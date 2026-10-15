import { createContext, useContext } from 'react';

export type EasyHubBridge = NonNullable<Window['easyHub']>;
export const BridgeContext = createContext<EasyHubBridge | undefined>(undefined);
export const DemoModeContext = createContext(false);
export type WorkspaceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const WorkspaceStorageContext = createContext<WorkspaceStorage | undefined>(undefined);
export function useWorkspaceStorage(): WorkspaceStorage {
  return useContext(WorkspaceStorageContext) ?? window.localStorage;
}
/** Native auth stays in App; every workspace operation uses its own provider. */
export function useEasyHub(): EasyHubBridge | undefined {
  return useContext(BridgeContext) ?? window.easyHub;
}
