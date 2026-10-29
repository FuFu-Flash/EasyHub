import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useSession } from "@/features/auth/session";
import { useTranslation } from "@/features/localization/react";
import { themed, onAccent } from "@/features/theme/theme";

// This leaf also appears inside Page, so it must not import elements.tsx.
const colors = {
  get ink() {
    return themed("#18263e");
  },
  get muted() {
    return themed("#60718b");
  },
  get blue() {
    return themed("#2477ed");
  },
  get border() {
    return themed("#d8e5f8");
  },
};

function ConnectionAction({
  title,
  onPress,
  primary = false,
  disabled = false,
}: {
  title: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 48,
        minWidth: 0,
        maxWidth: "100%",
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        justifyContent: "center",
        alignItems: "center",
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: primary ? (disabled ? themed("#91b7eb") : colors.blue) : themed("#fff"),
      }}
    >
      <Text
        style={{
          color: primary ? onAccent : colors.ink,
          fontSize: 15,
          lineHeight: 21,
          textAlign: "center",
          fontWeight: "700",
          flexShrink: 1,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/** Connection state is persistent, unlike the short-lived result of a page operation. */
export function SessionConnectionNotice({ full = false }: { full?: boolean }) {
  const { recovery, user, retrying, retrySession } = useSession();
  const t = useTranslation();
  const pathname = usePathname();
  const [settingsFailed, setSettingsFailed] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    queueMicrotask(() => {
      if (generation.current === current) setSettingsFailed(false);
    });
    return () => {
      generation.current += 1;
    };
  }, [t, pathname]);
  if (!recovery || (!full && !user)) return null;
  const title =
    recovery === "offline"
      ? full
        ? t("sessionRecovery.offlineTitle")
        : t("sessionRecovery.connectionNotice")
      : recovery === "forbidden"
        ? t("sessionRecovery.forbiddenTitle")
        : recovery === "expired"
          ? t("sessionRecovery.expiredTitle")
          : t("sessionRecovery.storageTitle");
  const help =
    recovery === "offline"
      ? user
        ? t("sessionRecovery.offlineSaved")
        : t("sessionRecovery.offlineNoProfile")
      : recovery === "forbidden"
        ? t("sessionRecovery.forbiddenHelp")
        : recovery === "expired"
          ? t("sessionRecovery.expiredHelp")
          : t("sessionRecovery.storageHelp");
  const openNetworkSettings = async () => {
    const current = generation.current;
    setSettingsFailed(false);
    try {
      if (Platform.OS === "android") await Linking.sendIntent("android.settings.WIRELESS_SETTINGS");
      else await Linking.openSettings();
    } catch {
      if (generation.current === current) setSettingsFailed(true);
    }
  };
  return (
    <View
      style={{
        minWidth: 0,
        padding: full ? 0 : 16,
        marginBottom: full ? 0 : 18,
        borderWidth: full ? 0 : 1,
        borderColor: colors.border,
        borderRadius: 16,
        backgroundColor: full ? "transparent" : themed("#edf4ff"),
        gap: 12,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ color: colors.ink, fontSize: full ? 27 : 17, lineHeight: full ? 36 : 24, fontWeight: "800" }}
      >
        {title}
      </Text>
      {!!user && (
        <Text style={{ color: colors.ink, fontSize: 14, lineHeight: 21 }}>
          {t("sessionRecovery.savedAccount", { login: user.login })}
        </Text>
      )}
      <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>{help}</Text>
      {retrying && (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t("sessionRecovery.retrying")}
          style={{ alignItems: "center", padding: 4 }}
        >
          <ActivityIndicator color={colors.blue} />
        </View>
      )}
      <ConnectionAction
        title={retrying ? t("sessionRecovery.retrying") : t("sessionRecovery.retry")}
        disabled={retrying}
        primary={recovery !== "expired"}
        onPress={() => {
          void retrySession();
        }}
      />
      {pathname !== "/login" && (
        <ConnectionAction
          title={t("sessionRecovery.signIn")}
          primary={recovery === "expired"}
          disabled={retrying}
          onPress={() => router.push("/login")}
        />
      )}
      {full && (
        <>
          <ConnectionAction
            title={t("sessionRecovery.networkSettings")}
            onPress={() => {
              void openNetworkSettings();
            }}
          />
          <ConnectionAction
            title={t("sessionRecovery.easyhubSettings")}
            onPress={() => router.push("/(tabs)/settings")}
          />
        </>
      )}
      {settingsFailed && (
        <Text accessibilityRole="alert" style={{ color: themed("#bf3947"), lineHeight: 22 }}>
          {t("sessionRecovery.networkSettingsFailed")}
        </Text>
      )}
    </View>
  );
}
