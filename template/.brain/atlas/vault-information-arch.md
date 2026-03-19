---
type: atlas
tags:
  - atlas
  - meta
---

# Vault Information Architecture

## Folder Structure

| Folder | Purpose |
|--------|---------|
| `goal/` | **THE NORTH STAR.** Mission, principles, success criteria. Never changes without user approval. |
| `docs/` | Stable reference documentation — settled knowledge agents can always rely on |
| `00-home/` | Maps of content, daily notes, top-of-mind |
| `00-home/daily/` | Daily notes (auto-generated) |
| `atlas/` | Structural overview — projects, research, this document |
| `inbox/` | Everything lands here first. Unprocessed captures. |
| `inbox/queue-generated/` | Auto-generated notes awaiting human review |
| `knowledge/graph/` | Curated knowledge nodes — the core brain |
| `knowledge/graph/agent-daily/` | Agent session observations |
| `knowledge/graph/research/` | Research findings as atomic claims |
| `knowledge/graph/repo-research/` | Repository-specific research |
| `knowledge/memory/` | Cross-session memory persistence |
| `sessions/` | Raw session transcripts |
| `voice-notes/` | Transcribed voice captures |
| `_assets/attachments/` | Images, media, files |
| `_assets/templates/` | Note templates |

## Naming Conventions

### Prose-as-Title (MANDATORY)

Notes are named as claims, not categories. The title alone must signal relevance.

**Wrong:**
- `memory-systems.md`
- `retrieval-notes.md`
- `productivity.md`

**Right:**
- `memory graphs beat giant memory files.md`
- `hybrid retrieval outperforms pure semantic search.md`
- `async work beats synchronous meetings for deep work.md`

### Wiki-Links as Prose

Links read as natural sentences:
- `we learned that [[memory graphs beat giant memory files]]`
- `when we [[benchmark retrieval like search infrastructure]]`

## Note Types

| Type | Template | Where it lives | Memory Type |
|------|----------|---------------|-------------|
| `goal` | `_assets/templates/goal.md` | `goal/` | goal (x5 priority) |
| `docs` | `_assets/templates/doc.md` | `docs/` | reference (x2.5 priority) |
| `daily` | `_assets/templates/daily-note.md` | `00-home/daily/` | episodic |
| `claim` | `_assets/templates/knowledge-claim.md` | `knowledge/graph/` | semantic |
| `session` | `_assets/templates/session-log.md` | `sessions/` | episodic |
| `ingested` | `_assets/templates/ingested-source.md` | `inbox/` then curated | semantic |
| `project` | `_assets/templates/project-context.md` | `atlas/` or `knowledge/` | procedural |
| `brain-eval` | `_assets/templates/brain-eval.md` | `knowledge/graph/agent-daily/` | episodic |

## Session Rhythm

Every agent session follows this cycle:

1. **Orient** — Read CLAUDE.md. Read `goal/mission.md` (the north star). Read top-of-mind. Absorb context.
2. **Work** — Operate with full accumulated context. Every decision serves the goal.
3. **Persist** — Write what was learned into memory files, knowledge notes, or session logs. Never modify `goal/` without user approval.

Skipping persist means the brain never improves.

## Rules

- **Never modify `goal/` without explicit user approval** — the mission is sacred
- MEMORY.md stays under 200 lines — routing document only
- One atomic claim per knowledge note
- Everything enters through `inbox/` first
- `docs/` contains settled truth — only update when knowledge is confirmed and stable
- No absolute paths anywhere — vault must be portable
- No project-specific data in the template — this is a blank brain
