import { useEffect, useRef } from 'react';
import { AccessibilityInfo, AppState, Pressable, Text, View } from 'react-native';
import { useTranslation } from '@/features/localization/react';
import { createNoticeTimer } from '@/features/workspace/noticeTimer';
import type { SuccessNotice } from '@/features/workspace/useSuccessNotice';
import { palette } from './elements';

export function FeedbackNotice({ notice, onDismiss }: { notice: SuccessNotice; onDismiss: (id: number) => void }) {
  const t = useTranslation();
  const timer = useRef<ReturnType<typeof createNoticeTimer> | null>(null);
  useEffect(() => {
    let active = true;
    let readerChanged = false;
    const countdown = createNoticeTimer(() => onDismiss(notice.id));
    timer.current = countdown;
    // Give screen-reader users control over when the feedback is dismissed.
    countdown.pause('accessibility-check');
    const screenReader = (enabled: boolean) => {
      if (!active) return;
      if (enabled) countdown.pause('screen-reader');
      else countdown.release('screen-reader');
      countdown.release('accessibility-check');
    };
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (!readerChanged) screenReader(enabled);
    }).catch(() => { if (!readerChanged) screenReader(true); });
    const readerSubscription = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
      readerChanged = true;
      screenReader(enabled);
    });
    const appState = (state: string | null) => {
      if (state === 'active') countdown.release('background');
      else countdown.pause('background');
    };
    appState(AppState.currentState);
    const stateSubscription = AppState.addEventListener('change', appState);
    return () => {
      active = false;
      countdown.dispose();
      readerSubscription.remove();
      stateSubscription.remove();
      if (timer.current === countdown) timer.current = null;
    };
  }, [notice.id, onDismiss]);

  return <View accessibilityLiveRegion="polite" onTouchStart={() => timer.current?.pause('touch')}
    onTouchEnd={() => timer.current?.release('touch')} onTouchCancel={() => timer.current?.release('touch')}
    onPointerEnter={(event) => { if (event.nativeEvent.pointerType === 'mouse') timer.current?.pause('hover'); }}
    onPointerLeave={(event) => { if (event.nativeEvent.pointerType === 'mouse') timer.current?.release('hover'); }}
    style={{ marginTop: 12, paddingLeft: 12, borderRadius: 10, borderWidth: 1, borderColor: '#bed0ef', backgroundColor: '#edf4ff', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    <Text style={{ flex: 1, minWidth: 0, color: palette.ink, lineHeight: 22, paddingVertical: 10 }}>{notice.message}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('common.dismissFeedback')}
      onPress={() => onDismiss(notice.id)} onFocus={() => timer.current?.pause('focus')} onBlur={() => timer.current?.release('focus')}
      style={{ minWidth: 48, minHeight: 48, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: palette.blue, fontWeight: '700' }}>{t('common.close')}</Text>
    </Pressable>
  </View>;
}
