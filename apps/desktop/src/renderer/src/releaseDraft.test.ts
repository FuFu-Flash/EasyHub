import { describe, expect, it } from 'vitest';
import { parseReleaseDraft } from './releaseDraft';
describe('release text draft recovery', () => {
  it('restores text and web images without reusing expired local file grants', () => {
    expect(parseReleaseDraft(JSON.stringify({ title: 'New release', body: 'Text\n![local](easyhub-image:old-grant)\n![web](https://example.com/a.png)', channel: 'beta', tagName: 'v2.0.0', attachments: true })))
      .toMatchObject({ title: 'New release', body: 'Text\n\n![web](https://example.com/a.png)', channel: 'beta', tagName: 'v2.0.0', attachments: true });
  });
  it('ignores corrupt drafts and unknown settings', () => {
    expect(parseReleaseDraft('broken')).toBeNull();
    expect(parseReleaseDraft('{"title":1,"body":2}')).toBeNull();
    expect(parseReleaseDraft('{"title":"Hi","body":"","channel":"invalid"}')?.channel).toBeUndefined();
  });
});
