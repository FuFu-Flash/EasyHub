import type { GitHubUser } from '@easyhub/github';
import type { MenuCommand, MenuState } from '../../shared/applicationMenu';
import type { DownloadCommand, DownloadItem, DownloadRequest } from '../../downloads';
import type { LocalFileDiff, LocalPublishPreview, LocalPublishSelection } from '@easyhub/types';
import type { FolderInspection, LocalDiscoveryResult, LocalOperationProgress, LocalProjectLink, LocalProjectStatus, SyncDecision, SyncPreview } from '@easyhub/types';
import type { TranslationProgress, TranslationRequest } from '@easyhub/types';
import type { AddReleaseAssetsRequest, EditReleaseRequest, PickedReleaseFile, PublishReleaseRequest, ReleaseProgress, RemoveReleaseAssetRequest, ReleaseMutationFailure } from '@easyhub/types';
import type { GitHubCreatedRelease } from '@easyhub/github';
import type { AiSettingsInput, AiSettingsStatus, AiReviewRequest, AiReviewResult, AiReviewProgress, AiCodeExplanationRequest, AiCodeExplanationResult } from '@easyhub/types';
import type { GitHubProxyStatus } from '@easyhub/types';
import type { BinaryAnalysisSettingsStatus, BinaryAnalysisSource, BinaryAnalysisRequest, BinaryAnalysisResult, BinaryAnalysisProgress, BinaryAiReviewRequest, BinaryAiReviewResult } from '@easyhub/types';

interface HostsRepairStatus { enabled: boolean; updatedAt: string | null; source: string }

export interface MacProxySnapshot {
  status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'unavailable';
  pacURL: string;
  socksPort: number;
  lastProbe?: string;
  error?: string;
  domains?: number;
}

export {};

declare global {
  interface Window {
    easyHub?: {
      readonly platform: string;
      readonly macProxy: {
        status: () => Promise<MacProxySnapshot>;
        setEnabled: (enabled: boolean) => Promise<MacProxySnapshot>;
        probe: () => Promise<MacProxySnapshot>;
        openSettings: () => Promise<MacProxySnapshot>;
        onChanged: (callback: (value: MacProxySnapshot) => void) => () => void;
      };
      copyPairingCode: (code: string) => Promise<boolean>;
      setMenuState: (state: MenuState) => Promise<void>;
      onMenuCommand: (callback: (command: MenuCommand) => void) => () => void;
      downloadsList: () => Promise<DownloadItem[]>;
      downloadsEnqueue: (request: DownloadRequest) => Promise<DownloadItem | null>;
      downloadsCommand: (id: string, command: DownloadCommand) => Promise<void>;
      downloadsClear: () => Promise<void>;
      downloadsOpen: (id: string, folder: boolean) => Promise<void>;
      onDownloadsChanged: (callback: (items: DownloadItem[]) => void) => () => void;
      chooseFolder: () => Promise<string | null>;
      localList: () => Promise<LocalProjectLink[]>;
      localDiscoveryRoots: () => Promise<string[]>;
      localDiscoveryAddRoot: (path: string) => Promise<string[]>;
      localDiscoveryRemoveRoot: (path: string) => Promise<string[]>;
      localDiscoveryScan: () => Promise<LocalDiscoveryResult>;
      localInspect: (path: string) => Promise<FolderInspection>;
      localConnect: (path: string) => Promise<LocalProjectLink>;
      localCreate: (path: string, name: string, description: string, isPrivate: boolean) => Promise<LocalProjectLink>;
      localDownload: (owner: string, name: string, parent: string) => Promise<LocalProjectLink>;
      localStatus: (id: string) => Promise<LocalProjectStatus>;
      localPreviewChanges: (id: string) => Promise<LocalPublishPreview>;
      localFileDiff: (id: string, path: string, snapshot: string) => Promise<LocalFileDiff>;
      localCancelPreview: (id: string) => Promise<void>;
      localPublish: (id: string, message: string, selection?: LocalPublishSelection) => Promise<{ changed: number }>;
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
      setWindowControlStyle: (style: 'windows' | 'reference', density?: 'comfortable' | 'compact') => Promise<void>;
      toggleMaximizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      openLicense: () => Promise<void>;
      hostsStatus: () => Promise<HostsRepairStatus>;
      hostsSetEnabled: (enabled: boolean) => Promise<HostsRepairStatus>;
      hostsRefresh: () => Promise<HostsRepairStatus>;
      githubProxyStatus: () => Promise<GitHubProxyStatus>;
      githubProxySetEnabled: (enabled: boolean) => Promise<GitHubProxyStatus>;
      githubProxyRefresh: () => Promise<GitHubProxyStatus>;
      githubProxyCancel: () => Promise<void>;
      openExternalLink: (url: string) => Promise<void>;
      authStatus: () => Promise<{ user: GitHubUser | null; clientId: string | null }>;
      aiSettings: () => Promise<AiSettingsStatus>;
      aiSaveSettings: (input: AiSettingsInput) => Promise<AiSettingsStatus>;
      aiForgetKey: () => Promise<AiSettingsStatus>;
      aiTestConnection: () => Promise<void>;
      aiReviewPull: (input: AiReviewRequest) => Promise<AiReviewResult>;
      aiExplainCode: (input: AiCodeExplanationRequest) => Promise<AiCodeExplanationResult>;
      aiCancelReview: (id: string) => Promise<void>;
      binaryAnalysisStatus: () => Promise<BinaryAnalysisSettingsStatus>;
      binaryAnalysisInstall: (id: string) => Promise<BinaryAnalysisSettingsStatus>;
      binaryAnalysisChooseFile: () => Promise<Extract<BinaryAnalysisSource, { kind: 'local' }> | null>;
      binaryAnalyze: (input: BinaryAnalysisRequest) => Promise<BinaryAnalysisResult>;
      binaryAnalysisCancel: (id: string) => Promise<void>;
      binaryAiReview: (input: BinaryAiReviewRequest) => Promise<BinaryAiReviewResult>;
      onBinaryAnalysisProgress: (callback: (value: BinaryAnalysisProgress) => void) => () => void;
      onAiReviewProgress: (callback: (value: AiReviewProgress) => void) => () => void;
      authStart: () => Promise<{ userCode: string; verificationUri: string; expiresAt: number; interval: number; codeCopied?: boolean }>;
      authStartDeletion: (owner: string, repo: string, id: number) => Promise<{ userCode: string; verificationUri: string; expiresAt: number; interval: number; codeCopied?: boolean }>;
      authPoll: () => Promise<{ state: 'waiting' | 'complete'; user?: GitHubUser; interval?: number }>;
      authCancel: () => Promise<void>;
      authLogout: () => Promise<void>;
      chooseReleaseFiles: (inline: boolean) => Promise<PickedReleaseFile[]>;
      publishRelease: (input: PublishReleaseRequest) => Promise<GitHubCreatedRelease | ReleaseMutationFailure<GitHubCreatedRelease>>;
      editRelease: (input: EditReleaseRequest) => Promise<GitHubCreatedRelease>;
      addReleaseAssets: (input: AddReleaseAssetsRequest) => Promise<GitHubCreatedRelease | ReleaseMutationFailure<GitHubCreatedRelease>>;
      removeReleaseAsset: (input: RemoveReleaseAssetRequest) => Promise<GitHubCreatedRelease>;
      cancelRelease: () => Promise<void>;
      onReleaseProgress: (callback: (value: ReleaseProgress) => void) => () => void;
      github: <T>(action: string, ...args: unknown[]) => Promise<T>;
      cancelGithubReads: () => Promise<void>;
      downloadArchive: (owner: string, repo: string, ref: string) => Promise<string | null>;
      downloadReleaseAsset: (owner: string, repo: string, assetId: number) => Promise<string | null>;
      downloadPullRequestFile: (owner: string, repo: string, number: number, path: string, headSha: string) => Promise<string | null>;
      revealDownloadedArchive: (path: string) => Promise<void>;
      openDownloadedFile: (path: string) => Promise<void>;
      cancelArchive: () => Promise<void>;
      onArchiveProgress: (callback: (value: number) => void) => () => void;
      onDownloadProgress: (callback: (value: { loaded: number; total: number | null; percent: number | null }) => void) => () => void;
    };
  }
}
