export type ProjectHealth = 'saved' | 'changes' | 'remote';
export type Visibility = 'private' | 'public';
export type ChangedFileKind = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  path: string;
  kind: ChangedFileKind;
  previousPath?: string;
}

export interface HistoryVersion {
  id: string;
  message: string;
  author: string;
  createdAt: string;
  changedFiles: string[];
  additions: number;
  deletions: number;
}

export type ReleaseChannel = 'stable' | 'alpha' | 'beta';

export interface ReleaseAsset {
  id: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface ProjectRelease {
  id: string;
  tagName: string;
  title: string;
  body: string;
  channel: ReleaseChannel;
  publishedAt: string;
  assets: ReleaseAsset[];
}

export interface CreateReleaseInput {
  tagName: string;
  title: string;
  body: string;
  channel: ReleaseChannel;
  assets: ReleaseAsset[];
}

export interface IssueComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface Issue {
  id: string;
  projectId: string;
  title: string;
  body: string;
  author: string;
  createdAt: string;
  state: 'open' | 'closed';
  comments: IssueComment[];
}

export interface Project {
  id: string;
  name: string;
  owner: string;
  description: string;
  visibility: Visibility;
  archived: boolean;
  branchProtectionEnabled: boolean;
  localPath?: string;
  updatedAt: string;
  health: ProjectHealth;
  changedFiles: ChangedFile[];
  readme: string;
  history: HistoryVersion[];
  releases: ProjectRelease[];
  color: string;
  initials: string;
  downloaded: boolean;
}

export interface CreateProjectInput {
  name: string;
  description: string;
  visibility: Visibility;
  localPath?: string;
}

export interface LocalProjectLink {
  id: string;
  repositoryId: number;
  owner: string;
  name: string;
  localPath: string;
  lastOpenedAt: string;
}

export interface LocalProjectStatus {
  files: ChangedFile[];
  needsReview: boolean;
}

export interface SyncFileReview {
  path: string;
  mine: string | null;
  github: string | null;
  previewable: boolean;
}

export interface SyncPreview {
  state: 'current' | 'ready' | 'review' | 'blocked';
  remoteRevision?: string;
  changedFiles: number;
  files: SyncFileReview[];
  message?: string;
}

export interface SyncDecision {
  path: string;
  choice: 'mine' | 'github';
}

export interface FolderInspection {
  path: string;
  state: 'github' | 'existing' | 'new';
  owner?: string;
  name?: string;
}

export interface LocalOperationProgress {
  phase: string;
  loaded?: number;
  total?: number;
  cancelable?: boolean;
}
export type TranslationTargetLanguage = 'zh-CN' | 'en';
export interface TranslationRequest {
  id: string;
  text: string;
  format: 'text' | 'markdown';
  target: TranslationTargetLanguage;
  repository?: { name: string; owner: string; fullName?: string };
  protectedNames?: string[];
}
export interface TranslationProgress { id: string; completed: number; total: number }
