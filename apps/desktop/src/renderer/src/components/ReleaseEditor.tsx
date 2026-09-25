import { useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { CreateReleaseInput, Project, ReleaseAsset, ReleaseChannel } from '@easyhub/types';
import { ArrowLeft, ArrowRight, FilePlus2, ImagePlus, Info, Link2, Plus, Trash2 } from 'lucide-react';
import type { Language } from '../i18n';
import { MAX_RELEASE_ASSET_SIZE, MAX_RELEASE_ASSETS, nextReleaseTag, validateReleaseAssets, validateReleaseInput } from '../stores/releaseStore';
import { formatFileSize, ReleasePreview } from './ReleasePreview';

type MediaDialog = 'link' | 'image' | null;

function validWebUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function markdownLabel(value: string): string {
  return value.trim().replace(/[\[\]\\]/gu, '\\$&');
}

export function ReleaseEditor({ project, language, busy, imageSources, onRegisterInlineImage, onPublish, onBack, onOpenUpdate, onOpenLink }: {
  project: Project;
  language: Language;
  busy: boolean;
  imageSources: Record<string, string>;
  onRegisterInlineImage: (id: string, file: File) => void;
  onPublish: (input: CreateReleaseInput) => void;
  onBack: () => void;
  onOpenUpdate: () => void;
  onOpenLink: (url: string) => void;
}) {
  const firstTag = nextReleaseTag(project.releases, 'stable');
  const [channel, setChannel] = useState<ReleaseChannel>('stable');
  const [tagName, setTagName] = useState(firstTag);
  const [title, setTitle] = useState(`${project.name} ${firstTag}`);
  const [body, setBody] = useState('');
  const [assets, setAssets] = useState<ReleaseAsset[]>([]);
  const [stage, setStage] = useState<'edit' | 'preview'>('edit');
  const [error, setError] = useState<string | null>(null);
  const [mediaDialog, setMediaDialog] = useState<MediaDialog>(null);
  const [mediaLabel, setMediaLabel] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const assetInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    document.querySelector('.main-column')?.scrollTo(0, 0);
  }, [stage]);

  const draft: CreateReleaseInput = { tagName, title, body, channel, assets };

  function chooseChannel(next: ReleaseChannel): void {
    const suggested = nextReleaseTag(project.releases, next);
    setChannel(next);
    setTagName(suggested);
    setTitle(`${project.name} ${suggested}`);
    setError(null);
  }

  function changeTag(next: string): void {
    if (title === `${project.name} ${tagName}`) setTitle(`${project.name} ${next}`);
    setTagName(next);
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>, inline: boolean): void {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!files.length) return;
    if (inline && files.some((file) => !file.type.startsWith('image/'))) {
      setError('请选择图片文件');
      return;
    }
    const added = files.map((file) => ({
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      file,
    }));
    try {
      validateReleaseAssets([...assets, ...added]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法添加文件');
      return;
    }
    setAssets((current) => [...current, ...added.map(({ file: _file, ...asset }) => asset)]);
    if (inline) {
      for (const item of added) {
        onRegisterInlineImage(item.id, item.file);
        const safeName = markdownLabel(item.name);
        setBody((current) => `${current.trimEnd()}\n\n![${safeName}](easyhub-image:${item.id})\n`.trimStart());
      }
      setMediaDialog(null);
    }
    setError(null);
  }

  function removeAsset(id: string): void {
    setAssets((current) => current.filter((asset) => asset.id !== id));
    setBody((current) => current.split('\n').filter((line) => !line.includes(`](easyhub-image:${id})`)).join('\n'));
    setError(null);
  }

  function insertMedia(): void {
    const url = validWebUrl(mediaUrl);
    if (!url) { setError('请输入以 https:// 或 http:// 开头的有效链接'); return; }
    const safeUrl = url.replaceAll(')', '%29');
    const label = markdownLabel(mediaLabel || (mediaDialog === 'image' ? '图片' : '查看链接'));
    const fragment = mediaDialog === 'image' ? `![${label}](${safeUrl})` : `[${label}](${safeUrl})`;
    setBody((current) => `${current.trimEnd()}\n\n${fragment}\n`.trimStart());
    setMediaDialog(null);
    setMediaLabel('');
    setMediaUrl('');
    setError(null);
  }

  function showPreview(): void {
    try {
      validateReleaseInput(project.releases, draft);
      setError(null);
      setStage('preview');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '请检查版本信息');
    }
  }

  return <div className="release-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回项目</button>
    <div className="release-page-heading">
      <div className="eyebrow">{project.name}</div>
      <h1>发布新版本</h1>
      <p>为下载者准备版本号、介绍和安装文件。</p>
    </div>
    <div className="release-distinction"><Info size={20} /><div><strong>两种发布，各有用途</strong><p><b>发布源码</b>保存日常代码修改；<b>发布新版本</b>提供带版本号和下载文件的正式页面。</p></div></div>
    {project.health === 'changes' && <div className="release-pending-changes"><Info size={18} /><span>这个项目还有未发布的源码修改。新版本将基于已保存的内容，不包含这些修改。</span><button className="text-link" onClick={onOpenUpdate}>先发布源码 <ArrowRight size={15} /></button></div>}
    {stage === 'edit' ? <div className="release-editor-stack">
      <section className="panel release-editor-card">
        <div className="release-section-heading"><span>1</span><div><h2>版本信息</h2><p>EasyHub 根据这个项目已有的版本自动续号，你也可以修改。</p></div></div>
        <div className="release-channel-options" role="group" aria-label="版本类型">
          <button className={channel === 'stable' ? 'selected' : ''} aria-pressed={channel === 'stable'} onClick={() => chooseChannel('stable')}>正式版</button>
          <button className={channel === 'alpha' ? 'selected' : ''} aria-pressed={channel === 'alpha'} onClick={() => chooseChannel('alpha')}>Alpha 测试版</button>
          <button className={channel === 'beta' ? 'selected' : ''} aria-pressed={channel === 'beta'} onClick={() => chooseChannel('beta')}>Beta 测试版</button>
        </div>
        <div className="release-fields"><label className="field"><span>版本号 <b>*</b></span><input aria-label="版本号" value={tagName} onChange={(event) => changeTag(event.target.value)} maxLength={80} placeholder="v0.01" /><small>这个项目的上一个正式版：{project.releases.find((release) => release.channel === 'stable')?.tagName ?? '还没有'}</small></label><label className="field"><span>版本名称 <b>*</b></span><input aria-label="版本名称" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="我的工具 v0.01" /></label></div>
      </section>
      <section className="panel release-editor-card">
        <div className="release-section-heading"><span>2</span><div><h2>版本介绍</h2><p>告诉下载者新增了什么，以及如何使用。</p></div></div>
        <div className="release-body-toolbar"><button onClick={() => { setMediaDialog('image'); setError(null); }}><ImagePlus size={17} />添加图片</button><button onClick={() => { setMediaDialog('link'); setError(null); }}><Link2 size={17} />添加链接</button></div>
        <textarea className="release-body-input" aria-label="版本介绍" value={body} onChange={(event) => setBody(event.target.value)} placeholder="例如：修复了窗口缩放问题，新增深色模式。下载安装包后直接打开即可使用。" rows={8} />
        <p className="release-field-hint">支持简单排版。使用上方按钮插入图片或链接，下一步可以预览效果。</p>
      </section>
      <section className="panel release-editor-card">
        <div className="release-section-heading"><span>3</span><div><h2>下载文件</h2><p>可选择一个或多个安装包、压缩包或其他文件。</p></div></div>
        <input ref={assetInput} type="file" multiple className="release-hidden-input" aria-label="选择发布文件" onChange={(event) => addFiles(event, false)} />
        <input ref={imageInput} type="file" multiple accept="image/*" className="release-hidden-input" aria-label="选择介绍图片" onChange={(event) => addFiles(event, true)} />
        <button className="release-add-files" onClick={() => assetInput.current?.click()}><FilePlus2 size={22} /><strong>添加文件</strong><span>点击选择文件，可一次添加多个</span></button>
        {assets.length > 0 && <div className="release-selected-files">{assets.map((asset) => <div key={asset.id} className="release-selected-file"><FilePlus2 size={17} /><span title={asset.name}>{asset.name}</span><small>{formatFileSize(asset.size)}</small><button className="icon-button" aria-label={`移除 ${asset.name}`} onClick={() => removeAsset(asset.id)}><Trash2 size={16} /></button></div>)}</div>}
        <p className="release-field-hint">按 GitHub 当前规则：最多 {MAX_RELEASE_ASSETS} 个文件，每个文件小于 {MAX_RELEASE_ASSET_SIZE / 1024 ** 3} GiB。同一版本内文件名不能重复，文件类型不受限制。</p>
      </section>
      {error && <div className="release-error" role="alert">{error}</div>}
      <div className="release-editor-actions"><button className="button button-quiet" onClick={onBack}>取消</button><button className="button button-primary" onClick={showPreview}>预览发布效果 <ArrowRight size={17} /></button></div>
    </div> : <div className="release-preview-stage">
      <div className="release-preview-intro"><strong>这是发布后下载者看到的样子</strong><span>请检查版本号、介绍、图片、链接和文件列表。</span></div>
      <ReleasePreview release={draft} imageSources={imageSources} language={language} onOpenLink={onOpenLink} />
      {assets.length === 0 && <div className="release-preview-warning"><Info size={17} />未添加安装包。GitHub 仍会自动提供项目源码压缩包。</div>}
      {project.health === 'changes' && <div className="release-preview-warning"><Info size={17} />尚未发布的本地修改不会出现在这个新版本中。</div>}
      <div className="release-editor-actions"><button className="button button-quiet" onClick={() => setStage('edit')}><ArrowLeft size={16} />返回编辑</button><button className="button button-primary" disabled={busy} onClick={() => onPublish(draft)}>确认发布新版本 <ArrowRight size={17} /></button></div>
      <p className="release-demo-note">当前是演示模式：点击确认只会更新本窗口中的演示数据，不会上传文件到 GitHub。</p>
    </div>}
    {mediaDialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMediaDialog(null); }}><div className="modal release-media-modal" role="dialog" aria-modal="true" aria-labelledby="release-media-title">
      <h2 id="release-media-title">{mediaDialog === 'image' ? '添加图片' : '添加链接'}</h2>
      <p>{mediaDialog === 'image' ? '粘贴图片地址，或者选择电脑中的图片。' : '输入链接地址和显示文字。'}</p>
      <label className="field"><span>{mediaDialog === 'image' ? '图片说明' : '显示文字'}</span><input value={mediaLabel} onChange={(event) => setMediaLabel(event.target.value)} placeholder={mediaDialog === 'image' ? '例如：应用界面' : '例如：使用说明'} /></label>
      <label className="field"><span>{mediaDialog === 'image' ? '图片地址' : '链接地址'}</span><input value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder="https://example.com" /></label>
      {error && <div className="release-error" role="alert">{error}</div>}
      <div className="modal-actions"><button className="button button-quiet" onClick={() => setMediaDialog(null)}>取消</button>{mediaDialog === 'image' && <button className="button button-quiet" onClick={() => imageInput.current?.click()}><ImagePlus size={16} />选择本地图片</button>}<button className="button button-primary" onClick={insertMedia}><Plus size={16} />插入</button></div>
    </div></div>}
  </div>;
}
