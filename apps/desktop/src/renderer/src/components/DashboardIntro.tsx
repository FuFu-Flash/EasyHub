import { type Translator, useTranslation } from '../localization';
import { ArrowRight, Plus } from 'lucide-react';
import appIcon from '../assets/easyhub-icon.svg';
import pottedPlant from '../assets/easyhub-potted-plant.svg';

function greeting(t: Translator): string {
  const hour = new Date().getHours();
  return hour < 11
    ? t('dashboardIntro.goodMorning')
    : hour < 18
      ? t('dashboardIntro.goodAfternoon')
      : t('dashboardIntro.goodEvening');
}

export function DashboardIntro({
  projectCount,
  unpublishedCount,
  issueCount,
  pullCount,
  projectName,
  localState = 'saved',
  projectChanges,
  onCreate,
  onContinue,
  onProjects,
  onIssues,
  onPulls,
}: {
  projectCount: number;
  unpublishedCount: number | null;
  issueCount: number | null;
  projectName?: string;
  localState?: 'saved' | 'checking' | 'remote' | 'unavailable' | 'none';
  projectChanges?: number;
  onCreate: () => void;
  onContinue: () => void;
  onProjects?: () => void;
  pullCount: number | null;
  onIssues?: () => void;
  onPulls?: () => void;
}) {
  const t = useTranslation();
  const title = t('dashboardIntro.letSCreateSomethingToday', { p0: greeting(t) });
  const changed = (projectChanges ?? unpublishedCount ?? 0) > 0;
  const heading = changed
    ? t('dashboardIntro.filesHaveChangedReviewThemBeforePublishing', { p0: projectChanges ?? unpublishedCount })
    : localState === 'checking'
      ? t('dashboardIntro.checkingProjectStatus')
      : localState === 'remote'
        ? t('dashboardIntro.newContentIsAvailableOnGithub')
        : localState === 'unavailable'
          ? t('dashboardIntro.someProjectsNeedYourAttention')
          : localState === 'none'
            ? t('dashboardIntro.turnAnIdeaIntoYourNextProject')
            : t('dashboardIntro.allYourProjectsAreSaved');
  const description =
    changed && projectName
      ? t('dashboardIntro.hasNewChangesReviewAndSelectTheFilesTo', { p0: projectName })
      : localState === 'checking'
        ? t('dashboardIntro.unpublishedChangesWillAppearHereAfterTheCheck')
        : localState === 'remote'
          ? t('dashboardIntro.openAProjectToGetTheLatestContentFrom')
          : localState === 'unavailable'
            ? t('dashboardIntro.openLocalProjectsToCheckTheirFoldersAndConnection')
            : localState === 'none'
              ? t('dashboardIntro.addALocalProjectOrDownloadOneFromGithub')
              : t('dashboardIntro.openAProjectWheneverInspirationStrikes');
  return (
    <div className="v2-dashboard-intro">
      <div className="page-header v2-home-heading">
        <div>
          <div className="eyebrow">{t('dashboardIntro.yourCreativeSpace')}</div>
          <h1>{title}</h1>
          <p>{t('dashboardIntro.seeYourProjectProgressAndKeepCreating')}</p>
        </div>
        <button className="button button-primary" onClick={onCreate}>
          <Plus size={18} />
          {t('dashboardIntro.newProject')}
        </button>
      </div>
      <div className="v2-home-top">
        <section className="v2-feature-card">
          <div className="v2-feature-copy">
            <span className="v2-feature-kicker">
              <i />
              {t('dashboardIntro.keepCreating')}
            </span>
            <h2>{heading}</h2>
            <p>{description}</p>
            <button className="button v2-feature-button" onClick={onContinue}>
              {changed ? t('dashboardIntro.reviewAndPublish') : t('dashboardIntro.viewProjects')}
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="v2-feature-art" aria-hidden="true">
            <div />
            <img src={pottedPlant} alt="" />
            <span>
              <img src={appIcon} alt="" />
            </span>
          </div>
        </section>
        <section className="v2-overview-card" aria-label={t('dashboardIntro.projectOverview')}>
          <span>{t('dashboardIntro.yourProgressAtAGlance')}</span>
          <button type="button" onClick={onProjects ?? onContinue}>
            <strong>{projectCount}</strong>
            <small>{t('dashboardIntro.myProjects')}</small>
          </button>
          <button type="button" onClick={onIssues ?? onContinue}>
            <strong>{issueCount ?? '…'}</strong>
            <small>{t('dashboardIntro.unresolvedIssues')}</small>
          </button>
          <button type="button" onClick={onPulls ?? onContinue}>
            <strong>{pullCount ?? '…'}</strong>
            <small>{t('dashboardIntro.pullRequestsAwaitingReview')}</small>
          </button>
        </section>
      </div>
    </div>
  );
}
