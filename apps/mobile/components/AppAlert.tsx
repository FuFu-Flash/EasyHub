import { useTranslation } from "@/features/localization/react";
import { useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { palette } from "./elements";
import { usePreferences } from "@/features/preferences/provider";
import { usePathname } from "expo-router";
import { themed, onAccent, scrim } from "@/features/theme/theme";

type Button = { text?: string; onPress?: () => void; style?: "default" | "cancel" | "destructive" };
type Dialog = { title: string; message?: string; buttons: Button[] };
let showDialog: ((dialog: Dialog) => void) | null = null;

/** In-app replacement for Android's system alert. */
export const AppAlert = {
  alert(title: string, message?: string, buttons?: Button[]): void {
    showDialog?.({ title, message, buttons: buttons ?? [] });
  },
};

export function AppAlertProvider({ children }: { children: ReactNode }) {
  const { language } = usePreferences();
  const t = useTranslation();
  const pathname = usePathname();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  useEffect(() => {
    showDialog = setDialog;
    return () => {
      showDialog = null;
    };
  }, []);
  useEffect(() => {
    queueMicrotask(() => setDialog(null));
  }, [language, pathname]);
  const dismiss = () => setDialog(null);
  return (
    <>
      {children}
      <Modal visible={!!dialog} transparent animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
        <View style={{ flex: 1, backgroundColor: scrim(), justifyContent: "center", padding: 22 }}>
          <Pressable
            accessibilityRole="button"
            onPress={dismiss}
            style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}
            accessibilityLabel={t("AppAlert.closeDialog")}
          />
          <View
            style={{
              backgroundColor: themed("#fff"),
              borderRadius: 22,
              borderWidth: 1,
              borderColor: palette.border,
              padding: 22,
              maxHeight: "78%",
            }}
          >
            <Text style={{ color: palette.ink, fontSize: 21, fontWeight: "800" }}>{dialog?.title}</Text>
            {!!dialog?.message && (
              <ScrollView style={{ flexGrow: 0, marginTop: 11, marginBottom: 20 }}>
                <Text style={{ color: palette.muted, fontSize: 15, lineHeight: 23 }}>{dialog.message}</Text>
              </ScrollView>
            )}
            <View style={{ gap: 9, marginTop: dialog?.message ? 0 : 22 }}>
              {(dialog?.buttons.length ? dialog.buttons : [{ text: t("AppAlert.ok") }]).map((button, index) => {
                const quiet = button.style === "cancel";
                const danger = button.style === "destructive";
                return (
                  <Pressable
                    key={`${button.text}-${index}`}
                    accessibilityRole="button"
                    onPress={() => {
                      setDialog(null);
                      button.onPress?.();
                    }}
                    style={{
                      minHeight: 48,
                      borderRadius: 11,
                      justifyContent: "center",
                      alignItems: "center",
                      borderWidth: 1,
                      borderColor: quiet ? palette.border : danger ? themed("#e9b7bf") : palette.blue,
                      backgroundColor: quiet ? themed("#fff") : danger ? themed("#fff2f3") : palette.blue,
                    }}
                  >
                    <Text
                      style={{
                        color: quiet ? palette.ink : danger ? themed("#b43449") : onAccent,
                        fontWeight: "800",
                        fontSize: 15,
                      }}
                    >
                      {button.text || t("AppAlert.ok")}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
