import { activityNoticeRevision } from './activityNoticeReadState';
import { useTranslation } from '../localization';
import { noticeGroup, unreadNotifications } from '../activityCounts';
import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronRight, X } from 'lucide-react';
import type { ActivityNotice } from './DownloadNotifications';
import { useActivityNoticeReadState } from './useActivityNoticeReadState';

export function DemoNotifications({ activity }: { activity: ActivityNotice[] }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const { seen, unread: activityUnread } = useActivityNoticeReadState(activity, open);

  const unread = unreadNotifications(activityUnread);

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent): void => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
  }, [open]);

  return <div className="download-notification-anchor" ref={wrapper}>
    <button className="icon-button download-notification-trigger" aria-label={t("demoNotifications.notifications")} aria-expanded={open} onClick={() => setOpen((value) => !value)}><Bell size={20} />{unread > 0 && <span className="download-notification-count" aria-label={t("demoNotifications.unreadNotifications", { p0: unread })}>{unread}</span>}</button>
    {open && <section className="download-notification-panel" role="dialog" aria-label={t("demoNotifications.notifications")}><header><strong>{t("demoNotifications.notifications")}</strong><button aria-label={t("demoNotifications.closeNotifications")} onClick={() => setOpen(false)}><X size={17} /></button></header>
      {activity.length ? <div className="activity-notification-list">{(['issues', 'pulls', 'projects'] as const).map((group) => <div key={group}>{activity.some((item) => noticeGroup(item.id) === group) && <span className="notification-section-label">{group === 'issues' ? t("demoNotifications.issues") : group === 'pulls' ? t("demoNotifications.pullRequests") : t("demoNotifications.projectActivity")}</span>}{activity.filter((item) => noticeGroup(item.id) === group).map((item) => <button key={item.id} className="activity-notification-item" onClick={() => { setOpen(false); item.onOpen(); }}><span className="activity-notification-mark" style={{ visibility: seen[item.id] === activityNoticeRevision(item) ? 'hidden' : 'visible' }} /><span><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight size={16} /></button>)}</div>)}</div> : <p className="download-notification-empty">{t("demoNotifications.noNotificationsYet")}</p>}
      
    </section>}
  </div>;
}
