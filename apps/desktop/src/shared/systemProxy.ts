/** Platform-neutral lifecycle used by the shared GitHub routing service. */
export interface SystemProxyStatus {
  mode: 'off' | 'managed' | 'existing' | 'external' | 'unavailable';
  error?: string;
}
export interface SystemProxy {
  initialize(): Promise<SystemProxyStatus>;
  acquire(pacUrl: string, existingEffectiveProxy?: boolean): Promise<SystemProxyStatus>;
  release(): Promise<SystemProxyStatus>;
  status(): Promise<SystemProxyStatus>;
  destroy(): Promise<SystemProxyStatus>;
}
