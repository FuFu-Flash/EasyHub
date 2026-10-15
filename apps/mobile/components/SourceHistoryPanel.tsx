import { useTranslation } from '@/features/localization/react';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { isEmptyAddedPullFile, validHistoryPath, type GitHubBranch, type GitHubCommit, type GitHubPullFile } from '@easyhub/github';
import { usePreferences } from '@/features/preferences/provider';
import { parseCommitPatch } from '@/features/github/sourceHistory';
import type { PagedListState } from '@/features/github/pagedList';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';
import { Action, Card, DirectionLabel, ErrorText, Loading, palette } from './elements';
import { MaterialArrow } from './MaterialArrow';

type List<T> = PagedListState<T> & { more(): Promise<void> };

export interface SourceHistoryViewState {
  pathDraft: { source: string; value: string };
  branchQuery: string;
  choosingBranch: boolean;
  visibleBranches: number;
}

export function initialSourceHistoryViewState(path: string): SourceHistoryViewState {
  return { pathDraft: { source: path, value: path }, branchQuery: '', choosingBranch: false, visibleBranches: 20 };
}

export function SourceHistoryPanel({ branch, path, branches, history, viewState, onViewStateChange, onFilter, onOpen }: {
  branch: string; path: string; branches: List<GitHubBranch>; history: List<GitHubCommit>;
  viewState: SourceHistoryViewState; onViewStateChange: Dispatch<SetStateAction<SourceHistoryViewState>>;
  onFilter(branch: string, path: string): void; onOpen(sha: string): void;
}) {
  const { language } = usePreferences();
  const t = useTranslation();
  const { choosingBranch, branchQuery, pathDraft, visibleBranches } = viewState;
  const updateView = (patch: Partial<SourceHistoryViewState>) => onViewStateChange(current => ({ ...current, ...patch }));
  const draftPath = pathDraft.source === path ? pathDraft.value : path;
  const { value: pathError, set: setPathError } = usePageFeedback(false);
  const branchNames = [...new Set([branch, ...branches.items.map(item => item.name)])].filter(value => value.toLowerCase().includes(branchQuery.trim().toLowerCase()));
  const applyPath = () => {
    const value = draftPath.trim();
    if (value && !validHistoryPath(value)) { setPathError(true); return; }
    setPathError(false); onFilter(branch, value);
  };
  return <>
    <Card>
      <Text style={{ fontSize: 18, fontWeight: '800', color: palette.ink, marginBottom: 7 }}>{t("common.changeHistory")}</Text>
      <Text style={{ color: palette.muted, lineHeight: 21, marginBottom: 14 }}>{t("SourceHistoryPanel.browseUpdatesAndCodeChangesCommittedToGitHub")}</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: choosingBranch }} onPress={() => onViewStateChange(current => ({ ...current, choosingBranch: !current.choosingBranch }))} style={{ minHeight: 48, paddingVertical: 12, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Text style={{ flex: 1, minWidth: 0, color: palette.blue, fontWeight: '700' }}>{t("SourceHistoryPanel.selectBranch")} · {branch}</Text>
        <MaterialArrow name={choosingBranch ? 'expandLess' : 'expandMore'} color={palette.blue} />
      </Pressable>
      {choosingBranch && <View style={{ gap: 8, marginBottom: 14 }}>
        <TextInput accessibilityLabel={t("SourceHistoryPanel.findABranch")} placeholder={t("SourceHistoryPanel.findABranch")} value={branchQuery} onChangeText={value => updateView({ branchQuery: value, visibleBranches: 20 })} autoCapitalize="none" style={{ minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 12, color: palette.ink }} />
        {branchNames.slice(0, visibleBranches).map(name => <Pressable key={name} accessibilityRole="button" accessibilityState={{ selected: name === branch }} onPress={() => { onFilter(name, path); updateView({ choosingBranch: false }); }} style={{ minHeight: 48, justifyContent: 'center', borderRadius: 10, backgroundColor: name === branch ? '#e7f0ff' : '#f6f8fc', padding: 12 }}><Text style={{ color: name === branch ? palette.blue : palette.ink }}>{name}</Text></Pressable>)}
        {visibleBranches < branchNames.length && <Action title={t("SourceHistoryPanel.showMoreBranches")} secondary onPress={() => onViewStateChange(current => ({ ...current, visibleBranches: current.visibleBranches + 20 }))} />}
        {branches.busy && <Loading />}
        {branches.failedPage !== null && <ErrorText message={t("SourceHistoryPanel.couldNotLoadBranchesPleaseRetry")} onRetry={() => { void branches.more(); }} />}
        {!branches.busy && branches.failedPage === null && branches.nextPage !== null && <Action title={t("SourceHistoryPanel.loadMoreBranches")} secondary onPress={() => { void branches.more(); }} />}
        {!branches.busy && !branchNames.length && <Text style={{ color: palette.muted }}>{t("SourceHistoryPanel.noLoadedBranchMatchesThisSearch")}</Text>}
      </View>}
      <Text style={{ color: palette.ink, marginBottom: 8 }}>{t("SourceHistoryPanel.fileOrDirectoryPath")}</Text>
      <TextInput accessibilityLabel={t("SourceHistoryPanel.fileOrDirectoryPath")} value={draftPath} onChangeText={value => { updateView({ pathDraft: { source: path, value } }); setPathError(false); }} onSubmitEditing={applyPath} placeholder={t("SourceHistoryPanel.leaveBlankForAllFiles")} autoCapitalize="none" autoCorrect={false} maxLength={4096} style={{ minHeight: 48, borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 12, color: palette.ink, marginBottom: 10 }} />
      <Action title={t("SourceHistoryPanel.viewFileHistory")} secondary onPress={applyPath} />
      {!!path && <View style={{ marginTop: 10 }}><Action title={t("SourceHistoryPanel.showHistoryForAllFiles")} secondary onPress={() => onFilter(branch, '')} /></View>}
      {pathError && <Text style={{ color: '#bf3947', marginTop: 10 }}>{t("SourceHistoryPanel.enterARelativeProjectPathWithoutEmptyOrParentDirectorySegments")}</Text>}
    </Card>
    {history.items.map(commit => <Pressable key={commit.sha} accessibilityRole="button" onPress={() => onOpen(commit.sha)}>
      <Card><View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {!!commit.author?.avatar_url && <Image source={{ uri: commit.author.avatar_url }} style={{ width: 34, height: 34, borderRadius: 17 }} />}
        <View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: palette.ink, fontWeight: '700', fontSize: 16 }}>{commit.commit.message.split('\n')[0]}</Text><Text style={{ color: palette.muted, marginTop: 7 }}>{commit.author?.login || commit.commit.author?.name || t("SourceHistoryPanel.unknownAuthor")} · {commit.commit.author?.date ? new Date(commit.commit.author.date).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN') : ''}</Text><Text selectable style={{ color: palette.muted, marginTop: 5, fontFamily: 'monospace' }}>{commit.sha.slice(0, 8)}</Text></View>
        <MaterialArrow name="chevron" color={palette.muted} />
      </View></Card>
    </Pressable>)}
    {history.busy && <Loading />}
    {history.failedPage !== null && <ErrorText message={t("SourceHistoryPanel.couldNotLoadChangeHistoryPreviouslyLoadedCommitsAreKept")} onRetry={() => { void history.more(); }} />}
    {history.loaded && !history.busy && history.failedPage === null && !history.items.length && <Card><Text style={{ color: palette.muted }}>{path ? t("SourceHistoryPanel.thisFileHasNoCommitsOnThisBranch") : t("SourceHistoryPanel.thisBranchHasNoCommitsYet")}</Text></Card>}
    {!history.busy && history.failedPage === null && history.nextPage !== null && <Action title={t("SourceHistoryPanel.loadMoreCommits")} secondary onPress={() => { void history.more(); }} />}
  </>;
}

export function CommitFileChanges({ file, onFileHistory }: { file: GitHubPullFile; onFileHistory(path: string): void }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(200);
  const patch = useMemo(() => open && file.patch ? parseCommitPatch(file) : null, [open, file]);
  const status = file.status === 'added' ? t("SourceHistoryPanel.added") : file.status === 'removed' ? t("SourceHistoryPanel.deleted") : file.status === 'renamed' ? t("SourceHistoryPanel.renamed") : t("SourceHistoryPanel.modified");
  return <Card>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 }}><MaterialArrow name={open ? 'expandLess' : 'expandMore'} color={palette.muted} /><Text selectable style={{ flex: 1, minWidth: 0, color: palette.ink, fontWeight: '700' }}>{file.filename}</Text></Pressable>
    <Text style={{ color: palette.muted, marginBottom: 10 }}>{status} · +{file.additions} / −{file.deletions}</Text>
    <Pressable accessibilityRole="button" onPress={() => onFileHistory(file.filename)} style={{ minHeight: 48, justifyContent: 'center' }}><DirectionLabel title={t("SourceHistoryPanel.fileHistory")} /></Pressable>
    {open && <View style={{ gap: 10 }}>
      {!!file.previous_filename && <Text selectable style={{ color: palette.muted }}>{t("SourceHistoryPanel.previousFilename")} · {file.previous_filename}</Text>}
      {patch ? <>
        {patch.incomplete && <Text style={{ color: palette.muted, lineHeight: 21 }}>{t("SourceHistoryPanel.someChangesAreOmittedViewTheCompleteDiffOnGitHub")}</Text>}
        <ScrollView horizontal nestedScrollEnabled={false} accessibilityLabel={t("SourceHistoryPanel.fileChanges")} style={{ flexGrow: 0, backgroundColor: '#f6f8fc', borderRadius: 8 }}><View style={{ paddingVertical: 8 }}>
          {patch.lines.slice(0, visible).map((line, index) => <Text selectable key={index} style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 20, paddingHorizontal: 10, color: line.kind === 'add' ? '#176b43' : line.kind === 'remove' ? '#a5283d' : palette.ink, backgroundColor: line.kind === 'add' ? '#e8f7ef' : line.kind === 'remove' ? '#fff0f2' : 'transparent' }}>{String(line.before ?? '').padStart(5)} {String(line.after ?? '').padStart(5)} {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '} {line.text}</Text>)}
        </View></ScrollView>
        {visible < patch.lines.length && <Action title={t("SourceHistoryPanel.showMoreChangedLines")} secondary onPress={() => setVisible(count => count + 200)} />}
      </> : <Text style={{ color: palette.muted, lineHeight: 21 }}>{isEmptyAddedPullFile(file) ? t("SourceHistoryPanel.thisIsANewEmptyFile") : t("SourceHistoryPanel.githubDidNotProvideATextDiffTheFileMayBe")}</Text>}
    </View>}
  </Card>;
}
