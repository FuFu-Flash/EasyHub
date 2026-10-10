import type { GitHubPullFile, GitHubPullRequest } from '@easyhub/github';

export function checkedPullDownload(file: GitHubPullFile, current: GitHubPullRequest, latest: GitHubPullRequest): { owner: string; repo: string; sha: string; name: string } {
  if (!current.head.sha || current.head.sha !== latest.head.sha || current.head.repo?.id !== latest.head.repo?.id || !latest.head.repo) {
    throw new Error('修改内容已更新，请刷新后重新检查文件。 / Changes have been updated. Refresh and check the files again.');
  }
  if (file.status === 'removed' || !/^[a-f0-9]{40}$/iu.test(file.sha ?? '')) {
    throw new Error('此文件无法下载。 / This file cannot be downloaded.');
  }
  const name = file.filename.split('/').at(-1)?.replace(/[^-\w.]/gu, '_') || 'changed-file';
  return { owner: latest.head.repo.owner.login, repo: latest.head.repo.name, sha: file.sha!, name };
}
