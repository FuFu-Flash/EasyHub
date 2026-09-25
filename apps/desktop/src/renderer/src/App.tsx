import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ChangedFile, CreateReleaseInput, Issue, Project, ProjectHealth, Visibility } from '@easyhub/types';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Bell, Check, CheckCircle2,
  ChevronDown, ChevronRight, CircleHelp, Clock3, Cloud, CloudDownload, CloudUpload,
  File, FilePlus2, Folder, FolderOpen, GitCompareArrows, Globe2, Home, Info,
  LockKeyhole, MessageCircle, Minus, MoreHorizontal, Pencil, Plus, RotateCw, Search, Settings2,
  Send, ShieldCheck, Sparkles, Square, Tag, Trash2, X,
} from 'lucide-react';
import { ReleaseEditor } from './components/ReleaseEditor';
import { ReleasePreview } from './components/ReleasePreview';
import { ProjectDangerZone } from './components/ProjectDangerZone';
import { IntroductionEditor } from './components/IntroductionEditor';
import { ReadmeMarkdown } from './components/ReadmeMarkdown';
import appIcon from './assets/easyhub-icon.svg';
import pottedPlant from './assets/easyhub-potted-plant.svg';
import minecraftGrassBlock from './assets/minecraft-grass-block.png';
import { createDomLocalizer, readLanguage, type Language } from './i18n';
import {
  addComment, addDemoChanges, createInitialState, createIssue, createProject,
  downloadProject, getChangeSummary, publishUpdate, syncProject, toggleIssue, updateProjectReadme,
} from './stores/mockStore';
import { publishRelease } from './stores/releaseStore';
import { applyDangerAction, type DangerAction } from './stores/dangerStore';
import type { GitHubUser } from '@easyhub/github';
import { LiveWorkspace } from './LiveWorkspace';

type Route =
  | { name: 'home' }
  | { name: 'projects' }
  | { name: 'project'; projectId: string }
  | { name: 'publish'; projectId: string }
  | { name: 'new-release'; projectId: string }
  | { name: 'release'; projectId: string; releaseId: string }
  | { name: 'history'; projectId: string }
  | { name: 'version'; projectId: string; versionId: string }
  | { name: 'issues'; projectId?: string }
  | { name: 'issue'; issueId: string }
  | { name: 'new-project' }
  | { name: 'add-folder' }
  | { name: 'download' }
  | { name: 'settings' };

const demoOnlyBuild = import.meta.env.VITE_EASYHUB_DEMO_ONLY === 'true';

type BusyAction = { label: string; progress: number } | null;
type WindowControlStyle = 'windows' | 'reference';

const windowControlStyleKey = 'easyhub:window-control-style';

function readWindowControlStyle(): WindowControlStyle {
  try {
    return window.localStorage.getItem(windowControlStyleKey) === 'reference' ? 'reference' : 'windows';
  } catch {
    return 'windows';
  }
}

const statusText: Record<ProjectHealth, string> = {
  saved: '已保存到 GitHub',
  changes: '有尚未发布的修改',
  remote: 'GitHub 上有新内容',
};

const fileText: Record<ChangedFile['kind'], string> = {
  added: '新增', modified: '修改', deleted: '删除', renamed: '重命名',
};

function relativeTime(iso: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  if (hours < 48) return '昨天';
  return `${Math.floor(hours / 24)} 天前`;
}

function fullDate(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));
}

function StatusBadge({ health, count, compact = false }: { health: ProjectHealth; count?: number; compact?: boolean }) {
  const text = health === 'changes' && count ? `有 ${count} 个文件还没发布` : statusText[health];
  return <span className={`status status-${health} ${compact ? 'status-compact' : ''}`}><span className="status-dot" />{text}</span>;
}

function ProjectLogo({ project, small = false }: { project: Project; small?: boolean }) {
  let mark: ReactNode = project.initials;
  if (project.id === 'mytool') mark = <span className="windows-mark"><i /><i /><i /><i /></span>;
  if (project.id === 'minecraft') mark = <img className="minecraft-project-icon" src={minecraftGrassBlock} alt="" />;
  if (project.id === 'website') mark = <Globe2 size={small ? 24 : 29} strokeWidth={2.2} />;
  return <span className={`project-logo logo-${project.color} ${small ? 'project-logo-small' : ''}`}>{mark}</span>;
}

function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{text}</p>{action}</div>;
}

function Intro({ readme, onOpenLink }: { readme: string; onOpenLink: (url: string) => void }) {
  if (!readme.trim()) return <p className="muted">这个项目还没有介绍。</p>;
  return <ReadmeMarkdown markdown={readme} onOpenLink={onOpenLink} />;
}

function DemoApp({ onLogin, demoOnly = false }: { onLogin: () => void; demoOnly?: boolean }) {
  const [data, setData] = useState(createInitialState);
  const [windowControlStyle, setWindowControlStyle] = useState<WindowControlStyle>(readWindowControlStyle);
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [search, setSearch] = useState('');
  const [projectTab, setProjectTab] = useState<'local' | 'cloud' | 'users'>('local');
  const [issueFilter, setIssueFilter] = useState<'open' | 'closed'>('open');
  const [expandedIssueProjects, setExpandedIssueProjects] = useState<string[]>([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newVisibility, setNewVisibility] = useState<Visibility>('private');
  const [newFolder, setNewFolder] = useState('');
  const [existingFolder, setExistingFolder] = useState('');
  const [downloadFolder, setDownloadFolder] = useState('');
  const [downloadTarget, setDownloadTarget] = useState<{ projectId: string; versionId?: string } | null>(null);
  const [newIssueProject, setNewIssueProject] = useState('mytool');
  const [newIssueTitle, setNewIssueTitle] = useState('');
  const [newIssueBody, setNewIssueBody] = useState('');
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [reply, setReply] = useState('');
  const [introEditProjectId, setIntroEditProjectId] = useState<string | null>(null);
  const [imageSources, setImageSources] = useState<Record<string, string>>({});
  const operation = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const appRoot = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const languageMenu = useRef<HTMLDivElement>(null);
  const localizer = useRef(createDomLocalizer());

  useLayoutEffect(() => {
    if (appRoot.current) localizer.current.apply(appRoot.current, language);
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  });

  useLayoutEffect(() => scrollArea.current?.scrollTo(0, 0), [route]);

  useEffect(() => {
    const root = appRoot.current;
    if (!root) return;
    const observer = new MutationObserver(() => localizer.current.apply(root, language));
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] });
    return () => observer.disconnect();
  }, [language]);

  useEffect(() => {
    try {
      window.localStorage.setItem('easyhub:language', language);
    } catch {
      // Keep the chosen language for this session when storage is unavailable.
    }
  }, [language]);

  useEffect(() => {
    if (!languageMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (event.target instanceof Node && !languageMenu.current?.contains(event.target)) setLanguageMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setLanguageMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [languageMenuOpen]);

  useLayoutEffect(() => {
    const area = scrollArea.current;
    const content = area?.querySelector('.page-content');
    if (!area || !content) return;
    const update = (): void => setCanScrollDown(area.scrollTop + area.clientHeight < area.scrollHeight - 3);
    const observer = new ResizeObserver(update);
    observer.observe(area);
    observer.observe(content);
    area.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      area.removeEventListener('scroll', update);
    };
  }, [route, data, language]);

  useEffect(() => {
    try {
      window.localStorage.setItem(windowControlStyleKey, windowControlStyle);
    } catch {
      // The preference remains usable for the current session if storage is unavailable.
    }
  }, [windowControlStyle]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => () => {
    if (operation.current) clearTimeout(operation.current);
    if (progressTimer.current) clearInterval(progressTimer.current);
  }, []);

  const project = 'projectId' in route ? data.projects.find((item) => item.id === route.projectId) : undefined;
  const introEditProject = introEditProjectId ? data.projects.find((item) => item.id === introEditProjectId) : undefined;
  const issue = route.name === 'issue' ? data.issues.find((item) => item.id === route.issueId) : undefined;
  const currentIssueProject = issue ? data.projects.find((item) => item.id === issue.projectId) : undefined;
  const version = route.name === 'version' ? project?.history.find((item) => item.id === route.versionId) : undefined;
  const release = route.name === 'release' ? project?.releases.find((item) => item.id === route.releaseId) : undefined;
  const localProjects = data.projects.filter((item) => item.downloaded);
  const cloudProjects = data.projects.filter((item) => !item.downloaded);
  const openIssueCount = data.issues.filter((item) => item.state === 'open').length;
  const selectedIssueProject = route.name === 'issues' ? route.projectId : undefined;
  const filteredIssues = data.issues.filter((item) => item.state === issueFilter && (!selectedIssueProject || item.projectId === selectedIssueProject));
  const issueGroups = data.projects.map((item) => ({ project: item, issues: filteredIssues.filter((entry) => entry.projectId === item.id) }))
    .filter((group) => group.issues.length > 0);
  const pendingProject = localProjects.find((item) => item.health === 'changes' && !item.archived);
  const recentVersions = data.projects.flatMap((item) => item.history.map((itemVersion) => ({ project: item, version: itemVersion })))
    .sort((a, b) => new Date(b.version.createdAt).getTime() - new Date(a.version.createdAt).getTime())
    .slice(0, 4);

  function navigate(next: Route): void {
    setRoute(next);
    if (next.name === 'issues') setExpandedIssueProjects(next.projectId ? [next.projectId] : []);
    setSearch('');
    scrollArea.current?.scrollTo(0, 0);
  }

  function openReleaseLink(url: string): void {
    if (!window.easyHub) { setToast('无法打开链接'); return; }
    void window.easyHub.openExternalLink(url).catch(() => setToast('无法打开链接'));
  }

  function handlePublishRelease(projectId: string, input: CreateReleaseInput): void {
    runOperation('正在发布演示新版本', () => {
      const result = publishRelease(data, projectId, input);
      setData(result.state);
      navigate({ name: 'release', projectId, releaseId: result.release.id });
    }, '新版本已发布（演示）');
  }

  function beginEditIntroduction(item: Project): void {
    setIntroEditProjectId(item.id);
  }

  function saveIntroduction(markdown: string): void {
    if (!introEditProjectId) return;
    try {
      setData(updateProjectReadme(data, introEditProjectId, markdown));
      setIntroEditProjectId(null);
      setToast('项目介绍已保存，等待发布源码（演示）');
    } catch (error) {
      setToast(error instanceof Error ? error.message : '无法保存项目介绍');
    }
  }

  function handleDangerAction(projectId: string, action: DangerAction, targetOwner?: string): void {
    const currentProject = data.projects.find((item) => item.id === projectId);
    const next = applyDangerAction(data, projectId, action, targetOwner);
    setData(next);
    if (action === 'delete') {
      if (newIssueProject === projectId) setNewIssueProject(next.projects[0]?.id ?? '');
      navigate({ name: 'projects' });
    }
    const messages: Record<DangerAction, string> = {
      visibility: '项目可见性已更改（演示）',
      protection: '分支保护设置已更改（演示）',
      transfer: '项目所有者已更改（演示）',
      archive: currentProject?.archived ? '项目已取消存档（演示）' : '项目已存档（演示）',
      delete: '演示项目已删除，本地文件未受影响',
    };
    setToast(messages[action]);
  }

  function runOperation(label: string, action: () => void, success: string): void {
    if (busy) return;
    setBusy({ label, progress: 12 });
    progressTimer.current = setInterval(() => setBusy((current) => current ? { ...current, progress: Math.min(current.progress + 13, 88) } : null), 130);
    operation.current = setTimeout(() => {
      if (progressTimer.current) clearInterval(progressTimer.current);
      try {
        action();
        setToast(success);
      } catch (error) {
        setToast(error instanceof Error ? error.message : '操作没有完成，请重试');
      }
      setBusy(null);
      operation.current = null;
    }, 850);
  }

  function cancelOperation(): void {
    if (operation.current) clearTimeout(operation.current);
    if (progressTimer.current) clearInterval(progressTimer.current);
    operation.current = null;
    setBusy(null);
    setToast('已取消操作');
  }

  async function chooseFolder(setter: (path: string) => void): Promise<void> {
    if (!window.easyHub) {
      setToast('请在 EasyHub 桌面窗口中选择文件夹');
      return;
    }
    try {
      const path = await window.easyHub.chooseFolder();
      if (path) setter(path);
    } catch {
      setToast('无法打开文件夹选择器');
    }
  }

  function controlWindow(action: 'minimizeWindow' | 'toggleMaximizeWindow' | 'closeWindow'): void {
    const bridge = window.easyHub;
    if (!bridge) { setToast('请在 EasyHub 桌面窗口中使用窗口按钮'); return; }
    void bridge[action]().catch(() => setToast('窗口操作没有完成，请重试'));
  }

  function handleCreateProject(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!newName.trim()) { setToast('请填写项目名称'); return; }
    if (!newFolder.trim()) { setToast('请选择本地文件夹'); return; }
    runOperation('正在创建演示项目', () => {
      const result = createProject(data, { name: newName, description: newDescription, visibility: newVisibility, localPath: newFolder });
      setData(result.state);
      navigate({ name: 'project', projectId: result.project.id });
      setNewName(''); setNewDescription(''); setNewFolder('');
    }, '项目创建成功（演示）');
  }

  function handleAddFolder(): void {
    if (!existingFolder.trim()) { setToast('请选择一个本地文件夹'); return; }
    const name = existingFolder.split(/[\\/]/).filter(Boolean).at(-1) ?? '我的项目';
    runOperation('正在添加演示文件夹', () => {
      const result = createProject(data, { name, description: '从现有文件夹添加的项目', visibility: 'private', localPath: existingFolder });
      setData(result.state);
      setExistingFolder('');
      navigate({ name: 'project', projectId: result.project.id });
    }, '项目已添加（演示）');
  }

  function handlePublish(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!project) return;
    if (!draftMessage.trim()) { setToast('请写一句这次改了什么'); return; }
    const projectId = project.id;
    runOperation('正在发布演示更新', () => {
      setData((current) => publishUpdate(current, projectId, draftMessage));
      setDraftMessage('');
      navigate({ name: 'history', projectId });
    }, '发布成功（演示）');
  }

  function handleHomePublish(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!pendingProject) return;
    if (!draftMessage.trim()) { setToast('请写一句这次改了什么'); return; }
    const projectId = pendingProject.id;
    const message = draftMessage;
    runOperation('正在发布演示更新', () => {
      setData((current) => publishUpdate(current, projectId, message));
      setDraftMessage('');
    }, '发布成功（演示）');
  }

  function handleCreateIssue(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    try {
      setData(createIssue(data, newIssueProject, newIssueTitle, newIssueBody));
      setExpandedIssueProjects((current) => current.includes(newIssueProject) ? current : [...current, newIssueProject]);
      setShowIssueForm(false); setNewIssueTitle(''); setNewIssueBody('');
      setIssueFilter('open'); setToast('问题已创建（演示）');
    } catch (error) { setToast(error instanceof Error ? error.message : '无法创建问题'); }
  }

  function handleReply(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!issue) return;
    try {
      setData(addComment(data, issue.id, reply));
      setReply(''); setToast('回复已发送（演示）');
    } catch (error) { setToast(error instanceof Error ? error.message : '无法发送回复'); }
  }

  function issueCount(projectId: string): number {
    return data.issues.filter((item) => item.projectId === projectId && item.state === 'open').length;
  }

  function projectCard(item: Project, compact = false): ReactNode {
    return <article className={`project-card ${compact ? 'compact-card' : ''}`} key={item.id}>
      <div className="card-head"><ProjectLogo project={item} /><button className="icon-button card-more" aria-label={`打开 ${item.name}`} onClick={() => navigate({ name: 'project', projectId: item.id })}><MoreHorizontal size={19} /></button></div>
      <button className="plain-heading" onClick={() => navigate({ name: 'project', projectId: item.id })}>{item.name}</button>
      <p className="card-description">{item.description || '还没有项目介绍'}</p>
      <StatusBadge health={item.health} count={item.changedFiles.length} />{item.archived && <span className="archived-chip">已存档 · 只读</span>}
      <div className="card-footer"><span><Clock3 size={14} />{relativeTime(item.updatedAt)}更新</span><span><MessageCircle size={14} />{issueCount(item.id)} 个问题</span></div>
      <div className="card-actions">
        {item.archived ? <button className="button button-quiet" onClick={() => navigate({ name: 'project', projectId: item.id })}>打开项目 <ArrowRight size={16} /></button> : item.health === 'changes'
          ? <><button className="button button-quiet" onClick={() => navigate({ name: 'publish', projectId: item.id })}>查看修改</button><button className="button button-primary" onClick={() => navigate({ name: 'publish', projectId: item.id })}>发布更新 <ArrowRight size={16} /></button></>
          : item.health === 'remote'
            ? <button className="button button-primary" onClick={() => runOperation('正在获取演示内容', () => setData((current) => syncProject(current, item.id)), '已获取最新内容（演示）')}>获取最新 <ArrowRight size={16} /></button>
            : <button className="button button-quiet" onClick={() => navigate({ name: 'project', projectId: item.id })}>打开项目 <ArrowRight size={16} /></button>}
      </div>
    </article>;
  }

  function homeProjectRow(item: Project): ReactNode {
    return <div className="home-project-row" key={item.id}>
      <ProjectLogo project={item} />
      <button className="home-project-name" onClick={() => navigate({ name: 'project', projectId: item.id })}><strong>{item.name}</strong><span>{item.description || '还没有项目介绍'}</span></button>
      <div className="home-project-meta"><span className={`home-row-status ${item.health}`}><i />{item.archived ? '已存档 · 只读' : item.health === 'saved' ? '已保存' : item.health === 'changes' ? `有 ${item.changedFiles.length} 个文件还没发布` : 'GitHub 上有新内容'}</span><small>{relativeTime(item.updatedAt)}更新 · {issueCount(item.id)} 个问题</small></div>
      <div className="home-project-actions">{item.archived ? <button className="button button-quiet" onClick={() => navigate({ name: 'project', projectId: item.id })}>打开项目</button> : item.health === 'changes'
        ? <><button className="button button-quiet" onClick={() => navigate({ name: 'publish', projectId: item.id })}>查看修改</button><button className="button button-primary" onClick={() => navigate({ name: 'publish', projectId: item.id })}>发布更新</button></>
        : item.health === 'remote'
          ? <button className="button button-quiet" onClick={() => runOperation('正在获取演示内容', () => setData((current) => syncProject(current, item.id)), '已获取最新内容（演示）')}>获取最新</button>
          : <button className="button button-quiet" onClick={() => navigate({ name: 'project', projectId: item.id })}>打开项目</button>}</div>
      <button className="icon-button home-row-more" aria-label={`查看 ${item.name}`} onClick={() => navigate({ name: 'project', projectId: item.id })}><MoreHorizontal size={18} /></button>
    </div>;
  }

  function issueRow(item: Issue): ReactNode {
    const linkedProject = data.projects.find((entry) => entry.id === item.projectId);
    return <button className="issue-row" key={item.id} onClick={() => navigate({ name: 'issue', issueId: item.id })}>
      <span className={`issue-indicator ${item.state === 'closed' ? 'closed' : ''}`}><CircleHelp size={19} /></span>
      <span className="issue-row-main"><strong>{item.title}</strong><small>{linkedProject?.name} · {item.author} · {relativeTime(item.createdAt)}</small></span>
      <span className="issue-comments"><MessageCircle size={16} />{item.comments.length}</span><ChevronRight size={18} className="chevron" />
    </button>;
  }

  const activeNav = route.name === 'issues' || route.name === 'issue' ? 'issues'
    : route.name === 'settings' ? 'settings'
      : ['projects', 'project', 'publish', 'new-release', 'release', 'history', 'version', 'download', 'add-folder'].includes(route.name) ? 'projects' : 'home';

  return <div className="app-shell" ref={appRoot}>
    <aside className="sidebar">
      <nav className="sidebar-nav" aria-label="主导航">
        <button className={activeNav === 'home' ? 'active' : ''} onClick={() => navigate({ name: 'home' })}><Home size={19} />首页</button>
        <button className={activeNav === 'projects' ? 'active' : ''} onClick={() => navigate({ name: 'projects' })}><Folder size={19} />我的项目</button>
        <button className={activeNav === 'issues' ? 'active' : ''} onClick={() => navigate({ name: 'issues' })}><MessageCircle size={19} />问题 <span className="nav-count">{openIssueCount}</span></button>
        <button className={activeNav === 'settings' ? 'active' : ''} onClick={() => navigate({ name: 'settings' })}><Settings2 size={19} />设置</button>
      </nav>
      <div className="sidebar-bottom"><span className="sidebar-demo"><span />{demoOnly ? '演示版 · 不连接 GitHub' : '演示模式 · 未连接 GitHub'}</span></div>
    </aside>

    <div className="main-column" ref={scrollArea}>
      <header className={`topbar topbar-${windowControlStyle}`}>
        {windowControlStyle === 'reference' && (
          <div className="window-controls" aria-label="窗口控制">
            <button className="window-dot window-close" aria-label="关闭窗口" title="关闭" onClick={() => controlWindow('closeWindow')} />
            <button className="window-dot window-minimize" aria-label="最小化窗口" title="最小化" onClick={() => controlWindow('minimizeWindow')} />
            <button className="window-dot window-maximize" aria-label="最大化或还原窗口" title="最大化或还原" onClick={() => controlWindow('toggleMaximizeWindow')} />
          </div>
        )}
        <button className="topbar-brand" onClick={() => navigate({ name: 'home' })}><img src={appIcon} alt="" /><span>EasyHub</span></button>
        <label className="topbar-search"><Search size={19} /><input aria-label="搜索项目/用户" value={search} onFocus={() => { if (route.name !== 'projects') setRoute({ name: 'projects' }); }} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目/用户..." /></label>
        <div className="topbar-actions">
          <div className="language-switcher" ref={languageMenu}>
            <button className="icon-button language-trigger" aria-label="选择语言" aria-expanded={languageMenuOpen} title="语言" onClick={() => setLanguageMenuOpen((open) => !open)}><Globe2 size={21} strokeWidth={1.8} /></button>
            {languageMenuOpen && <div className="language-menu" role="group" aria-label="语言选项">
              <button aria-pressed={language === 'zh'} onClick={() => { setLanguage('zh'); setLanguageMenuOpen(false); }}><span>中文</span>{language === 'zh' && <Check size={16} />}</button>
              <button aria-pressed={language === 'en'} onClick={() => { setLanguage('en'); setLanguageMenuOpen(false); }}><span>English</span>{language === 'en' && <Check size={16} />}</button>
            </div>}
          </div>
          <button className="icon-button" aria-label="通知" onClick={() => setToast('演示模式下暂无通知')}><Bell size={20} /></button>
          <button className="icon-button" aria-label="设置" onClick={() => navigate({ name: 'settings' })}><Settings2 size={20} /></button>
          <button className="topbar-profile" onClick={() => setToast('当前正在使用演示数据')}><span className="topbar-avatar">{language === 'en' ? 'Y' : '你'}</span><ChevronDown size={16} /></button>
        </div>
        {windowControlStyle === 'windows' && (
          <div className="windows-window-controls" aria-label="窗口控制">
            <button className="windows-control-button" aria-label="最小化窗口" title="最小化" onClick={() => controlWindow('minimizeWindow')}><Minus size={17} strokeWidth={1.6} /></button>
            <button className="windows-control-button" aria-label="最大化或还原窗口" title="最大化或还原" onClick={() => controlWindow('toggleMaximizeWindow')}><Square size={13} strokeWidth={1.7} /></button>
            <button className="windows-control-button windows-control-close" aria-label="关闭窗口" title="关闭" onClick={() => controlWindow('closeWindow')}><X size={17} strokeWidth={1.6} /></button>
          </div>
        )}
      </header>
      <main className="page-content">
        {route.name === 'home' && <>
          <section className="home-hero"><div className="home-hero-copy"><h1>早上好，<br />今天也来做点有趣的事情吧！ <span className="wave">👋</span></h1><p>你的项目都在这里，随时可以继续创作和发布更新。</p></div><div className="home-mascot" aria-hidden="true"><div className="mascot-cloud" /><div className="mascot-note">记录创意<br />分享给世界<br />从这里开始！</div><div className="mascot-character"><img src={appIcon} alt="" /><div className="mascot-arm left" /><div className="mascot-arm right" /><div className="mascot-laptop"><span>✦</span></div></div><img className="mascot-plant" src={pottedPlant} alt="" /></div></section>
          <button className="home-create" onClick={() => navigate({ name: 'new-project' })}><span className="home-create-icon"><Plus size={31} /></span><span><strong>新建项目</strong><small>从一个新想法开始</small></span><ChevronRight size={22} /></button>
          {pendingProject ? <form className="home-publish" onSubmit={handleHomePublish}><ProjectLogo project={pendingProject} /><div className="home-publish-content"><strong>{pendingProject.name} 有 {pendingProject.changedFiles.length} 个文件发生变化</strong><label htmlFor="home-update-message">这次改了什么？</label><div className="home-publish-controls"><input id="home-update-message" value={draftMessage} onChange={(event) => setDraftMessage(event.target.value)} placeholder="例如：修复窗口缩放问题" maxLength={120} /><button className="button button-primary" type="submit" disabled={Boolean(busy)}><Send size={17} />发布更新</button></div></div><button className="icon-button home-publish-detail" type="button" aria-label="查看修改" onClick={() => navigate({ name: 'publish', projectId: pendingProject.id })}><ChevronRight size={20} /></button></form> : <div className="home-all-saved"><CheckCircle2 size={20} />目前没有尚未发布的修改。<button onClick={() => navigate({ name: 'projects' })}>查看项目 <ArrowRight size={16} /></button></div>}
          <div className="home-dashboard"><section className="home-panel home-projects-panel"><div className="home-panel-heading"><h2>我的项目</h2><button className="text-link" onClick={() => navigate({ name: 'projects' })}>查看全部 <ChevronRight size={17} /></button></div><div className="home-project-list">{localProjects.slice(0, 3).map(homeProjectRow)}</div></section><section className="home-panel home-recent-panel"><div className="home-panel-heading"><h2>最近更新</h2><button className="text-link" onClick={() => navigate({ name: 'history', projectId: recentVersions[0]?.project.id ?? 'mytool' })}>查看全部 <ChevronRight size={17} /></button></div><div className="home-recent-list">{recentVersions.map(({ project: item, version: itemVersion }) => <button className="home-recent-row" key={`${item.id}-${itemVersion.id}`} onClick={() => navigate({ name: 'version', projectId: item.id, versionId: itemVersion.id })}><ProjectLogo project={item} small /><span><strong>{item.name}</strong><small>{relativeTime(itemVersion.createdAt)}</small><em>{itemVersion.message}</em></span></button>)}</div></section></div>
          <div className="home-shortcuts"><button onClick={() => navigate({ name: 'download' })}><CloudDownload size={17} />从 GitHub 下载项目 <ArrowRight size={15} /></button><button onClick={() => navigate({ name: 'add-folder' })}><FolderOpen size={17} />添加现有文件夹 <ArrowRight size={15} /></button></div>
        </>}

        {route.name === 'projects' && <>
          <div className="page-header"><div><div className="eyebrow">你的作品</div><h1>我的项目</h1><p>所有灵感和进展，都在这里。</p></div><button className="button button-primary" onClick={() => navigate({ name: 'new-project' })}><Plus size={18} />新建项目</button></div>
          <div className="toolbar"><div className="segmented"><button className={projectTab === 'local' ? 'selected' : ''} onClick={() => setProjectTab('local')}>这台电脑 <span>{localProjects.length}</span></button><button className={projectTab === 'cloud' ? 'selected' : ''} onClick={() => setProjectTab('cloud')}>我的云端项目 <span>{cloudProjects.length}</span></button><button className={projectTab === 'users' ? 'selected' : ''} onClick={() => setProjectTab('users')}>搜索用户</button></div><label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={projectTab === 'users' ? '搜索用户' : '搜索项目'} /></label></div>
          {projectTab === 'users' ? <div className="empty-state"><span className="empty-icon"><Search size={28} /></span><h3>{demoOnly ? '演示版不连接 GitHub' : '登录后搜索 GitHub 用户'}</h3><p>{demoOnly ? '安装正式版后可以搜索用户和公开项目。' : '连接 GitHub 后，可以查看头像、热门项目与个人主页。'}</p>{!demoOnly && <button className="button button-primary" onClick={onLogin}>使用 GitHub 登录 <ArrowRight size={16} /></button>}</div> : projectTab === 'local' ? <div className="project-grid">{localProjects.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())).map((item) => projectCard(item))}</div> : <><div className="cloud-list">{cloudProjects.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())).map((item) => <div className="cloud-row" key={item.id}><ProjectLogo project={item} small /><div><strong>{item.name}</strong><small>{item.description}</small></div><span className="cloud-private">{item.visibility === 'private' ? <><LockKeyhole size={14} />只有我</> : '所有人'}</span><button className="button button-primary" onClick={() => { setDownloadTarget({ projectId: item.id }); setDownloadFolder(''); }}>下载 <ArrowDownToLine size={16} /></button></div>)}</div>{cloudProjects.length === 0 && <EmptyState icon={<Cloud size={28} />} title="没有待下载的项目" text="你的云端项目都已在这台电脑上。" />}</>}
          <div className="inline-note"><Info size={17} />这里是演示数据。真实项目和文件会在后续阶段接入。</div>
        </>}

        {route.name === 'new-project' && <>
          <button className="back-link" onClick={() => navigate({ name: 'home' })}><ArrowLeft size={17} />返回首页</button>
          <div className="form-page"><div className="form-intro"><div className="form-symbol"><Plus size={27} /></div><div className="eyebrow">开始新的创作</div><h1>新建项目</h1><p>给你的作品起个名字，剩下的交给 EasyHub。</p><div className="form-tip"><ShieldCheck size={19} /><span>当前是演示模式：选择文件夹后不会读取文件，也不会上传到 GitHub。</span></div></div>
            <form className="form-card" onSubmit={handleCreateProject}><label className="field"><span>项目名称 <b>*</b></span><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="例如：我的工具" maxLength={80} /></label><label className="field"><span>一句介绍</span><input value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="用一句话介绍你的项目" maxLength={160} /></label><div className="field"><span>本地文件夹 <b>*</b></span><div className="folder-field"><FolderOpen size={19} /><span title={newFolder}>{newFolder || '还没有选择文件夹'}</span><button type="button" className="button button-quiet" onClick={() => void chooseFolder(setNewFolder)}>选择文件夹</button></div><small>演示阶段只记录路径，不会修改所选文件夹。</small></div><div className="field"><span>谁能看到？</span><div className="choice-grid"><button type="button" className={`choice ${newVisibility === 'private' ? 'chosen' : ''}`} onClick={() => setNewVisibility('private')}><span className="choice-circle">{newVisibility === 'private' && <Check size={13} />}</span><LockKeyhole size={18} /><strong>只有我</strong><small>仅自己可见</small></button><button type="button" className={`choice ${newVisibility === 'public' ? 'chosen' : ''}`} onClick={() => setNewVisibility('public')}><span className="choice-circle">{newVisibility === 'public' && <Check size={13} />}</span><Cloud size={18} /><strong>所有人</strong><small>可以分享给别人</small></button></div></div><button className="button button-primary submit-button" type="submit" disabled={Boolean(busy)}>创建项目 <ArrowRight size={18} /></button></form></div>
        </>}

        {route.name === 'add-folder' && <>
          <button className="back-link" onClick={() => navigate({ name: 'home' })}><ArrowLeft size={17} />返回首页</button>
          <div className="narrow-page"><div className="eyebrow">已有作品</div><h1>添加现有文件夹</h1><p className="page-subtitle">选择你的作品所在的文件夹，把它放进 EasyHub。</p><section className="panel add-folder-panel"><div className="form-symbol"><FolderOpen size={26} /></div><h2>选择项目文件夹</h2><p>演示模式会用文件夹名称创建一张项目卡片，不会检查或修改其中的文件。</p><div className="folder-field"><FolderOpen size={18} /><span title={existingFolder}>{existingFolder || '还没有选择文件夹'}</span><button className="button button-quiet" onClick={() => void chooseFolder(setExistingFolder)}>选择文件夹</button></div>{existingFolder && <div className="confirm-folder"><Info size={18} /><span>要把这个文件夹创建成一个新项目吗？</span></div>}<div className="add-folder-actions"><button className="button button-quiet" onClick={() => navigate({ name: 'home' })}>取消</button><button className="button button-primary" disabled={!existingFolder || Boolean(busy)} onClick={handleAddFolder}>添加项目 <ArrowRight size={17} /></button></div></section></div>
        </>}

        {route.name === 'project' && project && <>
          <button className="back-link" onClick={() => navigate({ name: 'projects' })}><ArrowLeft size={17} />所有项目</button>
          <section className="detail-hero"><div className="detail-main"><ProjectLogo project={project} /><div><div className="detail-name-row"><h1>{project.name}</h1><span className="visibility-label">{project.visibility === 'private' ? <><LockKeyhole size={13} />只有我</> : <><Cloud size={13} />所有人</>}</span></div><p>{project.description || '还没有项目介绍'}</p><StatusBadge health={project.health} count={project.changedFiles.length} />{project.archived && <span className="archived-chip">已存档 · 只读</span>}</div></div><div className="detail-actions">{project.health === 'changes' ? <button className="button button-primary" disabled={project.archived} onClick={() => navigate({ name: 'publish', projectId: project.id })}><CloudUpload size={18} />发布更新</button> : project.health === 'remote' ? <button className="button button-primary" onClick={() => runOperation('正在获取演示内容', () => setData((current) => syncProject(current, project.id)), '已获取最新内容（演示）')}><CloudDownload size={18} />获取最新</button> : <button className="button button-primary" disabled={project.archived} onClick={() => { setData((current) => addDemoChanges(current, project.id)); setToast('已模拟检测到 3 个修改'); }}><Sparkles size={17} />模拟文件修改</button>}<button className="button button-quiet" disabled={project.archived} onClick={() => navigate({ name: 'new-release', projectId: project.id })}><Tag size={17} />发布新版本</button><button className="button button-quiet" onClick={() => setToast('演示模式不会打开或修改本地文件夹')}><FolderOpen size={17} />打开文件夹</button></div></section>
          <div className="detail-grid"><div className="detail-primary"><section className="panel"><div className="panel-heading"><h2>项目介绍</h2><button className="text-link" disabled={project.archived || project.health === 'remote'} title={project.health === 'remote' ? '请先获取最新内容' : undefined} onClick={() => beginEditIntroduction(project)}><Pencil size={15} />编辑介绍</button></div><Intro readme={project.readme} onOpenLink={openReleaseLink} /></section><section className="panel"><div className="panel-heading"><h2>发布的版本</h2><button className="text-link" disabled={project.archived} onClick={() => navigate({ name: 'publish', projectId: project.id })}>发布源码 <ArrowRight size={16} /></button></div>{project.releases.length ? <div className="timeline-list">{project.releases.map((item) => <button className="timeline-item" key={item.id} onClick={() => navigate({ name: 'release', projectId: project.id, releaseId: item.id })}><span className="timeline-dot" /><span><strong>{item.title}</strong><small>{item.tagName} · {relativeTime(item.publishedAt)} · {item.assets.length} 个下载文件</small></span><ChevronRight size={17} /></button>)}</div> : <p className="muted">还没有发布可供下载的新版本。</p>}</section><section className="panel"><div className="panel-heading"><h2>历史版本</h2><button className="text-link" onClick={() => navigate({ name: 'history', projectId: project.id })}>查看全部 <ArrowRight size={16} /></button></div><div className="timeline-list">{project.history.slice(0, 3).map((item) => <button className="timeline-item" key={item.id} onClick={() => navigate({ name: 'version', projectId: project.id, versionId: item.id })}><span className="timeline-dot" /><span><strong>{item.message}</strong><small>{relativeTime(item.createdAt)} · 修改了 {item.changedFiles.length} 个文件</small></span><ChevronRight size={17} /></button>)}</div></section></div><div className="detail-side"><section className="panel side-panel"><div className="panel-heading"><h2>问题</h2><span className="count-bubble">{issueCount(project.id)}</span></div><p>看看大家的反馈，一起让项目变得更好。</p><button className="button button-quiet full-width" onClick={() => navigate({ name: 'issues', projectId: project.id })}>查看问题 <ArrowRight size={16} /></button></section><section className="panel side-panel"><div className="panel-heading"><h2>项目状态</h2></div><div className="status-detail"><span className={`big-status-dot ${project.health}`} /><div><strong>{project.health === 'changes' ? getChangeSummary(project.changedFiles) : statusText[project.health]}</strong><small>{project.health === 'changes' ? '准备好后发布你的更新' : `上次更新：${relativeTime(project.updatedAt)}`}</small></div></div>{project.health === 'changes' && <button className="text-link" disabled={project.archived} onClick={() => navigate({ name: 'publish', projectId: project.id })}>查看修改 <ArrowRight size={16} /></button>}</section></div></div>
          <ProjectDangerZone project={project} language={language} onApply={(action, targetOwner) => handleDangerAction(project.id, action, targetOwner)} />
        </>}

        {route.name === 'new-release' && project && <ReleaseEditor key={project.id} project={project} language={language} busy={Boolean(busy)} imageSources={imageSources} onRegisterInlineImage={(id, source) => setImageSources((current) => ({ ...current, [id]: typeof source === 'string' ? source : URL.createObjectURL(source) }))} onPublish={(input) => handlePublishRelease(project.id, input)} onBack={() => navigate({ name: 'project', projectId: project.id })} onOpenUpdate={() => navigate({ name: 'publish', projectId: project.id })} onOpenLink={openReleaseLink} />}

        {route.name === 'release' && project && release && <div className="release-page"><button className="back-link" onClick={() => navigate({ name: 'project', projectId: project.id })}><ArrowLeft size={17} />返回项目</button><div className="release-page-heading"><div className="eyebrow">{project.name}</div><h1>已发布的新版本</h1><p>这个版本供其他人查看介绍和下载文件。</p></div><ReleasePreview release={release} imageSources={imageSources} language={language} onOpenLink={openReleaseLink} onAssetClick={() => setToast('演示模式没有上传文件，暂时无法下载')} /><div className="release-editor-actions"><button className="button button-quiet" onClick={() => navigate({ name: 'project', projectId: project.id })}>返回项目</button><button className="button button-primary" disabled={project.archived} onClick={() => navigate({ name: 'new-release', projectId: project.id })}>发布下一个版本 <ArrowRight size={17} /></button></div><p className="release-demo-note">当前是演示模式，版本和文件仅保存在本窗口中，没有发布到 GitHub。</p></div>}

        {route.name === 'publish' && project && <>
          <button className="back-link" onClick={() => navigate({ name: 'project', projectId: project.id })}><ArrowLeft size={17} />返回项目</button>
          <div className="narrow-page"><div className="eyebrow">{project.name}</div><h1>发布更新</h1><p className="page-subtitle">把日常源码修改保存到 GitHub。要提供安装包和版本介绍，请使用“发布新版本”。</p><div className="publish-overview"><div className="publish-icon"><GitCompareArrows size={24} /></div><div><strong>{getChangeSummary(project.changedFiles)}</strong><span>EasyHub 已整理好这次修改</span></div><CheckCircle2 size={21} className="overview-check" /></div><form onSubmit={handlePublish} className="publish-card"><label className="field"><span>这次改了什么？</span><input value={draftMessage} onChange={(event) => setDraftMessage(event.target.value)} placeholder="例如：修复窗口缩放问题" maxLength={120} autoFocus /><small>写一句简单的话，方便以后找到这个版本。</small></label><div className="files-heading"><strong>修改内容</strong><span>{project.changedFiles.length} 个文件</span></div><div className="file-list">{project.changedFiles.map((file) => <div className="file-row" key={file.path}><span className={`file-kind kind-${file.kind}`}>{file.kind === 'added' ? <FilePlus2 size={16} /> : file.kind === 'deleted' ? <Trash2 size={16} /> : <File size={16} />}</span><span>{file.path}</span><small>{fileText[file.kind]}</small></div>)}</div><div className="publish-bottom"><span><ShieldCheck size={17} />发布前会检查云端更新</span><button className="button button-primary" type="submit" disabled={Boolean(busy) || project.archived || project.changedFiles.length === 0}>发布更新 <ArrowRight size={17} /></button></div></form><div className="inline-note"><Info size={17} />演示模式只会更新此窗口里的源码历史，不会发布可下载的新版本或上传文件。</div></div>
        </>}

        {route.name === 'history' && project && <>
          <button className="back-link" onClick={() => navigate({ name: 'project', projectId: project.id })}><ArrowLeft size={17} />返回项目</button><div className="page-header"><div><div className="eyebrow">{project.name}</div><h1>历史版本</h1><p>每一次更新，都有迹可循。</p></div></div><div className="history-list">{project.history.map((item) => <button className="history-row" key={item.id} onClick={() => navigate({ name: 'version', projectId: project.id, versionId: item.id })}><span className="history-icon"><Clock3 size={19} /></span><span className="history-main"><strong>{item.message}</strong><small>{fullDate(item.createdAt, language)} · {item.author} · 修改了 {item.changedFiles.length} 个文件</small></span><span className="button button-quiet small-button">查看 <ArrowRight size={15} /></span></button>)}</div>
        </>}

        {route.name === 'version' && project && version && <>
          <button className="back-link" onClick={() => navigate({ name: 'history', projectId: project.id })}><ArrowLeft size={17} />历史版本</button><div className="narrow-page"><div className="eyebrow">{project.name} · 历史版本</div><h1>{version.message}</h1><p className="page-subtitle">{version.author} 发布于 {fullDate(version.createdAt, language)}</p><div className="version-stats"><div><strong>{version.changedFiles.length}</strong><span>修改文件</span></div><div><strong className="positive">+{version.additions}</strong><span>新增行数</span></div><div><strong className="negative">−{version.deletions}</strong><span>删除行数</span></div></div><section className="panel"><div className="panel-heading"><h2>修改文件</h2></div>{version.changedFiles.length ? <div className="file-list">{version.changedFiles.map((file) => <div className="file-row" key={file}><span className="file-kind"><File size={16} /></span><span>{file}</span></div>)}</div> : <p className="muted">这个版本没有演示文件明细。</p>}</section><button className="button button-primary version-download" onClick={() => { setDownloadTarget({ projectId: project.id, versionId: version.id }); setDownloadFolder(''); }}><ArrowDownToLine size={18} />下载这个版本</button><p className="muted download-explain">演示模式不会写入任何文件。</p></div>
        </>}

        {route.name === 'issues' && <>
          <div className="page-header"><div><div className="eyebrow">一起完善作品</div><h1>问题</h1><p>查看反馈、回复想法，解决遇到的困难。</p></div><button className="button button-primary" onClick={() => { setNewIssueProject(route.projectId ?? 'mytool'); setShowIssueForm(true); }}><Plus size={18} />提出问题</button></div>
          <div className="toolbar"><div className="segmented"><button className={issueFilter === 'open' ? 'selected' : ''} onClick={() => setIssueFilter('open')}>待处理 <span>{data.issues.filter((item) => item.state === 'open' && (!route.projectId || item.projectId === route.projectId)).length}</span></button><button className={issueFilter === 'closed' ? 'selected' : ''} onClick={() => setIssueFilter('closed')}>已解决 <span>{data.issues.filter((item) => item.state === 'closed' && (!route.projectId || item.projectId === route.projectId)).length}</span></button></div>{route.projectId && <button className="filter-project" onClick={() => navigate({ name: 'issues' })}>{data.projects.find((item) => item.id === route.projectId)?.name}<X size={15} /></button>}</div>
          {issueGroups.length ? <div className="issue-project-list">{issueGroups.map(({ project: groupProject, issues }) => {
            const expanded = expandedIssueProjects.includes(groupProject.id);
            return <section className="issue-project-group" key={groupProject.id}>
              <button className="issue-project-header" aria-expanded={expanded} aria-controls={`issue-project-${groupProject.id}`} onClick={() => setExpandedIssueProjects((current) => expanded ? current.filter((id) => id !== groupProject.id) : [...current, groupProject.id])}>
                <ProjectLogo project={groupProject} small />
                <span className="issue-project-heading"><strong>{groupProject.name}</strong><small>{groupProject.description}</small></span>
                <span className="issue-project-count">{issues.length} 个问题</span>
                <ChevronDown className={`issue-project-chevron ${expanded ? 'expanded' : ''}`} size={19} />
              </button>
              <div id={`issue-project-${groupProject.id}`} className="issue-project-items" hidden={!expanded}>{expanded && issues.map(issueRow)}</div>
            </section>;
          })}</div> : <div className="issue-list"><EmptyState icon={<MessageCircle size={28} />} title={issueFilter === 'open' ? '没有待处理的问题' : '还没有已解决的问题'} text="这里会显示项目收到的反馈。" /></div>}
        </>}

        {route.name === 'issue' && issue && <>
          <button className="back-link" onClick={() => navigate({ name: 'issues', projectId: issue.projectId })}><ArrowLeft size={17} />返回问题</button><div className="issue-detail"><div className="issue-title"><span className={`issue-state ${issue.state}`}>{issue.state === 'open' ? '待处理' : '已解决'}</span><h1>{issue.title}</h1><p>{currentIssueProject?.name} · {issue.author} 提出于 {fullDate(issue.createdAt, language)}</p></div><div className="conversation"><div className="message"><div className="avatar author-avatar">{issue.author.slice(0, 1)}</div><div className="message-box"><div><strong>{issue.author}</strong><small>{relativeTime(issue.createdAt)}</small></div><p>{issue.body || '没有详细描述。'}</p></div></div>{issue.comments.map((comment) => <div className="message" key={comment.id}><div className="avatar">{comment.author.slice(0, 1)}</div><div className="message-box"><div><strong>{comment.author}</strong><small>{relativeTime(comment.createdAt)}</small></div><p>{comment.body}</p></div></div>)}</div><form className="reply-card" onSubmit={handleReply}><label htmlFor="reply">写一条回复</label><textarea id="reply" disabled={currentIssueProject?.archived} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="说说你的想法或处理进度…" rows={4} /><div><button type="button" className="button button-quiet" disabled={currentIssueProject?.archived} onClick={() => { setData(toggleIssue(data, issue.id)); setToast(issue.state === 'open' ? '问题已标记为解决（演示）' : '问题已重新打开（演示）'); }}>{issue.state === 'open' ? '标记为已解决' : '重新打开'}</button><button className="button button-primary" type="submit" disabled={currentIssueProject?.archived}>发送回复 <ArrowRight size={16} /></button></div></form></div>
        </>}

        {route.name === 'download' && <>
          <button className="back-link" onClick={() => navigate({ name: 'projects' })}><ArrowLeft size={17} />我的项目</button><div className="page-header"><div><div className="eyebrow">带到这台电脑</div><h1>下载项目</h1><p>选择云端项目，再选择保存位置。</p></div></div><div className="cloud-list">{cloudProjects.map((item) => <div className="cloud-row" key={item.id}><ProjectLogo project={item} small /><div><strong>{item.name}</strong><small>{item.description}</small></div><button className="button button-primary" onClick={() => { setDownloadTarget({ projectId: item.id }); setDownloadFolder(''); }}>下载 <ArrowDownToLine size={16} /></button></div>)}</div>{cloudProjects.length === 0 && <EmptyState icon={<CloudDownload size={28} />} title="所有项目都已下载" text="你可以在“我的项目”里打开它们。" />}
        </>}

        {route.name === 'settings' && <>
          <div className="page-header"><div><div className="eyebrow">个性化体验</div><h1>设置</h1><p>调整 EasyHub 的外观并查看当前演示环境。</p></div></div>
          <div className="settings-stack">
            <section className="panel settings-panel">
              <div className="settings-icon blue"><Square size={22} /></div>
              <div className="settings-panel-content">
                <h2>窗口控件</h2>
                <p>选择窗口顶部按钮的外观。更改会立即生效，并保存在这台电脑上。</p>
                <div className="window-style-options" role="group" aria-label="窗口控件样式">
                  <button className={`window-style-option ${windowControlStyle === 'windows' ? 'selected' : ''}`} aria-pressed={windowControlStyle === 'windows'} onClick={() => setWindowControlStyle('windows')}>
                    <span className="window-style-preview windows-preview" aria-hidden="true"><span /><span /><span /></span>
                    <span><strong>Windows 风格</strong><small>默认 · 右上角按钮</small></span>
                    {windowControlStyle === 'windows' && <Check size={18} className="window-style-check" />}
                  </button>
                  <button className={`window-style-option ${windowControlStyle === 'reference' ? 'selected' : ''}`} aria-pressed={windowControlStyle === 'reference'} onClick={() => setWindowControlStyle('reference')}>
                    <span className="window-style-preview reference-preview" aria-hidden="true"><span /><span /><span /></span>
                    <span><strong>圆点风格</strong><small>参考图 · 左上角圆点</small></span>
                    {windowControlStyle === 'reference' && <Check size={18} className="window-style-check" />}
                  </button>
                </div>
              </div>
            </section>
            <section className="panel settings-panel"><div className="settings-icon"><ShieldCheck size={22} /></div><div><h2>账户与连接</h2><p>{demoOnly ? '这是独立演示版，只展示模拟数据。安装正式版后可以连接 GitHub。' : '当前使用演示数据，尚未连接 GitHub。登录后可查看和管理真实项目。'}</p>{!demoOnly && <button className="button button-primary" onClick={onLogin}>使用 GitHub 登录 <ArrowRight size={16} /></button>}</div></section>
            <section className="panel settings-panel"><div className="settings-icon blue"><RotateCw size={22} /></div><div><h2>数据与同步</h2><p>演示项目数据只保存在当前窗口，重新启动后会恢复初始状态。窗口控件和语言偏好会保留。</p><button className="button button-quiet" onClick={() => { setData(createInitialState()); setToast('演示数据已重置'); }}>重置演示数据</button></div></section>
            <section className="panel settings-panel"><div className="settings-icon amber"><Info size={22} /></div><div><h2>关于 EasyHub</h2><p>Windows 桌面版</p><span className="settings-version">版本 1.0.0</span><div className="license-details"><strong>GNU GPLv3</strong><span>本应用采用 GNU General Public License 第 3 版。</span><button className="text-link" onClick={() => { if (window.easyHub) void window.easyHub.openLicense().catch(() => setToast('无法打开许可协议页面')); }}>查看许可协议 <ArrowRight size={15} /></button></div></div></section>
          </div>
        </>}
      </main>
      {canScrollDown && !downloadTarget && !showIssueForm && !introEditProject && !busy && <button className="scroll-down-cue" aria-label="向下滚动" title="向下滚动" onClick={() => scrollArea.current?.scrollBy({ top: Math.max(300, scrollArea.current.clientHeight * 0.75), behavior: 'smooth' })}><ChevronDown size={27} strokeWidth={2.6} aria-hidden="true" /></button>}
    </div>

    {introEditProject && <IntroductionEditor key={introEditProject.id} initialMarkdown={introEditProject.readme} onSave={saveIntroduction} onCancel={() => setIntroEditProjectId(null)} onOpenLink={openReleaseLink} />}

    {downloadTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDownloadTarget(null); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="download-title"><button className="icon-button modal-close" aria-label="关闭" onClick={() => setDownloadTarget(null)}><X size={19} /></button><div className="modal-symbol"><ArrowDownToLine size={24} /></div><h2 id="download-title">{downloadTarget.versionId ? '下载这个版本' : '下载项目'}</h2><p>选择保存位置，EasyHub 会把{downloadTarget.versionId ? '这个历史版本' : '项目'}放到这台电脑。</p><div className="folder-field"><FolderOpen size={18} /><span title={downloadFolder}>{downloadFolder || '还没有选择保存位置'}</span><button className="button button-quiet" onClick={() => void chooseFolder(setDownloadFolder)}>选择位置</button></div><div className="modal-actions"><button className="button button-quiet" onClick={() => setDownloadTarget(null)}>取消</button><button className="button button-primary" disabled={!downloadFolder || Boolean(busy)} onClick={() => { const target = downloadTarget; runOperation('正在准备演示下载', () => { if (!target.versionId) { setData((current) => downloadProject(current, target.projectId, downloadFolder)); navigate({ name: 'project', projectId: target.projectId }); } setDownloadTarget(null); }, target.versionId ? '历史版本下载已演示（没有写入文件）' : '项目已经下载到电脑（演示）'); }}>下载</button></div><small>演示模式不会实际写入文件。</small></div></div>}

    {showIssueForm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowIssueForm(false); }}><form className="modal issue-modal" role="dialog" aria-modal="true" aria-labelledby="new-issue-title" onSubmit={handleCreateIssue}><button type="button" className="icon-button modal-close" aria-label="关闭" onClick={() => setShowIssueForm(false)}><X size={19} /></button><div className="modal-symbol"><MessageCircle size={24} /></div><h2 id="new-issue-title">提出问题</h2><p>描述遇到的情况，或分享一个改进想法。</p><label className="field"><span>相关项目</span><select value={newIssueProject} onChange={(event) => setNewIssueProject(event.target.value)}>{data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field"><span>问题标题</span><input value={newIssueTitle} onChange={(event) => setNewIssueTitle(event.target.value)} placeholder="一句话概括问题" maxLength={120} /></label><label className="field"><span>详细描述</span><textarea value={newIssueBody} onChange={(event) => setNewIssueBody(event.target.value)} placeholder="发生了什么？你希望怎样改进？" rows={4} /></label><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setShowIssueForm(false)}>取消</button><button type="submit" className="button button-primary" disabled={!newIssueProject || data.projects.find((item) => item.id === newIssueProject)?.archived}>创建问题</button></div></form></div>}

    {busy && <div className="busy-overlay"><div className="busy-box"><span className="busy-spin"><RotateCw size={23} /></span><strong>{busy.label}</strong><p>正在处理，请稍候…</p><div className="progress-track"><span style={{ width: `${busy.progress}%` }} /></div><button className="button button-quiet" onClick={cancelOperation}>取消</button></div></div>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={18} />{toast}<button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div>;
}

interface LoginFlow { userCode: string; verificationUri: string; expiresAt: number; interval: number }

export default function App() {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [flow, setFlow] = useState<LoginFlow | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const loginLocalizer = useRef(createDomLocalizer());

  useLayoutEffect(() => {
    const modal = document.querySelector<HTMLElement>('.oauth-modal');
    if (modal) loginLocalizer.current.apply(modal, readLanguage());
  });

  useEffect(() => {
    if (demoOnlyBuild) return;
    let active = true;
    void window.easyHub?.authStatus().then((result) => { if (active) setUser(result.user); }).catch(() => { /* Demo mode remains available. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!flow) return;
    if (Date.now() >= flow.expiresAt) { setLoginError('登录确认已过期，请重新开始。'); setFlow(null); return; }
    let active = true;
    const timer = setTimeout(() => {
      void window.easyHub?.authPoll().then((result) => {
        if (!active) return;
        if (result.state === 'complete' && result.user) { setUser(result.user); setFlow(null); setLoginError(''); }
        else setFlow((current) => current ? { ...current, interval: result.interval ?? current.interval } : null);
      }).catch((error: unknown) => { if (active) { setLoginError(error instanceof Error ? error.message : '登录失败，请重试。'); setFlow(null); } });
    }, flow.interval * 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [flow]);

  async function beginLogin(): Promise<void> {
    if (!window.easyHub) return;
    setLoginBusy(true); setLoginError('');
    try {
      const next = await window.easyHub.authStart();
      setFlow(next);
      await window.easyHub.openExternalLink(next.verificationUri);
    } catch (error) { setLoginError(error instanceof Error ? error.message : '无法开始登录。'); }
    finally { setLoginBusy(false); }
  }

  function cancelLogin(): void { setFlow(null); setLoginError(''); void window.easyHub?.authCancel(); }

  if (demoOnlyBuild) return <DemoApp onLogin={() => undefined} demoOnly />;
  if (user) return <LiveWorkspace user={user} onLogout={() => { void window.easyHub?.authLogout().then(() => setUser(null)); }} />;
  return <><DemoApp onLogin={() => void beginLogin()} />{(flow || loginBusy || loginError) && <div className="modal-backdrop"><div className="modal oauth-modal" role="dialog" aria-modal="true" aria-labelledby="oauth-title"><button className="icon-button modal-close" aria-label="关闭" onClick={cancelLogin}><X size={19} /></button><div className="modal-symbol"><ShieldCheck size={24} /></div><h2 id="oauth-title">使用 GitHub 登录</h2>{flow ? <><p>已在浏览器打开 GitHub。输入下面的代码并允许 EasyHub 访问你的项目。</p><strong className="oauth-code">{flow.userCode}</strong><p className="oauth-wait">等待你在 GitHub 完成确认…</p><button className="button button-quiet" onClick={() => void window.easyHub?.openExternalLink(flow.verificationUri)}>重新打开 GitHub</button></> : loginBusy ? <p>正在连接 GitHub…</p> : <><p className="release-error">{loginError}</p><button className="button button-primary" onClick={() => void beginLogin()}>重试</button></>}<div className="modal-actions"><button className="button button-quiet" onClick={cancelLogin}>取消</button></div></div></div>}</>;
}
