import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Clock3, Folder, MapPin, Users } from 'lucide-react';
import type { Contributions, GitHubUser } from '@easyhub/github';

const bounds = (year: number): [string, string] => [`${year}-01-01T00:00:00.000Z`, `${year}-12-31T23:59:59.999Z`];

export function UserProfile({
  login,
  initialUser,
  onBack,
  onOpenRepository,
}: {
  login: string;
  initialUser: GitHubUser;
  onBack: () => void;
  onOpenRepository: (fullName: string) => void;
}) {
  const t = useTranslation();
  const easyHub = useEasyHub();
  const api = <T,>(action: string, ...args: unknown[]): Promise<T> =>
    easyHub
      ? easyHub.github<T>(action, ...args)
      : Promise.reject(new Error(t('userProfile.theAppConnectionIsUnavailablePleaseRestartEasyhub')));
  const [profile, setProfile] = useState(initialUser);
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [data, setData] = useState<Contributions | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [dayData, setDayData] = useState<Contributions | null>(null);
  const [busy, setBusy] = useState(true);
  const [dayBusy, setDayBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void api<GitHubUser>('profile', login)
      .then((item) => {
        if (active) setProfile(item);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [login]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    setData(null);
    setDay(null);
    setDayData(null);
    void api<Contributions>('contributions', login, ...bounds(year))
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause, t('userProfile.contributionDataIsTemporarilyUnavailable')));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [login, year]);
  useEffect(() => {
    if (!day) return;
    let active = true;
    setDayBusy(true);
    setDayData(null);
    void api<Contributions>('contributions', login, `${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`)
      .then((result) => {
        if (active) setDayData(result);
      })
      .catch(() => {
        if (active) setDayData(null);
      })
      .finally(() => {
        if (active) setDayBusy(false);
      });
    return () => {
      active = false;
    };
  }, [login, day]);
  const years = Array.from(new Set([new Date().getUTCFullYear(), ...(data?.years ?? []), year])).sort((a, b) => b - a);
  const entries =
    (day ? dayData : data)?.repositories.filter((item) => item.count > 0).sort((a, b) => b.count - a.count) ?? [];
  const avatar = profile.avatar_url || initialUser.avatar_url;
  return (
    <div className="profile-page">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={17} />
        {t('userProfile.back')}
      </button>
      <section className="panel profile-hero">
        {avatar ? (
          <img className="profile-avatar" src={avatar} alt={t('userProfile.sAvatar', { p0: login })} />
        ) : (
          <span className="profile-avatar profile-avatar-fallback" aria-label={t('userProfile.sAvatar', { p0: login })}>
            {login.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div>
          <div className="eyebrow">{t('userProfile.githubProfile')}</div>
          <h1>{profile.name || login}</h1>
          <p className="profile-handle">@{login}</p>
          <p>{profile.bio || t('userProfile.noBioYet')}</p>
          <div className="profile-meta">
            <span>
              <Users size={16} />
              {t('profile.followers', { count: profile.followers ?? '—' })} ·{' '}
              {t('profile.following', { count: profile.following ?? '—' })}
            </span>
            <span>
              <Folder size={16} />
              {t('profile.repositories', { count: profile.public_repos ?? '—' })}
            </span>
            {profile.location && (
              <span>
                <MapPin size={16} />
                {profile.location}
              </span>
            )}
          </div>
        </div>
      </section>
      <section className="panel contribution-panel">
        <div className="panel-heading">
          <div>
            <h2>
              {year} {t('userProfile.contributionChart')}
            </h2>
            <p>{t('userProfile.selectADayToSeeProjectsAndInteractions')}</p>
          </div>
          <span className="contribution-total">
            {busy ? t('userProfile.loading') : t('userProfile.contributions', { p0: data?.total ?? 0 })}
          </span>
        </div>
        <div className="contribution-years" role="group" aria-label={t('userProfile.selectYear')}>
          {years.map((item) => (
            <button key={item} className={item === year ? 'selected' : ''} onClick={() => setYear(item)}>
              {item}
            </button>
          ))}
        </div>
        {error ? (
          <p className="live-error" role="alert">
            <ErrorMessage error={error} />
          </p>
        ) : (
          <div
            className="contribution-calendar"
            role="grid"
            aria-label={t('userProfile.contributionChart2', { p0: year })}
          >
            {data?.weeks.map((week, index) => (
              <div className="contribution-week" key={index}>
                {week.contributionDays.map((item) => (
                  <button
                    key={item.date}
                    type="button"
                    className={`contribution-cell ${day === item.date ? 'selected' : ''}`}
                    style={{ backgroundColor: item.contributionCount ? item.color : undefined }}
                    aria-label={t('userProfile.contributions2', { p0: item.date, p1: item.contributionCount })}
                    title={t('userProfile.contributions3', { p0: item.date, p1: item.contributionCount })}
                    onClick={() => setDay(item.date)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="contribution-legend">
          {t('userProfile.less')} <i />
          <i />
          <i />
          <i />
          <i /> {t('userProfile.more')}
        </div>
      </section>
      <section className="panel profile-repositories">
        <div className="panel-heading">
          <div>
            <h2>
              {day
                ? t('userProfile.projectsAndSocialActivityOn', { p0: day })
                : t('userProfile.projectsIn', { p0: year })}
            </h2>
            <p>
              {day
                ? t('userProfile.includesUpdatesIssuesAndPullRequestsInAccessibleProjects')
                : t('userProfile.selectADayInTheChartToExploreActivity')}
            </p>
          </div>
          {day && (
            <button
              className="text-link"
              onClick={() => {
                setDay(null);
                setDayData(null);
              }}
            >
              {t('userProfile.viewFullYear')} <ArrowRight size={15} />
            </button>
          )}
        </div>
        {dayBusy ? (
          <p className="live-empty">
            <Clock3 size={16} /> {t('userProfile.loadingDayActivity')}
          </p>
        ) : entries.length ? (
          entries.map((item) => (
            <button
              className="profile-repo-row"
              key={`${item.fullName}:${item.kind}`}
              disabled={item.isPrivate}
              onClick={() => onOpenRepository(item.fullName)}
            >
              <span className="profile-repo-icon">
                <Folder size={18} />
              </span>
              <span>
                <strong>{item.isPrivate ? t('userProfile.privateProject') : item.fullName}</strong>
                <small>
                  {t('profile.activityCount', {
                    kind:
                      item.kind === '更新'
                        ? t('profile.updates')
                        : item.kind === '问题'
                          ? t('profile.issues')
                          : t('profile.pulls'),
                    count: item.count,
                  })}
                  {item.isPrivate ? t('userProfile.notPubliclyAccessible') : ''}
                </small>
              </span>
              <ArrowRight size={17} />
            </button>
          ))
        ) : (
          <p className="live-empty">
            {busy ? t('userProfile.loadingContributions') : t('userProfile.noProjectActivityToShowForThisPeriod')}
          </p>
        )}
      </section>
    </div>
  );
}
