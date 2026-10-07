import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn() }));
vi.mock('electron', () => ({ net: mocked }));
import { analysisElectronFetch } from './analysisElectronFetch';

class FakeRequest extends EventEmitter {
  setHeader = vi.fn();
  abort = vi.fn(() => this.emit('close'));
  end = vi.fn();
}
let request: FakeRequest;
beforeEach(() => {
  vi.clearAllMocks();
  request = new FakeRequest();
  mocked.request.mockReturnValue(request);
});

describe('Electron analysis transport', () => {
  it('returns a manual redirect without following it or sending cookies', async () => {
    const response = analysisElectronFetch('https://github.com/official/asset', { redirect: 'manual' });
    request.emit('redirect', 302, 'GET', 'https://release-assets.githubusercontent.com/asset', {});
    expect((await response).headers.get('location')).toBe('https://release-assets.githubusercontent.com/asset');
    expect(request.abort).toHaveBeenCalledOnce();
    expect(mocked.request).toHaveBeenCalledWith(expect.objectContaining({ redirect: 'manual', credentials: 'omit', useSessionCookies: false }));
  });

  it('streams bytes, finishes correctly, and propagates cancellation after receiving headers', async () => {
    const controller = new AbortController();
    const pending = analysisElectronFetch('https://github.com/official/asset', { redirect: 'manual', signal: controller.signal });
    const incoming = Object.assign(new EventEmitter(), { headers: {}, statusCode: 200 });
    request.emit('response', incoming);
    const reader = (await pending).body!.getReader();
    incoming.emit('data', Buffer.from('first'));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first');
    controller.abort();
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
    expect(request.abort).toHaveBeenCalledOnce();
  });

  it('bounds unread download buffering and cancels the native request', async () => {
    const pending = analysisElectronFetch('https://github.com/official/asset', { redirect: 'manual' });
    const incoming = Object.assign(new EventEmitter(), { headers: {}, statusCode: 200 });
    request.emit('response', incoming);
    const response = await pending;
    incoming.emit('data', Buffer.alloc(9 * 1024 ** 2));
    await expect(response.arrayBuffer()).rejects.toThrow('限制内存');
    expect(request.abort).toHaveBeenCalledOnce();
  });

  it('keeps metadata requests credential free and rejects other hosts', async () => {
    mocked.fetch.mockResolvedValue(Response.json({}));
    await analysisElectronFetch('https://api.github.com/repos/owner/repo', { redirect: 'error' });
    expect(mocked.fetch).toHaveBeenCalledWith(expect.objectContaining({ credentials: 'omit' }), { credentials: 'omit', cache: 'no-store' });
    await expect(analysisElectronFetch('https://localhost/asset', { redirect: 'manual' })).rejects.toThrow('官方 HTTPS');
    expect(mocked.request).not.toHaveBeenCalled();
  });

  it('streams a validated CDN URL through native fetch while refusing additional redirects', async () => {
    mocked.fetch.mockResolvedValue(new Response('asset'));
    await analysisElectronFetch('https://release-assets.githubusercontent.com/asset', { redirect: 'manual' });
    expect(mocked.fetch).toHaveBeenCalledWith(expect.objectContaining({ redirect: 'error', credentials: 'omit' }),
      { credentials: 'omit', cache: 'no-store' });
    expect(mocked.request).not.toHaveBeenCalled();
  });
});
