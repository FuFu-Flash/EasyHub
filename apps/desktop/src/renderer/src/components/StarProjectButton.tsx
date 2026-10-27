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
      onChanged?.(next);
    } catch (cause) {
      onError(errorText(cause, t('starProjectButton.couldNotUpdateTheProjectTryAgainLater')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      className={`button button-quiet star-project-button ${starred ? 'is-starred' : ''}`}
      aria-pressed={starred}
      disabled={checking || saving}
      onClick={() => void toggle()}
    >
      <Star size={17} fill={starred ? 'currentColor' : 'none'} />
      {checking
        ? t('starProjectButton.loading')
        : saving
          ? t('starProjectButton.saving')
          : starred
            ? t('starProjectButton.starred')
            : t('starProjectButton.starProject')}
    </button>
  );
}
