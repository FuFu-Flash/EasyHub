import { useEffect, useState } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { Star } from 'lucide-react';

export function StarProjectButton({ repo, onChanged }: { repo: GitHubRepo; onChanged?: (starred: boolean) => void }) {
  const [starred, setStarred] = useState(false);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setChecking(true);
    setError('');
    void window.easyHub!.github<boolean>('isStarred', repo.owner.login, repo.name)
      .then((value) => { if (active) setStarred(value); })
      .catch(() => { if (active) setError('暂时无法读取收藏状态，请稍后重试。'); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [repo.owner.login, repo.name]);

  async function toggle(): Promise<void> {
    const next = !starred;
    setSaving(true);
    setError('');
    try {
      await window.easyHub!.github('setStarred', repo.owner.login, repo.name, next);
      setStarred(next);
      onChanged?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '收藏操作失败，请稍后重试。');
    } finally { setSaving(false); }
  }

  return <span className="star-project-control">
    <button type="button" className={`button button-quiet star-project-button ${starred ? 'is-starred' : ''}`} aria-pressed={starred} disabled={checking || saving} onClick={() => void toggle()}>
      <Star size={17} fill={starred ? 'currentColor' : 'none'} />{checking ? '读取中…' : saving ? '保存中…' : starred ? '已收藏' : '收藏项目'}
    </button>
    {error && <small className="star-project-error" role="alert">{error}</small>}
  </span>;
}
