import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useState } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { ArrowRight, GitFork, RotateCw } from 'lucide-react';


export function ForkSetup({ source, currentUser, onReady }: { source: GitHubRepo; currentUser: string; onReady: (fork: GitHubRepo) => void }) {
  const t = useTranslation();
  const easyHub = useEasyHub();
  const [name, setName] = useState(source.name);
  const [existing, setExisting] = useState<GitHubRepo | null>(null);
  const [checking, setChecking] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setChecking(true); setExisting(null); setError(''); setName(source.name);
    void easyHub!.github<GitHubRepo | null>('myFork', source.owner.login, source.name)
      .then((fork) => { if (active) setExisting(fork); })
      .catch((cause) => { if (active) setError(errorText(cause)); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [source.id, source.owner.login, source.name]);

  async function create(): Promise<void> {
    if (creating || checking || !/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name === '.' || name === '..') return;
    setCreating(true); setError('');
    try {
      const fork = await easyHub!.github<GitHubRepo>('forkRepo', source.owner.login, source.name, name.trim());
      onReady(fork);
    } catch (cause) { setError(errorText(cause)); }
    finally { setCreating(false); }
  }

  return <div className="fork-setup">
    <div className="fork-relationship"><span><small>{t("forkSetup.originalProject")}</small><strong>{source.full_name}</strong></span><ArrowRight size={18} /><span><small>{t("forkSetup.yourCopy")}</small><strong>{currentUser}/{existing?.name || name || source.name}</strong></span></div>
    <p>{t("forkSetup.easyhubWillCreateACopyInYourGithubAccount")}</p>
    {checking ? <p className="live-loading"><RotateCw size={16} className="live-spin" />{t("forkSetup.lookingForAnExistingCopy")}</p> : existing ? <>
      <p className="fork-existing"><GitFork size={17} />{t("forkSetup.anAssociatedRepositoryCopyAlreadyExists")}{existing.full_name}</p>
      <button type="button" className="button button-primary" onClick={() => onReady(existing)}>{t("forkSetup.openCopy")} <ArrowRight size={16} /></button>
    </> : <>
      <label className="field"><span>{t("forkSetup.copyName")}</span><input aria-label={t("forkSetup.copyName")} value={name} onChange={(event) => setName(event.target.value)} maxLength={100} disabled={creating} /></label>
      <small>{t("forkSetup.copyTheMainVersionOnlyTheOriginalStaysUnchanged")}</small>
      <button type="button" className="button button-primary" disabled={creating || !/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name === '.' || name === '..'} onClick={() => void create()}>{creating ? t("forkSetup.creatingCopy") : t("forkSetup.createCopy")} <ArrowRight size={16} /></button>
    </>}
    {error && <p className="live-error" role="alert"><ErrorMessage error={error} /></p>}
  </div>;
}
