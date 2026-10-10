/** @param {import('./index.ts').GitHubPullFile} file */
export function isEmptyAddedPullFile(file) {
  return file.status === 'added' && file.sha === 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
}
