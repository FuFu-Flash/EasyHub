import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { errorText } from '../errors';
import { useEffect, useState } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { Star } from 'lucide-react';

/** `onError` shows a failed star change in the page's own notice area, not beside the button. */
export function StarProjectButton({
  repo,
  onChanged,
  onError,
}: {
  repo: GitHubRepo;
  onChanged?: (starred: boolean) => void;
  onError: (text: string) => void;
}) {
  const t = useTranslation();
  const easyHub = useEasyHub();
  const [starred, setStarred] = useState(false);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  // GitHub's count already includes an earlier star; only this session's change is added on top.
  const [change, setChange] = useState(0);
  const baseCount = repo.stargazers_count ?? 0;
  useEffect(() => setChange(0), [repo.id, baseCount]);

  useEffect(() => {
    let active = true;
    setChecking(true);
    void easyHub!
      .github<boolean>('isStarred', repo.owner.login, repo.name)
      .then((value) => {
        if (active) setStarred(value);
      })
      // An unknown status leaves the button usable; only a failed action is reported.
      .catch(() => undefined)
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [repo.owner.login, repo.name]);

  async function toggle(): Promise<void> {
    const next = !starred;
    setSaving(true);
    try {
      await easyHub!.github('setStarred', repo.owner.login, repo.name, next);
      setStarred(next);
      setChange((value) => value + (next ? 1 : -1));
      onChanged?.(next);
    } catch (cause) {
      onError(errorText(cause, t('starProjectButton.couldNotUpdateTheProjectTryAgainLater')));
    } finally {
      setSaving(false);
    }
  }

  const label = checking
    ? t('starProjectButton.loading')
    : saving
      ? t('starProjectButton.saving')
      : starred
        ? t('starProjectButton.starred')
        : t('starProjectButton.starProject');
  const count = Math.max(0, baseCount + change).toLocaleString();

  return (
    <button
      type="button"
      className={`star-project-button ${starred ? 'is-starred' : ''}`}
      aria-label={label}
      aria-pressed={starred}
      title={`${label} · ${count}`}
      disabled={checking || saving}
      onClick={() => void toggle()}
    >
      <Star size={17} fill={starred ? 'currentColor' : 'none'} aria-hidden="true" />
      <span aria-hidden="true">{count}</span>
    </button>
  );
}
