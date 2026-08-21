# Security policy

Emito handles subscriber data, provider credentials, and an admin surface, so
security reports are taken seriously and answered.

## Reporting a vulnerability

**Please do not open a public issue, discussion, or pull request for a security
vulnerability.** Report it privately through either channel:

- **GitHub security advisory** (preferred):
  [open a private advisory](https://github.com/emito-pro/emito/security/advisories/new)
  for this repository, or
- **Email:** security@emito.io

Please include, as far as you can:

- the affected package(s) and version(s) — e.g. `@emito/server 0.1.0`;
- a description of the issue and the impact you believe it has;
- steps to reproduce, ideally a minimal proof of concept;
- any configuration required to trigger it (framework adapter, provider,
  auth mode).

You do not need a working exploit to report something — a precise description of
the weakness is enough.

## What to expect

| Stage | Target |
|---|---|
| Acknowledgement of your report | within 3 business days |
| Initial assessment and severity | within 7 days |
| Fix or documented mitigation | depends on severity; we keep you updated |

We will tell you what we found, when a fix lands, and coordinate the disclosure
timing with you. Unless you prefer to stay anonymous, you are credited in the
release notes and the advisory.

Please give us a reasonable window to ship a fix before disclosing publicly.

## Supported versions

Emito is pre-1.0. Security fixes land on `main` and go out in the next release;
older releases are not patched separately.

| Version | Supported |
|---|---|
| `0.1.x` (latest release) | ✅ |
| Anything older | ❌ — upgrade to the latest release |

## Scope

**In scope** — anything in the published `@emito/*` packages, including:

- authentication and session handling (`@emito/auth-jwt`, subscriber-token
  verification, API-key and admin-key gating);
- workspace isolation and access control across the engine and the HTTP API
  (any path where one workspace can read or write another's data);
- handling of provider credentials and other secrets (leakage through API
  responses or logs);
- injection, deserialization, path traversal, and template-rendering issues in
  the send pipeline or the HTTP surface;
- webhook signature verification and unsubscribe-link handling.

**Out of scope:**

- the **demo application** (`apps/demo`) and the committed local-demo
  credentials in `docker-compose.demo.yml` — these are documented, deliberately
  weak local defaults, not production secrets;
- findings that require a self-hosted deployment to be misconfigured against our
  own documentation (for example, running the HTTP API over plain HTTP, or
  reusing the example `JWT_SECRET` in production);
- vulnerabilities in third-party provider services (Resend, Twilio, FCM, Slack,
  Telegram) — report those to the vendor;
- missing hardening headers or rate limits with no demonstrated impact,
  automated-scanner output without a working scenario, and social engineering.

## Deployment hardening

Emito is self-hosted, so a portion of the security posture is yours. Before
production, check the
[gotchas checklist](https://docs.emito.io/gotchas/) and the
[self-hosting guide](https://docs.emito.io/self-hosting/architecture/) — in
particular: distinct, generated `EMITO_JWT_SECRET` / `EMITO_API_KEY` per
environment, HTTPS in front of the API, and a restricted admin key.
