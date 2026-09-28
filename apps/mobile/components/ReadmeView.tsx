import { useMemo, useRef, useState } from 'react';
import { Linking } from 'react-native';
import WebView, { type WebViewNavigation } from 'react-native-webview';

function documentFor(html: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><style>
    :root { color-scheme: light; } * { box-sizing: border-box; }
    body { margin: 0; padding: 1px 0 12px; background: white; color: #18263e; font: 15px/1.55 -apple-system, BlinkMacSystemFont, sans-serif; overflow-wrap: anywhere; }
    h1, h2 { border-bottom: 1px solid #dce5f1; padding-bottom: .3em; }
    h1 { font-size: 1.8em; } h2 { font-size: 1.45em; } h3 { font-size: 1.2em; }
    h1, h2, h3 { line-height: 1.25; margin: 1.3em 0 .6em; }
    h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
    p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
    a { color: #2477ed; text-decoration: none; }
    img { max-width: 100%; height: auto; }
    code { padding: .15em .3em; border-radius: 4px; background: #f1f4f9; font-family: monospace; font-size: .9em; }
    pre { padding: 12px; border-radius: 8px; background: #f1f4f9; overflow-x: auto; }
    pre code { padding: 0; background: none; }
    blockquote { border-left: 3px solid #c8d6e9; padding-left: 12px; color: #66758d; }
    table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
    th, td { border: 1px solid #dce5f1; padding: 6px 10px; }
    hr { border: 0; border-top: 1px solid #dce5f1; }
  </style></head><body>${html}</body></html>`;
}

export function ReadmeView({ html, onOpenLink }: { html: string; onOpenLink?: (url: string) => boolean }) {
  const [height, setHeight] = useState(300);
  const view = useRef<WebView>(null);
  const source = useMemo(() => ({ html: documentFor(html) }), [html]);
  const allowNavigation = (request: WebViewNavigation) => {
    if (request.url.startsWith('about:blank') || request.url.startsWith('data:')) return true;
    if (/^https?:\/\//i.test(request.url) && !onOpenLink?.(request.url)) void Linking.openURL(request.url);
    return false;
  };
  return <WebView
    ref={view}
    originWhitelist={['*']}
    source={source}
    style={{ height, backgroundColor: 'transparent' }}
    scrollEnabled={false}
    showsVerticalScrollIndicator={false}
    onMessage={(event) => {
      const measured = Number(event.nativeEvent.data);
      if (Number.isFinite(measured) && measured > 0) setHeight(Math.min(200000, Math.ceil(measured)));
    }}
    onLoadEnd={() => view.current?.injectJavaScript(`
      (() => {
        const report = () => window.ReactNativeWebView.postMessage(String(document.body.scrollHeight));
        [0, 200, 1000, 3000].forEach((delay) => setTimeout(report, delay));
        document.querySelectorAll('img').forEach((image) => image.addEventListener('load', report));
      })(); true;
    `)}
    onShouldStartLoadWithRequest={allowNavigation}
  />;
}
