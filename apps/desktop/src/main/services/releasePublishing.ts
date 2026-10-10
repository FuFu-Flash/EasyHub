import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { pipeline } from 'node:stream/promises';
import { dialog, net, session } from 'electron';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { GitHubClient, GitHubError, friendlyGitHubError } from '@easyhub/github';
import type { GitHubCreatedRelease, GitHubReleaseAsset } from '@easyhub/github';
import type { AddReleaseAssetsRequest, EditReleaseRequest, PickedReleaseFile, PublishReleaseRequest, ReleaseProgress, RemoveReleaseAssetRequest, ReleaseMutationFailure } from '@easyhub/types';
import { githubAccessToken, gitHubIdentity } from './githubService';
import { githubOriginAgent, isEasyHubProxyChoice } from './GitHubProxyService';
import type { GitHubOriginAgent } from './githubProxyOrigin';

const MAX_FILES = 1000;
const MAX_FILE_SIZE = 2 * 1024 ** 3;
const MAX_PREVIEW_SIZE = 8 * 1024 ** 2;
const DRAFT_SELECTION_MISMATCH = '草稿中的文件与当前选择清单不一致。请先在 GitHub 查看草稿，核对附件后再继续。';
const mimeTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.zip': 'application/zip', '.txt': 'text/plain', '.pdf': 'application/pdf',
};

interface SelectedFile { path: string; name: string; size: number; modified: number; mimeType: string }
interface UploadAttempt { confirmed: Map<string, GitHubReleaseAsset>; attempted: Set<string>; draft?: GitHubCreatedRelease }
type ReleaseResult = GitHubCreatedRelease | ReleaseMutationFailure<GitHubCreatedRelease>;
function releaseError(error: unknown): string {
  if (error instanceof Error && /^[\u3400-\u9fff\u201c]/u.test(error.message)) return error.message;
  return friendlyGitHubError(error);
}

function validPart(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) && value !== '.' && value !== '..'; }
function validTag(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 80 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..') && !value.endsWith('.') && !value.endsWith('.lock');
}

function validReleaseId(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function releaseTarget(input: unknown): { owner: string; repo: string; releaseId: number } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('版本信息无效。');
  const value = input as Record<string, unknown>;
  if (!validPart(value.owner) || !validPart(value.repo) || !validReleaseId(value.releaseId)) throw new Error('版本信息无效。');
  return { owner: value.owner, repo: value.repo, releaseId: value.releaseId };
}

export function validateEditReleaseRequest(input: unknown): EditReleaseRequest {
  const target = releaseTarget(input);
  const value = input as Record<string, unknown>;
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120 ||
      typeof value.body !== 'string' || value.body.length > 262144 || typeof value.prerelease !== 'boolean') throw new Error('请检查版本名称和介绍。');
  return { ...target, title: value.title, body: value.body, prerelease: value.prerelease };
}

export function validateAddReleaseAssetsRequest(input: unknown): AddReleaseAssetsRequest {
  const target = releaseTarget(input);
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value.assetIds) || value.assetIds.length < 1 || value.assetIds.length > MAX_FILES ||
      !value.assetIds.every((id: unknown) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)) ||
      new Set(value.assetIds).size !== value.assetIds.length) throw new Error('请选择要上传的文件。');
  return { ...target, assetIds: value.assetIds as string[] };
}

export function validateRemoveReleaseAssetRequest(input: unknown): RemoveReleaseAssetRequest {
  const target = releaseTarget(input);
  const value = input as Record<string, unknown>;
  if (!validReleaseId(value.assetId)) throw new Error('文件信息无效。');
  return { ...target, assetId: value.assetId };
}

export function validatePublishRequest(input: unknown): PublishReleaseRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('请检查新版本的信息。');
  const value = input as Record<string, unknown>;
  if (!validPart(value.owner) || !validPart(value.repo) || !validTag(value.tagName) ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120 ||
      typeof value.body !== 'string' || !value.body.trim() || value.body.length > 262144 ||
      typeof value.channel !== 'string' || !['stable', 'alpha', 'beta'].includes(value.channel) ||
      !Array.isArray(value.assetIds) || value.assetIds.length > MAX_FILES ||
      !value.assetIds.every((id: unknown) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)) ||
      new Set(value.assetIds).size !== value.assetIds.length) throw new Error('请检查新版本的信息和文件。');
  return value as unknown as PublishReleaseRequest;
}

export function replaceInlineImages(body: string, urls: Map<string, string>): string {
  if (/easyhub-image:(?![a-f0-9-]{36})/i.test(body)) throw new Error('介绍中的本地图片无效，请重新选择。');
  const unresolved = [...body.matchAll(/easyhub-image:([a-f0-9-]{36})/g)].map((match) => match[1]!);
  if (unresolved.some((id) => !urls.has(id))) throw new Error('介绍中的本地图片尚未添加，请重新选择。');
  return body.replace(/easyhub-image:([a-f0-9-]{36})/g, (_match, id: string) => urls.get(id)!);
}

export function releaseAssetUrl(owner: string, repo: string, tag: string, name: string): string {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

async function proxyAgent(url: string): Promise<HttpsProxyAgent<string> | SocksProxyAgent | GitHubOriginAgent | undefined> {
  const choices = await session.defaultSession.resolveProxy(url);
  if (isEasyHubProxyChoice(choices)) return githubOriginAgent();
  for (const choice of choices.split(';')) {
    const match = choice.trim().match(/^(PROXY|HTTPS)\s+([^\s]+)$/i);
    if (match?.[2]) return new HttpsProxyAgent(`${match[1]?.toUpperCase() === 'HTTPS' ? 'https' : 'http'}://${match[2]}`);
    const socks = choice.trim().match(/^(SOCKS5|SOCKS4|SOCKS)\s+([^\s]+)$/i);
    if (socks?.[2]) return new SocksProxyAgent(`socks${socks[1]?.toUpperCase() === 'SOCKS4' ? '4a' : '5h'}://${socks[2]}`);
  }
  return githubOriginAgent();
}

async function uploadAsset(url: string, file: SelectedFile, token: string, signal: AbortSignal, onChunk: (bytes: number) => void): Promise<GitHubReleaseAsset> {
  const agent = await proxyAgent(url);
  return new Promise<GitHubReleaseAsset>((resolve, reject) => {
    const request = httpsRequest(url, {
      method: 'POST', agent, signal,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'EasyHub',
        'Content-Type': file.mimeType, 'Content-Length': file.size, 'X-GitHub-Api-Version': '2022-11-28' },
    }, (response) => {
      const chunks: Buffer[] = [];
      let responseSize = 0;
      response.on('data', (chunk: Buffer) => {
        responseSize += chunk.length;
        if (responseSize > 1024 * 1024) { response.destroy(new Error('GitHub 返回的文件信息过大。')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 201) { reject(new GitHubError(response.statusCode ?? 502, 'Release upload failed')); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as GitHubReleaseAsset); }
        catch { reject(new Error('GitHub 没有返回有效的文件信息。')); }
      });
    });
    request.on('error', reject);
    request.setTimeout(180000, () => request.destroy(new Error('上传等待时间过长，请重试。')));
    const stream = createReadStream(file.path, { highWaterMark: 256 * 1024 });
    stream.on('data', (chunk: string | Buffer) => onChunk(Buffer.byteLength(chunk)));
    void pipeline(stream, request).catch(reject);
  });
}

export class ReleasePublishingService {
  private readonly selected = new Map<string, SelectedFile>();
  private active: AbortController | null = null;
  private readonly client = new GitHubClient(githubAccessToken, (input, init) => net.fetch(String(input), init));
  private readonly attempts = new Map<string, UploadAttempt>();

  constructor(private readonly sendAsset: typeof uploadAsset = uploadAsset) {}

  async chooseFiles(inline: boolean): Promise<PickedReleaseFile[]> {
    if (typeof inline !== 'boolean') throw new Error('文件选择方式无效。');
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'],
      ...(inline ? { filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'] }] } : {}) });
    if (result.canceled) return [];
    if (this.selected.size + result.filePaths.length > MAX_FILES) throw new Error('每个版本最多选择 1000 个文件。');
    const picked: PickedReleaseFile[] = [];
    for (const path of result.filePaths) {
      const canonical = await realpath(path);
      const details = await lstat(canonical);
      if (!details.isFile() || details.size >= MAX_FILE_SIZE) throw new Error('每个文件必须小于 2 GiB。');
      const name = basename(canonical);
      const mimeType = mimeTypes[extname(name).toLowerCase()] ?? 'application/octet-stream';
      if (inline && !mimeType.startsWith('image/')) throw new Error('请选择图片文件。');
      if (inline && details.size > MAX_PREVIEW_SIZE) throw new Error('用于介绍的图片需小于 8 MiB。');
      const id = randomUUID();
      this.selected.set(id, { path: canonical, name, size: details.size, modified: details.mtimeMs, mimeType });
      picked.push({ id, name, size: details.size, mimeType,
        ...(inline ? { previewDataUrl: `data:${mimeType};base64,${(await readFile(canonical)).toString('base64')}` } : {}) });
    }
    return picked;
  }

  cancel(): void { this.active?.abort(); }

  private beginOperation(): AbortController {
    if (this.active) throw new Error('已有版本操作正在进行，请稍后。');
    const controller = new AbortController();
    this.active = controller;
    return controller;
  }

  private async editableRelease(owner: string, repoName: string, releaseId: number, signal?: AbortSignal): Promise<GitHubCreatedRelease> {
    const repo = await this.client.repo(owner, repoName);
    const identity = await gitHubIdentity();
    if (repo.archived || !(repo.permissions?.push || repo.permissions?.admin || repo.owner.login.toLowerCase() === identity.user.login.toLowerCase())) {
      throw new Error('你没有编辑这个版本的权限。');
    }
    const release = await this.client.release(owner, repoName, releaseId, signal);
    if (release.draft) throw new Error('这个版本尚未发布，请在 GitHub 中编辑草稿。');
    return release;
  }

  private async files(assetIds: string[], confirmed?: ReadonlyMap<string, GitHubReleaseAsset>): Promise<SelectedFile[]> {
    const files = assetIds.map((id) => this.selected.get(id));
    if (files.some((file) => !file)) throw new Error('请重新选择要上传的文件。');
    const chosen = files as SelectedFile[];
    if (new Set(chosen.map((file) => file.name.toLowerCase())).size !== chosen.length) throw new Error('同一个版本不能包含同名文件。');
    for (let index = 0; index < chosen.length; index += 1) {
      if (confirmed?.has(assetIds[index]!)) continue;
      const file = chosen[index]!;
      const details = await stat(file.path).catch(() => { throw new Error(`“${file.name}”无法读取，请重新选择。`); });
      if (!details.isFile() || details.size !== file.size || details.mtimeMs !== file.modified) throw new Error(`“${file.name}”已发生变化，请重新选择。`);
    }
    return chosen;
  }

  private async reconcile(attempt: UploadAttempt, assetIds: string[], files: SelectedFile[], release: GitHubCreatedRelease, target: { owner: string; repo: string }): Promise<void> {
    for (let index = 0; index < files.length; index += 1) {
      const id = assetIds[index]!;
      const file = files[index]!;
      const existing = release.assets.find((asset) => asset.name.toLowerCase() === file.name.toLowerCase());
      if (!existing) { attempt.confirmed.delete(id); continue; }
      if (attempt.attempted.has(id) && ['starter', 'new'].includes(existing.state)) {
        await this.client.deleteReleaseAsset(target.owner, target.repo, existing.id);
        attempt.confirmed.delete(id);
        release.assets = release.assets.filter((asset) => asset.id !== existing.id);
        continue;
      }
      if (!attempt.attempted.has(id) || existing.state !== 'uploaded' || existing.size !== file.size) {
        throw new Error(`这个版本已有同名文件“${file.name}”，请先移除旧文件或为新文件改名。`);
      }
      attempt.confirmed.set(id, existing);
    }
  }

  private async uploadFiles(release: GitHubCreatedRelease, attempt: UploadAttempt, assetIds: string[], files: SelectedFile[], controller: AbortController, progress: (value: ReleaseProgress) => void): Promise<void> {
    const token = await githubAccessToken();
    const total = files.reduce((sum, file) => sum + file.size, 0);
    let loaded = files.reduce((sum, file, index) => sum + (attempt.confirmed.has(assetIds[index]!) ? file.size : 0), 0);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      const id = assetIds[index]!;
      if (attempt.confirmed.has(id)) continue;
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const phase = `正在上传 ${file.name}`;
      progress({ phase, loaded, total, cancelable: true });
      const url = release.upload_url.replace(/\{.*$/, '') + `?name=${encodeURIComponent(file.name)}`;
      attempt.attempted.add(id);
      const uploaded = await this.sendAsset(url, file, token, controller.signal, (bytes) => {
        loaded += bytes;
        progress({ phase, loaded: Math.min(loaded, total), total, cancelable: true });
      });
      if (uploaded.state !== 'uploaded' || uploaded.size !== file.size || !uploaded.browser_download_url) throw new Error(`“${file.name}”上传后未通过检查。`);
      attempt.confirmed.set(id, uploaded);
    }
  }

  private failure(error: string, attempt: UploadAttempt, assetIds: string[], retryable: boolean, release?: GitHubCreatedRelease): ReleaseMutationFailure<GitHubCreatedRelease> {
    return { status: 'failed', error, retryable,
      completedAssetIds: assetIds.filter((id) => attempt.confirmed.has(id)),
      remainingAssetIds: assetIds.filter((id) => !attempt.confirmed.has(id)), ...(release ? { release } : {}) };
  }

  async edit(raw: unknown): Promise<GitHubCreatedRelease> {
    const input = validateEditReleaseRequest(raw);
    const controller = this.beginOperation();
    try {
      await this.editableRelease(input.owner, input.repo, input.releaseId, controller.signal);
      return await this.client.updateRelease(input.owner, input.repo, input.releaseId,
        { name: input.title.trim(), body: input.body, prerelease: input.prerelease }, controller.signal);
    } catch (error) { throw new Error(releaseError(error)); }
    finally { this.active = null; }
  }

  async addAssets(raw: unknown, progress: (value: ReleaseProgress) => void): Promise<ReleaseResult> {
    const input = validateAddReleaseAssetsRequest(raw);
    const controller = this.beginOperation();
    let key = '';
    let attempt: UploadAttempt | undefined;
    let release: GitHubCreatedRelease | undefined;
    try {
      const identity = await gitHubIdentity();
      key = `${identity.user.login.toLowerCase()}/${input.owner.toLowerCase()}/${input.repo.toLowerCase()}/${input.releaseId}`;
      attempt = this.attempts.get(key) ?? { confirmed: new Map(), attempted: new Set() };
      const files = await this.files(input.assetIds, attempt.confirmed);
      release = await this.editableRelease(input.owner, input.repo, input.releaseId, controller.signal);
      await this.reconcile(attempt, input.assetIds, files, release, input);
      // Remote confirmation may reveal that an earlier asset was removed. In
      // that case validate its current local file before attempting to upload it.
      await this.files(input.assetIds, attempt.confirmed);
      if (release.assets.length + files.filter((_file, index) => !attempt!.confirmed.has(input.assetIds[index]!)).length > MAX_FILES) throw new Error('每个版本最多可包含 1000 个文件。');
      this.attempts.set(key, attempt);
      await this.uploadFiles(release, attempt, input.assetIds, files, controller, progress);
      const updated = await this.client.release(input.owner, input.repo, input.releaseId).catch(() => ({ ...release!, assets: [...release!.assets, ...[...attempt!.confirmed.values()].filter((asset) => !release!.assets.some((known) => known.id === asset.id))] }));
      for (const id of attempt.confirmed.keys()) this.selected.delete(id);
      this.attempts.delete(key);
      return updated;
    } catch (error) {
      if (!attempt || !release) throw new Error(releaseError(error));
      // A lost response may still have reached GitHub. Confirm it before offering retry.
      const updated = await this.client.release(input.owner, input.repo, input.releaseId).catch(() => undefined);
      if (updated) {
        const chosen = input.assetIds.map((id) => this.selected.get(id)!);
        try { await this.reconcile(attempt, input.assetIds, chosen, updated, input); } catch { /* Keep only previously confirmed files. */ }
      }
      const message = controller.signal.aborted ? '上传已取消。已完成的文件仍保留在版本中。' : `${releaseError(error)} 已完成的文件仍保留在版本中，重试只会上传未完成的文件。`;
      return this.failure(message, attempt, input.assetIds, true, updated);
    } finally { this.active = null; }
  }

  async removeAsset(raw: unknown): Promise<GitHubCreatedRelease> {
    const input = validateRemoveReleaseAssetRequest(raw);
    const controller = this.beginOperation();
    try {
      const release = await this.editableRelease(input.owner, input.repo, input.releaseId, controller.signal);
      if (!release.assets.some((asset) => asset.id === input.assetId)) throw new Error('这个文件已不在当前版本中，请刷新后重试。');
      await this.client.deleteReleaseAsset(input.owner, input.repo, input.assetId);
      return await this.client.release(input.owner, input.repo, input.releaseId);
    } catch (error) { throw new Error(releaseError(error)); }
    finally { this.active = null; }
  }

  async publish(raw: unknown, progress: (value: ReleaseProgress) => void): Promise<ReleaseResult> {
    const input = validatePublishRequest(raw);
    const controller = this.beginOperation();
    let key = '';
    let attempt: UploadAttempt = { confirmed: new Map(), attempted: new Set() };
    let finalizing = false;
    let creating = false;
    try {
      const inlineIds = [...input.body.matchAll(/easyhub-image:([a-f0-9-]{36})/g)].map((match) => match[1]!);
      if (inlineIds.some((id) => !input.assetIds.includes(id))) throw new Error('介绍中的本地图片尚未添加，请重新选择。');
      const repo = await this.client.repo(input.owner, input.repo);
      const identity = await gitHubIdentity();
      if (repo.archived || !repo.permissions?.push && repo.owner.login.toLowerCase() !== identity.user.login.toLowerCase()) throw new Error('你没有发布这个项目的权限。');
      key = `${identity.user.login.toLowerCase()}/${input.owner.toLowerCase()}/${input.repo.toLowerCase()}/tag:${input.tagName}`;
      attempt = this.attempts.get(key) ?? attempt;
      const chosen = await this.files(input.assetIds, attempt.confirmed);
      const total = chosen.reduce((sum, file) => sum + file.size, 0);
      if (attempt.draft) {
        const remote = await this.client.release(input.owner, input.repo, attempt.draft.id, controller.signal);
        if (!remote.draft) {
          for (const id of input.assetIds) this.selected.delete(id);
          this.attempts.delete(key);
          return remote;
        }
        attempt.draft = remote;
        const selectedNames = new Map(chosen.map((file, index) => [file.name.toLowerCase(), input.assetIds[index]!]));
        if (remote.assets.some((asset) => {
          const selectedId = selectedNames.get(asset.name.toLowerCase());
          return !selectedId || !attempt.attempted.has(selectedId);
        })) throw new Error(DRAFT_SELECTION_MISMATCH);
        await this.reconcile(attempt, input.assetIds, chosen, remote, input);
        await this.files(input.assetIds, attempt.confirmed);
      } else {
        if (this.attempts.size >= 20) throw new Error('还有未完成的版本上传，请先完成或取消它们。');
        progress({ phase: '正在创建新版本', loaded: 0, total, cancelable: true });
        creating = true;
        attempt.draft = await this.client.createRelease(input.owner, input.repo, {
          tagName: input.tagName, target: repo.default_branch, name: input.title.trim(), body: input.body.trim(), prerelease: input.channel !== 'stable',
        }, controller.signal);
        this.attempts.set(key, attempt);
      }
      await this.uploadFiles(attempt.draft, attempt, input.assetIds, chosen, controller, progress);
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      progress({ phase: '正在确认新版本', loaded: total, total, cancelable: false });
      const urls = new Map([...attempt.confirmed].map(([id, asset]) => [id, releaseAssetUrl(input.owner, input.repo, input.tagName, asset.name)]));
      const body = replaceInlineImages(input.body.trim(), urls);
      finalizing = true;
      const published = await this.client.updateRelease(input.owner, input.repo, attempt.draft.id,
        { name: input.title.trim(), body, prerelease: input.channel !== 'stable', draft: false });
      for (const id of input.assetIds) this.selected.delete(id);
      this.attempts.delete(key);
      return published;
    } catch (error) {
      if (!attempt.draft) {
        if (creating && !(error instanceof GitHubError)) {
          return { ...this.failure('暂时无法确认 GitHub 是否已创建草稿。请先查看版本页面，核对这个版本后再决定是否重试。', attempt, input.assetIds, false),
            residualDraft: { tagName: input.tagName, title: input.title, url: `https://github.com/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/releases`, retainedForRetry: false } };
        }
        throw new Error(releaseError(error));
      }
      const selectionMismatch = error instanceof Error && error.message === DRAFT_SELECTION_MISMATCH;
      const remote = await this.client.release(input.owner, input.repo, attempt.draft.id).catch(() => undefined);
      if (remote && !remote.draft) {
        for (const id of input.assetIds) this.selected.delete(id);
        this.attempts.delete(key);
        return remote;
      }
      if (remote) {
        attempt.draft = remote;
        const chosen = input.assetIds.map((id) => this.selected.get(id)!);
        try { await this.reconcile(attempt, input.assetIds, chosen, remote, input); } catch { /* A conflict must be reviewed on the draft page. */ }
      }
      if (!selectionMismatch && !finalizing && (controller.signal.aborted || attempt.confirmed.size === 0)) {
        const cancelled = controller.signal.aborted;
        try {
          await this.client.deleteRelease(input.owner, input.repo, attempt.draft.id);
          this.attempts.delete(key);
          return this.failure(cancelled ? '发布已取消，未发布草稿已清理。' : `${releaseError(error)} 未发布草稿已清理，可以重试。`, { confirmed: new Map(), attempted: new Set() }, input.assetIds, true);
        } catch {
          return { ...this.failure(cancelled ? '发布已取消，但未能清理 GitHub 上的草稿。请查看草稿后再决定如何处理。' : '发布失败，且未能清理 GitHub 上的草稿。请查看草稿后再决定如何处理。', attempt, input.assetIds, false),
            residualDraft: { id: attempt.draft.id, tagName: attempt.draft.tag_name, title: attempt.draft.name || input.title,
              url: `https://github.com/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/releases`, retainedForRetry: false } };
        }
      }
      const message = selectionMismatch ? DRAFT_SELECTION_MISMATCH : finalizing ? '暂时无法确认发布结果。重试前会检查 GitHub，避免重复发布。' : `${releaseError(error)} 已完成的文件保留在未发布草稿中，重试只会上传未完成的文件。`;
      return { ...this.failure(message, attempt, input.assetIds, !selectionMismatch), residualDraft: { id: attempt.draft.id,
        tagName: attempt.draft.tag_name, title: attempt.draft.name || input.title,
        url: `https://github.com/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/releases`, retainedForRetry: !selectionMismatch } };
    } finally { this.active = null; }
  }
}
