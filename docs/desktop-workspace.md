# Desktop workspace ownership

`LiveWorkspace.tsx` is the shared real/demo shell. It owns layout, window controls,
topbar input, navigation entry points and refresh animation. It does not fetch or
hold page content.

## Shared state

`workspace/WorkspaceContext.tsx` uses React context and `workspaceReducer` for the
account, language/preferences, repositories, local links/status, activity counts
and feedback. The scoped bridge and storage from Stage B remain the only route to
native or demo operations. No state library is required.

`pages/` owns the individual destinations. Existing domain UI such as
`LocalWorkspace`, `PublicProjectBrowser`, `SourceHistory` and `PullRequestsPanel`
is composed by the corresponding page, retaining its own local state and data
loading. These embedded readers retain their internal navigation; it is separate
from the outer workspace stack.

## Navigation

`workspace/navigation.ts` is a pure reducer. Every history entry is exactly:

```ts
{ view, params, scrollTop }
```

Parameters identify repositories, issue numbers, commit SHAs, local links, search
filters/pages, users and release targets. They contain no fetched objects, data
arrays, state setter callbacks or restoration closures. Sidebar bookmarks use the
same destination structure, and switching sidebar sections creates a normal
chronological visit. A second click on the active section opens its root.

Pages read their own `PageRouteContext`, rather than the currently visible route
of another retained page. `NavigationPages` retains visited component trees for
drafts, open dialogs and paged UI. `usePageData` revalidates when a page becomes
active, keeps a session memory cache visible during reload, and discards results
from requests that outlived that active page. Async feedback from a hidden page
cannot appear on the current page. Completed release publication replaces its
submit destination; deleting/transferring a repository prunes its destinations.

The outer scroll restorer responds to outer navigation. An embedded reader's
reported tab/detail identifier must not restart it: embedded readers own their
internal scroll restoration. Keyboard and mouse navigation still select the
deepest visible reader before the workspace stack.

## Verification

- `npm run test:navigation-state`
- `npm run test:navigation-detail`
- `npm run test:navigation-chain` (also `--case=cross-release`, `profile`,
  `public-pull`, `chronological` via the desktop script directly)
- `npm run test:release-navigation`
- `npm run test:discovery-navigation`
- `npm run test:demo-navigation-chain`
- `npm run review:workspace-navigation`

The independent review runs the signed-in UI with an isolated in-memory API
fixture, blocks external network traffic, and never operates a real GitHub
account. It covers the complete return chain, retained draft/revalidation, and
six main pages at 1440/1000 widths in both languages and layout densities.

## macOS native shell

`workspace/useNativeShell.ts` connects native menu commands to the same navigation
controller used by page controls. It owns no repository data. Authentication and
welcome screens retain a pending native command and hand it to the mounted
workspace, including when Settings reopens the last closed window.

Native menu labels use the shared Chinese/English catalogs. Menu state follows
sign-in, loading and visible dialogs. AppKit draws the macOS traffic lights; the
renderer reserves their space and synchronizes the saved style and layout density.
Windows retains its own window controls and default preference.

The macOS build uses the shared GitHub proxy service with `MacSystemProxy` as the
OS adapter. Test profiles use memory credentials and skip acquiring system proxy
settings. Keep native menu and compact-package smoke tests on the packaged app,
and run workspace/localization/new-project layout tests against the shared UI.

## Linux window

Linux uses the same frameless window and in-app minimize, maximize and close
buttons as Windows. It does not install the macOS application menu. The window
icon is `easyhub.png`. Login uses the system secret service through the existing
keyring library. GitHub access inside the app can be turned on without rewriting
desktop proxy settings; an existing proxy is reused. Program-file review
components remain available only for Windows x64 and Apple Silicon macOS.
