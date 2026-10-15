import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useState } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { Star } from 'lucide-react';

export function StarProjectButton({ repo, onChanged }: { repo: GitHubRepo; onChanged?: (starred: boolean) => void }) {
  const t = useTranslation();
  const easyHub = useEasyHub();
  const [starred, setStarred] = useState(false);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setChecking(true);
    setError('');
    void easyHub!.github<boolean>('isStarred', repo.owner.login, repo.name)
      .then((value) => { if (active) setStarred(value); })
      .catch(() => { if (active) setError(t("starProjectButton.couldNotCheckStarredStatusTryAgainLater")); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [repo.owner.login, repo.name]);

  async function toggle(): Promise<void> {
    const next = !starred;
    setSaving(true);
    setError('');
    try {
      await easyHub!.github('setStarred', repo.owner.login, repo.name, next);
      setStarred(next);
      onChanged?.(next);
    } catch (cause) {
      setError(errorText(cause, t("starProjectButton.couldNotUpdateTheProjectTryAgainLater")));
    } finally { setSaving(false); }
  }

  return <span className="star-project-control">
    <button type="button" className={`button button-quiet star-project-button ${starred ? 'is-starred' : ''}`} aria-pressed={starred} disabled={checking || saving} onClick={() => void toggle()}>
      <Star size={17} fill={starred ? 'currentColor' : 'none'} />{checking ? t("starProjectButton.loading") : saving ? t("starProjectButton.saving") : starred ? t("starProjectButton.starred") : t("starProjectButton.starProject")}
    </button>
    {error && <small className="star-project-error" role="alert"><ErrorMessage error={error} /></small>}
  </span>;
}
