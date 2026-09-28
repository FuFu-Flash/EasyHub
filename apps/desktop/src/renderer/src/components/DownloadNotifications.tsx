import { useEffect, useRef } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { ArrowDownToLine, Bell, CheckCircle2, ChevronRight, FolderOpen, RotateCw, X } from 'lucide-react';
import type { useDownloadCenter } from './useDownloadCenter';
import { downloadAmount, downloadTransferText } from './downloadTransfer';

type Center = ReturnType<typeof useDownloadCenter>;
export interface ActivityNotice { id: string; title: string; detail: string; onOpen: () => void }

export function DownloadNotifications({ center, savedPublicRepoIds, onAddPublic, activity = [] }: { center: Center; savedPublicRepoIds: number[]; onAddPublic: (repo: GitHubRepo) => void; activity?: ActivityNotice[] }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const running = center.items.filter((item) => item.state === 'running').length;
  useEffect(() => {
    if (!center.open) return;
    const pointer = (event: PointerEvent): void => { if (!wrapper.current?.contains(event.target as Node)) center.setOpen(false); };
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') center.setOpen(false); };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
  }, [center.open, center.setOpen]);

  return <div className="download-notification-anchor" ref={wrapper}>
    <button className="icon-button download-notification-trigger" aria-label="通知" aria-expanded={center.open} onClick={() => center.setOpen((value) => !value)}><Bell size={20} />{(activity.length > 0 || running > 0 || center.unread > 0) && <span className="download-notification-count">{activity.length + (running || center.unread)}</span>}</button>
    {center.open && <section className="download-notification-panel" role="dialog" aria-label="通知">
      <header><strong>通知</strong><div>{center.items.some((item) => item.state !== 'running') && <button onClick={center.clearFinished}>清除下载记录</button>}<button aria-label="关闭通知" onClick={() => center.setOpen(false)}><X size={17} /></button></div></header>
      {activity.length > 0 && <div className="activity-notification-list"><span className="notification-section-label">项目动态</span>{activity.map((item) => <button key={item.id} className="activity-notification-item" onClick={() => { center.setOpen(false); item.onOpen(); }}><span className="activity-notification-mark" /><span><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight size={16} /></button>)}</div>}
      {center.items.length > 0 && <span className="notification-section-label notification-download-label">下载</span>}
      <div className="download-notification-list">{center.items.length ? center.items.map((item) => <article className="download-notification-item" key={item.id}>
        <span className={`download-notification-symbol ${item.state}`}>{item.state === 'running' ? <RotateCw size={18} className="live-spin" /> : item.state === 'complete' ? <CheckCircle2 size={18} /> : <ArrowDownToLine size={18} />}</span>
        <div className="download-notification-info"><strong title={item.request.fileName}>{item.request.fileName}</strong><small>{item.request.repo.full_name}</small>
          {item.state === 'running' ? <><span className="download-notification-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.percent ?? undefined} aria-label={`${item.request.fileName} 下载进度`}><span className={item.percent === null ? 'indeterminate' : ''} style={item.percent === null ? undefined : { width: `${item.percent}%` }} /></span><small>{item.request.kind === 'project' ? `${item.phase}${item.percent === null ? '' : ` · ${item.percent}%`}` : `${downloadAmount(item.loaded)}${item.total === null ? '' : ` / ${downloadAmount(item.total)}`} · ${item.percent === null ? '下载中' : `${item.percent}%`}`}</small>{item.request.kind !== 'project' && <small className="download-notification-transfer"><span>速度：{downloadTransferText(item.loaded, item.total, item.bytesPerSecond).speed}</span><span>剩余：{downloadTransferText(item.loaded, item.total, item.bytesPerSecond).remaining}</span></small>}<div className="download-notification-actions"><button onClick={() => void center.cancel(item.id)}>取消</button></div></>
            : item.state === 'complete' ? <><small className="download-notification-success">{item.phase}</small><div className="download-notification-actions">{item.request.kind !== 'project' && <button onClick={() => void center.openFile(item)}>打开文件</button>}<button onClick={() => void center.openFolder(item)}><FolderOpen size={14} />打开文件夹</button>{item.request.kind === 'archive' && item.request.offerAdd && !savedPublicRepoIds.includes(item.request.repo.id) && <button onClick={() => onAddPublic(item.request.repo)}>添加到我的项目</button>}</div></>
              : <><small className="download-notification-error">{item.error || (item.state === 'cancelled' ? '下载已取消。' : '下载失败。')}</small><div className="download-notification-actions"><button onClick={() => void center.start(item.request, item.id)}>重试</button><button onClick={() => center.dismiss(item.id)}>移除</button></div></>}
          {item.error && item.state === 'complete' && <small className="download-notification-error">{item.error}</small>}
        </div>
      </article>) : !activity.length ? <p className="download-notification-empty">目前没有通知。</p> : null}</div>
    </section>}
  </div>;
}
