---
type: docs
tags:
  - docs
  - reference
keywords:
  - documentation
  - reference
  - guide
---

# Brain Docs

This folder contains **stable reference documentation** — settled knowledge that agents can consult at any time.

Unlike `knowledge/graph/` (which contains atomic claims that evolve), docs are **curated, authoritative, and rarely change**.

## What Goes Here

- Architecture decisions that are final (not exploratory)
- API references and integration guides
- Team conventions and standards
- Domain knowledge that won't change
- Onboarding context for new agents joining the project

## What Does NOT Go Here

- Work in progress (use `inbox/`)
- Evolving research (use `knowledge/graph/research/`)
- Session-specific notes (use `sessions/`)
- Active goals (use `goal/`)

## How Agents Use This

The brain router classifies `docs/` as `reference` memory type with high priority (x2.5). When an agent needs authoritative answers, docs surface before general knowledge claims.

Think of this as the project's **internal wiki** — the settled truth agents can rely on.
