import { useTranslation } from "@/features/localization/react";
import { useCallback, useRef, useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { AiCommitExplanationResult } from "@easyhub/types";
import Markdown from "react-native-markdown-display";
import { useSession } from "@/features/auth/session";
import { usePreferences } from "@/features/preferences/provider";
import { usePageFeedback } from "@/features/workspace/usePageFeedback";
import { loadAiSettings } from "@/features/ai/settings";
import { AI_PROVIDERS, type AiSettings } from "@/features/ai/review";
import { explainCommit } from "@/features/ai/commitExplanation";
import { Action, Card, ErrorText, Loading, palette } from "./elements";
import { AiReviewButton } from "./AiReviewButton";
import { themed, scrim } from "@/features/theme/theme";
import { markdownStyle } from "./markdownStyle";

export function CommitExplanation({
  owner,
  repo,
  sha,
  disabled,
  privateProject,
}: {
  owner: string;
  repo: string;
  sha: string;
  disabled: boolean;
  privateProject: boolean;
}) {
  const { client } = useSession();
  const { language } = usePreferences();
  const t = useTranslation();
  const feedback = usePageFeedback();
  const [consent, setConsent] = useState<AiSettings | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AiCommitExplanationResult | null>(null);
  const focused = useRef(false);
  const focusedLanguage = useRef(language);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const consentCurrent = useRef<(() => boolean) | null>(null);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      focusedLanguage.current = language;
      return () => {
        focused.current = false;
        generation.current++;
        request.current?.abort();
        request.current = null;
        consentCurrent.current = null;
        setConsent(null);
        setRunning(false);
        setPreparing(false);
      };
    }, [language]),
  );

  const prepare = async () => {
    if (disabled || !client || preparing || request.current || !focused.current || focusedLanguage.current !== language)
      return;
    const current = feedback.capture();
    const revision = ++generation.current;
    setPreparing(true);
    feedback.set("");
    try {
      const settings = await loadAiSettings();
      if (!current() || revision !== generation.current || !focused.current) return;
      if (!settings) {
        feedback.set(t("CommitExplanation.connectYourAIServiceInSettingsFirst"));
        return;
      }
      consentCurrent.current = current;
      setConsent(settings);
    } catch {
      if (current()) feedback.set(t("CommitExplanation.couldNotLoadAISettingsPleaseRetry"));
    } finally {
      if (revision === generation.current && focused.current) setPreparing(false);
    }
  };
  const start = async () => {
    const accepted = consent;
    const current = consentCurrent.current;
    if (!accepted || !current?.() || !client || request.current || !focused.current || disabled) return;
    const revision = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    setConsent(null);
    setRunning(true);
    feedback.set("");
    try {
      const settings = await loadAiSettings();
      if (!current() || controller.signal.aborted || revision !== generation.current) return;
      if (!settings || settings.providerId !== accepted.providerId || settings.model !== accepted.model)
        throw new Error(t("CommitExplanation.aiSettingsChangedConfirmAgain"));
      const provider = AI_PROVIDERS.find((item) => item.id === accepted.providerId)!;
      const next = await explainCommit({
        client,
        owner,
        repo,
        sha,
        settings,
        language,
        signal: controller.signal,
        consentToSend: true,
        providerBaseUrl: provider.baseUrl,
      });
      if (current() && revision === generation.current && !controller.signal.aborted) setResult(next);
    } catch {
      if (current() && revision === generation.current && !controller.signal.aborted)
        feedback.set(t("CommitExplanation.couldNotExplainTheseChangesCheckYourAIAuthorizationAndConnection"));
    } finally {
      if (request.current === controller) request.current = null;
      if (revision === generation.current && focused.current) setRunning(false);
    }
  };
  const cancel = () => {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setRunning(false);
  };
  const provider = consent ? AI_PROVIDERS.find((item) => item.id === consent.providerId) : null;
  return (
    <Card>
      <AiReviewButton
        title={result ? t("CommitExplanation.explainChangesAgain") : t("CommitExplanation.explainChanges")}
        disabled={disabled || preparing || running}
        onPress={() => {
          void prepare();
        }}
      />
      {preparing && <Loading />}
      {!!feedback.value && (
        <View style={{ marginTop: 12 }}>
          <ErrorText message={feedback.value} />
          <Action
            title={t("CommitExplanation.openAISettings")}
            secondary
            onPress={() => router.push("/(tabs)/settings")}
          />
        </View>
      )}
      {running && (
        <View style={{ gap: 10, marginTop: 12 }}>
          <Loading />
          <Text style={{ color: palette.muted }}>{t("CommitExplanation.explainingTheseChanges")}</Text>
          <Action title={t("CommitExplanation.cancelExplanation")} secondary onPress={cancel} />
        </View>
      )}
      {result && (
        <View style={{ marginTop: 14 }}>
          <Text style={{ color: palette.ink, fontWeight: "800", fontSize: 18 }}>
            {t("CommitExplanation.changeExplanation")}
          </Text>
          <Markdown style={markdownStyle()} onLinkPress={() => false} rules={{ image: () => null }}>
            {result.explanation}
          </Markdown>
          {result.partial && (
            <Text style={{ color: palette.muted, lineHeight: 21 }}>
              {t("CommitExplanation.thisExplanationCoversOnlySuppliedChangesSomeContentWasTooLarge")}
            </Text>
          )}
        </View>
      )}
      <Modal visible={!!consent} transparent animationType="fade" onRequestClose={() => setConsent(null)}>
        <View style={{ flex: 1, justifyContent: "center", backgroundColor: scrim(), padding: 22 }}>
          <View
            accessibilityViewIsModal
            style={{ maxHeight: "85%", backgroundColor: themed("#fff"), borderRadius: 20, padding: 22 }}
          >
            <ScrollView style={{ flexGrow: 0 }}>
              <Text style={{ color: palette.ink, fontSize: 22, fontWeight: "800" }}>
                {t("CommitExplanation.useAIToExplainTheseChanges")}
              </Text>
              <Text style={{ color: palette.muted, lineHeight: 22, marginTop: 12 }}>
                {t("CommitExplanation.thisCommitSMessageFilenamesAndCodeDiffsWillBeSent")}
              </Text>
              <Text selectable style={{ color: palette.ink, lineHeight: 23, marginTop: 14 }}>
                {provider?.name} · {consent?.model}
                {"\n"}
                {provider?.baseUrl}
                {"\n\n"}
                {owner}/{repo}
                {"\n"}
                {sha}
              </Text>
              {privateProject && (
                <Text style={{ color: themed("#996616"), lineHeight: 22, marginTop: 12 }}>
                  {t("CommitExplanation.thisIsAPrivateProjectConfirmThatYouWantToShare")}
                </Text>
              )}
              <Text style={{ color: palette.muted, lineHeight: 22, marginVertical: 14 }}>
                {t("CommitExplanation.yourProviderMayChargeForThisRequestTheExplanationCoversOnly")}
              </Text>
            </ScrollView>
            <View style={{ gap: 9 }}>
              <Action
                title={t("CommitExplanation.startExplanation")}
                onPress={() => {
                  void start();
                }}
              />
              <Action title={t("AiReviewSettings.cancel")} secondary onPress={() => setConsent(null)} />
            </View>
          </View>
        </View>
      </Modal>
    </Card>
  );
}
