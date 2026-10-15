import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { useEffect, useState } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { ArrowRight, GitFork, RotateCw } from 'lucide-react';
import { SearchEmptyState } from './SearchEmptyState';

export function ForksOverview({ repos, search, onClearSearch, onOpen, onBrowseOriginal }: {
  repos: GitHubRepo[]; search: string; onClearSearch?: () => void; onOpen: (repo: GitHubRepo) => void; onBrowseOriginal: (owner: string, name: string) => void;
}) {
  const t = useTranslation();
  const easyHub = useEasyHub();
  const [details, setDetails] = useState<Record<number, GitHubRepo>>({});
  const [loading, setLoading] = useState(false);
  const ids = repos.map((repo) => repo.id).join(',');
  useEffect(() => {
    let active = true;
    if (repos.length === 0) return;
    setLoading(true);
    void Promise.all(repos.map(async (repo) => {
      try { return await easyHub!.github<GitHubRepo>('repository', repo.owner.login, repo.name); }
      catch { return repo; }
    })).then((items) => {
      if (active) setDetails(Object.fromEntries(items.map((repo) => [repo.id, repo])));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ids]);

  const filtered = repos.filter((repo) => {
    const detail = details[repo.id] ?? repo;
    return `${repo.name} ${repo.description ?? ''} ${detail.parent?.full_name ?? ''}`.toLowerCase().includes(search.toLowerCase());
  });
  return <section className="forks-overview" data-testid="forks-overview">
    <p className="muted">{t("forksOverview.theseAreCopiesOfOtherPeopleSProjectsManaged")}</p>
    {loading && <p className="live-loading"><RotateCw size={16} className="live-spin" />{t("forksOverview.checkingOriginalProjectRelationships")}</p>}
    <div className="cloud-list">{filtered.map((repo) => {
      const detail = details[repo.id] ?? repo;
      const parent = detail.parent;
      return <div className="cloud-row fork-cloud-row" key={repo.id}>
        <span className="project-logo project-logo-small logo-sky"><GitFork size={19} /></span>
        <div><button className="plain-heading" onClick={() => onOpen(detail)}>{repo.full_name}</button><small>{parent ? <>{t("forksOverview.from")} <button className="fork-parent-link" onClick={() => onBrowseOriginal(parent.owner.login, parent.name)}>{parent.full_name}</button> · {parent.default_branch} → {repo.default_branch}</> : t("forksOverview.loadingOriginalProjectRelationship")}</small></div>
        <button className="button button-primary" onClick={() => onOpen(detail)}>{t("forksOverview.openCopy")} <ArrowRight size={16} /></button>
      </div>;
    })}</div>
    {repos.length === 0 && <div className="empty-state"><span className="empty-icon"><GitFork size={28} /></span><h3>{t("forksOverview.noRepositoryCopiesYet")}</h3><p>{t("forksOverview.chooseCreatePullRequestInAnotherPublicProjectTo")}</p></div>}
    {repos.length > 0 && filtered.length === 0 && !loading && <SearchEmptyState onClear={onClearSearch ?? (() => undefined)} />}
  </section>;
}
