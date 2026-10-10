import { dialog, net, shell } from 'electron';
import { basename, join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { GitHubClient } from '@easyhub/github';
import type { GitHubRepo } from '@easyhub/github';
import type { DownloadItem, DownloadRequest } from '../../downloads';
import { DownloadError, DownloadManager } from './DownloadManager';
import type { DownloadSource, PreparedDownload } from './DownloadManager';
import { getPullRequestReviewContext, githubAccessToken } from './githubService';
import type { LocalProjectService } from '../git/LocalProjectService';

const validPart = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) && value !== '.' && value !== '..';
const validSha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
function fileName(value: string): string {
  let name = basename(value).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 180);
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  if (!name) throw new Error('下载文件名称无效。');
  return name;
}
export class GitHubDownloads {
  readonly manager: DownloadManager;
  private client = new GitHubClient(githubAccessToken, (input, init) => net.fetch(String(input), init));
  private choosing = false;
  constructor(directory: string, local: LocalProjectService, changed: (items: DownloadItem[]) => void) {
    this.manager = new DownloadManager(join(directory, 'downloads.json'), {
      changed,
      open: async (source, signal, headers) => {
        switch (source.kind) {
          case 'archive': return this.client.archive(source.owner, source.repo, source.revision, signal, headers);
          case 'blob': return this.client.downloadBlob(source.owner, source.repo, source.sha, signal, headers);
          case 'asset': {
            const asset = await this.client.releaseAsset(source.owner, source.repo, source.assetId, signal);
            if (asset.state !== 'uploaded' || asset.size !== source.size || (source.sha256 && asset.digest !== `sha256:${source.sha256}`)) throw new DownloadError('版本文件已改变，请移除此任务后重新下载。');
            return this.client.downloadReleaseAsset(source.owner, source.repo, source.assetId, signal, headers);
          }
        }
      },
      clone: async (source, destination, signal, progress) => {
        const parent = await local.grant(destination);
        return local.download(source.owner, source.repo, parent, { signal, progress: (value) => progress(value.phase, value.loaded, value.total) });
      },
      confirmReplace: async () => (await dialog.showMessageBox({ type: 'warning', buttons: ['取消', '覆盖'], defaultId: 0, cancelId: 0,
        message: '下载已完成，此位置已有同名文件。确定要覆盖当前文件吗？' })).response === 1,
    });
  }

  async enqueue(raw: unknown): Promise<DownloadItem | null> {
    if (!raw || typeof raw !== 'object') throw new Error('下载项目无效。');
    const value = raw as Partial<DownloadRequest>;
    if (!value.repo || !validPart(value.repo.owner?.login) || !validPart(value.repo.name) || !Number.isSafeInteger(value.repo.id)) throw new Error('下载项目无效。');
    if (!['archive', 'project', 'pull-file'].includes(String(value.kind))) throw new Error('下载类型无效。');
    if (this.choosing) throw new Error('请先完成当前保存位置选择。');
    this.choosing = true;
    try {
      const owner = value.repo.owner.login; const name = value.repo.name;
      const remote = await this.client.repo(owner, name);
      if (remote.id !== value.repo.id) throw new Error('项目已发生变化，请刷新后重试。');
      // Store only the display fields needed by notifications and Add to My Projects.
      const repo: GitHubRepo = { id: remote.id, owner: { login: remote.owner.login, avatar_url: remote.owner.avatar_url }, name: remote.name,
        full_name: remote.full_name, description: remote.description, private: remote.private, default_branch: remote.default_branch,
        updated_at: remote.updated_at, open_issues_count: remote.open_issues_count, html_url: remote.html_url };
      let source: DownloadSource;
      let request: DownloadRequest;
      let defaultName: string;
      if (value.kind === 'project') {
        const selected = await dialog.showOpenDialog({ title: '选择项目保存位置', properties: ['openDirectory', 'createDirectory'] });
        if (selected.canceled || !selected.filePaths[0]) return null;
        if (await lstat(join(selected.filePaths[0], name)).then(() => true, (error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
          throw error;
        })) throw new Error('此位置已有同名项目，原有文件已保留。请重试并选择其他保存位置。');
        return this.manager.enqueue({ request: { kind: 'project', repo, fileName: repo.name }, source: { kind: 'project', owner, repo: name }, destination: selected.filePaths[0] });
      } else if (value.kind === 'pull-file') {
        if (!Number.isSafeInteger(value.number) || Number(value.number) < 1 || !validSha(value.headSha) || typeof value.path !== 'string' || value.path.length > 4096
          || /[\\\x00-\x1f]/.test(value.path) || value.path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('修改文件无效。');
        const context = await getPullRequestReviewContext(owner, name, Number(value.number), value.headSha);
        const file = context.files.find((entry) => entry.filename === value.path);
        if (!file || file.status === 'removed' || !validSha(file.sha)) throw new Error('这个修改文件暂时无法下载，请刷新后重试。');
        const repository = context.pullRequest.head.repo ?? context.repository;
        if (!validPart(repository.owner.login) || !validPart(repository.name)) throw new Error('无法确认修改文件来源。');
        source = { kind: 'blob', owner: repository.owner.login, repo: repository.name, sha: file.sha };
        defaultName = fileName(value.path.split('/').at(-1)!);
        request = { kind: 'pull-file', repo, number: Number(value.number), path: value.path, headSha: value.headSha, fileName: defaultName };
      } else if (value.kind === 'archive') {
        if (typeof value.ref !== 'string' || !/^[a-f0-9]{40}$|^[A-Za-z0-9_.\/-]{1,200}$/.test(value.ref)) throw new Error('下载版本无效。');
        if (value.assetId !== undefined) {
          if (!Number.isSafeInteger(value.assetId) || value.assetId < 1) throw new Error('版本文件无效。');
          const asset = await this.client.releaseAsset(owner, name, value.assetId);
          if (asset.state !== 'uploaded') throw new Error('这个版本文件尚未准备好。');
          source = { kind: 'asset', owner, repo: name, assetId: asset.id, size: asset.size, sha256: asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : undefined };
          defaultName = fileName(asset.name);
        } else {
          const revision = await this.client.commit(owner, name, value.ref);
          if (!validSha(revision.sha)) throw new Error('无法确认下载版本，请刷新后重试。');
          source = { kind: 'archive', owner, repo: name, revision: revision.sha };
          defaultName = fileName(`${name}-${value.ref.slice(0, 30)}.zip`);
        }
        request = { kind: 'archive', repo, ref: value.ref, assetId: value.assetId, fileName: defaultName, offerAdd: value.offerAdd === true };
      } else throw new Error('下载类型无效。');
      const target = await dialog.showSaveDialog({ title: '保存下载文件', defaultPath: defaultName });
      if (target.canceled || !target.filePath) return null;
      const prepared: PreparedDownload = { request, source, destination: target.filePath };
      return await this.manager.enqueue(prepared);
    } finally { this.choosing = false; }
  }

  async open(id: unknown, folder: unknown): Promise<void> {
    if (typeof folder !== 'boolean') throw new Error('打开方式无效。');
    const path = await this.manager.completedPath(id);
    if (folder) { shell.showItemInFolder(path); return; }
    const error = await shell.openPath(path);
    if (error) throw new Error('无法打开这个文件。');
  }
}
