import { InterfaceError } from '../localization/error.ts';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { fetch as expoFetch } from 'expo/fetch';
import { GitHubClient, type GitHubUser } from '@easyhub/github';
import { type Credential, refreshCredential } from './deviceFlow';
import { createUiTestClient, simulateUiTestDownload, uiFixtureUser } from './uiTestFixtures';
import { throwIfCancelled as checkDownloadAbort } from '../network/cancellation.js';
import { withFreshReads } from '../network/freshReads';
import { createSessionOperations, createSessionStorage, restoreSavedSession, parseSavedSession, verifiedSessionUser, type SavedSession, type SessionRecovery } from './startupSession';

const key = 'easyhub.github.credential';
const storage = createSessionStorage({
  read: () => SecureStore.getItemAsync(key),
  write: (value) => SecureStore.setItemAsync(key, value),
  remove: () => SecureStore.deleteItemAsync(key),
});
const transport = withFreshReads(expoFetch as typeof fetch);
const readUser = (credential: Credential, signal: AbortSignal) => new GitHubClient(async () => credential.accessToken, transport).user(signal);
const uiTestMode = __DEV__ && process.env.EXPO_PUBLIC_UI_TEST === '1';
interface Session {
  ready: boolean; user: GitHubUser | null; client: GitHubClient | null;
  recovery: SessionRecovery | null; retrying: boolean; readRevision: number; retrySession(): Promise<void>;
  signIn(credential: Credential): Promise<void>; signOut(): Promise<void>;
  downloadAndShare(path: string, name: string, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void>;
}
interface Connection { client: GitHubClient; token(): Promise<string>; deactivate(): void; reactivate(value: SavedSession): boolean; snapshot(): SavedSession }
const Context = createContext<Session | null>(null);

function createConnection(initial: Credential, initialUser: GitHubUser | null,
  save: (value: SavedSession, current: () => boolean) => Promise<void>,
  persistenceProblem: (failed: boolean) => void = () => undefined): Connection {
  let current = initial;
  let user = initialUser;
  const accountId = initialUser?.id;
  let pending: Promise<Credential> | null = null;
  let active = true;
  let dirty = false;
  let epoch = 0;
  let lifetime = new AbortController();
  const check = (request: number) => {
    if (!active || epoch !== request) throw new InterfaceError('deviceFlow.signInCanceled');
  };
  const persist = async (request: number) => {
    if (!dirty) return;
    try {
      await save({ credential: current, user }, () => active && epoch === request);
      if (active && epoch === request) { dirty = false; persistenceProblem(false); }
    } catch { if (active && epoch === request) persistenceProblem(true); }
  };
  const token = async (): Promise<string> => {
    if (!active) throw new InterfaceError("session.signInWithGitHubFirst").withDiagnostic("请先使用 GitHub 登录。");
    const request = epoch;
    if (pending) { const value = await pending; check(request); return value.accessToken; }
    if (!current.expiresAt || current.expiresAt > Date.now() + 60_000) {
      await persist(request); check(request); return current.accessToken;
    }
    const refresh = refreshCredential(current, lifetime.signal).then(async (renewed) => {
      check(request);
      current = renewed; dirty = true;
      await persist(request); check(request);
      return renewed;
    }).finally(() => { if (pending === refresh) pending = null; });
    pending = refresh;
    const value = await refresh; check(request); return value.accessToken;
  };
  return { client: new GitHubClient(token, (input, init) => {
    // Token resolution and the client's await continuation are separate microtasks.
    if (!active) throw new InterfaceError('deviceFlow.signInCanceled');
    return transport(input, init);
  }), token,
    deactivate: () => { active = false; epoch += 1; lifetime.abort(); pending = null; },
    reactivate: (value) => {
      // A client captured by the old account must never borrow another account's token.
      if (!Number.isSafeInteger(accountId) || value.user?.id !== accountId) return false;
      epoch += 1; lifetime.abort(); lifetime = new AbortController(); pending = null;
      current = value.credential; user = value.user; dirty = false; active = true;
      return true;
    },
    snapshot: () => ({ credential: current, user }) };
}

function createUiTestConnection(): Connection {
  return { client: createUiTestClient(), token: async () => 'easyhub-ui-test-in-memory-only', deactivate: () => undefined, reactivate: () => false,
    snapshot: () => ({ credential: { accessToken: 'easyhub-ui-test-in-memory-only' }, user: uiFixtureUser }) };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<Connection | null>(() => uiTestMode ? createUiTestConnection() : null);
  const [user, setUser] = useState<GitHubUser | null>(() => uiTestMode ? uiFixtureUser : null);
  const [ready, setReady] = useState(uiTestMode);
  const [recovery, setRecovery] = useState<SessionRecovery | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [readRevision, setReadRevision] = useState(0);
  const connectionRef = useRef(connection);
  const [operations] = useState(createSessionOperations);
  const pendingRestore = useRef<Promise<void> | null>(null);

  const realConnection = useCallback((saved: SavedSession) => {
    let next: Connection;
    next = createConnection(saved.credential, saved.user, (value, active) =>
      storage.save(value, () => active() && connectionRef.current === next),
    (failed) => {
      if (connectionRef.current === next) setRecovery((current) => failed ? 'storage' : current === 'storage' ? null : current);
    });
    return next;
  }, []);
  const publish = useCallback((next: Connection | null, account: GitHubUser | null, failure: SessionRecovery | null) => {
    const previous = connectionRef.current;
    if (previous && next && account && previous.reactivate(next.snapshot())) {
      next.deactivate(); next = previous;
    } else if (previous !== next) previous?.deactivate();
    connectionRef.current = next;
    setConnection(next); setUser(account); setRecovery(failure);
  }, []);

  const retrySession = useCallback((): Promise<void> => {
    if (uiTestMode) return Promise.resolve();
    if (pendingRestore.current) return pendingRestore.current;
    const operation = operations.begin();
    const previous = connectionRef.current?.snapshot() ?? null;
    // A retry owns renewal; an older connection cannot rotate the same refresh token concurrently.
    connectionRef.current?.deactivate();
    setRetrying(true);
    const pending = (async () => {
      try {
        const raw = await storage.read();
        if (!operation.current()) return;
        // A failed credential write must not discard a valid rotated credential still in memory.
        const saved = previous?.user ? previous : raw ? parseSavedSession(raw) : null;
        if (!saved) { publish(null, null, raw ? 'expired' : null); return; }
        const result = await restoreSavedSession(saved, { readUser, refresh: refreshCredential, signal: operation.signal });
        if (!operation.current()) return;
        const cached = { credential: result.credential, user: result.state === 'signed-in' ? result.user : saved.user };
        let failure: SessionRecovery | null = result.state === 'signed-in' ? null : result.state;
        if (result.state === 'signed-in' || JSON.stringify(result.credential) !== JSON.stringify(saved.credential)) {
          try { await storage.save(cached, operation.current); } catch { failure = 'storage'; }
        }
        if (!operation.current()) return;
        publish(result.user ? realConnection({ credential: result.credential, user: result.user }) : null, result.user, failure);
        if (result.state === 'signed-in') setReadRevision((value) => value + 1);
      } catch {
        if (operation.current()) publish(previous?.user ? realConnection(previous) : null, previous?.user ?? null, 'storage');
      } finally {
        if (operation.current()) { setReady(true); setRetrying(false); }
      }
    })();
    pendingRestore.current = pending;
    void pending.finally(() => { if (pendingRestore.current === pending) pendingRestore.current = null; });
    return pending;
  }, [operations, publish, realConnection]);

  const signIn = useCallback(async (value: Credential) => {
    if (uiTestMode) { publish(createUiTestConnection(), uiFixtureUser, null); setReady(true); return; }
    const operation = operations.begin();
    pendingRestore.current = null;
    const previous = connectionRef.current?.snapshot() ?? null;
    connectionRef.current?.deactivate();
    setRetrying(true);
    try {
      const account = verifiedSessionUser(await readUser(value, operation.signal));
      if (!operation.current()) throw new InterfaceError('deviceFlow.signInCanceled');
      if (!account) throw new InterfaceError('login.signInFailedPleaseTryAgain');
      await storage.save({ credential: value, user: account }, operation.current);
      if (!operation.current()) throw new InterfaceError('deviceFlow.signInCanceled');
      publish(realConnection({ credential: value, user: account }), account, null);
      setReadRevision((current) => current + 1); setReady(true);
    } catch (cause) {
      if (operation.current()) {
        if (previous?.user) publish(realConnection(previous), previous.user, recovery);
        setReady(true);
        // A failed login must not strand the initial restore it canceled in a loading state.
        if (!ready && !previous?.user) void retrySession();
      }
      throw cause;
    } finally { if (operation.current()) setRetrying(false); }
  }, [operations, publish, realConnection, ready, recovery, retrySession]);
  const signOut = useCallback(async () => {
    const operation = operations.begin();
    pendingRestore.current = null;
    const previous = connectionRef.current?.snapshot() ?? null;
    connectionRef.current?.deactivate();
    setRetrying(false);
    try {
      if (!uiTestMode) await storage.clear();
      if (operation.current()) { publish(null, null, null); setReady(true); }
    } catch {
      if (operation.current()) {
        publish(previous?.user ? realConnection(previous) : null, previous?.user ?? null, 'storage');
        setReady(true);
      }
    }
  }, [operations, publish, realConnection]);

  const downloadAndShare = useCallback(async (path: string, name: string, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal) => {
    if (!connection) throw new InterfaceError("session.signInWithGitHubFirst").withDiagnostic("请先使用 GitHub 登录。");
    if (!path.startsWith('/repos/') || !/^[-\w.]+$/.test(name)) throw new InterfaceError("session.theDownloadAddressIsInvalid").withDiagnostic("下载地址无效。");
    checkDownloadAbort(signal);
    if (uiTestMode) { await simulateUiTestDownload(onProgress, signal); return; }
    const destination = new File(Paths.cache, `${Date.now()}-${name}`);
    try {
      const downloaded = await File.downloadFileAsync(`https://api.github.com${path}`, destination, {
        headers: { Authorization: `Bearer ${await connection.token()}`, Accept: path.includes('/releases/assets/') ? 'application/octet-stream' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        onProgress: ({ bytesWritten, totalBytes }) => onProgress(bytesWritten, totalBytes), signal,
      });
      checkDownloadAbort(signal);
      if (!await Sharing.isAvailableAsync()) throw new InterfaceError("session.savingOrSharingFilesIsUnavailableOnThisDevice").withDiagnostic("此设备暂不支持保存或分享文件。");
      checkDownloadAbort(signal);
      await Sharing.shareAsync(downloaded.uri);
    } catch (cause) {
      try { if (destination.exists) destination.delete(); } catch { /* Preserve the download error. */ }
      throw cause;
    }
  }, [connection]);

  useEffect(() => {
    if (uiTestMode) return;
    void retrySession();
    return () => { operations.invalidate(); pendingRestore.current = null; connectionRef.current?.deactivate(); };
  }, [operations, retrySession]);
  // Retained screens, drafts and private read caches belong to one verified account.
  return <Context.Provider key={user?.id ?? user?.login ?? 'signed-out'} value={{ ready, user, client: connection?.client ?? null,
    recovery, retrying, readRevision, retrySession, signIn, signOut, downloadAndShare }}>{children}</Context.Provider>;
}

export function useSession(): Session {
  const session = useContext(Context);
  if (!session) throw new Error('SessionProvider is missing');
  return session;
}
