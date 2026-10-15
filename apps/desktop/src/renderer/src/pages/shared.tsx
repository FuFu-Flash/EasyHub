import { useTranslation } from '../localization';
import type { GitHubIssue,GitHubRepo } from '@easyhub/github';
import { ArrowLeft,RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { ErrorMessage } from '../components/ErrorMessage';
import { TranslatableContent,TranslationPreferencesContext } from '../components/TranslatableContent';
import { useWorkspace } from '../workspace/WorkspaceContext';
export const ownerOf = (repo: GitHubRepo) => repo.owner.login;
export function RepoLogo({ repo, small = false }: { repo: GitHubRepo; small?: boolean }) {
  const color = ['logo-lilac', 'logo-peach', 'logo-mint', 'logo-sky'][repo.id % 4];
  return <span className={`project-logo ${small ? 'project-logo-small' : ''} ${color}`} aria-hidden="true">{repo.owner.avatar_url ? <img src={repo.owner.avatar_url} alt="" /> : repo.name.slice(0, 1).toUpperCase()}</span>;
}
export function TranslationScope({ repo, children }: { repo: GitHubRepo; children: ReactNode }) {
  const { automaticTranslation, translationTarget, translationNames } = useWorkspace();
  return <TranslationPreferencesContext.Provider value={{ automatic: automaticTranslation && !repo.private, target: translationTarget, repository: { name: repo.name, owner: repo.owner.login, fullName: repo.full_name }, names: translationNames }}>{children}</TranslationPreferencesContext.Provider>;
}
export function IssueListTitle({ issue, repo }: { issue: GitHubIssue; repo: GitHubRepo }) {
  return repo.private ? <strong>{issue.title}</strong> : <TranslationScope repo={repo}><TranslatableContent text={issue.title} format="text" protectedNames={issue.user?.login ? [issue.user.login] : []} render={value => <strong>{value}</strong>} /></TranslationScope>;
}
export function PageBack({ children, onClick }: { children?: ReactNode; onClick?: () => void }) {
  const t = useTranslation(); const { navigation } = useWorkspace(); return <button className="back-link" onClick={onClick ?? (() => navigation.back())}><ArrowLeft size={17} />{children ?? t("shared.back")}</button>; }
export function PageStatus({ loading, error, retry, cancel }: { loading: boolean; error: string; retry?: () => void; cancel?: () => void }) {
  const t = useTranslation();
  return <>{loading && <div className="live-loading" role="status"><RotateCw size={16} className="live-spin" />{t("shared.syncingWithGithub")}{cancel && <button className="text-link" onClick={cancel}>{t("shared.cancel")}</button>}</div>}{error && <div className="live-error" role="alert"><ErrorMessage error={error} />{retry && <button className="text-link" onClick={retry}>{t("shared.retry")}</button>}</div>}</>;
}
