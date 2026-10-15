import { activityNoticeRevision } from './activityNoticeReadState';
import { useTranslation } from '../localization';
import { useContext } from 'react';
import { LanguageContext, readLanguage } from '../i18n';
import { ErrorMessage } from './ErrorMessage';
import { noticeGroup, unreadNotifications } from '../activityCounts';
import { useEffect, useRef } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { ArrowDownToLine, Bell, CheckCircle2, ChevronRight, FolderOpen, RotateCw, X } from 'lucide-react';
import type { useDownloadCenter } from './useDownloadCenter';
import { downloadAmount, downloadTransferText } from './downloadTransfer';
import { useActivityNoticeReadState } from './useActivityNoticeReadState';
import { useDialogFocus } from './useDialogFocus';

type Center = ReturnType<typeof useDownloadCenter>;
export interface ActivityNotice {
  id: string;
  title: string;
  revision?: string;
  detail: string;
  onOpen: () => void;
}

export function DownloadNotifications({
  center,
  savedPublicRepoIds,
  onAddPublic,
  activity = [],
  account = 'default',
}: {
  center: Center;
  savedPublicRepoIds: number[];
  onAddPublic: (repo: GitHubRepo) => void;
  activity?: ActivityNotice[];
  account?: string;
}) {
  const language = useContext(LanguageContext) ?? readLanguage();
  const t = useTranslation(language);
  const wrapper = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useDialogFocus(center.open, dialog, () => center.setOpen(false), {
    fallbackFocus: () => wrapper.current?.querySelector<HTMLButtonElement>('.download-notification-trigger') ?? null,
  });
  const { seen: seenActivity, unread: unreadActivity } = useActivityNoticeReadState(activity, center.open, account);
  const unread = unreadNotifications(unreadActivity, center.unread);
  useEffect(() => {
    if (!center.open) return;
    const pointer = (event: PointerEvent): void => {
      if (!wrapper.current?.contains(event.target as Node)) center.setOpen(false);
    };
    document.addEventListener('pointerdown', pointer);
    return () => {
      document.removeEventListener('pointerdown', pointer);
    };
  }, [center.open, center.setOpen]);

  return (
    <div className="download-notification-anchor" ref={wrapper}>
      <button
        className="icon-button download-notification-trigger"
        aria-label={t('downloadNotifications.notifications')}
        aria-expanded={center.open}
        onClick={() => center.setOpen((value) => !value)}
      >
        <Bell size={20} />
        {unread > 0 && (
          <span
            className="download-notification-count"
            aria-label={t('downloadNotifications.unreadNotifications', { p0: unread })}
          >
            {unread}
          </span>
        )}
      </button>
      {center.open && (
        <section
          ref={dialog}
          className="download-notification-panel"
          role="dialog"
          aria-modal="true"
          aria-label={t('downloadNotifications.notifications')}
          tabIndex={-1}
        >
          <header>
            <strong>{t('downloadNotifications.notifications')}</strong>
            <div>
              {center.items.some((item) => ['complete', 'cancelled', 'failed'].includes(item.state)) && (
                <button onClick={center.clearFinished}>{t('downloadNotifications.clearDownloadHistory')}</button>
              )}
              <button aria-label={t('downloadNotifications.closeNotifications')} onClick={() => center.setOpen(false)}>
                <X size={17} />
              </button>
            </div>
          </header>
          {activity.length > 0 && (
            <div className="activity-notification-list">
              {(['issues', 'pulls', 'projects'] as const).map((group) => (
                <div key={group}>
                  {activity.some((item) => noticeGroup(item.id) === group) && (
                    <span className="notification-section-label">
                      {group === 'issues'
                        ? t('downloadNotifications.issues')
                        : group === 'pulls'
                          ? t('downloadNotifications.pullRequests')
                          : t('downloadNotifications.projectActivity')}
                    </span>
                  )}
                  {activity
                    .filter((item) => noticeGroup(item.id) === group)
                    .map((item) => (
                      <button
                        key={item.id}
                        className="activity-notification-item"
                        onClick={() => {
                          center.setOpen(false);
                          item.onOpen();
                        }}
                      >
                        <span
                          className="activity-notification-mark"
                          style={{
                            visibility: seenActivity[item.id] === activityNoticeRevision(item) ? 'hidden' : 'visible',
                          }}
                        />
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                </div>
              ))}
            </div>
          )}
          {center.items.length > 0 && (
            <span className="notification-section-label notification-download-label">
              {t('downloadNotifications.download')}
            </span>
          )}
          <div className="download-notification-list">
            {center.items.length ? (
              center.items.map((item) => (
                <article className="download-notification-item" key={item.id}>
                  <span className={`download-notification-symbol ${item.state}`}>
                    {item.state === 'running' ? (
                      <RotateCw size={18} className="live-spin" />
                    ) : item.state === 'complete' ? (
                      <CheckCircle2 size={18} />
                    ) : (
                      <ArrowDownToLine size={18} />
                    )}
                  </span>
                  <div className="download-notification-info">
                    <strong title={item.request.fileName}>{item.request.fileName}</strong>
                    <small>{item.request.repo.full_name}</small>
                    {item.state === 'running' ? (
                      <>
                        <span
                          className="download-notification-track"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={item.percent ?? undefined}
                          aria-label={t('downloadNotifications.downloadProgressFor', { p0: item.request.fileName })}
                        >
                          <span
                            className={item.percent === null ? 'indeterminate' : ''}
                            style={item.percent === null ? undefined : { width: `${item.percent}%` }}
                          />
                        </span>
                        <small>
                          {item.request.kind === 'project'
                            ? `${t('progress.downloadingProject')}${item.percent === null ? '' : ` · ${item.percent}%`}`
                            : t('downloadNotifications.transferProgress', {
                                p0: downloadAmount(item.loaded),
                                p1: item.total === null ? '' : ` / ${downloadAmount(item.total)}`,
                                p2: item.percent === null ? t('downloadNotifications.downloading') : `${item.percent}%`,
                              })}
                        </small>
                        {item.restarting && <small>{t('progress.restarting')}</small>}
                        {item.request.kind !== 'project' && (
                          <small className="download-notification-transfer">
                            <span>
                              {t('downloadNotifications.speed')}
                              {downloadTransferText(item.loaded, item.total, item.bytesPerSecond, language).speed}
                            </span>
                            <span>
                              {t('downloadNotifications.remaining')}
                              {downloadTransferText(item.loaded, item.total, item.bytesPerSecond, language).remaining}
                            </span>
                          </small>
                        )}
                        <div className="download-notification-actions">
                          {center.supportsPause && item.request.kind !== 'project' && (
                            <button onClick={() => void center.pause(item.id)}>
                              {t('downloadNotifications.pause')}
                            </button>
                          )}
                          <button onClick={() => void center.cancel(item.id)}>
                            {t('downloadNotifications.cancel')}
                          </button>
                        </div>
                      </>
                    ) : item.state === 'queued' ? (
                      <>
                        <small>{t('downloadNotifications.queued')}</small>
                        <div className="download-notification-actions">
                          {item.request.kind !== 'project' && (
                            <button onClick={() => void center.pause(item.id)}>
                              {t('downloadNotifications.pause')}
                            </button>
                          )}
                          <button onClick={() => void center.cancel(item.id)}>
                            {t('downloadNotifications.cancel')}
                          </button>
                        </div>
                      </>
                    ) : item.state === 'paused' ? (
                      <>
                        <small>
                          {t('downloadNotifications.paused')} {downloadAmount(item.loaded)}
                          {item.total === null ? '' : ` / ${downloadAmount(item.total)}`}
                        </small>
                        <div className="download-notification-actions">
                          <button onClick={() => void center.resume(item.id)}>
                            {t('downloadNotifications.resumeDownload')}
                          </button>
                          <button onClick={() => void center.cancel(item.id)}>
                            {t('downloadNotifications.cancel')}
                          </button>
                        </div>
                      </>
                    ) : item.state === 'complete' ? (
                      <>
                        <small className="download-notification-success">
                          {item.request.kind === 'pull-file'
                            ? t('progress.changedFileDownloaded')
                            : t('progress.projectDownloaded')}
                        </small>
                        <div className="download-notification-actions">
                          {item.request.kind !== 'project' && (
                            <button onClick={() => void center.openFile(item)}>
                              {t('downloadNotifications.openFile')}
                            </button>
                          )}
                          <button onClick={() => void center.openFolder(item)}>
                            <FolderOpen size={14} />
                            {t('downloadNotifications.openFolder')}
                          </button>
                          {item.request.kind === 'archive' &&
                            item.request.offerAdd &&
                            !savedPublicRepoIds.includes(item.request.repo.id) && (
                              <button onClick={() => onAddPublic(item.request.repo)}>
                                {t('downloadNotifications.addToMyProjects')}
                              </button>
                            )}
                        </div>
                      </>
                    ) : (
                      <>
                        <small className="download-notification-error">
                          <ErrorMessage
                            error={
                              item.error ||
                              (item.state === 'cancelled'
                                ? t('downloadNotifications.downloadCancelled')
                                : t('downloadNotifications.downloadFailed'))
                            }
                          />
                        </small>
                        <div className="download-notification-actions">
                          <button onClick={() => void center.start(item.request, item.id)}>
                            {t('downloadNotifications.retry')}
                          </button>
                          <button onClick={() => center.dismiss(item.id)}>{t('downloadNotifications.remove')}</button>
                        </div>
                      </>
                    )}
                    {item.error && ['complete', 'running', 'queued', 'paused'].includes(item.state) && (
                      <small className="download-notification-error">
                        <ErrorMessage error={item.error} />
                      </small>
                    )}
                  </div>
                </article>
              ))
            ) : !activity.length ? (
              <p className="download-notification-empty">{t('downloadNotifications.noNotificationsYet')}</p>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
