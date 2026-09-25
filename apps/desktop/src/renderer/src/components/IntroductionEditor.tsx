import { useState } from 'react';
import { ImagePlus, Link2, X } from 'lucide-react';
import { ReadmeMarkdown, type ReadmeRepository } from './ReadmeMarkdown';

type Media = 'image' | 'link' | null;

function webUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

function label(value: string): string { return value.trim().replace(/[\[\]\\]/gu, '\\$&'); }

export function IntroductionEditor({ initialMarkdown, repository, saving = false, live = false, saveError = '', onSave, onCancel, onOpenLink }: {
  initialMarkdown: string;
  repository?: ReadmeRepository;
  saving?: boolean;
  live?: boolean;
  saveError?: string;
  onSave: (markdown: string) => void;
  onCancel: () => void;
  onOpenLink: (url: string) => void;
}) {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [preview, setPreview] = useState(false);
  const [media, setMedia] = useState<Media>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  function insert(): void {
    const valid = webUrl(url);
    if (!valid) { setError('请输入以 https:// 或 http:// 开头的有效地址。'); return; }
    const fragment = media === 'image' ? `![${label(title || '图片')}](${valid.replaceAll(')', '%29')})` : `[${label(title || '查看链接')}](${valid.replaceAll(')', '%29')})`;
    setMarkdown((old) => `${old.trimEnd()}\n\n${fragment}\n`.trimStart());
    setMedia(null); setTitle(''); setUrl(''); setError('');
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <div className="modal intro-modal" role="dialog" aria-modal="true" aria-labelledby="intro-editor-title">
      <button className="icon-button modal-close" aria-label="关闭" onClick={onCancel}><X size={19} /></button>
      <h2 id="intro-editor-title">编辑项目介绍</h2>
      <p>{live ? '保存会替换本地介绍文件。发布源码后，GitHub 才会显示新介绍。' : '支持 Markdown。保存后会标记为尚未发布的源码修改。'}</p>
      <div className="segmented intro-editor-tabs"><button className={!preview ? 'selected' : ''} onClick={() => setPreview(false)}>编辑</button><button className={preview ? 'selected' : ''} onClick={() => setPreview(true)}>预览</button></div>
      {preview ? <div className="intro-editor-preview"><ReadmeMarkdown markdown={markdown || '这个项目还没有介绍。'} repository={repository} onOpenLink={onOpenLink} /></div> : <>
        <div className="release-body-toolbar intro-media-toolbar"><button onClick={() => { setMedia('image'); setError(''); }}><ImagePlus size={17} />添加图片</button><button onClick={() => { setMedia('link'); setError(''); }}><Link2 size={17} />添加链接</button></div>
        {media && <div className="intro-media-form"><strong>{media === 'image' ? '插入网络图片' : '插入网页链接'}</strong><label className="field"><span>{media === 'image' ? '图片说明' : '显示文字'}</span><input aria-label={media === 'image' ? '图片说明' : '显示文字'} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={media === 'image' ? '例如：应用界面' : '例如：使用说明'} /></label><label className="field"><span>{media === 'image' ? '图片地址' : '链接地址'}</span><input aria-label={media === 'image' ? '图片地址' : '链接地址'} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" /></label><div className="local-actions"><button className="button button-quiet" onClick={() => setMedia(null)}>取消插入</button><button className="button button-primary" onClick={insert}>插入</button></div></div>}
        <label className="field"><span>项目介绍内容</span><textarea aria-label="项目介绍内容" value={markdown} onChange={(event) => setMarkdown(event.target.value)} rows={13} placeholder={'# 我的项目\n\n用几句话介绍你的项目……'} autoFocus /></label>
      </>}
      <p className="muted">图片请使用可公开访问的 http/https 地址；预览会显示图片和链接。</p>
      {live && <label className="intro-overwrite-confirm"><input type="checkbox" checked={confirmOverwrite} onChange={(event) => setConfirmOverwrite(event.target.checked)} />我确认替换这个项目的本地介绍文件</label>}
      {(error || saveError) && <div className="live-error" role="alert">{error || saveError}</div>}
      <div className="modal-actions"><button className="button button-quiet" onClick={onCancel}>取消</button><button className="button button-primary" disabled={saving || (live && !confirmOverwrite)} onClick={() => onSave(markdown)}>保存介绍</button></div>
    </div>
  </div>;
}
