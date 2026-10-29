import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { useEasyHub } from '../bridge';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';

/** Mount a new instance for each authorization flow so clipboard feedback cannot leak between codes. */
export function PairingCode({
  code,
  codeCopied,
  language,
  pendingMessage,
  children,
}: {
  code: string;
  codeCopied?: boolean;
  language?: Language;
  pendingMessage: string;
  children: ReactNode;
}) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const [copied, setCopied] = useState(codeCopied === true);
  const [copying, setCopying] = useState(false);
  const copyingNow = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function copy(): Promise<void> {
    if (copyingNow.current) return;
    copyingNow.current = true;
    setCopying(true);
    try {
      const result = await easyHub?.copyPairingCode?.(code);
      if (active.current) setCopied(result === true);
    } catch {
      if (active.current) setCopied(false);
    } finally {
      copyingNow.current = false;
      if (active.current) setCopying(false);
    }
  }

  return (
    <>
      <strong className="oauth-code">{code}</strong>
      <p className="oauth-wait" role="status" aria-live="polite" aria-atomic="true">
        {copied ? t('pairingCode.copied') : t('pairingCode.copyFailed')}
      </p>
      <p className="oauth-wait">{pendingMessage}</p>
      <div className="pairing-code-actions">
        <button
          type="button"
          className="button button-quiet"
          disabled={copying}
          aria-busy={copying}
          onClick={() => void copy()}
        >
          <Copy size={17} aria-hidden="true" />
          {copying ? t('pairingCode.copying') : t('pairingCode.copy')}
        </button>
        {children}
      </div>
    </>
  );
}
