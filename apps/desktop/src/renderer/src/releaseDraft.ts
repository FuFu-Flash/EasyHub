import type { ReleaseChannel } from '@easyhub/types';

export interface ReleaseTextDraft { title: string; body: string; tagName?: string; channel?: ReleaseChannel; prerelease?: boolean; attachments?: boolean }
export function parseReleaseDraft(value: string): ReleaseTextDraft | null {
  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== 'object') return null;
    const item = data as Record<string, unknown>;
    if (typeof item.title !== 'string' || typeof item.body !== 'string') return null;
    return { title: item.title.slice(0, 120), body: item.body.replace(/!\[[^\]\n]*\]\(easyhub-image:[^)]+\)/g, ''),
      tagName: typeof item.tagName === 'string' ? item.tagName.slice(0, 80) : undefined,
      channel: item.channel === 'stable' || item.channel === 'alpha' || item.channel === 'beta' ? item.channel : undefined,
      prerelease: typeof item.prerelease === 'boolean' ? item.prerelease : undefined,
      attachments: item.attachments === true || item.body.includes('easyhub-image:') };
  } catch { return null; }
}
