# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

This is the **Second Brain Framework** — an installable template that drops a knowledge persistence system (Obsidian vault) into any project via `scripts/init-second-brain.sh`.

## Prerequisites

- **bash** — init script is bash
- **Node.js** — required for bootstrap, brain index rebuild, and hook scripts
- **jq** — required for MCP config merge and hooks merge into `.claude/settings.json`

## Repo Structure

```
scripts/
  init-second-brain.sh           — The installer (7-step pipeline, see below)
  bootstrap-scan.mjs             — Scans target project, outputs JSON manifest
  bootstrap-populate.mjs         — Populates brain from manifest (--bootstrap flag)
  auto-populate-prompt.mjs       — Generates auto-populate prompt (--auto flag)

template/
  .brain/                        — The vault template (what gets installed)
  .brain/hooks/                  — Claude Code hooks (router, indexer, search, validator, graph)
  CLAUDE-second-brain.md         — CLAUDE.md section (appended to target's CLAUDE.md)
  mcp-servers.json               — MCP server definitions (merged into target's .mcp.json)
  gitignore-entries.txt          — Gitignore entries (appended to target's .gitignore)

tests/                           — Test suite (Node.js + shell)
```

## Init Script Pipeline

```bash
./scripts/init-second-brain.sh [--bootstrap] [--auto] /path/to/project
```

Flags:
- `--bootstrap` — scan project and auto-populate brain from README, package.json, git history, ADRs, etc.
- `--auto` — implies `--bootstrap` plus runs the auto-populate prompt generator (`auto-populate-prompt.mjs`)

The script runs 7 steps in order:
1. Copy vault structure (`.brain/` → `.brain_<project-name>/`)
2. Bootstrap scan+populate (optional, requires `--bootstrap` or `--auto`)
3. CLAUDE.md integration (create/append/update using `<!-- SECOND-BRAIN-FRAMEWORK:START/END -->` markers)
4. MCP config merge (`.mcp.json`)
5. Hooks configuration (merges into `.claude/settings.json`)
6. Build brain index (`brain-index.json`)
7. Register Obsidian vault (macOS `obsidian.json`)

## Hook Architecture

Hooks live in `template/.brain/hooks/` and are configured as Claude Code hooks in `.claude/settings.json`. Each hook is a shell wrapper (`.sh`) that may call a Node.js script (`.mjs`) for the heavy lifting.

| Hook | Trigger | Purpose |
|------|---------|---------|
| `session-orient.sh` | `UserPromptSubmit` | Prints orientation context (mission, top-of-mind, brain stats) on session start |
| `brain-router.sh` | `PreToolUse` (Write\|Edit) | Advisory: warns if brain files lack YAML frontmatter; also detects and surfaces auto-populate prompts |
| `brain-index-updater.sh` | `PostToolUse` (Write\|Edit) | Rebuilds brain-index.json when brain files change, auto-links new notes into MOCs via `auto-link-note.mjs` |
| `session-eval-prompt.sh` | `Stop` | Generates session evaluation prompt at end of session |

Supporting scripts (not hooks, but called by hooks or directly):
- `rebuild-brain-index.sh` / `rebuild-brain-index.mjs` — full index rebuild (v3 format with backlinks, age, title-boosted keywords)
- `brain-search.mjs` — weighted search with fuzzy matching against brain index
- `brain-validator.mjs` — validate note frontmatter (YAML parsing)
- `brain-graph.mjs` — graph analysis (orphan detection, connectivity)
- `auto-link-note.mjs` — auto-links new notes into the relevant MOC (called by `brain-index-updater.sh`)
- `brain-health-report.sh` — vault health summary

## Bootstrap Data Flow

The `--bootstrap` flag runs a two-stage pipeline:

1. **Scan** (`bootstrap-scan.mjs`): reads README, package.json, git history, ADRs, CLAUDE.md, Claude memory files → writes a JSON manifest to `.brain*/inbox/queue-generated/bootstrap-scan.json`
2. **Populate** (`bootstrap-populate.mjs`): reads the manifest → generates brain notes with `[BOOTSTRAPPED — REVIEW]` warnings in frontmatter

The `--auto` flag adds a third stage: `auto-populate-prompt.mjs` generates a prompt file at `.brain*/hooks/.state/auto-populate-prompt.md` which `brain-router.sh` surfaces once and then renames to `.done`.

## Template Substitution

The template uses `.brain/` as a placeholder directory name. During install, `init-second-brain.sh` runs `sed` replacements across `CLAUDE-second-brain.md`, `mcp-servers.json`, and `gitignore-entries.txt` to substitute `.brain_<project-name>/` (derived from git remote or directory basename). This means each project gets a uniquely-named Obsidian vault.

## Development Guidelines

- The vault template lives in `template/.brain/` — edit vault content there, not at the repo root
- All vault paths in `CLAUDE-second-brain.md` must be prefixed with `.brain/` since that's where they install
- The init script must be idempotent — safe to re-run without destroying user content
- The CLAUDE.md section uses HTML comment markers (`<!-- SECOND-BRAIN-FRAMEWORK:START/END -->`) for safe merging
- Keep notes in prose-as-title format (claims, not categories)
- One atomic claim per knowledge note, with YAML frontmatter

## Running Tests

```bash
# Run full test suite (Node.js + shell) — 161 tests total
bash tests/run-all.sh

# Run all Node.js tests (148 tests: indexer, router, bootstrap, search, validator, graph, auto-populate, integration)
node --test tests/test-indexer.mjs tests/test-router.mjs tests/test-bootstrap.mjs tests/test-search.mjs tests/test-validator.mjs tests/test-graph.mjs tests/test-auto-populate.mjs tests/test-integration.mjs

# Run a single test file
node --test tests/test-search.mjs

# Run only shell tests (init script, 13 tests)
bash tests/test-init.sh
```

All tests use Node.js built-in test runner (`node:test`) — no test framework dependency. Shell tests use a custom assert helper in `test-init.sh`.

**Note:** `run-all.sh` runs Node.js tests twice (once for results, once to count). This is a known quirk — if tests are slow, run individual files instead.

## Manual Testing

```bash
# Test fresh install
mkdir /tmp/test-project && cd /tmp/test-project && git init
/path/to/scripts/init-second-brain.sh .

# Test install alongside agentic framework
# (use a project that already has .claude/, CLAUDE.md, .mcp.json)

# Test re-install (should show "already up to date")
/path/to/scripts/init-second-brain.sh .
```


---

> **Below this line**: Vault operating instructions installed by `init-second-brain.sh` from `template/CLAUDE-second-brain.md`. These are the agent-facing protocols for using the `.brain_second-brain-project/` vault in this repo. Edit the source template when making changes that should propagate to all installations.

# Second Brain — Claude Code Instructions

This project uses a `.brain_second-brain-project/` vault as a structured knowledge graph. Follow these protocols every session.

---

## Session Start Protocol

The **session-orient hook** automatically prints a compact orientation on your first prompt:
mission context, top-of-mind status, last session summary, and brain stats.
It also surfaces relevant notes from `brain-index.json` on every prompt via keyword matching.

After reading the hook output:

1. Confirm you understand the current state and priorities.
2. Query `.brain_second-brain-project/brain-index.json` for keywords specific to the current task (see below).
3. Read only the notes the index points to. Never crawl the vault wholesale.

---

## How to Query brain-index.json

The index is a JSON array. Each entry has:

```
p   — relative path from .brain_second-brain-project/
m   — maturity: working | procedural | reference | goal
moc — true if this is a Map of Content (index note)
t   — tags array
k   — explicit keywords
bk  — body keywords extracted from content
s   — one-line summary
l   — outgoing wiki-links
lc  — link count
```

Query strategy:

1. Extract 3-5 keywords from the user's request.
2. Scan `k` and `bk` fields for matches. Collect matching `p` values.
3. Sort candidates by `lc` descending (higher link count = more central node).
4. Read the top 3-5 candidate files. Read MOC files (`moc: true`) first.
5. Follow `[[wiki-links]]` only when the linked note is directly relevant.

Do not read every file in the vault. The index exists precisely to avoid that.

---

## When to Create Notes

Create a note when information is worth retaining across sessions. Default to the inbox if uncertain.

| Situation | Template | Location |
|-----------|----------|----------|
| New factual claim or insight | `knowledge-claim.md` | `.brain_second-brain-project/knowledge/graph/research/` |
| Research on a repo or codebase | `research-finding.md` | `.brain_second-brain-project/knowledge/graph/repo-research/` |
| A decision was made with rationale | `decision-record.md` | `.brain_second-brain-project/knowledge/graph/research/` |
| A new project is being tracked | `project-context.md` | `.brain_second-brain-project/atlas/` |
| A goal or north-star statement | `goal.md` | `.brain_second-brain-project/goal/` |
| Stable how-to or process doc | `doc.md` | `.brain_second-brain-project/docs/` |
| External source was ingested | `ingested-source.md` | `.brain_second-brain-project/knowledge/graph/research/` |
| Uncertain / needs triage | any | `.brain_second-brain-project/inbox/queue-generated/` |

Rules:
- Always copy the appropriate template from `.brain_second-brain-project/_assets/templates/`.
- Always include YAML frontmatter (see Frontmatter section below).
- Never create a note without frontmatter — the index rebuild will skip it.
- One claim or decision per note. Keep notes atomic.
- New notes in `knowledge/graph/` and `sessions/` are **auto-linked** into the relevant MOC by the `brain-index-updater` hook. You do not need to manually add links to `index.md` or `atlas/research.md` for these.

---

## Continuous Knowledge Capture

As you work, continuously identify knowledge worth persisting. **Do NOT wait until session end.**

Create a knowledge note immediately when any of these occur:
- You discover a non-obvious fact about the codebase (architecture pattern, hidden dependency, performance characteristic)
- You make a decision with tradeoffs (use `decision-record.md` template)
- You find the answer to a question that took investigation (use `research-finding.md` template)
- You learn a user preference, team convention, or project constraint (use `knowledge-claim.md` in `knowledge/memory/`)
- You encounter a gotcha, bug pattern, or workaround (use `knowledge-claim.md`)

The title of each note IS the claim. Good: `React context re-renders all consumers on any state change.md`. Bad: `react context notes.md`.

**Why this matters**: The Stop hook cannot access your conversation. If you defer knowledge capture to session end, the hook can only remind you — it cannot extract what you learned. Write notes as you go or the knowledge is lost.

---

## Frontmatter Requirements

Every note must open with a YAML block. Minimum required fields:

```yaml
---
title: "Descriptive title"
date: YYYY-MM-DD
maturity: working         # working | procedural | reference | goal
tags: []
keywords: []
summary: "One sentence."
---
```

Optional but encouraged:

```yaml
links: []                 # explicit outgoing links as list
source: ""                # URL or citation if applicable
project: ""               # project this belongs to
```

---

## Memory Strategy

- Use `.brain_second-brain-project/knowledge/memory/` as persistent memory instead of `~/.claude` memory files.
- Store durable facts about the project, team, preferences, and constraints here.
- Use `knowledge-claim.md` template for memory notes.
- Knowledge graph notes (discoveries, research) go in `.brain_second-brain-project/knowledge/graph/`.
- Memory notes (facts to recall next session) go in `.brain_second-brain-project/knowledge/memory/`.

Separation rule: if the note answers "what did I learn?", it's graph. If it answers "what should I always remember?", it's memory.

---

## Session End Protocol

The **Stop hook** automatically detects files you modified and notes you created. It prints numbered directives with pre-populated data. Follow every directive:

1. **Create a session log** — The hook provides the file path, date, list of files touched, and git summary. You fill in: session goal, decisions made, what worked/didn't.
2. **Update `top-of-mind.md`** — The hook tells you if it's stale. Remove resolved items, add new open threads.
3. **Knowledge sweep** — Review your conversation one final time. Did you learn anything you didn't already write to a note? Write it now. This is the most critical step.
4. **Link orphan notes** — The hook identifies notes not linked from any MOC. Add them.

The hook also rebuilds `brain-index.json` automatically. Do not skip any directive — the hook output is not advisory, treat it as a mandatory checklist with pre-filled answers.

---

## Daily Notes

- Create daily notes in `.brain_second-brain-project/00-home/daily/`.
- Name format: `YYYY-MM-DD.md`.
- Use the `daily-note.md` template.
- Link the daily note from `index.md` under the current week if an active-week section exists.
- Daily notes are maturity `working` — they are not meant to be permanent.

---

## The Inbox

When content arrives that you are not sure how to categorize:

1. Write it to `.brain_second-brain-project/inbox/queue-generated/` using whatever template fits best.
2. Add frontmatter with `maturity: working` and `tags: [inbox]`.
3. Do not link it from other notes yet.
4. On the next session that has time for triage, move inbox items to their correct location and update links.

The inbox is a staging area, not a destination. Items in `queue-generated/` are not indexed reliably — process them promptly.

---

## Linking Rules

- Use `[[wiki-link]]` syntax to link between notes. Obsidian resolves these.
- Link to the note's filename without the `.md` extension.
- When you create a note that is referenced by an existing note, add the back-link manually if Obsidian is not running.
- The `brain-index-updater` hook automatically rebuilds `brain-index.json` and auto-links new notes into the relevant MOC. You do not need to manually update the index or add links to standard MOCs for notes in `knowledge/graph/` or `sessions/`.
- For notes in non-standard locations, manually add them to the relevant MOC file (e.g., `atlas/projects.md`, `atlas/research.md`).

---

## Maturity Levels

| Level | Meaning | When to Use |
|-------|---------|-------------|
| `working` | Draft, in progress, may change | New notes, daily notes, inbox |
| `procedural` | Stable how-to or process | Docs, runbooks, repeatable steps |
| `reference` | Stable factual record | Finalized research, decision records |
| `goal` | North-star, aspirational | Mission, principles, OKRs |

Promote maturity deliberately. A `working` note that has been validated and stabilized should be updated to `reference`. Never auto-promote — it requires a human decision or an explicit agent decision with rationale.

---

## What NOT to Do

- **Do not read every file in the vault.** Use `brain-index.json` to navigate.
- **Do not create notes without frontmatter.** The rebuild hooks skip them and they become invisible to the index.
- **Do not put durable knowledge only in session context.** If it matters beyond this session, write it to a note.
- **Do not write to `~/.claude` memory when a `.brain_second-brain-project/` vault is present.** The vault is the memory system.
- **Do not skip the session end protocol.** An un-logged session produces knowledge drift.
- **Do not create duplicate notes.** Query the index first; if a note already covers the topic, extend it instead.
- **Do not use free-form filenames.** Follow the naming convention: `kebab-case-descriptive-title.md` with date prefix where applicable (`YYYY-MM-DD-slug.md`).
- **Do not leave inbox items indefinitely.** Triage them within 1-2 sessions.
- **Do not defer knowledge capture to session end.** The Stop hook has no conversation access — write notes as you discover things.

---

## Quick Reference

```
Session start:   orient hook prints context automatically → query index for task keywords → targeted reads
During session:  write knowledge notes immediately as you discover things (don't defer)
New knowledge:   copy template → write frontmatter → save to correct folder (auto-linked + auto-indexed)
Memory:          .brain_second-brain-project/knowledge/memory/  (not ~/.claude)
Uncertain:       .brain_second-brain-project/inbox/queue-generated/
Session end:     follow Stop hook directives → session log → top-of-mind → knowledge sweep
Links:           [[wiki-link]] syntax — auto-linked for knowledge/graph/ and sessions/
```
