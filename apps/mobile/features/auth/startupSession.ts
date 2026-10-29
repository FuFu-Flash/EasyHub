import type { GitHubUser } from "@easyhub/github";
import type { Credential } from "./deviceFlow.ts";

export interface SavedSession {
  credential: Credential;
  user: GitHubUser | null;
}
export type SessionRecovery = "offline" | "forbidden" | "expired" | "storage";
export type StartupSession = SavedSession & { state: "signed-in" | "offline" | "forbidden" | "expired" };

/** Identity is saved only after /user succeeds; older credential-only records have no identity. */
export function verifiedSessionUser(value: unknown): GitHubUser | null {
  if (!value || typeof value !== "object") return null;
  const user = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(user.id) ||
    Number(user.id) <= 0 ||
    typeof user.login !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(user.login) ||
    (user.name !== null && (typeof user.name !== "string" || user.name.length > 256)) ||
    typeof user.avatar_url !== "string" ||
    user.avatar_url.length > 2048
  )
    return null;
  return {
    id: Number(user.id),
    login: user.login,
    name: user.name as string | null,
    avatar_url: user.avatar_url,
    html_url: `https://github.com/${user.login}`,
  };
}

function credentialValue(value: unknown): Credential | null {
  if (!value || typeof value !== "object") return null;
  const credential = value as Record<string, unknown>;
  const token = (entry: unknown) =>
    typeof entry === "string" && entry.length > 0 && entry.length <= 4096 && !/\s/u.test(entry);
  if (
    !token(credential.accessToken) ||
    (credential.refreshToken !== undefined && !token(credential.refreshToken)) ||
    (credential.expiresAt !== undefined &&
      (typeof credential.expiresAt !== "number" || !Number.isFinite(credential.expiresAt) || credential.expiresAt <= 0))
  )
    return null;
  return {
    accessToken: credential.accessToken as string,
    ...(typeof credential.refreshToken === "string" ? { refreshToken: credential.refreshToken } : {}),
    ...(typeof credential.expiresAt === "number" ? { expiresAt: credential.expiresAt } : {}),
  };
}

export function parseSavedSession(raw: string): SavedSession | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (record.version === 1) {
      const credential = credentialValue(record.credential);
      return credential ? { credential, user: verifiedSessionUser(record.user) } : null;
    }
    const credential = credentialValue(value);
    return credential ? { credential, user: null } : null;
  } catch {
    return null;
  }
}

/** A single encrypted record binds the cached identity to its credential, including rotation. */
export function encodeSavedSession(value: SavedSession): string {
  const credential = credentialValue(value.credential);
  if (!credential) throw new Error("Invalid saved credential");
  return JSON.stringify({ version: 1, credential, user: verifiedSessionUser(value.user) });
}

const abortError = () => Object.assign(new Error("Session operation canceled"), { name: "AbortError" });

/** Only a definitive authorization failure expires a session; transient failures keep it recoverable. */
export async function restoreSavedSession(
  saved: SavedSession,
  options: {
    readUser(credential: Credential, signal: AbortSignal): Promise<GitHubUser>;
    refresh(credential: Credential, signal: AbortSignal): Promise<Credential>;
    signal?: AbortSignal;
    timeout?: number;
    now?: number;
  },
): Promise<StartupSession> {
  const controller = new AbortController();
  let credential = saved.credential;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => undefined;
  const check = () => {
    if (controller.signal.aborted) throw abortError();
  };
  const deadline = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      controller.abort();
      reject(abortError());
    };
    if (options.signal?.aborted) {
      cancel();
      return;
    }
    options.signal?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Session verification timed out"));
    }, options.timeout ?? 8000);
  });
  try {
    const work = (async () => {
      check();
      if (credential.expiresAt && credential.expiresAt <= (options.now ?? Date.now()) + 60_000) {
        const renewed = await options.refresh(credential, controller.signal);
        check();
        const valid = credentialValue(renewed);
        if (!valid) throw new Error("Invalid renewed credential");
        credential = valid;
      }
      const account = await options.readUser(credential, controller.signal);
      check();
      const user = verifiedSessionUser(account);
      if (!user) throw new Error("Invalid GitHub identity");
      return user;
    })();
    const user = await Promise.race([work, deadline]);
    return { state: "signed-in", credential, user };
  } catch (cause) {
    if (options.signal?.aborted) throw abortError();
    const failure = cause && typeof cause === "object" ? (cause as { status?: unknown; code?: unknown }) : {};
    const state =
      failure.status === 401 || failure.code === "GITHUB_CREDENTIAL_EXPIRED"
        ? "expired"
        : failure.status === 403
          ? "forbidden"
          : "offline";
    return { state, credential, user: state === "expired" ? null : verifiedSessionUser(saved.user) };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

/** All writes share one queue, so sign-out removal follows an already started refresh write. */
export function createSessionStorage(storage: {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}) {
  let tail = Promise.resolve();
  const enqueue = (action: () => Promise<void>) => {
    const pending = tail.then(action);
    tail = pending.catch(() => undefined);
    return pending;
  };
  return {
    read: async () => {
      await tail;
      return storage.read();
    },
    save: (value: SavedSession, current: () => boolean = () => true) =>
      enqueue(async () => {
        if (current()) await storage.write(encodeSavedSession(value));
      }),
    clear: () => enqueue(() => storage.remove()),
  };
}

export function createSessionOperations() {
  let generation = 0;
  let controller: AbortController | null = null;
  const invalidate = () => {
    generation += 1;
    controller?.abort();
    controller = null;
  };
  return {
    invalidate,
    begin: () => {
      invalidate();
      const own = new AbortController();
      controller = own;
      const request = generation;
      return { signal: own.signal, current: () => generation === request && !own.signal.aborted };
    },
  };
}
