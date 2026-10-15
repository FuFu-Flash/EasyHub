import { getTranslator, type MessageKey, type Translator } from './index.ts';
import type { zh } from './locales/zh.ts';

type Slots<S extends string> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Slots<Rest> : never;
type MessageArguments<K extends MessageKey> = [Slots<(typeof zh)[K]>] extends [never] ? [params?: never]
  : [params: Record<Slots<(typeof zh)[K]>, string | number | null | undefined>];
type Parameters = Record<string, string | number | null | undefined>;
const render = (t: Translator, key: MessageKey, params?: Parameters) => (t as (key: MessageKey, params?: Parameters) => string)(key, params);

/** Stable interface identity; `message` stays Chinese for existing native/protocol diagnostics. */
export class InterfaceError<K extends MessageKey = MessageKey> extends Error {
  readonly key: K;
  readonly params: Parameters | undefined;
  constructor(key: K, ...args: MessageArguments<K>) {
    super(render(getTranslator('zh'), key, args[0]));
    this.name = 'InterfaceError';
    this.key = key;
    this.params = args[0];
  }
  withDiagnostic(message: string): this {
    this.message = message;
    return this;
  }
}

/** Only our typed failures are translated. Remote messages, code and authored text remain opaque. */
export function localizeError(error: unknown, t: Translator, fallback: string): string {
  if (error instanceof InterfaceError) return render(t, error.key, error.params);
  return error instanceof Error ? error.message : fallback;
}
