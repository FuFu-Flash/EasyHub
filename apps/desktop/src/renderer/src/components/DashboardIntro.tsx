import { ArrowRight, Plus } from 'lucide-react';
import appIcon from '../assets/easyhub-icon.svg';
import pottedPlant from '../assets/easyhub-potted-plant.svg';

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 11 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
}

export function DashboardIntro({ projectCount, unpublishedCount, pendingCount, projectName, localState = 'saved', projectChanges, onCreate, onContinue, onProjects, onChanges, onPending }: {
  projectCount: number;
  unpublishedCount: number | null;
  pendingCount: number | null;
  projectName?: string;
  localState?: 'saved' | 'checking' | 'remote' | 'unavailable' | 'none';
  projectChanges?: number;
  onCreate: () => void;
  onContinue: () => void;
  onProjects?: () => void;
  onChanges?: () => void;
  onPending?: () => void;
}) {
  const title = `${greeting()}，今天也来做点有趣的事情。`;
  const changed = (projectChanges ?? unpublishedCount ?? 0) > 0;
  const heading = changed ? `${projectChanges ?? unpublishedCount} 个文件，离发布只差一句话。` : localState === 'checking' ? '正在检查项目状态…' : localState === 'remote' ? 'GitHub 上有新内容。' : localState === 'unavailable' ? '有项目需要检查。' : localState === 'none' ? '把想法变成下一个作品。' : '你的项目已经全部保存。';
  const description = changed && projectName ? `${projectName} 的修改已准备好，写一句更新说明就能发布。` : localState === 'checking' ? '检查完成后，这里会显示尚未发布的修改。' : localState === 'remote' ? '查看项目，获取 GitHub 上的最新内容。' : localState === 'unavailable' ? '打开本地项目，确认文件夹和连接状态。' : localState === 'none' ? '添加电脑上的项目，或从 GitHub 下载后继续创作。' : '有新想法时，打开项目继续创作。';
  return <div className="v2-dashboard-intro">
    <div className="page-header v2-home-heading"><div><div className="eyebrow">你的创作空间</div><h1>{title}</h1><p>查看项目进展，继续创作你的下一个想法。</p></div><button className="button button-primary" onClick={onCreate}><Plus size={18} />新建项目</button></div>
    <div className="v2-home-top"><section className="v2-feature-card"><div className="v2-feature-copy"><span className="v2-feature-kicker"><i />接着创作</span><h2>{heading}</h2><p>{description}</p><button className="button v2-feature-button" onClick={onContinue}>{changed ? '查看修改' : '查看项目'}<ArrowRight size={17} /></button></div><div className="v2-feature-art" aria-hidden="true"><div /><img src={pottedPlant} alt="" /><span><img src={appIcon} alt="" /></span></div></section>
      <section className="v2-overview-card" aria-label="项目概览"><span>一眼看清进展</span><button type="button" onClick={onProjects ?? onContinue}><strong>{projectCount}</strong><small>我的项目</small></button><button type="button" onClick={onChanges ?? onContinue}><strong>{unpublishedCount ?? '…'}</strong><small>尚未发布的文件</small></button><button type="button" onClick={onPending ?? onContinue}><strong>{pendingCount ?? '…'}</strong><small>待处理的反馈与改进</small></button></section></div>
  </div>;
}
