import { localizeError } from "../features/localization/error.ts";
import { useTranslation } from "@/features/localization/react";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { AppAlert as Alert } from "./AppAlert";

import { AI_PROVIDERS, testAiConnection, type AiProviderId } from "@/features/ai/review";
import { clearAiSettings, loadAiSettings, saveAiSettings } from "@/features/ai/settings";
import { Action, Card, palette } from "./elements";
import { MaterialArrow } from "./MaterialArrow";
import { FeedbackNotice } from "./FeedbackNotice";
import { useSuccessNotice } from "@/features/workspace/useSuccessNotice";
import { usePageFeedback } from "@/features/workspace/usePageFeedback";
import { themed } from "@/features/theme/theme";

export function AiReviewSettings() {
  const t = useTranslation();
  const { capture } = usePageFeedback();
  const { value: notice, set: setNotice, dismiss: dismissNotice } = useSuccessNotice();
  const [providerId, setProviderId] = useState<AiProviderId>("openai");
  const [model, setModel] = useState<string>(AI_PROVIDERS[0].defaultModel);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [savedProvider, setSavedProvider] = useState<AiProviderId | null>(null);
  const [savedModel, setSavedModel] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [modelExpanded, setModelExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void loadAiSettings()
      .then((saved) => {
        if (!active || !saved) return;
        setProviderId(saved.providerId);
        setSavedProvider(saved.providerId);
        setModel(saved.model);
        setSavedModel(saved.model);
        setHasKey(true);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const locked = busy || loading;
  const edited = hasKey && (providerId !== savedProvider || model.trim() !== savedModel || apiKey.length > 0);
  const toggleExpanded = () => {
    if (locked) return;
    if (expanded) {
      setProviderId(savedProvider ?? "openai");
      setModel(savedModel ?? AI_PROVIDERS[0].defaultModel);
      setApiKey("");
      setModelExpanded(false);
    }
    setExpanded((value) => !value);
  };
  const save = async (selectedModel = model) => {
    if (locked) return;
    setBusy(true);
    setNotice("");
    const current = capture();
    try {
      const previous = await loadAiSettings();
      const key = apiKey.trim() || (previous?.providerId === providerId ? previous.apiKey : "");
      await saveAiSettings({ providerId, model: selectedModel.trim(), apiKey: key });
      setSavedProvider(providerId);
      setSavedModel(selectedModel.trim());
      setModel(selectedModel.trim());
      setHasKey(true);
      setApiKey("");
      setExpanded(false);
      setModelExpanded(false);
      if (current()) setNotice(t("AiReviewSettings.aiSettingsSaved"));
    } catch (reason) {
      if (current())
        Alert.alert(
          t("AiReviewSettings.couldNotSaveSettings"),
          localizeError(reason, t, t("AiReviewSettings.pleaseTryAgain")),
        );
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    if (locked || edited) return;
    setBusy(true);
    setNotice("");
    const current = capture();
    try {
      const saved = await loadAiSettings();
      if (!saved) throw new Error(t("AiReviewSettings.saveAISettingsFirst"));
      if (saved.providerId !== providerId || saved.model !== model.trim())
        throw new Error(t("AiReviewSettings.aiSettingsChangedReopenSettings"));
      await testAiConnection(saved);
      if (current()) setNotice(t("AiReviewSettings.connectedAIReviewIsReady"));
    } catch (reason) {
      if (current())
        Alert.alert(
          t("AiReviewSettings.connectionFailed"),
          reason instanceof Error && reason.name !== "AbortError"
            ? localizeError(reason, t, t("AiReviewSettings.connectionTimedOutPleaseTryAgain"))
            : t("AiReviewSettings.connectionTimedOutPleaseTryAgain"),
        );
    } finally {
      setBusy(false);
    }
  };
  const forget = () =>
    Alert.alert(
      t("AiReviewSettings.removeAIAuthorization"),
      t("AiReviewSettings.theAPIKeySavedOnThisDeviceWillBeRemoved"),
      [
        { text: t("AiReviewSettings.cancel"), style: "cancel" },
        {
          text: t("AiReviewSettings.remove"),
          style: "destructive",
          onPress: () => {
            const current = capture();
            void clearAiSettings()
              .then(() => {
                setHasKey(false);
                setSavedProvider(null);
                setApiKey("");
              })
              .catch(() => {
                if (current()) Alert.alert(t("AiReviewSettings.couldNotRemoveAuthorization"));
              });
          },
        },
      ],
    );
  const chooseCompactModel = () => {
    if (locked || !savedProvider || !savedModel) return;
    const choices = [
      ...new Set([savedModel, AI_PROVIDERS.find((provider) => provider.id === savedProvider)!.defaultModel]),
    ];
    Alert.alert(t("AiReviewSettings.chooseModel"), undefined, [
      ...choices.map((choice) => ({
        text: choice,
        onPress: () => {
          void save(choice);
        },
      })),
      {
        text: t("AiReviewSettings.enterAnotherModel"),
        onPress: () => {
          setExpanded(true);
          setModelExpanded(true);
        },
      },
      { text: t("AiReviewSettings.cancel"), style: "cancel" },
    ]);
  };
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        disabled={locked}
        onPress={toggleExpanded}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: palette.ink, fontWeight: "800", fontSize: 18 }}>
            {t("AiReviewSettings.aiAPIAccess")}
          </Text>
          <Text style={{ color: palette.muted, marginTop: 6, lineHeight: 20 }}>
            {loading
              ? t("AiReviewSettings.loadingSettings")
              : hasKey
                ? t("AiReviewSettings.connectedManageAccess")
                : t("AiReviewSettings.setUpAnAIProvider")}
          </Text>
        </View>
        <MaterialArrow name={expanded ? "expandLess" : "expandMore"} />
      </Pressable>
      {!expanded && hasKey && (
        <View style={{ marginTop: 14 }}>
          <Text style={{ color: palette.muted, marginBottom: 6 }}>{t("AiReviewSettings.model")}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("AiReviewSettings.chooseModel")}: ${savedModel}`}
            disabled={locked}
            onPress={chooseCompactModel}
            style={{
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: 10,
              padding: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              minHeight: 48,
            }}
          >
            <Text numberOfLines={2} style={{ color: palette.ink, flex: 1 }}>
              {savedModel}
            </Text>
            <MaterialArrow name="expandMore" />
          </Pressable>
        </View>
      )}
      {expanded && (
        <>
          <Text style={{ color: palette.muted, marginTop: 12, lineHeight: 20 }}>
            {t("AiReviewSettings.useYourOwnAICredentialsToReviewProposedChangesAndProgram")}
          </Text>
          <Text style={{ color: palette.ink, fontWeight: "700", marginTop: 16, marginBottom: 9 }}>
            {t("AiReviewSettings.aiProvider")}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {AI_PROVIDERS.map((provider) => (
              <Pressable
                key={provider.id}
                disabled={locked}
                accessibilityRole="radio"
                accessibilityState={{ checked: providerId === provider.id }}
                onPress={() => {
                  if (providerId !== provider.id) {
                    setProviderId(provider.id);
                    setModel(provider.defaultModel);
                    setApiKey("");
                  }
                }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: providerId === provider.id ? palette.blue : palette.border,
                  backgroundColor: providerId === provider.id ? themed("#e7f0ff") : themed("#fff"),
                }}
              >
                <Text style={{ color: providerId === provider.id ? palette.blue : palette.ink, fontWeight: "700" }}>
                  {provider.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: palette.ink, fontWeight: "700", marginTop: 17, marginBottom: 7 }}>API Key</Text>
          <TextInput
            placeholderTextColor={palette.muted}
            value={apiKey}
            onChangeText={setApiKey}
            editable={!locked}
            maxLength={4096}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={
              hasKey && savedProvider === providerId
                ? t("AiReviewSettings.savedLeaveBlankToKeepIt")
                : t("AiReviewSettings.enterYourOwnAPIKey")
            }
            style={{
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: themed("#fff"),
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 11,
              color: palette.ink,
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: modelExpanded }}
            disabled={locked}
            onPress={() => setModelExpanded((value) => !value)}
            style={{
              marginTop: 17,
              paddingVertical: 12,
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <MaterialArrow name={modelExpanded ? "expandLess" : "expandMore"} color={palette.ink} />
            <Text style={{ color: palette.ink, fontWeight: "700", flexShrink: 1 }}>
              {t("AiReviewSettings.changeModelOptional")}
            </Text>
          </Pressable>
          {modelExpanded && (
            <View>
              <Text style={{ color: palette.muted, marginBottom: 7 }}>{t("AiReviewSettings.modelName")}</Text>
              <TextInput
                placeholderTextColor={palette.muted}
                value={model}
                onChangeText={setModel}
                editable={!locked}
                maxLength={200}
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  borderWidth: 1,
                  borderColor: palette.border,
                  backgroundColor: themed("#fff"),
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 11,
                  color: palette.ink,
                }}
              />
            </View>
          )}
          <View style={{ marginTop: 15, gap: 8 }}>
            <Action
              title={busy ? t("AiReviewSettings.working") : t("AiReviewSettings.saveAISettings")}
              disabled={locked || !model.trim() || (!apiKey.trim() && !(hasKey && savedProvider === providerId))}
              onPress={() => {
                void save();
              }}
            />
            <Action
              title={t("AiReviewSettings.testConnection")}
              secondary
              disabled={locked || !hasKey || edited}
              onPress={() => {
                void test();
              }}
            />
            {hasKey && (
              <Action title={t("AiReviewSettings.removeSavedAPIKey")} secondary disabled={locked} onPress={forget} />
            )}
          </View>
          {edited && (
            <Text style={{ color: palette.muted, marginTop: 10 }}>
              {t("AiReviewSettings.saveYourChangesBeforeTestingTheConnection")}
            </Text>
          )}
        </>
      )}
      {notice && <FeedbackNotice key={notice.id} notice={notice} onDismiss={dismissNotice} />}
    </Card>
  );
}
