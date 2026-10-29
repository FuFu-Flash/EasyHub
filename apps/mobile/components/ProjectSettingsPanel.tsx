import { useTranslation } from "@/features/localization/react";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import type { RefreshHandle } from "@/features/github/usePullRefresh";
import * as Linking from "expo-linking";
import { GitHubClient, type GitHubRepo } from "@easyhub/github";
import { useSession } from "@/features/auth/session";

import { awaitDeviceAuthorization, requestDeletionDeviceCode, type DeviceCode } from "@/features/auth/deviceFlow";
import {
  applyRepositorySetting,
  assertDeletionAccount,
  canManageRepository,
  loadProtectionState,
  repositoryErrorMessage,
  requireDeletionAuthorization,
  settingConfirmation,
  type ProtectionState,
  type RepositorySettingAction,
} from "@/features/github/repositoryOperations";
import { AppAlert } from "./AppAlert";
import { Action, Card, Loading, palette } from "./elements";
import { usePageFeedback } from "@/features/workspace/usePageFeedback";
import { themed } from "@/features/theme/theme";

const fieldStyle = {
  borderWidth: 1,
  borderRadius: 12,
  padding: 13,
  get borderColor() {
    return palette.border;
  },
  get color() {
    return palette.ink;
  },
  get backgroundColor() {
    return themed("#fff");
  },
};

export function ProjectSettingsPanel({
  repo,
  publicMode = false,
  active = true,
  onUpdate,
  onRemoved,
  ref,
}: {
  ref?: Ref<RefreshHandle>;
  repo: GitHubRepo;
  publicMode?: boolean;
  active?: boolean;
  onUpdate: (repo: GitHubRepo) => void;
  onRemoved: () => void;
}) {
  const { client, user } = useSession();
  const t = useTranslation();
  const [action, setAction] = useState<RepositorySettingAction | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [targetOwner, setTargetOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const { value: error, set: setError, capture } = usePageFeedback("", active);
  const visible = useRef(active);
  useLayoutEffect(() => {
    visible.current = active;
  }, [active]);
  const [completed, setCompleted] = useState<{
    action: RepositorySettingAction;
    result: GitHubRepo | ProtectionState | null;
  } | null>(null);
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
  const protectionRead = useRef<{
    client: GitHubClient;
    scope: string;
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);
  const canManage = canManageRepository(repo, user?.login, publicMode);

  useEffect(
    () => () => {
      generation.current++;
      authorization.current?.abort();
      deletion.current = null;
      protectionRead.current?.controller.abort();
      protectionRead.current = null;
    },
    [repo.id, repo.full_name, client],
  );

  const rows: {
    id: RepositorySettingAction;
    title: string;
    description: string;
    button: string;
    disabled?: boolean;
  }[] = [
    {
      id: "visibility",
      title: t("ProjectSettingsPanel.changeVisibility"),
      description: repo.private
        ? t("ProjectSettingsPanel.onlyAuthorizedPeopleCanSeeThisProject")
        : t("ProjectSettingsPanel.thisProjectIsCurrentlyPublic"),
      button: t("ProjectSettingsPanel.changeVisibilitybaa7a191"),
      disabled: repo.archived,
    },
    {
      id: "protection",
      title: t("ProjectSettingsPanel.branchProtectionRules"),
      description: t("ProjectSettingsPanel.viewAndManageDefaultBranchProtection"),
      button: t("ProjectSettingsPanel.manageRules"),
      disabled: repo.archived,
    },
    {
      id: "transfer",
      title: t("ProjectSettingsPanel.transferOwnership"),
      description: t("ProjectSettingsPanel.transferToAnotherUserOrOrganizationTheyMayNeedToAccept"),
      button: t("ProjectSettingsPanel.transferProject"),
      disabled: repo.archived,
    },
    {
      id: "archive",
      title: repo.archived ? t("ProjectSettingsPanel.unarchiveProject") : t("ProjectSettingsPanel.archiveProject"),
      description: repo.archived
        ? t("ProjectSettingsPanel.unarchiveToMakeChangesAgain")
        : t("ProjectSettingsPanel.archivingMakesTheProjectReadOnlyYouCanUnarchiveItLater"),
      button: repo.archived ? t("ProjectSettingsPanel.unarchive") : t("ProjectSettingsPanel.archiveProject"),
    },
    {
      id: "delete",
      title: t("ProjectSettingsPanel.deleteProject"),
      description: t("ProjectSettingsPanel.permanentlyDeleteTheProjectHistoryAndIssuesOnGitHub"),
      button: t("ProjectSettingsPanel.deleteProject"),
    },
  ];
  const selected = rows.find((row) => row.id === action);
  const expected = action ? settingConfirmation(repo, action) : "";
  const actionButton =
    action === "protection"
      ? protection?.enabled
        ? t("ProjectSettingsPanel.removeDefaultBranchProtection")
        : t("ProjectSettingsPanel.protectDefaultBranch")
      : (selected?.button ?? "");

  const close = () => {
    if (applying.current) return;
    generation.current++;
    authorization.current?.abort();
    deletion.current = null;
    protectionRead.current?.controller.abort();
    protectionRead.current = null;
    setLoadingProtection(false);
    setAction(null);
    setFlow(null);
    setAuthorized(false);
    setAuthorizing(false);
    setError("");
  };
  const readProtection = useCallback(() => {
    if (!visible.current || !client || !focused.current) return Promise.resolve();
    const scope = `${repo.id}/${repo.full_name}/${repo.default_branch}`;
    const previous = protectionRead.current;
    if (previous?.client === client && previous.scope === scope) return previous.promise;
    previous?.controller.abort();
    protectionRead.current = null;
    const current = generation.current;
    const currentVisit = capture();
    const controller = new AbortController();
    const request = { client, scope, controller, promise: Promise.resolve() };
    const active = () =>
      visible.current &&
      focused.current &&
      !controller.signal.aborted &&
      protectionRead.current === request &&
      current === generation.current;
    setLoadingProtection(true);
    setError("");
    request.promise = client
      .repo(repo.owner.login, repo.name, controller.signal)
      .then(async (details) => {
        if (!active()) return;
        if (
          details.id !== repo.id ||
          details.full_name !== repo.full_name ||
          !canManageRepository(details, user?.login, publicMode)
        )
          throw new Error("Changed");
        const state = await loadProtectionState(client, details, controller.signal);
        if (active()) setProtection(state);
      })
      .catch((cause) => {
        if (active() && currentVisit()) setError(repositoryErrorMessage(cause, t));
      })
      .finally(() => {
        if (active()) setLoadingProtection(false);
        if (protectionRead.current === request) protectionRead.current = null;
      });
    protectionRead.current = request;
    return request.promise;
  }, [client, repo, user, publicMode, t, setError, capture]);
  const openSetting = useCallback(
    async (next: RepositorySettingAction) => {
      if (!visible.current || !focused.current || !canManage || !client || applying.current) return;
      generation.current++;
      authorization.current?.abort();
      deletion.current = null;
      protectionRead.current?.controller.abort();
      protectionRead.current = null;
      setLoadingProtection(false);
      setAction(next);
      setConfirmation("");
      setTargetOwner("");
      setError("");
      setFlow(null);
      setAuthorized(false);
      setAuthorizing(false);
      setProtection(null);
      setCompleted(null);
      if (next === "protection") await readProtection();
    },
    [canManage, client, readProtection, setError],
  );
  const refreshProtection = useCallback(() => {
    if (!canManage || action !== "protection" || applying.current || authorizing) return Promise.resolve();
    return readProtection();
  }, [canManage, action, authorizing, readProtection]);
  useImperativeHandle(ref, () => ({ refresh: refreshProtection }), [refreshProtection]);
  const refreshVisibleProtection = useRef(refreshProtection);
  useEffect(() => {
    refreshVisibleProtection.current = refreshProtection;
  }, [refreshProtection]);
  useFocusEffect(
    useCallback(() => {
      focused.current = active;
      if (active) void refreshVisibleProtection.current();
      return () => {
        focused.current = false;
        protectionRead.current?.controller.abort();
        protectionRead.current = null;
        setLoadingProtection(false);
        authorization.current?.abort();
        authorization.current = null;
        deletion.current = null;
        setFlow(null);
        setAuthorized(false);
        setAuthorizing(false);
      };
    }, [active]),
  );

  const authorizeDeletion = async () => {
    if (
      !visible.current ||
      !focused.current ||
      !client ||
      !user ||
      !canManage ||
      authorizing ||
      confirmation !== repo.full_name
    )
      return;
    if (authorization.current && !authorization.current.signal.aborted) return;
    const current = generation.current;
    const currentVisit = capture();
    const controller = new AbortController();
    authorization.current = controller;
    setAuthorizing(true);
    setError("");
    try {
      const code = await requestDeletionDeviceCode(controller.signal);
      if (controller.signal.aborted || current !== generation.current) return;
      setFlow(code);
      const credential = await awaitDeviceAuthorization(code, controller.signal);
      if (controller.signal.aborted || current !== generation.current || !visible.current || !focused.current) return;
      const temporary = new GitHubClient(async () => credential.accessToken);
      const account = await temporary.user(controller.signal);
      assertDeletionAccount(user.login, account.login);
      if (controller.signal.aborted || current !== generation.current) return;
      deletion.current = {
        client: temporary,
        repoId: repo.id,
        login: account.login,
        expiresAt: Math.min(credential.expiresAt ?? Infinity, Date.now() + 5 * 60_000),
      };
      setAuthorized(true);
      setFlow(null);
      setConfirmation("");
    } catch (cause) {
      if (!controller.signal.aborted && current === generation.current) {
        setFlow(null);
        if (currentVisit()) setError(repositoryErrorMessage(cause, t));
      }
    } finally {
      if (authorization.current === controller) authorization.current = null;
      if (!controller.signal.aborted && current === generation.current) setAuthorizing(false);
    }
  };

  const apply = async () => {
    if (
      !visible.current ||
      !focused.current ||
      !action ||
      !client ||
      !canManage ||
      applying.current ||
      authorizing ||
      confirmation !== expected
    )
      return;
    if (action === "delete" && !authorized) {
      await authorizeDeletion();
      return;
    }
    const current = generation.current;
    const currentVisit = capture();
    applying.current = true;
    setBusy(true);
    setError("");
    try {
      let operationClient = client;
      if (action === "delete") {
        const token = deletion.current;
        deletion.current = null;
        setAuthorized(false);
        if (
          !token ||
          token.repoId !== repo.id ||
          token.login.toLowerCase() !== user?.login.toLowerCase() ||
          token.expiresAt <= Date.now()
        ) {
          setConfirmation("");
          requireDeletionAuthorization(false);
          return;
        }
        operationClient = token.client;
      }
      const result = await applyRepositorySetting(operationClient, repo, {
        action,
        confirmation,
        publicMode,
        targetOwner,
        protection,
      });
      if (current !== generation.current) return;
      if (action === "visibility" || action === "archive") onUpdate(result as GitHubRepo);
      else if (action === "protection") setProtection(result as ProtectionState);
      setCompleted({ action, result: result as GitHubRepo | ProtectionState | null });
      setAction(null);
      if (currentVisit()) {
        AppAlert.alert(
          t("ProjectSettingsPanel.done"),
          action === "transfer"
            ? t("ProjectSettingsPanel.transferRequestedTheNewOwnerMayNeedToAcceptOnGitHub")
            : action === "delete"
              ? t("ProjectSettingsPanel.projectDeletedFromGitHub")
              : action === "protection"
                ? (result as ProtectionState).enabled
                  ? t("ProjectSettingsPanel.defaultBranchProtectionEnabled")
                  : t("ProjectSettingsPanel.defaultBranchProtectionRemoved")
                : action === "archive"
                  ? (result as GitHubRepo).archived
                    ? t("ProjectSettingsPanel.projectArchived")
                    : t("ProjectSettingsPanel.projectUnarchived")
                  : t("ProjectSettingsPanel.projectVisibilityUpdated"),
        );
        if (action === "transfer" || action === "delete") onRemoved();
      }
    } catch (cause) {
      if (currentVisit() && current === generation.current) setError(repositoryErrorMessage(cause, t));
    } finally {
      applying.current = false;
      if (current === generation.current) setBusy(false);
    }
  };

  const settingHandlers = {
    visibility: () => {
      void openSetting("visibility");
    },
    protection: () => {
      void openSetting("protection");
    },
    transfer: () => {
      void openSetting("transfer");
    },
    archive: () => {
      void openSetting("archive");
    },
    delete: () => {
      void openSetting("delete");
    },
  };

  const completedMessage =
    completed?.action === "transfer"
      ? t("ProjectSettingsPanel.transferRequestedTheNewOwnerMayNeedToAcceptOnGitHub")
      : completed?.action === "delete"
        ? t("ProjectSettingsPanel.projectDeletedFromGitHub")
        : completed?.action === "protection"
          ? (completed.result as ProtectionState).enabled
            ? t("ProjectSettingsPanel.defaultBranchProtectionEnabled")
            : t("ProjectSettingsPanel.defaultBranchProtectionRemoved")
          : completed?.action === "archive"
            ? (completed.result as GitHubRepo).archived
              ? t("ProjectSettingsPanel.projectArchived")
              : t("ProjectSettingsPanel.projectUnarchived")
            : completed
              ? t("ProjectSettingsPanel.projectVisibilityUpdated")
              : "";

  if (!canManage)
    return (
      <Card>
        <Text style={{ color: palette.muted }}>
          {publicMode
            ? t("ProjectSettingsPanel.theOriginalProjectIsReadOnlyInPublicBrowsingMode")
            : t("ProjectSettingsPanel.onlyProjectAdministratorsCanChangeTheseSettings")}
        </Text>
      </Card>
    );
  return (
    <View>
      {!!completedMessage && (
        <Card>
          <Text accessibilityLiveRegion="polite" style={{ color: palette.green, lineHeight: 22 }}>
            {completedMessage}
          </Text>
        </Card>
      )}
      <Card>
        <Text style={{ color: palette.ink, fontSize: 21, fontWeight: "800" }}>
          {t("ProjectSettingsPanel.projectSettings")}
        </Text>
        <Text style={{ color: palette.muted, marginTop: 10, lineHeight: 22 }}>
          {repo.full_name} · {t("ProjectSettingsPanel.theseActionsChangeProjectAccessOrManagement")}
        </Text>
      </Card>
      {!action &&
        rows.map((row) => (
          <Card key={row.id}>
            <Text
              style={{ color: row.id === "delete" ? themed("#bf3947") : palette.ink, fontWeight: "800", fontSize: 17 }}
            >
              {row.title}
            </Text>
            <Text style={{ color: palette.muted, lineHeight: 22, marginVertical: 12 }}>{row.description}</Text>
            <Action title={row.button} secondary disabled={row.disabled || busy} onPress={settingHandlers[row.id]} />
          </Card>
        ))}
      {action && selected && (
        <Card style={{ borderColor: themed("#e9b7bf") }}>
          <Text style={{ color: palette.ink, fontWeight: "800", fontSize: 20 }}>{selected.title}</Text>
          <Text style={{ color: palette.muted, lineHeight: 22, marginVertical: 14 }}>
            {action === "visibility"
              ? repo.private
                ? t("ProjectSettingsPanel.everyoneWillBeAbleToSeeThisProjectAndItsContents")
                : t("ProjectSettingsPanel.onlyAuthorizedPeopleWillBeAbleToSeeThisProject")
              : action === "delete"
                ? t("ProjectSettingsPanel.theProjectHistoryAndIssuesWillBePermanentlyDeletedFromGitHub")
                : selected.description}
          </Text>
          {action === "protection" && (
            <View style={{ marginBottom: 14 }}>
              {loadingProtection ? (
                <Loading />
              ) : protection?.externalRules ? (
                <Text style={{ color: themed("#bf3947"), lineHeight: 22 }}>
                  {t("ProjectSettingsPanel.otherRulesProtectThisBranchManageThoseRulesOnGitHub")}
                </Text>
              ) : protection ? (
                <Text style={{ color: palette.muted, lineHeight: 22 }}>
                  {protection.enabled
                    ? t("ProjectSettingsPanel.defaultBranchIsProtectedRemovingProtectionRevokesItsCurrentLegacyRule", {
                        p0: protection.branch,
                      })
                    : t(
                        "ProjectSettingsPanel.defaultBranchIsUnprotectedEnablingProtectionRequiresOneApprovalBeforeMerging",
                        { p0: protection.branch },
                      )}
                </Text>
              ) : null}
            </View>
          )}
          {action === "transfer" && (
            <View style={{ gap: 8, marginBottom: 15 }}>
              <Text style={{ color: palette.ink, fontWeight: "700" }}>{t("ProjectSettingsPanel.newOwner")}</Text>
              <TextInput
                placeholderTextColor={palette.muted}
                accessibilityLabel={t("ProjectSettingsPanel.newOwner")}
                value={targetOwner}
                onChangeText={setTargetOwner}
                maxLength={39}
                autoCorrect={false}
                autoCapitalize="none"
                editable={!busy}
                placeholder={t("ProjectSettingsPanel.githubUsernameOrOrganization")}
                style={fieldStyle}
              />
            </View>
          )}
          {authorized && (
            <Text style={{ color: palette.green, lineHeight: 22, marginBottom: 14 }}>
              {t("ProjectSettingsPanel.deletionAuthorizedEnterTheFullProjectNameAgainAndConfirmDeletion")}
            </Text>
          )}
          <Text style={{ color: palette.ink, fontWeight: "700", marginBottom: 8 }}>
            {t("ProjectSettingsPanel.typeTheProjectNameToConfirm")}: {expected}
          </Text>
          <TextInput
            placeholderTextColor={palette.muted}
            accessibilityLabel={t("ProjectSettingsPanel.confirmProjectName")}
            value={confirmation}
            onChangeText={setConfirmation}
            autoCorrect={false}
            autoCapitalize="none"
            editable={!busy && !authorizing}
            style={fieldStyle}
          />
          {flow && (
            <View style={{ gap: 12, marginTop: 16 }}>
              <Text selectable style={{ color: palette.ink, fontSize: 20, fontWeight: "800" }}>
                {flow.user_code}
              </Text>
              <Text style={{ color: palette.muted, lineHeight: 22 }}>
                {t("ProjectSettingsPanel.enterThisCodeOnGitHubToAuthorizeDeletionYouMustConfirm")}
              </Text>
              <Action
                title={t("ProjectSettingsPanel.openGitHubAuthorization")}
                secondary
                onPress={() => {
                  void Linking.openURL(flow.verification_uri);
                }}
              />
            </View>
          )}
          {authorizing && (
            <Text style={{ color: palette.muted, marginTop: 14 }}>
              {t("ProjectSettingsPanel.waitingForGitHubAuthorization")}
            </Text>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={{ color: themed("#bf3947"), lineHeight: 22, marginTop: 15 }}>
              {error}
            </Text>
          )}
          <View style={{ gap: 10, marginTop: 18 }}>
            <Action
              title={
                busy
                  ? t("AiReviewSettings.working")
                  : action === "delete" && !authorized
                    ? t("ProjectSettingsPanel.authorizeDeletion")
                    : actionButton
              }
              disabled={
                busy ||
                authorizing ||
                confirmation !== expected ||
                (action === "transfer" && !targetOwner.trim()) ||
                (action === "protection" && (loadingProtection || !!error || !protection || protection.externalRules))
              }
              onPress={() => {
                void apply();
              }}
            />
            {action === "protection" && !!error && (
              <Action
                title={t("ProjectSettingsPanel.reloadProtectionRules")}
                secondary
                disabled={busy || loadingProtection}
                onPress={() => {
                  void refreshProtection();
                }}
              />
            )}
            <Action title={t("AiReviewSettings.cancel")} secondary disabled={busy} onPress={close} />
          </View>
        </Card>
      )}
    </View>
  );
}
