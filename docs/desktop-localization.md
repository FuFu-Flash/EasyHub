# Desktop interface localization

Interface text lives in `apps/desktop/src/renderer/src/locales/zh.ts` and `en.ts`.
The Chinese catalog defines `MessageKey`; the English catalog must contain exactly
the same keys. Catalog tests also check matching interpolation parameters.

React components call `const t = useTranslation()` and then `t(key, params)`.
The hook follows `LanguageContext`, including changes before preference storage
effects run. Components with an explicit language can pass it to the hook.
Non-React presentation helpers accept a language and use `getTranslator(language)`.
Do not compute translated labels at module initialization or store them in caches.

Use a complete message for a count or sentence. English count messages can provide
`{ count: 'parameterName', one: '…', other: '…' }`; selection uses `Intl.PluralRules`.
The call signature infers required parameters from the Chinese message. Include
accessible names, placeholders, titles and empty states in the catalog.

Repository names, README bodies, issue bodies, comments, code, paths and submitted
commit messages are opaque content. Do not pass them as translation keys. Parameters
are substituted once without interpreting their contents. `data-content-original`
marks authored content for the UI language audit; it must not hide surrounding UI
controls from that audit. Paragraph translation remains an independent service.

Local, release and review progress events include stable `step` codes and optional `count`
or `fileName`. The renderer maps those codes to catalog keys. The legacy human
`phase` field remains on the wire for compatibility, but is not a translation key.
Notification read identity uses a language independent activity revision.
Transient success messages are dismissed on a language change, so cached messages
cannot leave UI text in the previous language. Drafts and operation results remain.

`npm run test:key-localization` checks the signed-in workspace with an isolated
bridge fixture: language switching, notification identity, English UI text and
attributes, search empty states, row backgrounds, window controls and overflow at
1440/1000 widths in comfortable/compact layouts. No real GitHub writes or paid API
calls are made. `npm run review:demo` exercises the same interface through the demo
bridge. The DOM text replacement translator and its observer have been removed;
remaining mutation observers measure layout, scroll state or focus behavior.
