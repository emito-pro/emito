---
title: Emito for AI assistants
description: Tooling that lets AI coding assistants integrate Emito for you.
sidebar:
  label: Overview
---

Most Emito integrations are now written with an AI assistant in the loop. This section covers the tooling that makes assistants accurate about Emito: a packaged skill, an MCP server, and AI-readable docs, so "add Emito to my app" produces correct code, not guesses.

## Available today

- **[Skill](/ai/skill/)**: a packaged agent skill (`npx @emito/cli@latest agent-skill`) that wraps the `emito init` CLI and wires the generated glue into your real entrypoint. Shipped and tested.

## Planned

:::caution[Planned: not written yet]
Placeholder for the rest of this section.
:::

- **MCP server**: expose Emito operations and docs to assistants over the Model Context Protocol.
- **llms.txt & editor rules**: AI-readable docs and drop-in agent rules for popular editors.
- Which to use when, and how they compose with the skill above.
