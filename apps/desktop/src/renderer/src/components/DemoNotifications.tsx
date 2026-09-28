import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronRight, X } from 'lucide-react';
import type { ActivityNotice } from './DownloadNotifications';

export function DemoNotifications({ activity }: { activity: ActivityNotice[] }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent): void => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
  }, [open]);

  return <div className="download-notification-anchor" ref={wrapper}>
    <button className="icon-button download-notification-trigger" aria-label="通知" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Bell size={20} />{activity.length > 0 && <span className="download-notification-count">{activity.length}</span>}</button>
    {open && <section className="download-notification-panel" role="dialog" aria-label="通知"><header><strong>通知</strong><button aria-label="关闭通知" onClick={() => setOpen(false)}><X size={17} /></button></header>
      {activity.length ? <div className="activity-notification-list"><span className="notification-section-label">项目动态</span>{activity.map((item) => <button key={item.id} className="activity-notification-item" onClick={() => { setOpen(false); item.onOpen(); }}><span className="activity-notification-mark" /><span><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight size={16} /></button>)}</div> : <p className="download-notification-empty">目前没有通知。</p>}
      <p className="notification-demo-label">演示数据仅在当前窗口生效</p>
    </section>}
  </div>;
}
