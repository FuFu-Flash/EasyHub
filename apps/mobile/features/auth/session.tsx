import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { fetch as expoFetch } from 'expo/fetch';
import { GitHubClient, type GitHubUser } from '@easyhub/github';
import { type Credential, refreshCredential } from './deviceFlow';
import { createUiTestClient, simulateUiTestDownload, uiFixtureUser } from './uiTestFixtures';
import { throwIfCancelled as checkDownloadAbort } from '../network/cancellation.js';
import { withFreshReads } from '../network/freshReads';

const key = 'easyhub.github.credential';
const uiTestMode = __DEV__ && process.env.EXPO_PUBLIC_UI_TEST === '1';
interface Session {
  ready: boolean; user: GitHubUser | null; client: GitHubClient | null;
  signIn(credential: Credential): Promise<void>; signOut(): Promise<void>;
  downloadAndShare(path: string, name: string, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void>;
}
interface Connection { client: GitHubClient; token(): Promise<string>; deactivate(): void }
const Context = createContext<Session | null>(null);

function createConnection(initial: Credential): Connection {
  let current = initial;
  let pending: Promise<Credential> | null = null;
  let active = true;
  const token = async (): Promise<string> => {
    if (!active) throw new Error('请先使用 GitHub 登录。');
    if (!current.expiresAt || current.expiresAt > Date.now() + 60_000) return current.accessToken;
    pending ??= refreshCredential(current).then(async (renewed) => {
      if (!active) throw new Error('登录已取消。');
      await SecureStore.setItemAsync(key, JSON.stringify(renewed));
      current = renewed;
      return renewed;
    }).finally(() => { pending = null; });
    return (await pending).accessToken;
  };
  return { client: new GitHubClient(token, withFreshReads(expoFetch as typeof fetch)), token, deactivate: () => { active = false; } };
}

function createUiTestConnection(): Connection {
  return { client: createUiTestClient(), token: async () => 'easyhub-ui-test-in-memory-only', deactivate: () => undefined };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<Connection | null>(() => uiTestMode ? createUiTestConnection() : null);
  const [user, setUser] = useState<GitHubUser | null>(() => uiTestMode ? uiFixtureUser : null);
  const [ready, setReady] = useState(uiTestMode);

  const signIn = useCallback(async (value: Credential) => {
    if (uiTestMode) { setConnection(createUiTestConnection()); setUser(uiFixtureUser); return; }
    const next = createConnection(value);
    const account = await next.client.user();
    await SecureStore.setItemAsync(key, JSON.stringify(value));
    connection?.deactivate();
    setConnection(next);
    setUser(account);
  }, [connection]);
  const signOut = useCallback(async () => {
    connection?.deactivate();
    if (!uiTestMode) await SecureStore.deleteItemAsync(key);
    setConnection(null); setUser(null);
  }, [connection]);

  const downloadAndShare = useCallback(async (path: string, name: string, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal) => {
    if (!connection) throw new Error('请先使用 GitHub 登录。');
    if (!path.startsWith('/repos/') || !/^[-\w.]+$/.test(name)) throw new Error('下载地址无效。');
    checkDownloadAbort(signal);
    if (uiTestMode) { await simulateUiTestDownload(onProgress, signal); return; }
    const destination = new File(Paths.cache, `${Date.now()}-${name}`);
    try {
      const downloaded = await File.downloadFileAsync(`https://api.github.com${path}`, destination, {
        headers: { Authorization: `Bearer ${await connection.token()}`, Accept: path.includes('/releases/assets/') ? 'application/octet-stream' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        onProgress: ({ bytesWritten, totalBytes }) => onProgress(bytesWritten, totalBytes), signal,
      });
      checkDownloadAbort(signal);
      if (!await Sharing.isAvailableAsync()) throw new Error('此设备暂不支持保存或分享文件。');
      checkDownloadAbort(signal);
      await Sharing.shareAsync(downloaded.uri);
    } catch (cause) {
      try { if (destination.exists) destination.delete(); } catch { /* Preserve the download error. */ }
      throw cause;
    }
  }, [connection]);

  useEffect(() => {
    if (uiTestMode) return;
    let active = true;
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(key);
        if (!saved) return;
        let value = JSON.parse(saved) as Credential;
        if (value.expiresAt && value.expiresAt <= Date.now() + 60_000) value = await refreshCredential(value);
        const restored = createConnection(value);
        const account = await restored.client.user();
        if (active) { await SecureStore.setItemAsync(key, JSON.stringify(value)); setConnection(restored); setUser(account); }
        else restored.deactivate();
      } catch { await SecureStore.deleteItemAsync(key).catch(() => undefined); }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; };
  }, []);
  return <Context.Provider value={{ ready, user, client: connection?.client ?? null, signIn, signOut, downloadAndShare }}>{children}</Context.Provider>;
}

export function useSession(): Session {
  const session = useContext(Context);
  if (!session) throw new Error('SessionProvider is missing');
  return session;
}
