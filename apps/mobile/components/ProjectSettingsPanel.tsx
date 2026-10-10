import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { RefreshHandle } from '@/features/github/usePullRefresh';
import * as Linking from 'expo-linking';
import { GitHubClient, type GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { awaitDeviceAuthorization, requestDeletionDeviceCode, type DeviceCode } from '@/features/auth/deviceFlow';
import { applyRepositorySetting, assertDeletionAccount, canManageRepository, loadProtectionState, repositoryErrorMessage, requireDeletionAuthorization, settingConfirmation, type ProtectionState, type RepositorySettingAction } from '@/features/github/repositoryOperations';
import { AppAlert } from './AppAlert';
import { Action, Card, Loading, palette } from './elements';

const fieldStyle = { borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 13, color: palette.ink, backgroundColor: '#fff' } as const;

export function ProjectSettingsPanel({ repo, publicMode = false, onUpdate, onRemoved, ref }: {
  ref?: Ref<RefreshHandle>;
  repo: GitHubRepo;
  publicMode?: boolean;
  onUpdate: (repo: GitHubRepo) => void;
  onRemoved: () => void;
}) {
  const { client, user } = useSession();
  const { t } = usePreferences();
  const [action, setAction] = useState<RepositorySettingAction | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [targetOwner, setTargetOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [protection, setProtection] = useState<ProtectionState | null>(null);
  const [loadingProtection, setLoadingProtection] = useState(false);
  const [flow, setFlow] = useState<DeviceCode | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const deletion = useRef<{ client: GitHubClient; repoId: number; login: string; expiresAt: number } | null>(null);
  const authorization = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const applying = useRef(false);
  const focused = useRef(false);
  const protectionRead = useRef<{ client: GitHubClient; scope: string; controller: AbortController; promise: Promise<void> } | null>(null);
  const canManage = canManageRepository(repo, user?.login, publicMode);

  useEffect(() => () => { generation.current++; authorization.current?.abort(); deletion.current = null; protectionRead.current?.controller.abort(); protectionRead.current = null; }, [repo.id, repo.full_name, client]);

  const rows: { id: RepositorySettingAction; title: string; description: string; button: string; disabled?: boolean }[] = [
    { id: 'visibility', title: t('变更项目可见性', 'Change visibility'), description: repo.private ? t('目前只有获得授权的人能看到这个项目。', 'Only authorized people can see this project.') : t('这个项目目前是公开的。', 'This project is currently public.'), button: t('改变可见性', 'Change visibility'), disabled: repo.archived },
    { id: 'protection', title: t('分支保护规则', 'Branch protection rules'), description: t('查看并管理默认分支的保护规则。', 'View and manage default branch protection.'), button: t('管理规则', 'Manage rules'), disabled: repo.archived },
    { id: 'transfer', title: t('所有权转移', 'Transfer ownership'), description: t('转移给其他用户或组织，对方可能需要接受。', 'Transfer to another user or organization. They may need to accept.'), button: t('转移项目', 'Transfer project'), disabled: repo.archived },
    { id: 'archive', title: repo.archived ? t('取消项目存档', 'Unarchive project') : t('存档此项目', 'Archive project'), description: repo.archived ? t('取消存档后可以继续修改项目。', 'Unarchive to make changes again.') : t('存档后项目会变为只读，之后仍可取消存档。', 'Archiving makes the project read-only. You can unarchive it later.'), button: repo.archived ? t('取消存档', 'Unarchive') : t('存档此项目', 'Archive project') },
    { id: 'delete', title: t('删除此项目', 'Delete project'), description: t('永久删除 GitHub 上的项目、历史版本和问题。', 'Permanently delete the project, history and issues on GitHub.'), button: t('删除此项目', 'Delete project') },
  ];
  const selected = rows.find((row) => row.id === action);
  const expected = action ? settingConfirmation(repo, action) : '';
  const actionButton = action === 'protection' ? protection?.enabled ? t('移除默认分支保护', 'Remove default branch protection') : t('开启默认分支保护', 'Protect default branch') : selected?.button ?? '';

  const close = () => {
    if (applying.current) return;
    generation.current++; authorization.current?.abort(); deletion.current = null;
    protectionRead.current?.controller.abort(); protectionRead.current = null; setLoadingProtection(false);
    setAction(null); setFlow(null); setAuthorized(false); setAuthorizing(false); setError('');
  };
  const readProtection = useCallback(() => {
    if (!client || !focused.current) return Promise.resolve();
    const scope = `${repo.id}/${repo.full_name}/${repo.default_branch}`;
    const previous = protectionRead.current;
    if (previous?.client === client && previous.scope === scope) return previous.promise;
    previous?.controller.abort(); protectionRead.current = null;
    const current = generation.current;
    const controller = new AbortController();
    const request = { client, scope, controller, promise: Promise.resolve() };
    const active = () => !controller.signal.aborted && protectionRead.current === request && current === generation.current;
    setLoadingProtection(true); setError('');
    request.promise = client.repo(repo.owner.login, repo.name, controller.signal).then(async (details) => {
      if (!active()) return;
      if (details.id !== repo.id || details.full_name !== repo.full_name || !canManageRepository(details, user?.login, publicMode)) throw new Error('Changed');
      const state = await loadProtectionState(client, details, controller.signal);
      if (active()) setProtection(state);
    }).catch((cause) => { if (active()) setError(repositoryErrorMessage(cause, t)); })
      .finally(() => {
        if (active()) setLoadingProtection(false);
        if (protectionRead.current === request) protectionRead.current = null;
      });
    protectionRead.current = request;
    return request.promise;
  }, [client, repo, user, publicMode, t]);
  const openSetting = useCallback(async (next: RepositorySettingAction) => {
    if (!canManage || !client || applying.current) return;
    generation.current++; authorization.current?.abort(); deletion.current = null;
    protectionRead.current?.controller.abort(); protectionRead.current = null;
    setLoadingProtection(false);
    setAction(next); setConfirmation(''); setTargetOwner(''); setError(''); setFlow(null); setAuthorized(false); setAuthorizing(false); setProtection(null);
    if (next === 'protection') await readProtection();
  }, [canManage, client, readProtection]);
  const refreshProtection = useCallback(() => {
    if (!canManage || action !== 'protection' || applying.current || authorizing) return Promise.resolve();
    return readProtection();
  }, [canManage, action, authorizing, readProtection]);
  useImperativeHandle(ref, () => ({ refresh: refreshProtection }), [refreshProtection]);
  const refreshVisibleProtection = useRef(refreshProtection);
  useEffect(() => { refreshVisibleProtection.current = refreshProtection; }, [refreshProtection]);
  useFocusEffect(useCallback(() => {
    focused.current = true; void refreshVisibleProtection.current();
    return () => {
      focused.current = false; protectionRead.current?.controller.abort(); protectionRead.current = null; setLoadingProtection(false);
    };
  }, []));

  const authorizeDeletion = async () => {
    if (!client || !user || !canManage || authorizing || confirmation !== repo.full_name) return;
    if (authorization.current && !authorization.current.signal.aborted) return;
    const current = generation.current;
    const controller = new AbortController(); authorization.current = controller;
    setAuthorizing(true); setError('');
    try {
      const code = await requestDeletionDeviceCode(controller.signal);
      if (controller.signal.aborted || current !== generation.current) return;
      setFlow(code);
      const credential = await awaitDeviceAuthorization(code, controller.signal);
      const temporary = new GitHubClient(async () => credential.accessToken);
      const account = await temporary.user(controller.signal);
      assertDeletionAccount(user.login, account.login);
      if (controller.signal.aborted || current !== generation.current) return;
      deletion.current = { client: temporary, repoId: repo.id, login: account.login, expiresAt: Math.min(credential.expiresAt ?? Infinity, Date.now() + 5 * 60_000) };
      setAuthorized(true); setFlow(null); setConfirmation('');
    } catch (cause) { if (!controller.signal.aborted && current === generation.current) { setFlow(null); setError(repositoryErrorMessage(cause, t)); } }
    finally { if (authorization.current === controller) authorization.current = null; if (!controller.signal.aborted && current === generation.current) setAuthorizing(false); }
  };

  const apply = async () => {
    if (!action || !client || !canManage || applying.current || authorizing || confirmation !== expected) return;
    if (action === 'delete' && !authorized) { await authorizeDeletion(); return; }
    const current = generation.current;
    applying.current = true; setBusy(true); setError('');
    try {
      let operationClient = client;
      if (action === 'delete') {
        const token = deletion.current; deletion.current = null; setAuthorized(false);
        if (!token || token.repoId !== repo.id || token.login.toLowerCase() !== user?.login.toLowerCase() || token.expiresAt <= Date.now()) {
          setConfirmation(''); requireDeletionAuthorization(false); return;
        }
        operationClient = token.client;
      }
      const result = await applyRepositorySetting(operationClient, repo, { action, confirmation, publicMode, targetOwner, protection });
      if (current !== generation.current) return;
      if (action === 'visibility' || action === 'archive') onUpdate(result as GitHubRepo);
      else if (action === 'protection') setProtection(result as ProtectionState);
      setAction(null);
      AppAlert.alert(t('操作完成', 'Done'), action === 'transfer' ? t('转移请求已提交，对方可能需要在 GitHub 接受。', 'Transfer requested. The new owner may need to accept on GitHub.') : action === 'delete' ? t('项目已从 GitHub 删除。', 'Project deleted from GitHub.') : action === 'protection' ? (result as ProtectionState).enabled ? t('默认分支保护已开启。', 'Default branch protection enabled.') : t('默认分支保护已移除。', 'Default branch protection removed.') : action === 'archive' ? (result as GitHubRepo).archived ? t('项目已存档。', 'Project archived.') : t('项目已取消存档。', 'Project unarchived.') : t('项目可见性已更新。', 'Project visibility updated.'));
      if (action === 'transfer' || action === 'delete') onRemoved();
    } catch (cause) { if (current === generation.current) setError(repositoryErrorMessage(cause, t)); }
    finally { applying.current = false; if (current === generation.current) setBusy(false); }
  };

  const settingHandlers = {
    visibility: () => { void openSetting('visibility'); },
    protection: () => { void openSetting('protection'); },
    transfer: () => { void openSetting('transfer'); },
    archive: () => { void openSetting('archive'); },
    delete: () => { void openSetting('delete'); },
  };

  if (!canManage) return <Card><Text style={{ color: palette.muted }}>{publicMode ? t('公开浏览模式下，原项目为只读。', 'The original project is read-only in public browsing mode.') : t('只有项目管理员可以更改这些设置。', 'Only project administrators can change these settings.')}</Text></Card>;
  return <View>
    <Card>
      <Text style={{ color: palette.ink, fontSize: 21, fontWeight: '800' }}>{t('项目设置', 'Project settings')}</Text>
      <Text style={{ color: palette.muted, marginTop: 10, lineHeight: 22 }}>{repo.full_name} · {t('这些操作会改变项目的访问或管理方式。', 'These actions change project access or management.')}</Text>
    </Card>
    {!action && rows.map((row) => <Card key={row.id}>
      <Text style={{ color: row.id === 'delete' ? '#bf3947' : palette.ink, fontWeight: '800', fontSize: 17 }}>{row.title}</Text>
      <Text style={{ color: palette.muted, lineHeight: 22, marginVertical: 12 }}>{row.description}</Text>
      <Action title={row.button} secondary disabled={row.disabled || busy} onPress={settingHandlers[row.id]} />
    </Card>)}
    {action && selected && <Card style={{ borderColor: '#e9b7bf' }}>
      <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 20 }}>{selected.title}</Text>
      <Text style={{ color: palette.muted, lineHeight: 22, marginVertical: 14 }}>{action === 'visibility' ? repo.private ? t('所有人都将能看到这个项目及其内容。', 'Everyone will be able to see this project and its contents.') : t('只有获得授权的人能看到这个项目。', 'Only authorized people will be able to see this project.') : action === 'delete' ? t('项目、历史版本和问题将从 GitHub 永久删除。此操作无法撤销。', 'The project, history and issues will be permanently deleted from GitHub. This cannot be undone.') : selected.description}</Text>
      {action === 'protection' && <View style={{ marginBottom: 14 }}>
        {loadingProtection ? <Loading /> : protection?.externalRules ? <Text style={{ color: '#bf3947', lineHeight: 22 }}>{t('默认分支受到其他规则保护。请前往 GitHub 管理这些规则。', 'Other rules protect this branch. Manage those rules on GitHub.')}</Text> : protection ? <Text style={{ color: palette.muted, lineHeight: 22 }}>{protection.enabled ? t(`默认分支 ${protection.branch} 已保护。移除会撤销当前的旧版保护规则。`, `Default branch ${protection.branch} is protected. Removing protection revokes its current legacy rule.`) : t(`默认分支 ${protection.branch} 未保护。开启后合入修改需要一人批准。`, `Default branch ${protection.branch} is unprotected. Enabling protection requires one approval before merging.`)}</Text> : null}
      </View>}
      {action === 'transfer' && <View style={{ gap: 8, marginBottom: 15 }}>
        <Text style={{ color: palette.ink, fontWeight: '700' }}>{t('新所有者', 'New owner')}</Text>
        <TextInput accessibilityLabel={t('新所有者', 'New owner')} value={targetOwner} onChangeText={setTargetOwner} maxLength={39} autoCorrect={false} autoCapitalize="none" editable={!busy} placeholder={t('GitHub 用户名或组织名', 'GitHub username or organization')} style={fieldStyle} />
      </View>}
      {authorized && <Text style={{ color: palette.green, lineHeight: 22, marginBottom: 14 }}>{t('删除权限已授权。请再次输入完整项目名称并确认删除。', 'Deletion authorized. Enter the full project name again and confirm deletion.')}</Text>}
      <Text style={{ color: palette.ink, fontWeight: '700', marginBottom: 8 }}>{t('输入项目名称以确认', 'Type the project name to confirm')}: {expected}</Text>
      <TextInput accessibilityLabel={t('确认项目名称', 'Confirm project name')} value={confirmation} onChangeText={setConfirmation} autoCorrect={false} autoCapitalize="none" editable={!busy && !authorizing} style={fieldStyle} />
      {flow && <View style={{ gap: 12, marginTop: 16 }}>
        <Text selectable style={{ color: palette.ink, fontSize: 20, fontWeight: '800' }}>{flow.user_code}</Text>
        <Text style={{ color: palette.muted, lineHeight: 22 }}>{t('在 GitHub 输入以上验证码，授权删除权限。完成后仍需再次确认删除。', 'Enter this code on GitHub to authorize deletion. You must confirm deletion again afterward.')}</Text>
        <Action title={t('打开 GitHub 授权页面', 'Open GitHub authorization')} secondary onPress={() => { void Linking.openURL(flow.verification_uri); }} />
      </View>}
      {authorizing && <Text style={{ color: palette.muted, marginTop: 14 }}>{t('正在等待 GitHub 授权…', 'Waiting for GitHub authorization…')}</Text>}
      {!!error && <Text accessibilityRole="alert" style={{ color: '#bf3947', lineHeight: 22, marginTop: 15 }}>{error}</Text>}
      <View style={{ gap: 10, marginTop: 18 }}>
        <Action title={busy ? t('正在处理…', 'Working…') : action === 'delete' && !authorized ? t('授权删除权限', 'Authorize deletion') : actionButton} disabled={busy || authorizing || confirmation !== expected || (action === 'transfer' && !targetOwner.trim()) || (action === 'protection' && (loadingProtection || !!error || !protection || protection.externalRules))} onPress={() => { void apply(); }} />
        {action === 'protection' && !!error && <Action title={t('重新读取保护规则', 'Reload protection rules')} secondary disabled={busy || loadingProtection} onPress={() => { void refreshProtection(); }} />}
        <Action title={t('取消', 'Cancel')} secondary disabled={busy} onPress={close} />
      </View>
    </Card>}
  </View>;
}
