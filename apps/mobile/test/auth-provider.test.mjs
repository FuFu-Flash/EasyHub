import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as startup from "../features/auth/startupSession.ts";
import { InterfaceError } from "../features/localization/error.ts";
import { CredentialExpiredError } from "../features/auth/deviceFlow.ts";
import { isEmptyAddedPullFile } from "../../../packages/github/src/pullFiles.js";

const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const sourcePath = fileURLToPath(new URL("../features/auth/session.tsx", import.meta.url));
const source = fs.readFileSync(sourcePath, "utf8") + "\nexport { createConnection };";
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const githubModule = { exports: {} };
const githubSource = fs.readFileSync(new URL("../../../packages/github/src/index.ts", import.meta.url), "utf8");
const githubCompiled = ts.transpileModule(githubSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInThisContext(`(function(require,module,exports){${githubCompiled}\n})`)(
  (id) => {
    if (id !== "./pullFiles.js") throw Error(`Unexpected GitHub client import: ${id}`);
    return { isEmptyAddedPullFile };
  },
  githubModule,
  githubModule.exports,
);
const account = {
  id: 42,
  login: "real-account",
  name: "Verified account",
  avatar_url: "https://avatars.githubusercontent.com/u/42",
  html_url: "https://github.com/real-account",
};
const otherAccount = { ...account, id: 77, login: "second-account", html_url: "https://github.com/second-account" };
const credential = { accessToken: "saved-access", refreshToken: "saved-refresh" };
const renewed = () => ({ accessToken: "next-access", refreshToken: "next-refresh", expiresAt: Date.now() + 3_600_000 });
const saved = (user = account, value = credential) => startup.encodeSavedSession({ credential: value, user });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let index = 0; index < 4; index++) await new Promise((resolve) => setImmediate(resolve));
};

/** Execute the real provider and connection; only React hooks and native/network I/O are isolated. */
function load(options = {}) {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let raw = options.raw === undefined ? saved() : options.raw;
  let reads = 0;
  let writes = 0;
  let removes = 0;
  let refreshes = 0;
  const profileTokens = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    createContext: () => ({ Provider: "Provider" }),
    useContext: () => null,
    useState: (initial) => {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [
        slots[index].value,
        (value) => {
          slots[index].value = typeof value === "function" ? value(slots[index].value) : value;
        },
      ];
    },
    useRef: (initial) => {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useCallback: (callback, deps) => {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useEffect: (callback, deps) => {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].deps, deps)) {
        slots[index] = { callback, deps };
        effects.push(slots[index]);
      }
    },
  };
  const mocks = {
    react: hooks,
    "react/jsx-runtime": { jsx: (type, props, key) => ({ type, props, key }) },
    "expo-secure-store": {
      getItemAsync: async () => {
        reads++;
        if (options.read) await options.read(reads);
        return raw;
      },
      setItemAsync: async (_key, value) => {
        writes++;
        if (options.write) await options.write(writes, value);
        raw = value;
      },
      deleteItemAsync: async () => {
        removes++;
        if (options.remove) await options.remove(removes);
        raw = null;
      },
    },
    "expo-file-system": { File: class {}, Paths: {} },
    "expo-sharing": {},
    "expo/fetch": {
      fetch: async (input, init) => {
        if (new URL(String(input)).origin !== "https://api.github.com" || new URL(String(input)).pathname !== "/user")
          throw Error("Unexpected isolated auth endpoint");
        const token = new Headers(init.headers).get("Authorization")?.replace(/^Bearer /u, "");
        profileTokens.push(token);
        return Response.json(options.user ? await options.user(token, init.signal) : account);
      },
    },
    "@easyhub/github": githubModule.exports,
    "./deviceFlow": {
      refreshCredential: async (value, signal) => {
        refreshes++;
        return options.refresh ? options.refresh(value, signal, refreshes) : renewed();
      },
    },
    "./uiTestFixtures": {
      createUiTestClient: () => {
        throw Error("Production provider must not enter fixture mode");
      },
    },
    "../network/cancellation.js": {},
    "../network/freshReads": { withFreshReads: (transport) => transport },
    "../localization/error.ts": { InterfaceError },
    "./startupSession": startup,
  };
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports,__DEV__){${compiled}\n})`)(
    (id) => {
      if (!Object.hasOwn(mocks, id)) throw Error(`Unexpected provider import: ${id}`);
      return mocks[id];
    },
    module,
    module.exports,
    false,
  );
  const render = () => {
    cursor = 0;
    return module.exports.SessionProvider({ children: "router" });
  };
  return {
    render,
    effects,
    connection: module.exports.createConnection,
    value: () => render().props.value,
    raw: () => raw,
    reads: () => reads,
    writes: () => writes,
    removes: () => removes,
    refreshes: () => refreshes,
    profileTokens,
  };
}

test("StrictMode effect setup-cleanup-setup starts a fresh restore and settles the real provider", async () => {
  const app = load();
  app.render();
  const effect = app.effects[0];
  effect.callback()();
  const cleanup = effect.callback();
  await flush();
  const session = app.value();
  assert.equal(session.ready, true);
  assert.equal(session.retrying, false);
  assert.equal(session.user.id, 42);
  assert.equal(app.reads(), 2);
  cleanup();
});

test("rapid retry clicks share one active provider restore", async () => {
  const profile = deferred();
  const app = load({ user: () => profile.promise });
  app.render();
  const cleanup = app.effects[0].callback();
  await flush();
  const first = app.value().retrySession();
  const second = app.value().retrySession();
  assert.equal(first, second);
  assert.equal(app.reads(), 1);
  profile.resolve(account);
  await first;
  await flush();
  assert.equal(app.value().ready, true);
  assert.equal(app.value().retrying, false);
  cleanup();
});

test("sign-out during an abort-ignoring profile request never restores the account or its credential", async () => {
  const profile = deferred();
  const app = load({ user: () => profile.promise });
  app.render();
  const cleanup = app.effects[0].callback();
  await flush();
  await app.value().signOut();
  profile.resolve(account);
  await flush();
  assert.equal(app.value().ready, true);
  assert.equal(app.value().user, null);
  assert.equal(app.value().client, null);
  assert.equal(app.raw(), null);
  assert.equal(app.writes(), 0);
  cleanup();
});

test("a new sign-in wins over a late startup response and changes the provider account boundary", async () => {
  const profile = deferred();
  const app = load({ user: (token) => (token === "saved-access" ? profile.promise : otherAccount) });
  app.render();
  const cleanup = app.effects[0].callback();
  await flush();
  await app.value().signIn({ accessToken: "second-access" });
  profile.resolve(account);
  await flush();
  const rendered = app.render();
  assert.equal(rendered.key, 77);
  assert.equal(rendered.props.value.user.id, 77);
  const stored = startup.parseSavedSession(app.raw());
  assert.equal(stored.user.login, "second-account");
  assert.equal(stored.credential.accessToken, "second-access");
  cleanup();
});

test("a failed deep-linked sign-in cannot leave the canceled initial restore permanently loading", async () => {
  const read = deferred();
  const app = load({
    read: (count) => (count === 1 ? read.promise : undefined),
    user: async () => {
      throw TypeError("Offline");
    },
  });
  app.render();
  const cleanup = app.effects[0].callback();
  await flush();
  await assert.rejects(() => app.value().signIn({ accessToken: "new-unverified-access" }), /Offline/);
  read.resolve();
  await flush();
  const session = app.value();
  assert.equal(session.ready, true);
  assert.equal(session.retrying, false);
  assert.equal(session.recovery, "offline");
  assert.equal(session.user.id, 42);
  assert.equal(startup.parseSavedSession(app.raw()).credential.accessToken, "saved-access");
  cleanup();
});

test("normal connection retries a failed rotated-credential save without rotating twice", async () => {
  const app = load();
  let attempts = 0;
  const problems = [];
  const connection = app.connection(
    { ...credential, expiresAt: 1 },
    account,
    async () => {
      attempts++;
      if (attempts === 1) throw Error("Secure storage unavailable");
    },
    (failed) => problems.push(failed),
  );
  assert.equal(await connection.token(), "next-access");
  assert.equal(await connection.token(), "next-access");
  assert.equal(app.refreshes(), 1);
  assert.equal(attempts, 2);
  assert.deepEqual(problems, [true, false]);
  connection.deactivate();
});

test("provider retry uses a rotated in-memory credential after persistence failed", async () => {
  const app = load({
    raw: saved(account, { ...credential, expiresAt: 1 }),
    write: async (count) => {
      if (count === 1) throw Error("Storage unavailable once");
    },
    refresh: async (_value, _signal, count) => {
      if (count > 1) throw new CredentialExpiredError();
      return renewed();
    },
  });
  app.render();
  const cleanup = app.effects[0].callback();
  await flush();
  assert.equal(app.value().recovery, "storage");
  assert.equal(app.value().user.id, 42);
  assert.equal(startup.parseSavedSession(app.raw()).credential.accessToken, "saved-access");
  await app.value().retrySession();
  await flush();
  assert.equal(app.value().recovery, null);
  assert.equal(app.value().user.id, 42);
  assert.equal(app.refreshes(), 1);
  assert.deepEqual(app.profileTokens, ["next-access", "next-access"]);
  assert.equal(startup.parseSavedSession(app.raw()).credential.accessToken, "next-access");
  cleanup();
});

test("concurrent native requests share one token renewal and sign-out deactivates the old connection", async () => {
  const refresh = deferred();
  const app = load({ refresh: () => refresh.promise });
  let saves = 0;
  const connection = app.connection({ ...credential, expiresAt: 1 }, account, async () => {
    saves++;
  });
  const first = connection.token();
  const second = connection.token();
  refresh.resolve(renewed());
  assert.deepEqual(await Promise.all([first, second]), ["next-access", "next-access"]);
  assert.equal(app.refreshes(), 1);
  assert.equal(saves, 1);
  connection.deactivate();
  await assert.rejects(() => connection.token(), /session.signInWithGitHubFirst|GitHub/);
});

test("same-account recovery preserves the client while advancing its read revision", async () => {
  const app = load();
  app.render();
  const cleanup = app.effects[0].callback();
  await flush();
  const before = app.value();
  await before.retrySession();
  await flush();
  const after = app.value();
  assert.equal(after.user.id, before.user.id);
  assert.equal(after.client, before.client);
  assert.equal(after.readRevision, before.readRevision + 1);
  assert.equal(after.recovery, null);
  cleanup();
});

test("a client captured by the previous account cannot read using a newly signed-in account", async () => {
  const app = load({ user: (token) => (token === "second-access" ? otherAccount : account) });
  app.render();
  const cleanup = app.effects[0].callback();
  await flush();
  const previous = app.value().client;
  await app.value().signIn({ accessToken: "second-access" });
  assert.notEqual(app.value().client, previous);
  await assert.rejects(() => previous.user(), /GitHub/);
  assert.equal((await app.value().client.user()).id, 77);
  cleanup();
});

test("old renewal callbacks cannot publish tokens or clear the pending renewal of a new epoch", async () => {
  const old = deferred();
  const fresh = deferred();
  let count = 0;
  const app = load({ refresh: () => (++count === 1 ? old.promise : fresh.promise) });
  let saves = 0;
  const connection = app.connection({ ...credential, expiresAt: 1 }, account, async () => {
    saves++;
  });
  const stale = connection.token();
  connection.deactivate();
  assert.equal(
    connection.reactivate({
      credential: { accessToken: "same-account-new", refreshToken: "same-account-refresh", expiresAt: 1 },
      user: account,
    }),
    true,
  );
  const next = connection.token();
  old.resolve({ accessToken: "old-late-token" });
  await assert.rejects(stale, /取消|canceled/);
  const concurrent = connection.token();
  assert.equal(count, 2);
  assert.equal(saves, 0);
  fresh.resolve(renewed());
  assert.deepEqual(await Promise.all([next, concurrent]), ["next-access", "next-access"]);
  assert.equal(count, 2);
  assert.equal(saves, 1);
  assert.equal(
    connection.reactivate({ credential: { accessToken: "other-account-token" }, user: otherAccount }),
    false,
  );
  assert.equal(await connection.token(), "next-access");
  connection.deactivate();
});

test("failed sign-out from a deep-linked startup settles ready with a storage recovery state", async () => {
  const read = deferred();
  const app = load({
    read: () => read.promise,
    remove: async () => {
      throw Error("Storage unavailable");
    },
  });
  app.render();
  const cleanup = app.effects[0].callback();
  await flush();
  await app.value().signOut();
  read.resolve();
  await flush();
  assert.equal(app.value().ready, true);
  assert.equal(app.value().retrying, false);
  assert.equal(app.value().user, null);
  assert.equal(app.value().recovery, "storage");
  assert.notEqual(app.raw(), null);
  cleanup();
});

test("deactivation around completed renewal prevents an undispatched real client request from being sent", async () => {
  for (let ticks = 0; ticks < 16; ticks++) {
    const refresh = deferred();
    const app = load({ refresh: () => refresh.promise });
    const connection = app.connection({ ...credential, expiresAt: 1 }, account, async () => undefined);
    const pending = connection.client.user().then(
      (user) => ({ user }),
      (error) => ({ error }),
    );
    refresh.resolve(renewed());
    for (let index = 0; index < ticks; index++) await Promise.resolve();
    const alreadyDispatched = app.profileTokens.length > 0;
    connection.deactivate();
    const result = await pending;
    if (!alreadyDispatched) {
      assert.ok(result.error, `tick ${ticks}: a request canceled before dispatch must reject`);
      assert.equal(app.profileTokens.length, 0, `tick ${ticks}: late token must not start an old-account request`);
    }
  }
});

test("the renewal owner rechecks its epoch after the refresh promise and finally continuation settle", async () => {
  for (let ticks = 0; ticks < 9; ticks++) {
    const refresh = deferred();
    const app = load({ refresh: () => refresh.promise });
    const connection = app.connection({ ...credential, expiresAt: 1 }, account, async () => undefined);
    const pending = connection.token();
    refresh.resolve(renewed());
    for (let index = 0; index < ticks; index++) await Promise.resolve();
    connection.deactivate();
    await assert.rejects(pending, /取消|canceled/, `tick ${ticks}: the old renewal must reject after deactivation`);
  }
});
