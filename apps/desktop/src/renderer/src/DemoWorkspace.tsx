import { useEffect, useRef, useState } from 'react';
import { BridgeContext, DemoModeContext, WorkspaceStorageContext } from './bridge';
import { createDemoBridge } from './demo/demoBridge';
import { LiveWorkspace } from './LiveWorkspace';

/** The demo owns data and bridge lifetime; the workspace owns all UI and navigation. */
export function DemoWorkspace({ onLogin, demoOnly = false }: { onLogin: () => void; demoOnly?: boolean }) {
  const [session] = useState(() => createDemoBridge(window.easyHub));
  const lifetime = useRef(0);
  useEffect(() => {
    const version = ++lifetime.current;
    // React StrictMode replays effects without discarding the session instance.
    return () => { queueMicrotask(() => { if (lifetime.current === version) session.dispose(); }); };
  }, [session]);
  return <BridgeContext.Provider value={session.api}><DemoModeContext.Provider value><WorkspaceStorageContext.Provider value={session.storage}>
    <LiveWorkspace user={session.user} onLogout={async () => { await session.api.authLogout(); }} demo={{ only: demoOnly, onLogin, onNotice: session.onNotice }} />
  </WorkspaceStorageContext.Provider></DemoModeContext.Provider></BridgeContext.Provider>;
}
