import { getTranslator } from "../localization/index.ts";
import { throwIfCancelled } from "../network/cancellation.js";

export type AnalysisFrameworkId = "java" | "native";
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
  if (/\.(?:apk|dex|jar|class)$/iu.test(name)) return "java";
  if (/\.(?:exe|dll|sys|elf|so|dylib|bin)$/iu.test(name)) return "native";
  return null;
}

export function frameworkRequirement(
  status: Availability | null,
  name: string,
  language: "zh" | "en",
): { ready: boolean; component: AnalysisFrameworkId | null; message: string } {
  const component = frameworkForFile(name);
  if (!status)
    return {
      ready: false,
      component,
      message: getTranslator(language)("frameworks.programReviewIsUnavailableInThisBuild"),
    };
  if (component) {
    if (component === "java" ? status.javaAvailable : status.nativeAvailable)
      return { ready: true, component, message: "" };
    const value = (status.components ?? []).find((item) => item.id === component);
    const title = component === "java" ? "Java / Dalvik (JADX)" : "Native (radare2 / r2ghidra)";
    return {
      ready: false,
      component,
      message:
        value && !value.supported
          ? getTranslator(language)("frameworks.isNotSupportedOnThisDevice", { p0: title })
          : getTranslator(language)("frameworks.downloadInSettingsBeforeAnalyzingThisFile", { p0: title }),
    };
  }
  if (status.javaAvailable || status.nativeAvailable) return { ready: true, component: null, message: "" };
  return {
    ready: false,
    component: null,
    message: (status.components ?? []).some((item) => item.supported)
      ? getTranslator(language)("frameworks.downloadTheRequiredProgramReviewComponentInSettingsFirst")
      : getTranslator(language)("frameworks.programReviewComponentsAreNotSupportedOnThisDevice"),
  };
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
  input.signal.addEventListener("abort", cancel, { once: true });
  try {
    throwIfCancelled(input.signal);
    const result = await input.run();
    throwIfCancelled(input.signal);
    return result;
  } finally {
    input.signal.removeEventListener("abort", cancel);
    subscription.remove();
  }
}
