import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { pipeline } from 'node:stream/promises';
import { dialog, net, session } from 'electron';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { GitHubClient, GitHubError, friendlyGitHubError } from '@easyhub/github';
import type { GitHubCreatedRelease, GitHubReleaseAsset } from '@easyhub/github';
import type { AddReleaseAssetsRequest, EditReleaseRequest, PickedReleaseFile, PublishReleaseRequest, ReleaseProgress, RemoveReleaseAssetRequest } from '@easyhub/types';
import { githubAccessToken, gitHubIdentity } from './githubService';
import { githubOriginAgent } from './GitHubProxyService';
import type { GitHubOriginAgent } from './githubProxyOrigin';

const MAX_FILES = 1000;
const MAX_FILE_SIZE = 2 * 1024 ** 3;
const MAX_PREVIEW_SIZE = 8 * 1024 ** 2;
const mimeTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.zip': 'application/zip', '.txt': 'text/plain', '.pdf': 'application/pdf',
};

interface SelectedFile { path: string; name: string; size: number; modified: number; mimeType: string }

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

async function proxyAgent(url: string): Promise<HttpsProxyAgent<string> | GitHubOriginAgent | undefined> {
  const choices = await session.defaultSession.resolveProxy(url);
  for (const choice of choices.split(';')) {
    const match = choice.trim().match(/^(PROXY|HTTPS)\s+([^\s]+)$/i);
    if (match?.[2]) return new HttpsProxyAgent(`${match[1]?.toUpperCase() === 'HTTPS' ? 'https' : 'http'}://${match[2]}`);
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

  async edit(raw: unknown): Promise<GitHubCreatedRelease> {
    const input = validateEditReleaseRequest(raw);
    if (this.active) throw new Error('已有版本操作正在进行，请稍后。');
    await this.editableRelease(input.owner, input.repo, input.releaseId);
    try {
      return await this.client.updateRelease(input.owner, input.repo, input.releaseId,
        { name: input.title.trim(), body: input.body, prerelease: input.prerelease });
    } catch (error) { throw new Error(friendlyGitHubError(error)); }
  }

  async addAssets(raw: unknown, progress: (value: ReleaseProgress) => void): Promise<GitHubCreatedRelease> {
    const input = validateAddReleaseAssetsRequest(raw);
    if (this.active) throw new Error('已有版本操作正在进行，请稍后。');
    const chosen = input.assetIds.map((id) => this.selected.get(id));
    if (chosen.some((file) => !file)) throw new Error('请重新选择要上传的文件。');
    const files = chosen as SelectedFile[];
    const release = await this.editableRelease(input.owner, input.repo, input.releaseId);
    const existing = new Set(release.assets.map((asset) => asset.name.toLowerCase()));
    if (files.some((file) => existing.has(file.name.toLowerCase())) || new Set(files.map((file) => file.name.toLowerCase())).size !== files.length) {
      throw new Error('这个版本已有同名文件，请先移除旧文件或为新文件改名。');
    }
    if (release.assets.length + files.length > MAX_FILES) throw new Error('每个版本最多可包含 1000 个文件。');
    for (const file of files) {
      const details = await stat(file.path);
      if (!details.isFile() || details.size !== file.size || details.mtimeMs !== file.modified) throw new Error(`“${file.name}”已发生变化，请重新选择。`);
    }
    const controller = new AbortController();
    this.active = controller;
    const total = files.reduce((sum, file) => sum + file.size, 0);
    let loaded = 0;
    try {
      const token = await githubAccessToken();
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!;
        const id = input.assetIds[index]!;
        const phase = `正在上传 ${file.name}`;
        progress({ phase, loaded, total, cancelable: true });
        const url = release.upload_url.replace(/\{.*$/, '') + `?name=${encodeURIComponent(file.name)}`;
        const uploaded = await uploadAsset(url, file, token, controller.signal, (bytes) => {
          loaded += bytes;
          progress({ phase, loaded, total, cancelable: true });
        });
        if (uploaded.state !== 'uploaded' || uploaded.size !== file.size) throw new Error(`“${file.name}”上传后未通过检查。`);
        this.selected.delete(id);
      }
      return await this.client.release(input.owner, input.repo, input.releaseId);
    } catch (error) {
      if (controller.signal.aborted) throw new Error('上传已取消。已完成的文件仍保留在版本中。');
      throw new Error(`${friendlyGitHubError(error)} 已完成的文件仍保留在版本中。`);
    } finally { this.active = null; }
  }

  async removeAsset(raw: unknown): Promise<GitHubCreatedRelease> {
    const input = validateRemoveReleaseAssetRequest(raw);
    if (this.active) throw new Error('已有版本操作正在进行，请稍后。');
    const release = await this.editableRelease(input.owner, input.repo, input.releaseId);
    if (!release.assets.some((asset) => asset.id === input.assetId)) throw new Error('这个文件已不在当前版本中，请刷新后重试。');
    try {
      await this.client.deleteReleaseAsset(input.owner, input.repo, input.assetId);
      return await this.client.release(input.owner, input.repo, input.releaseId);
    } catch (error) { throw new Error(friendlyGitHubError(error)); }
  }

  async publish(raw: unknown, progress: (value: ReleaseProgress) => void): Promise<GitHubCreatedRelease> {
    if (this.active) throw new Error('已有新版本正在发布，请稍后。');
    const input = validatePublishRequest(raw);
    const files = input.assetIds.map((id) => this.selected.get(id));
    if (files.some((file) => !file)) throw new Error('请重新选择要上传的文件。');
    const chosen = files as SelectedFile[];
    const names = chosen.map((file) => file.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new Error('同一个版本不能包含同名文件。');
    const inlineIds = [...input.body.matchAll(/easyhub-image:([a-f0-9-]{36})/g)].map((match) => match[1]!);
    if (inlineIds.some((id) => !input.assetIds.includes(id))) throw new Error('介绍中的本地图片尚未添加，请重新选择。');
    for (const file of chosen) {
      const details = await stat(file.path);
      if (!details.isFile() || details.size !== file.size || details.mtimeMs !== file.modified) throw new Error(`“${file.name}”已发生变化，请重新选择。`);
    }
    const controller = new AbortController();
    this.active = controller;
    let draft: GitHubCreatedRelease | null = null;
    let finalizing = false;
    try {
      const repo = await this.client.repo(input.owner, input.repo);
      const identity = await gitHubIdentity();
      if (repo.archived || !repo.permissions?.push && repo.owner.login.toLowerCase() !== identity.user.login.toLowerCase()) throw new Error('你没有发布这个项目的权限。');
      const total = chosen.reduce((sum, file) => sum + file.size, 0);
      progress({ phase: '正在创建新版本', loaded: 0, total, cancelable: true });
      draft = await this.client.createRelease(input.owner, input.repo, {
        tagName: input.tagName, target: repo.default_branch, name: input.title.trim(), body: input.body.trim(), prerelease: input.channel !== 'stable',
      }, controller.signal);
      const token = await githubAccessToken();
      const urls = new Map<string, string>();
      let loaded = 0;
      for (let index = 0; index < chosen.length; index += 1) {
        const file = chosen[index]!;
        const id = input.assetIds[index]!;
        progress({ phase: `正在上传 ${file.name}`, loaded, total, cancelable: true });
        const url = draft.upload_url.replace(/\{.*$/, '') + `?name=${encodeURIComponent(file.name)}`;
        const uploaded = await uploadAsset(url, file, token, controller.signal, (bytes) => {
          loaded += bytes;
          progress({ phase: `正在上传 ${file.name}`, loaded, total, cancelable: true });
        });
        if (uploaded.state !== 'uploaded' || uploaded.size !== file.size || !uploaded.browser_download_url) throw new Error(`“${file.name}”上传后未通过检查。`);
        // Draft assets use a temporary "untagged" URL. The final tag URL remains valid after publishing.
        urls.set(id, releaseAssetUrl(input.owner, input.repo, input.tagName, uploaded.name));
      }
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      progress({ phase: '正在确认新版本', loaded: total, total, cancelable: false });
      const body = replaceInlineImages(input.body.trim(), urls);
      finalizing = true;
      const published = await this.client.updateRelease(input.owner, input.repo, draft.id, { body, draft: false });
      for (const id of input.assetIds) this.selected.delete(id);
      return published;
    } catch (error) {
      if (draft && !finalizing) await this.client.deleteRelease(input.owner, input.repo, draft.id).catch(() => undefined);
      if (finalizing) throw new Error('无法确认发布结果，请先在 GitHub 检查版本，再决定是否重试。');
      if (error instanceof Error && (error.message.startsWith('请') || error.message.startsWith('你没有') || error.message.includes('已发生变化') || error.message.includes('上传后未通过'))) throw error;
      throw new Error(friendlyGitHubError(error));
    } finally { this.active = null; }
  }
}
