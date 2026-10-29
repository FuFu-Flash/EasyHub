import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionOperations,
  createSessionStorage,
  encodeSavedSession,
  parseSavedSession,
  restoreSavedSession,
  verifiedSessionUser,
} from "../features/auth/startupSession.ts";
import { CredentialExpiredError, refreshCredential } from "../features/auth/deviceFlow.ts";

const account = {
  id: 42,
  login: "real-account",
  name: "真实账号 · 原始内容",
  avatar_url: "https://avatars.githubusercontent.com/u/42",
  html_url: "https://github.com/real-account",
};
const credential = { accessToken: "saved-access", refreshToken: "saved-refresh" };
const saved = (user = account, value = credential) => ({ credential: value, user });
const rejectWith = (cause) => async () => {
  throw cause;
};
const noRefresh = async () => {
  throw Error("Unexpected refresh");
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("legacy credentials do not invent an identity and verified identity stays with its encrypted record", () => {
  assert.deepEqual(parseSavedSession(JSON.stringify(credential)), saved(null));
  assert.deepEqual(parseSavedSession(encodeSavedSession(saved())), saved());
  const rotation = { accessToken: "rotated-access", refreshToken: "rotated-refresh", expiresAt: 123456789 };
  assert.deepEqual(parseSavedSession(encodeSavedSession(saved(account, rotation))), saved(account, rotation));
  // No malformed profile or invented zero identity is accepted as an account.
  for (const user of [
    null,
    {},
    { ...account, id: 0 },
    { ...account, id: -1 },
    { ...account, login: "" },
    { ...account, login: "a/b" },
  ]) {
    assert.equal(parseSavedSession(JSON.stringify({ version: 1, credential, user })).user, null);
  }
  for (const raw of [
    "",
    "{",
    "null",
    "[]",
    "{}",
    '{"accessToken":""}',
    '{"accessToken":"with whitespace"}',
    '{"accessToken":"valid","expiresAt":-1}',
  ]) {
    assert.equal(parseSavedSession(raw), null);
  }
  assert.equal(verifiedSessionUser({ ...account, html_url: "https://untrusted.example/" }).html_url, account.html_url);
});

test("successful startup verifies the actual GitHub account before exposing it", async () => {
  const seen = [];
  const result = await restoreSavedSession(saved(null), {
    refresh: noRefresh,
    readUser: async (value, signal) => {
      seen.push([value.accessToken, signal.aborted]);
      return account;
    },
  });
  assert.equal(result.state, "signed-in");
  assert.deepEqual(result.user, account);
  assert.deepEqual(seen, [["saved-access", false]]);
});

test("offline and 403 preserve credentials and only an already verified real identity", async () => {
  for (const cause of [
    new TypeError("Network request failed"),
    Object.assign(Error("Limited"), { status: 403 }),
    Object.assign(Error("Unavailable"), { status: 503 }),
  ]) {
    for (const user of [null, account]) {
      const result = await restoreSavedSession(saved(user), { refresh: noRefresh, readUser: rejectWith(cause) });
      assert.equal(result.state, cause.status === 403 ? "forbidden" : "offline");
      assert.deepEqual(result.credential, credential);
      assert.deepEqual(result.user, user);
    }
  }
});

test("401 and explicit refresh expiry stop authorization without deleting or replacing credentials", async () => {
  const rejected = await restoreSavedSession(saved(), {
    refresh: noRefresh,
    readUser: rejectWith(Object.assign(Error("Rejected"), { status: 401 })),
  });
  assert.equal(rejected.state, "expired");
  assert.equal(rejected.user, null);
  assert.deepEqual(rejected.credential, credential);
  let reads = 0;
  const expired = { ...credential, expiresAt: 1 };
  const renewed = await restoreSavedSession(saved(account, expired), {
    refresh: rejectWith(new CredentialExpiredError()),
    readUser: async () => {
      reads++;
      return account;
    },
  });
  assert.equal(renewed.state, "expired");
  assert.equal(renewed.user, null);
  assert.equal(reads, 0);
  assert.deepEqual(renewed.credential, expired);
});

test("temporary token endpoint failures and malformed replies do not masquerade as expired sign-in", async () => {
  const expired = { ...credential, expiresAt: 1 };
  const replies = [
    Response.json({}, { status: 503 }),
    Response.json({ error: "bad_refresh_token" }, { status: 503 }),
    Response.json({}),
    Response.json({ error: "temporarily_unavailable" }),
  ];
  for (const reply of replies) {
    const result = await restoreSavedSession(saved(account, expired), {
      refresh: (value, signal) => refreshCredential(value, signal, async () => reply),
      readUser: async () => {
        throw Error("Profile request must wait for refresh");
      },
    });
    assert.equal(result.state, "offline");
    assert.deepEqual(result.credential, expired);
    assert.deepEqual(result.user, account);
  }
  const forbidden = await restoreSavedSession(saved(account, expired), {
    refresh: (value, signal) => refreshCredential(value, signal, async () => Response.json({}, { status: 403 })),
    readUser: rejectWith(Error("Unexpected read")),
  });
  assert.equal(forbidden.state, "forbidden");
  for (const error of ["bad_refresh_token", "expired_token", "invalid_grant"]) {
    for (const status of [200, 400])
      await assert.rejects(
        () => refreshCredential(expired, undefined, async () => Response.json({ error }, { status })),
        CredentialExpiredError,
      );
  }
});

test("a rotated credential survives a later profile outage and keeps only its known identity", async () => {
  const next = { accessToken: "next-access", refreshToken: "next-refresh", expiresAt: Date.now() + 3_600_000 };
  const result = await restoreSavedSession(saved(account, { ...credential, expiresAt: 1 }), {
    refresh: async () => next,
    readUser: async (value) => {
      assert.deepEqual(value, next);
      throw TypeError("Offline");
    },
  });
  assert.equal(result.state, "offline");
  assert.deepEqual(result.credential, next);
  assert.deepEqual(result.user, account);
  assert.deepEqual(parseSavedSession(encodeSavedSession(result)), saved(account, next));
});

test("a startup deadline aborts the request and a late profile cannot become an account", async () => {
  const response = deferred();
  let requestSignal;
  const result = await restoreSavedSession(saved(null), {
    timeout: 5,
    refresh: noRefresh,
    readUser: (_value, signal) => {
      requestSignal = signal;
      return response.promise;
    },
  });
  assert.equal(result.state, "offline");
  assert.equal(result.user, null);
  assert.equal(requestSignal.aborted, true);
  response.resolve(account);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.user, null);
});

test("explicit cancellation settles even when a transport ignores AbortSignal", async () => {
  const response = deferred();
  const controller = new AbortController();
  let requestSignal;
  const pending = restoreSavedSession(saved(), {
    signal: controller.signal,
    timeout: 1000,
    refresh: noRefresh,
    readUser: (_value, signal) => {
      requestSignal = signal;
      return response.promise;
    },
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(requestSignal.aborted, true);
  response.resolve(account);
});

test("auth generations invalidate a late restore when sign-out or another login wins", async () => {
  const operations = createSessionOperations();
  const first = operations.begin();
  assert.equal(first.current(), true);
  const second = operations.begin();
  assert.equal(first.current(), false);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.current(), true);
  operations.invalidate();
  assert.equal(second.current(), false);
  assert.equal(second.signal.aborted, true);
});

test("sign-out clears an already started refresh write and suppresses queued writes from the old account", async () => {
  let value = encodeSavedSession(saved());
  const started = deferred();
  const finish = deferred();
  let active = true;
  const writes = [];
  const storage = createSessionStorage({
    read: async () => value,
    write: async (raw) => {
      writes.push(parseSavedSession(raw).credential.accessToken);
      started.resolve();
      await finish.promise;
      value = raw;
    },
    remove: async () => {
      value = null;
    },
  });
  const inFlight = storage.save(saved(account, { accessToken: "rotated-access" }), () => active);
  await started.promise;
  const queued = storage.save(saved(account, { accessToken: "late-access" }), () => active);
  active = false;
  const signOut = storage.clear();
  finish.resolve();
  await Promise.all([inFlight, queued, signOut]);
  assert.equal(await storage.read(), null);
  assert.deepEqual(writes, ["rotated-access"]);
});

test("failed secure-storage operations do not poison later retry or new-account writes", async () => {
  let value = null;
  let fail = true;
  const storage = createSessionStorage({
    read: async () => value,
    write: async (raw) => {
      if (fail) {
        fail = false;
        throw Error("Storage unavailable");
      }
      value = raw;
    },
    remove: async () => {
      value = null;
    },
  });
  await assert.rejects(() => storage.save(saved()), /Storage unavailable/);
  const nextAccount = { ...account, id: 77, login: "other-account", html_url: "https://github.com/other-account" };
  await storage.save(saved(nextAccount, { accessToken: "other-access" }));
  assert.equal(parseSavedSession(await storage.read()).user.login, "other-account");
  await storage.clear();
  assert.equal(await storage.read(), null);
});

test("invalid server identity never enters signed-in or cached-account state", async () => {
  for (const invalid of [
    { ...account, id: undefined },
    { ...account, login: "" },
    { ...account, name: undefined },
  ]) {
    const result = await restoreSavedSession(saved(null), { refresh: noRefresh, readUser: async () => invalid });
    assert.equal(result.state, "offline");
    assert.equal(result.user, null);
  }
});
