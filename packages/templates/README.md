<div align="center">
  <img src="../../.github/assets/emito-logo.png" width="120" alt="Emito" />

  # @emito/templates

  **Default notification templates, multi-channel rendering, locale-aware formatters, and language fallback for Emito.**

  [![License](https://img.shields.io/badge/license-MIT-blue)](../../README.md)
  [![Types](https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white)](#)
  ![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
</div>

## What it is

`@emito/templates` is the rendering layer that turns notification events into per-channel content. It ships a registry of ready-made templates for common product events (auth, security, team, billing, system, trading), a builder for declaring your own templates from plain strings, locale-aware Intl formatters, Slack Block Kit and Telegram HTML helpers, a language-resolution chain, and a generic fallback for events that have no template. Email content is rendered with [React Email](https://react.email).

> Templates are plain functions keyed by language. Each channel function receives the event payload, a `BrandTheme`, and a `RenderContext`, and returns the content shape that channel expects — so the same event can produce an HTML email, an SMS body, a push payload, and a Slack message from one definition.

## Install

Emito is developed as a pnpm workspace; the `@emito/*` packages are consumed
from within the monorepo. Add the templates package to a workspace package as a
workspace dependency:

```jsonc
// package.json
"dependencies": {
  "@emito/templates": "workspace:*"
}
```

> Standalone npm publishing of the `@emito/*` scope is planned but not yet
> available — install from the workspace for now.

It expects React 19 as a peer dependency:

```jsonc
// peerDependencies
"react": "^19",
"react-dom": "^19"
```

## Usage

Build a multi-language, multi-channel template and resolve the right language for a send:

```ts
import {
  buildTemplate,
  resolveLang,
  resolveTemplateLang,
  formatDateTime,
} from "@emito/templates";

// Declare content per language and channel.
const orderShipped = buildTemplate({
  en: {
    email: {
      subject: "Your order has shipped",
      heading: "On its way",
      body: "Track your package any time from your account.",
      cta: "Track order",
      ctaUrl: "https://app.example.com/orders",
    },
    sms: { body: "Your order has shipped." },
    push: { title: "Shipped", body: "Your order is on its way." },
  },
  de: {
    email: {
      subject: "Deine Bestellung ist unterwegs",
      heading: "Unterwegs",
      body: "Verfolge dein Paket jederzeit in deinem Konto.",
    },
  },
});

// Resolve which language to use (per-send > subscriber > config default > "en").
const lang = resolveLang({ subscriberLang: "de", configDefaultLang: "en" });

// Pick the template for that language, with English/first-key fallback.
const template = resolveTemplateLang(orderShipped, lang);

// Render a channel. Channel functions take (payload, brand, ctx).
const brand = { name: "Acme", appUrl: "https://app.example.com" };
const ctx = { locale: "de-DE", timezone: "Europe/Berlin" };

const email = await template?.email?.({}, brand, ctx);
// => { subject, html, text }

formatDateTime(Date.now(), ctx); // locale- and timezone-aware string
```

To use a shipped template instead of authoring one, read from `defaultTemplates`:

```ts
import { defaultTemplates } from "@emito/templates";

const welcome = defaultTemplates["auth.welcome"]; // Record<lang, EventTemplate>
```

## API surface

All exports are available from the package root (`@emito/templates`).

### Templates and resolution

| Export | Description |
| --- | --- |
| `defaultTemplates` | `Record<string, Record<string, EventTemplate>>` — registry of all built-in event templates, keyed by event name then language. |
| `buildTemplate(langs)` | Builds a `Record<lang, EventTemplate>` from a `LangStringsMap` of per-channel strings. |
| `createFallbackTemplate(eventName)` | Generic `EventTemplate` that renders event name + payload key-values across every channel. |
| `resolveLang(params)` | Resolves a language: per-send override → subscriber preference → config default → `"en"`. |
| `resolveTemplateLang(langMap, lang)` | Picks a template by language with fallback to `en`, then the first available key. |

### Built-in event templates

Exported individually and registered in `defaultTemplates`:

| Group | Event keys |
| --- | --- |
| Auth | `auth.welcome`, `auth.password-reset`, `auth.email-verification`, `auth.login-new-device`, `auth.password-changed`, `auth.2fa-enabled` |
| Security | `security.alert`, `security.api-key-created`, `security.api-key-expiring` |
| Team | `team.invitation`, `team.member-joined`, `team.role-changed` |
| Billing | `billing.payment-succeeded`, `billing.payment-failed`, `billing.trial-expiring` |
| System | `system.maintenance`, `system.incident`, `system.resolved` |
| Trading | `order.fill`, `price.alert` |

### Formatters

| Export | Description |
| --- | --- |
| `formatDate`, `formatTime`, `formatDateTime` | Locale- and timezone-aware date/time formatting via `Intl.DateTimeFormat`; fall back to `en`/`UTC` on invalid input. |
| `formatCurrency`, `formatNumber` | Locale-aware number formatting via `Intl.NumberFormat`. |
| `formatPlural(count, forms, ctx)` | Selects a `PluralForms` variant using `Intl.PluralRules`. |
| `isRtl(locale)` | Returns `true` for right-to-left languages (`ar`, `he`, `fa`, `ur`). |
| `formatSlackBlocks(params)` | Builds Slack Block Kit content (`SlackContent`) with optional fields, button, and context. |
| `formatTelegramHtml(params)` | Builds Telegram-safe HTML content (`TelegramContent`). |

### Layout and theme

| Export | Description |
| --- | --- |
| `BaseEmailLayout` | Shared React Email layout wrapping template bodies with brand-aware styling. |
| `THEME_DEFAULTS` | Default colors, typography, and button styling used when `BrandTheme` fields are absent. |

### Types

`LangStringsMap`, `ChannelStringsMap`, `EmailStrings`, `SmsStrings`, `PushStrings`, `InAppStrings`, `SlackStrings`, `TelegramStrings`, `ResolveLangParams`, `BaseEmailLayoutProps`, `BaseEmailLayoutStrings`, `PluralForms`, `SlackBlockParams`, and `TelegramMessageParams` are exported alongside their implementations. Channel content shapes (`EventTemplate`, `BrandTheme`, `RenderContext`, `SlackContent`, `TelegramContent`) come from [`@emito/types`](../types/README.md).

## Part of Emito

`@emito/templates` is one package in the [Emito](../../README.md) monorepo —
self-hosted, provider-agnostic notification infrastructure for Node.js and
TypeScript.

- **Shared types** — [`@emito/types`](../types/README.md)
- **Core engine** — [`@emito/core`](../core/README.md)
- See the [full package list](../../README.md#monorepo) in the root README.

## License

MIT — part of the [Emito](../../README.md) project.
