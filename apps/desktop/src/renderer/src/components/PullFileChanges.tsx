import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { isEmptyAddedPullFile } from '@easyhub/github';
import type { GitHubPullFile } from '@easyhub/github';
import { parsePullPatch } from './pullReviewPresentation';
import { CodeExplanation } from './CodeExplanation';
import type { Language } from '../i18n';
import './pullReviewDetails.css';

export function PullFileChanges({ file, owner, repo, number, headSha, language, downloadControl, onOpenLink }: {
  file: GitHubPullFile; owner: string; repo: string; number: number; headSha: string; language: Language; downloadControl: ReactNode; onOpenLink: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(200);
  const parsed = useMemo(() => open && file.patch ? parsePullPatch(file) : null, [open, file]);
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;
  const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull/${number}/files`;
  const status = file.status === 'added' ? t('新增', 'Added') : file.status === 'removed' ? t('删除', 'Deleted') : file.status === 'renamed' ? t('更名', 'Renamed') : t('修改', 'Modified');
  return <article className="pull-file-change">
    <div className="live-file pull-download-row">
      <button type="button" className="pull-file-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}><ChevronDown size={16} className={open ? 'expanded' : ''} /><span className="pull-file-name" data-content-original>{file.filename}</span><span className="pull-file-status">{status}</span></button>
      <small>{isEmptyAddedPullFile(file) ? t('新建空文件', 'New empty file') : `+${file.additions} / −${file.deletions}`}</small>{downloadControl}
    </div>
    {open && <div className="pull-file-preview">
      {file.previous_filename && <p className="pull-file-rename" data-content-original>{file.previous_filename} → {file.filename}</p>}
      {parsed ? <>
        <div className="pull-diff-key"><span>{t('红色是删除，绿色是新增；左侧为修改前行号，右侧为修改后行号。', 'Red lines were removed; green lines were added. Line numbers show the original and changed files.')}</span></div>
        {parsed.incomplete && <p className="pull-review-note" role="status">{parsed.limited ? t('差异内容较长，这里显示部分内容。请打开 GitHub 查看完整修改。', 'This long change is partially displayed. Open GitHub to review the complete changes.') : t('GitHub 返回的文字差异不完整，请打开 GitHub 确认完整修改。', 'GitHub returned an incomplete text change. Open GitHub to review the full changes.')}</p>}
        <CodeExplanation source={{ kind: 'pull', owner, repo, number, headSha, path: file.filename }} language={language}>
          <div className="pull-diff-scroll" data-code-selection-region tabIndex={0} aria-label={t('逐行修改内容', 'Line-by-line changes')}><table className="pull-diff-table" data-content-original><tbody>{parsed.lines.slice(0, visible).map((line, index) => <tr key={index} className={`pull-diff-${line.kind}`}><td className="pull-line-number">{line.before}</td><td className="pull-line-number">{line.after}</td><td className="pull-line-sign">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ''}</td><td className="pull-line-code"><code data-explain-code={line.kind === 'add' || line.kind === 'remove' || line.kind === 'context' ? true : undefined}>{line.text}</code></td></tr>)}</tbody></table></div>
        </CodeExplanation>
        {visible < parsed.lines.length && <button className="text-link pull-diff-more" onClick={() => setVisible((count) => count + 200)}>{t('继续查看修改内容', 'Show more changed lines')}</button>}
      </> : <p className="pull-review-note">{isEmptyAddedPullFile(file) ? t('这是一个新建的空文件，没有文字内容。', 'This is a new empty file with no text content.') : file.status === 'renamed' && file.additions === 0 && file.deletions === 0 ? t('文件已更名，GitHub 没有提供文字差异。', 'The file was renamed. GitHub did not provide a text change.') : t('GitHub 没有提供这个文件的文字差异，可能是图片、程序文件或内容过大。可以下载检查，或打开 GitHub 查看。', 'GitHub did not provide a text change for this file. It may be an image, a program file, or too large. Download it to inspect, or open GitHub.')}</p>}
      <button className="text-link pull-diff-more" onClick={() => onOpenLink(url)}><ExternalLink size={14} />{t('在 GitHub 查看完整修改', 'View full changes on GitHub')}</button>
    </div>}
  </article>;
}
