# Android interface localization

Android follows [the desktop localization contract](desktop-localization.md) and
[the shared terminology](terminology.md). Interface messages are defined in
`apps/mobile/features/localization/locales/zh.ts` and `en.ts`; Chinese defines
`MessageKey`, and the English catalog must contain exactly the same keys and
interpolation parameters.

React components use `useTranslation()` from `features/localization/react`.
`LanguageContext` follows the current preference render immediately, before file
persistence effects run. Components with an explicit language pass it to the
hook. Presentation helpers use `getTranslator(language)`. Do not translate labels
at module initialization or cache translated labels with repository data.

Use a complete message for a count or sentence. English count entries can define
`{ count, one, other }`; selection follows the Chinese and English CLDR cardinal
rules directly because Android Hermes may not provide `Intl.PluralRules`. English
uses `one` for numeric 1 and -1; Chinese always uses `other`. Adding a locale
requires adding its plural rules. The translator infers
required parameters from the Chinese message. Accessible names, placeholders,
dialogs, progress and empty states use the same catalog.

Repository and branch names, README and issue bodies, comments, patches, paths,
commit messages, decompiled code and AI results are opaque content. They are never
translation keys. Parameters are substituted once; braces in inserted content
are not interpreted again. Content translation remains independent of interface
language.

`InterfaceError` carries a stable message key and parameters for application-owned
failures. `localizeError` translates only that type; remote error text is kept
opaque. Historical error diagnostics are retained for protocol compatibility.
GitHub error presentation selects messages by status code. Program and framework
progress selects catalog messages by stable phase codes. Pull request review adds
`step` and `fileName` metadata while retaining its legacy phase argument; the UI
uses the stable metadata. Language changes dismiss transient page feedback and
dialogs, while drafts and operation results remain available.

`node --test apps/mobile/test/*.test.mjs` includes catalog parity, parameter and
plural checks, opaque-content checks, owned error and GitHub status presentation,
and an AST audit of Android UI calls and text attributes. The one-time migration
script is `scripts/migrate-mobile-localization.mjs`; dry-run is its default. It
excludes authored UI fixture data. Runtime localization adds no dependencies.
