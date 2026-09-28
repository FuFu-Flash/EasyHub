import { ArrowRight, Plus } from 'lucide-react';
import appIcon from '../assets/easyhub-icon.svg';
import pottedPlant from '../assets/easyhub-potted-plant.svg';

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 11 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
}

export function DashboardIntro({ projectCount, unpublishedCount, pendingCount, projectName, onCreate, onContinue }: {
  projectCount: number;
  unpublishedCount: number;
  pendingCount: number;
  projectName?: string;
  onCreate: () => void;
  onContinue: () => void;
}) {
  const title = `${greeting()}，今天也来做点有趣的事情。`;
  return <div className="v2-dashboard-intro">
    <div className="page-header v2-home-heading"><div><div className="eyebrow">你的创作空间</div><h1>{title}</h1><p>项目已经妥善保存。接下来想做什么，由你决定。</p></div><button className="button button-primary" onClick={onCreate}><Plus size={18} />新建项目</button></div>
    <div className="v2-home-top"><section className="v2-feature-card"><div className="v2-feature-copy"><span className="v2-feature-kicker"><i />接着创作</span><h2>{unpublishedCount > 0 ? `${unpublishedCount} 个文件，离发布只差一句话。` : '你的项目已经全部保存。'}</h2><p>{projectName && unpublishedCount > 0 ? `${projectName} 的修改已准备好，写一句更新说明就能发布。` : '有新想法时，打开项目继续创作。'}</p><button className="button v2-feature-button" onClick={onContinue}>{unpublishedCount > 0 ? '查看修改' : '查看项目'}<ArrowRight size={17} /></button></div><div className="v2-feature-art" aria-hidden="true"><div /><img src={pottedPlant} alt="" /><span><img src={appIcon} alt="" /></span></div></section>
      <section className="v2-overview-card" aria-label="项目概览"><span>一眼看清进展</span><div><strong>{String(projectCount).padStart(2, '0')}</strong><small>我的项目</small></div><div><strong>{String(unpublishedCount).padStart(2, '0')}</strong><small>尚未发布的文件</small></div><div><strong>{String(pendingCount).padStart(2, '0')}</strong><small>待处理的反馈与改进</small></div></section></div>
  </div>;
}
