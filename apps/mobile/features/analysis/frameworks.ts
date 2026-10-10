import { throwIfCancelled } from '../network/cancellation.js';

export type AnalysisFrameworkId = 'java' | 'native';
export interface AnalysisFrameworkComponent {
  id: AnalysisFrameworkId;
  version: string;
  supported: boolean;
  installed: boolean;
  downloadBytes: number;
  installedBytes: number;
}
type Availability = { javaAvailable: boolean; nativeAvailable: boolean; components: AnalysisFrameworkComponent[] };

/** A filename hint only; the native engine still validates the actual file format. */
export function frameworkForFile(name: string): AnalysisFrameworkId | null {
  if (/\.(?:apk|dex|jar|class)$/iu.test(name)) return 'java';
  if (/\.(?:exe|dll|sys|elf|so|dylib|bin)$/iu.test(name)) return 'native';
  return null;
}

export function frameworkRequirement(status: Availability | null, name: string, language: 'zh' | 'en'): { ready: boolean; component: AnalysisFrameworkId | null; message: string } {
  const component = frameworkForFile(name);
  if (!status) return { ready: false, component, message: language === 'en' ? 'Program review is unavailable in this build.' : '此版本无法使用程序文件审查。' };
  if (component) {
    if (component === 'java' ? status.javaAvailable : status.nativeAvailable) return { ready: true, component, message: '' };
    const value = (status.components ?? []).find((item) => item.id === component);
    const title = component === 'java' ? 'Java / Dalvik (JADX)' : 'Native (radare2 / r2ghidra)';
    return { ready: false, component, message: value && !value.supported
      ? language === 'en' ? `${title} is not supported on this device.` : `${title} 不支持这台设备。`
      : language === 'en' ? `Download ${title} in Settings before analyzing this file.` : `请先在设置中下载 ${title} 组件，再分析这个文件。` };
  }
  if (status.javaAvailable || status.nativeAvailable) return { ready: true, component: null, message: '' };
  return { ready: false, component: null, message: (status.components ?? []).some((item) => item.supported)
    ? language === 'en' ? 'Download the required program review component in Settings first.' : '请先在设置中下载所需的程序文件审查组件。'
    : language === 'en' ? 'Program review components are not supported on this device.' : '程序文件审查组件不支持这台设备。' };
}

/** Cancellation retains ownership until the native promise settles and cleans up. */
export async function runCancellableNativeRequest<T, Progress extends { requestId: string }>(input: {
  requestId: string;
  signal: AbortSignal;
  subscribe: (listener: (progress: Progress) => void) => { remove(): void };
  onProgress: (progress: Progress) => void;
  run: () => Promise<T>;
  cancel: () => void;
}): Promise<T> {
  throwIfCancelled(input.signal);
  const subscription = input.subscribe((progress) => {
    if (progress.requestId === input.requestId && !input.signal.aborted) input.onProgress(progress);
  });
  const cancel = () => input.cancel();
  input.signal.addEventListener('abort', cancel, { once: true });
  try {
    throwIfCancelled(input.signal);
    const result = await input.run();
    throwIfCancelled(input.signal);
    return result;
  } finally {
    input.signal.removeEventListener('abort', cancel);
    subscription.remove();
  }
}
