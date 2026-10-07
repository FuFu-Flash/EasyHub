import { net } from 'electron';
import type { RuntimeFetch } from './analysisDownloads';

const HOSTS = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const MAX_QUEUED_BYTES = 8 * 1024 ** 2;

/** Chromium networking with explicit redirects, system proxy support, and no session credentials. */
export const analysisElectronFetch: RuntimeFetch = async (input, init) => {
  const requestInfo = new Request(input instanceof URL ? input.toString() : input, { ...init, credentials: 'omit' });
  const url = new URL(requestInfo.url);
  if (requestInfo.method !== 'GET' || url.protocol !== 'https:' || !HOSTS.has(url.hostname)
    || url.username || url.password || url.port || url.hash) throw new Error('分析组件请求必须使用官方 HTTPS 来源');
  if (requestInfo.signal.aborted) throw new DOMException('分析组件安装已取消', 'AbortError');
  // The installer has already checked CDN URLs. Refuse any further redirect and use
  // Chromium's fetch stream for backpressure throughout large asset transfers.
  if (requestInfo.redirect !== 'manual' || url.hostname !== 'github.com') {
    return net.fetch(new Request(requestInfo, { redirect: 'error' }), { credentials: 'omit', cache: 'no-store' });
  }

  // Electron net.fetch rejects manual redirects instead of returning a 302 Response.
  return new Promise<Response>((resolve, reject) => {
    const request = net.request({ url: requestInfo.url, method: 'GET', redirect: 'manual',
      credentials: 'omit', useSessionCookies: false, cache: 'no-store' });
    requestInfo.headers.forEach((value, name) => request.setHeader(name, value));
    request.setHeader('Accept-Encoding', 'identity');
    let responded = false;
    let finished = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const cleanup = () => { clearTimeout(idleTimer); requestInfo.signal.removeEventListener('abort', abort); };
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (responded) bodyController?.error(error);
      else reject(error);
    };
    const abort = () => {
      fail(new DOMException('分析组件安装已取消', 'AbortError'));
      request.abort();
    };
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { fail(new Error('官方组件下载超过 60 秒没有响应')); request.abort(); }, 60_000);
    };
    requestInfo.signal.addEventListener('abort', abort, { once: true });
    request.on('error', fail);
    // Electron's writable request can emit close after request.end(), before response data.
    // Response end/error/aborted events and the install signal own transaction completion.
    request.once('close', () => { if (finished) cleanup(); });
    request.once('redirect', (status, _method, location) => {
      if (finished) return;
      responded = true;
      finished = true;
      cleanup();
      resolve(new Response(null, { status, headers: { location } }));
      // The installer validates this location before making a separate request.
      request.abort();
    });
    request.once('response', response => {
      if (finished) return;
      resetIdleTimer();
      const headers = new Headers();
      for (const [name, values] of Object.entries(response.headers)) {
        for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value);
      }
      const noBody = [204, 205, 304].includes(response.statusCode);
      const body = new ReadableStream<Uint8Array>({
        start(controller) { bodyController = controller; },
        cancel() { finished = true; cleanup(); request.abort(); },
      }, { highWaterMark: MAX_QUEUED_BYTES, size: chunk => chunk.byteLength });
      response.once('error', fail);
      response.once('aborted', () => fail(new Error('官方组件下载连接已中断')));
      response.once('end', () => {
        if (finished) return;
        finished = true;
        cleanup();
        bodyController?.close();
      });
      response.on('data', chunk => {
        if (finished || noBody) return;
        resetIdleTimer();
        // IncomingMessage exposes events rather than pause/resume; bound the pending queue.
        if ((bodyController?.desiredSize ?? 0) < chunk.byteLength) {
          fail(new Error('分析组件下载写入速度不足，已停止以限制内存使用'));
          request.abort();
          return;
        }
        bodyController?.enqueue(new Uint8Array(chunk));
      });
      responded = true;
      resolve(new Response(noBody ? null : body, { status: response.statusCode, headers }));
    });
    if (requestInfo.signal.aborted) abort();
    else { resetIdleTimer(); request.end(); }
  });
};
