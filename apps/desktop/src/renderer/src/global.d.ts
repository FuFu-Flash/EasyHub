import type { GitHubUser } from '@easyhub/github';
import type { FolderInspection, LocalOperationProgress, LocalProjectLink, LocalProjectStatus, SyncDecision, SyncPreview } from '@easyhub/types';
import type { TranslationProgress, TranslationRequest } from '@easyhub/types';
import type { PickedReleaseFile, PublishReleaseRequest, ReleaseProgress } from '@easyhub/types';
import type { GitHubCreatedRelease } from '@easyhub/github';

export {};

declare global {
  interface Window {
    easyHub?: {
      chooseFolder: () => Promise<string | null>;
      localList: () => Promise<LocalProjectLink[]>;
      localInspect: (path: string) => Promise<FolderInspection>;
      localConnect: (path: string) => Promise<LocalProjectLink>;
      localCreate: (path: string, name: string, description: string, isPrivate: boolean) => Promise<LocalProjectLink>;
      localDownload: (owner: string, name: string, parent: string) => Promise<LocalProjectLink>;
      localStatus: (id: string) => Promise<LocalProjectStatus>;
      localPublish: (id: string, message: string) => Promise<{ changed: number }>;
      localCheckSync: (id: string) => Promise<SyncPreview>;
      localSync: (id: string, revision: string | undefined, decisions: SyncDecision[]) => Promise<{ updated: number }>;
      localCancel: () => Promise<void>;
      localOpenFolder: (id: string) => Promise<void>;
      localReadIntroduction: (id: string) => Promise<string>;
      localSaveIntroduction: (id: string, expected: string, content: string) => Promise<void>;
      translateContent: (request: TranslationRequest) => Promise<string>;
      cancelTranslation: (id: string) => Promise<void>;
      onTranslationProgress: (callback: (value: TranslationProgress) => void) => () => void;
      onLocalProgress: (callback: (value: LocalOperationProgress) => void) => () => void;
      onLocalStatus: (callback: (value: { id: string; status: LocalProjectStatus }) => void) => () => void;
      minimizeWindow: () => Promise<void>;
      toggleMaximizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      openLicense: () => Promise<void>;
      openExternalLink: (url: string) => Promise<void>;
      authStatus: () => Promise<{ user: GitHubUser | null; clientId: string | null }>;
      authStart: () => Promise<{ userCode: string; verificationUri: string; expiresAt: number; interval: number }>;
      authPoll: () => Promise<{ state: 'waiting' | 'complete'; user?: GitHubUser; interval?: number }>;
      authCancel: () => Promise<void>;
      authLogout: () => Promise<void>;
      chooseReleaseFiles: (inline: boolean) => Promise<PickedReleaseFile[]>;
      publishRelease: (input: PublishReleaseRequest) => Promise<GitHubCreatedRelease>;
      cancelRelease: () => Promise<void>;
      onReleaseProgress: (callback: (value: ReleaseProgress) => void) => () => void;
      github: <T>(action: string, ...args: unknown[]) => Promise<T>;
      cancelGithubReads: () => Promise<void>;
      downloadArchive: (owner: string, repo: string, ref: string) => Promise<string | null>;
      downloadReleaseAsset: (owner: string, repo: string, assetId: number) => Promise<string | null>;
      revealDownloadedArchive: (path: string) => Promise<void>;
      openDownloadedFile: (path: string) => Promise<void>;
      cancelArchive: () => Promise<void>;
      onArchiveProgress: (callback: (value: number) => void) => () => void;
      onDownloadProgress: (callback: (value: { loaded: number; total: number | null; percent: number | null }) => void) => () => void;
    };
  }
}
