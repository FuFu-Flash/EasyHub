import { describe, expect, it } from 'vitest';
import { createDownloadTransferSampler, downloadTransferText } from './downloadTransfer';

describe('download transfer display', () => {
  it('keeps the speed readable between two-second samples', () => {
    const sample = createDownloadTransferSampler(0);
    expect(sample(100, 100)).toBeNull();
    expect(sample(600, 900)).toBeNull();
    expect(sample(1_000, 2_000)).toBe(500);
    expect(sample(1_100, 2_100)).toBe(500);
    expect(sample(1_900, 3_900)).toBe(500);
    expect(sample(2_000, 4_000)).toBe(500);
  });

  it('shows speed and remaining time together without alternating', () => {
    expect(downloadTransferText(1_000, 3_000, 500)).toEqual({ speed: '500 B/秒', remaining: '约 4 秒' });
    expect(downloadTransferText(1_000, null, 500)).toEqual({ speed: '500 B/秒', remaining: '剩余时间未知' });
  });
});
