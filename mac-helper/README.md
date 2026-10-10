# Electron macOS SteamTools proxy helper

This executable reuses the six tested native proxy source files without linking
SwiftUI, loading GitHub credentials, changing hosts, or writing system settings.
Electron starts it only after the user enables the proxy. Control uses NDJSON on
stdin/stdout; stderr is reserved for diagnostics. Only GitHub destinations are
allowed through the loopback SOCKS5 listener `127.0.0.1:8868`; the generated PAC is
`http://127.0.0.1:8869/github.pac` and returns DIRECT for unrelated domains.

Build the Apple Silicon macOS 27 Release helper from the repository root:

```sh
bash EasyHubDesktop/mac-helper/build-helper.sh
```

The default output is `EasyHubDesktop/apps/desktop/resources/easyhub-proxy-helper`.
Package it as an Electron extra resource named `easyhub-proxy-helper`, outside
ASAR, and sign it together with the final application. An optional first argument
selects the output path. The script applies an ad hoc signature for local use.

Requests are `{ "id": "unique-request-id", "method": "start" }` lines. Supported
methods are `status`, `start`, `stop`, `probe`, and `shutdown`. Responses include
`id`, `ok`, `result`, and, on failure, `error`; unsolicited status events use
`event: "status"`. `start` fetches and validates SteamTools rules anew. `probe`
uses a credential-free GitHub public request through SOCKS5 with no direct
failover. EOF/SIGTERM/SIGINT cancel pending work, stop both listeners, and exit.

Local regression, without contacting GitHub or changing system settings:

```sh
bash EasyHubDesktop/mac-helper/build-helper.sh /tmp/easyhub-helper-debug --debug
python3 EasyHubDesktop/mac-helper/test-helper.py /tmp/easyhub-helper-debug
```

`--test-fixture` exists only in DEBUG builds. It injects a resolved SteamTools
rule and intercepts the fixed probe URL with URLProtocol. The test checks real
loopback PAC/SOCKS listeners, error responses, occupied-port rollback, stop,
reconnect, EOF, and SIGTERM. Probe transport in this test is a local fixture, not
proof of public-network TLS reachability. The Node service also has a Vitest
integration test using a separately compiled DEBUG helper.

App-level proxy configuration belongs to Electron main. The optional system
PAC setup is manual and applies to clients which support it; stopping the helper
does not remove a user's manually configured system PAC. Disable that setting
before stopping if it is in use. The project and helper remain under the
repository GPL v3 license.
