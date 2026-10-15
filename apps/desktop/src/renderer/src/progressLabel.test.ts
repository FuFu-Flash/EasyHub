import { describe, expect, it } from 'vitest';
import { progressLabel } from './progressLabel';
import { getTranslator } from './localization';
import { downloadTransferText } from './components/downloadTransfer';
import { sensitiveReasonText } from './sensitiveReasonText';

describe('localized operation presentation', () => {
  it('uses operation codes and leaves uploaded file names opaque', () => {
    const value = { step: 'uploading-asset' as const, fileName: '更新{count}.zip' };
    expect(progressLabel(value, getTranslator('en'))).toBe('Uploading 更新{count}.zip');
    expect(progressLabel(value, getTranslator('zh'))).toBe('正在上传 更新{count}.zip');
    expect(progressLabel({ step: 'reviewing-file', fileName: '安装.ts' }, getTranslator('en'))).toBe('Reviewing 安装.ts…');
    expect(progressLabel(null, getTranslator('en'))).toBe('Working…');
  });
  it('localizes speeds, durations and sensitive reason codes', () => {
    expect(downloadTransferText(0, 1000, 1000, 'en')).toEqual({ speed: '1000 B/s', remaining: 'About 1 second' });
    expect(sensitiveReasonText('private-key', 'en')).toBe('Contains a private key marker');
    expect(sensitiveReasonText('unknown-future-code', 'en')).toBe('May contain passwords or keys');
  });
});
