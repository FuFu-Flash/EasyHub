import { useTranslation } from './localization';
import { useEffect, useRef, useState } from 'react';
import type { GitHubUser } from '@easyhub/github';
import { ShieldCheck, X } from 'lucide-react';
import { ErrorMessage } from './components/ErrorMessage';
import { errorText } from './errors';
import { needsWelcome, readWelcomeChoice, saveWelcomeChoice, type WelcomeChoice } from './onboarding';
import { useDialogFocus } from './components/useDialogFocus';
import { LiveWorkspace } from './LiveWorkspace';
import { DemoWorkspace } from './DemoWorkspace';
import { OfflineStart } from './components/OfflineStart';
import { WindowControls } from './components/WindowControls';
import { readWindowStyle } from './windowStyle';
import { PairingCode } from './components/PairingCode';
import appIcon from './assets/easyhub-icon.svg';
import { startThemeSync } from './themePreferences';

// Runs once when the app loads, before the first paint, so every screen starts in the saved theme.
startThemeSync();

const demoOnlyBuild = import.meta.env.VITE_EASYHUB_DEMO_ONLY === 'true';

interface LoginFlow {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
  codeCopied?: boolean;
}

export default function App() {
  const t = useTranslation();
  const windowStyle = readWindowStyle();
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [authState, setAuthState] = useState('checking');
  const [welcomeChoice, setWelcomeChoice] = useState<WelcomeChoice | null>(readWelcomeChoice);
  const choose = (choice: WelcomeChoice): void => {
    saveWelcomeChoice(choice);
    setWelcomeChoice(choice);
  };

  const [authChecking, setAuthChecking] = useState(!demoOnlyBuild);
  const [authOffline, setAuthOffline] = useState(false);
  const [authRetry, setAuthRetry] = useState(0);
  const [flow, setFlow] = useState<LoginFlow | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const loginGeneration = useRef(0);
  const loginStarting = useRef(false);
  const loginDialog = useRef<HTMLDivElement>(null);
  useDialogFocus(Boolean(flow || loginBusy || loginError), loginDialog, cancelLogin);

  useEffect(() => {
    if (demoOnlyBuild) return;
    let active = true;
    setAuthChecking(true);
    if (!window.easyHub) {
      setAuthState('signed-out');
      setAuthChecking(false);
      return;
    }
    void window.easyHub
      .authStatus()
      .then((result) => {
        if (!active) return;
        setAuthState(result.state ?? (result.user ? 'signed-in' : 'signed-out'));
        if (result.state === 'signed-in' || (!result.state && result.user)) choose('login');
        const offline = result.state === 'offline';
        setAuthOffline(offline);
        setUser(result.user);
        if (result.state === 'expired') setLoginError(t('app.yourGithubLoginHasExpiredPleaseSignInAgain'));
      })
      .catch((cause: unknown) => {
        if (active) setLoginError(errorText(cause));
      })
      .finally(() => {
        if (active) setAuthChecking(false);
      });
    return () => {
      active = false;
    };
  }, [authRetry]);

  useEffect(() => {
    if (!flow) return;
    if (Date.now() >= flow.expiresAt) {
      setLoginError(t('app.signInConfirmationExpiredPleaseStartAgain'));
      setFlow(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void window.easyHub
        ?.authPoll()
        .then((result) => {
          if (!active) return;
          if (result.state === 'complete' && result.user) {
            choose('login');
            setAuthState('signed-in');
            setUser(result.user);
            setAuthOffline(false);
            setFlow(null);
            setLoginError('');
          } else setFlow((current) => (current ? { ...current, interval: result.interval ?? current.interval } : null));
        })
        .catch((error: unknown) => {
          if (active) {
            setLoginError(errorText(error));
            setFlow(null);
          }
        });
    }, flow.interval * 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [flow]);

  async function beginLogin(): Promise<void> {
    if (!window.easyHub || loginStarting.current || flow) return;
    const generation = ++loginGeneration.current;
    loginStarting.current = true;
    setLoginBusy(true);
    setLoginError('');
    try {
      const next = await window.easyHub.authStart();
      if (generation !== loginGeneration.current) return;
      setFlow(next);
      await window.easyHub.openExternalLink(next.verificationUri);
    } catch (error) {
      if (generation === loginGeneration.current) setLoginError(errorText(error));
    } finally {
      if (generation === loginGeneration.current) {
        loginStarting.current = false;
        setLoginBusy(false);
      }
    }
  }

  function cancelLogin(): void {
    loginGeneration.current++;
    loginStarting.current = false;
    setLoginBusy(false);
    setFlow(null);
    setLoginError('');
    void window.easyHub?.authCancel().catch(() => undefined);
  }

  if (demoOnlyBuild) return <DemoWorkspace onLogin={() => undefined} demoOnly />;
  if (authChecking && !user)
    return (
      <div className="startup-loading" role="status" aria-live="polite">
        <img src={appIcon} alt="EasyHub" />
        <p>{t('app.connectingToGithub')}</p>
      </div>
    );
  if (authOffline && !user) return <OfflineStart onRetry={() => setAuthRetry((value) => value + 1)} />;
  if (user)
    return (
      <LiveWorkspace
        key={user.login}
        user={user}
        offline={authOffline}
        authRetrying={authChecking}
        onRetryAuth={() => setAuthRetry((value) => value + 1)}
        onLogout={async () => {
          await window.easyHub?.authLogout();
          setAuthState('signed-out');
          setAuthOffline(false);
          choose('login');
          setUser(null);
        }}
      />
    );
  return (
    <>
      {needsWelcome(authState, welcomeChoice) ? (
        <div className="welcome-page">
          <header className={`welcome-controls welcome-controls-${windowStyle}`}>
            <WindowControls style={windowStyle} />
          </header>
          <section>
            <img src={appIcon} alt="EasyHub" />
            <h1>{t('app.welcomeToEasyhub')}</h1>
            <p>{t('app.saveYourWorkExploreProjectsAndBringYourIdeas')}</p>
            <button
              className="button button-primary"
              onClick={() => {
                saveWelcomeChoice('login');
                void beginLogin();
              }}
            >
              {t('app.signInToGithub')}
            </button>
            <button className="button button-quiet" onClick={() => choose('demo')}>
              {t('app.exploreTheDemo')}
            </button>
          </section>
        </div>
      ) : (
        <DemoWorkspace onLogin={() => void beginLogin()} />
      )}
      {(flow || loginBusy || loginError) && (
        <div className="modal-backdrop">
          <div
            className="modal oauth-modal"
            ref={loginDialog}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="oauth-title"
          >
            <button className="icon-button modal-close" aria-label={t('app.close')} onClick={cancelLogin}>
              <X size={19} />
            </button>
            <div className="modal-symbol">
              <ShieldCheck size={24} />
            </div>
            <h2 id="oauth-title">{t('app.signInWithGithub')}</h2>
            {flow ? (
              <>
                <p>{t('app.githubOpenedInYourBrowserEnterThisCodeAnd')}</p>
                <PairingCode
                  key={`${flow.userCode}:${flow.expiresAt}`}
                  code={flow.userCode}
                  codeCopied={flow.codeCopied}
                  pendingMessage={t('app.waitingForYourConfirmationOnGithub')}
                >
                  <button
                    className="button button-quiet"
                    onClick={() => void window.easyHub?.openExternalLink(flow.verificationUri)}
                  >
                    {t('app.openGithubAgain')}
                  </button>
                  <button className="button button-quiet" onClick={cancelLogin}>
                    {t('app.cancel')}
                  </button>
                </PairingCode>
              </>
            ) : loginBusy ? (
              <p>{t('app.connectingToGithub')}</p>
            ) : (
              <>
                <p className="release-error">
                  <ErrorMessage error={loginError} />
                </p>
                <button className="button button-primary" onClick={() => void beginLogin()}>
                  {t('app.retry')}
                </button>
              </>
            )}
            {!flow && (
              <div className="modal-actions">
                <button className="button button-quiet" onClick={cancelLogin}>
                  {t('app.cancel')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
