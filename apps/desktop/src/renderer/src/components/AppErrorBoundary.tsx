import { useTranslation } from '../localization';
import React, { Component, createContext, useContext, useEffect, useRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Home, Minus, RotateCw, Square, X } from 'lucide-react';
import { LanguageContext, readLanguage, type Language } from '../i18n';
import { useEasyHub, type EasyHubBridge } from '../bridge';

export const RecoveryHomeContext = createContext<(() => void) | undefined>(undefined);

function RecoveryScreen({
  language,
  shell,
  retry,
  home,
}: {
  language: Language;
  shell: boolean;
  retry: () => void;
  home: () => void;
}) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Retained pages are attached by their parent after the portal commits.
    const frame = requestAnimationFrame(() => {
      if (heading.current?.isConnected) heading.current.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div className={`page-recovery${shell ? ' shell-recovery' : ''}`}>
      {shell && (
        <header className="recovery-window-controls">
          <button
            className="icon-button"
            aria-label={t('appErrorBoundary.minimizeWindow')}
            onClick={() => void easyHub?.minimizeWindow()}
          >
            <Minus size={18} />
          </button>
          <button
            className="icon-button"
            aria-label={t('appErrorBoundary.maximizeOrRestoreWindow')}
            onClick={() => void easyHub?.toggleMaximizeWindow()}
          >
            <Square size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={t('appErrorBoundary.closeWindow')}
            onClick={() => void easyHub?.closeWindow()}
          >
            <X size={18} />
          </button>
        </header>
      )}
      <section className="panel" role="alert">
        <h1 ref={heading} tabIndex={-1}>
          {t('appErrorBoundary.somethingWentWrongOnThisPage')}
        </h1>
        <p>{t('appErrorBoundary.tryOpeningItAgainOrReturnToHomeYour')}</p>
        <div className="local-actions">
          <button className="button button-primary" onClick={retry}>
            <RotateCw size={17} />
            {t('appErrorBoundary.retry')}
          </button>
          <button className="button button-quiet" onClick={home}>
            <Home size={17} />
            {t('appErrorBoundary.backToHome')}
          </button>
        </div>
      </section>
    </div>
  );
}

interface Props {
  children: ReactNode;
  scope: string;
  language: Language;
  shell?: boolean;
  onHome?: () => void;
  bridge?: EasyHubBridge;
}
class Boundary extends Component<Props, { failed: boolean; revision: number }> {
  state = { failed: false, revision: 0 };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logging must never prevent the recovery screen from rendering.
    try {
      void this.props.bridge
        ?.reportRendererError?.({
          scope: this.props.scope,
          message: error.message,
          stack: error.stack ?? '',
          componentStack: info.componentStack ?? '',
        })
        .catch(() => undefined);
    } catch {
      /* The bridge can be unavailable during startup. */
    }
  }
  retry = (): void => {
    this.setState(({ revision }) => ({ failed: false, revision: revision + 1 }));
  };
  home = (): void => {
    this.props.onHome?.();
    this.retry();
  };
  render(): ReactNode {
    if (this.state.failed)
      return (
        <RecoveryScreen
          language={this.props.language}
          shell={Boolean(this.props.shell)}
          retry={this.retry}
          home={this.home}
        />
      );
    return <React.Fragment key={this.state.revision}>{this.props.children}</React.Fragment>;
  }
}

export function AppErrorBoundary({
  children,
  scope,
  shell = false,
  onHome,
}: {
  children: ReactNode;
  scope: string;
  shell?: boolean;
  onHome?: () => void;
}) {
  const bridge = useEasyHub();
  const language = useContext(LanguageContext) ?? readLanguage();
  const contextHome = useContext(RecoveryHomeContext);
  return (
    <Boundary scope={scope} language={language} shell={shell} onHome={onHome ?? contextHome} bridge={bridge}>
      {children}
    </Boundary>
  );
}
