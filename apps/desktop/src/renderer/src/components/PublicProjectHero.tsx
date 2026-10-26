import { ArrowDownToLine, Globe2, Plus } from 'lucide-react';
import type { GitHubRepo } from '@easyhub/github';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';
import { SourceHistoryButton } from './SourceHistory';
import { StarProjectButton } from './StarProjectButton';
import { TranslatableContent } from './TranslatableContent';

/** Name, description and main actions at the top of a public project page. */
export function PublicProjectHero({
  repo,
  language,
  onOpenSourceHistory,
  onPropose,
  onOpenDownloads,
  onError,
}: {
  repo: GitHubRepo;
  language: Language;
  onOpenSourceHistory: () => void;
  onPropose: () => void;
  onOpenDownloads: () => void;
  onError: (text: string) => void;
}) {
  const t = useTranslation(language);
  return (
    <section className="detail-hero public-browser-hero has-source-history">
      <SourceHistoryButton language={language} onClick={onOpenSourceHistory} />
      <div className="detail-main">
        <span className="project-logo logo-sky public-owner-avatar" aria-hidden="true">
          {repo.owner.avatar_url ? (
            <img src={repo.owner.avatar_url} alt="" />
          ) : (
            repo.owner.login.slice(0, 1).toUpperCase()
          )}
        </span>
        <div>
          <div className="detail-name-row">
            <h1>{repo.full_name}</h1>
            <span className="visibility-label">
              <Globe2 size={13} />
              {repo.private ? t('publicProjectBrowser.authorizedProject') : t('publicProjectBrowser.publicProjects')}
            </span>
          </div>
          {repo.description ? (
            <TranslatableContent text={repo.description} format="text" render={(value) => <p>{value}</p>} />
          ) : (
            <p>{t('publicProjectBrowser.noProjectDescriptionYet')}</p>
          )}
        </div>
      </div>
      <div className="detail-actions">
        <StarProjectButton repo={repo} onError={onError} />
        <button className="button button-quiet" onClick={onPropose}>
          <Plus size={17} />
          {t('publicProjectBrowser.reportAnIssueSuggestAChange')}
        </button>
        <button className="button button-primary" onClick={onOpenDownloads}>
          <ArrowDownToLine size={17} />
          {t('publicProjectBrowser.downloadReleasesOrSource')}
        </button>
      </div>
    </section>
  );
}
