# Second Brain — Claude Code Instructions

This project uses a `.brain/` vault as a structured knowledge graph. Follow these protocols every session.

---

## Session Start Protocol

The **session-orient hook** automatically prints a compact orientation on your first prompt:
mission context, top-of-mind status, last session summary, and brain stats.
It also surfaces relevant notes from `brain-index.json` on every prompt via keyword matching.

After reading the hook output:

1. Confirm you understand the current state and priorities.
2. Query `.brain/brain-index.json` for keywords specific to the current task (see below).
3. Read only the notes the index points to. Never crawl the vault wholesale.

---

## How to Query brain-index.json

The index is a JSON array. Each entry has:

```
p   — relative path from .brain/
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
| New factual claim or insight | `knowledge-claim.md` | `.brain/knowledge/graph/research/` |
| Research on a repo or codebase | `research-finding.md` | `.brain/knowledge/graph/repo-research/` |
| A decision was made with rationale | `decision-record.md` | `.brain/knowledge/graph/research/` |
| A new project is being tracked | `project-context.md` | `.brain/atlas/` |
| A goal or north-star statement | `goal.md` | `.brain/goal/` |
| Stable how-to or process doc | `doc.md` | `.brain/docs/` |
| External source was ingested | `ingested-source.md` | `.brain/knowledge/graph/research/` |
| Uncertain / needs triage | any | `.brain/inbox/queue-generated/` |

Rules:
- Always copy the appropriate template from `.brain/_assets/templates/`.
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

- Use `.brain/knowledge/memory/` as persistent memory instead of `~/.claude` memory files.
- Store durable facts about the project, team, preferences, and constraints here.
- Use `knowledge-claim.md` template for memory notes.
- Knowledge graph notes (discoveries, research) go in `.brain/knowledge/graph/`.
- Memory notes (facts to recall next session) go in `.brain/knowledge/memory/`.

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

- Create daily notes in `.brain/00-home/daily/`.
- Name format: `YYYY-MM-DD.md`.
- Use the `daily-note.md` template.
- Link the daily note from `index.md` under the current week if an active-week section exists.
- Daily notes are maturity `working` — they are not meant to be permanent.

---

## The Inbox

When content arrives that you are not sure how to categorize:

1. Write it to `.brain/inbox/queue-generated/` using whatever template fits best.
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
- **Do not write to `~/.claude` memory when a `.brain/` vault is present.** The vault is the memory system.
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
Memory:          .brain/knowledge/memory/  (not ~/.claude)
Uncertain:       .brain/inbox/queue-generated/
Session end:     follow Stop hook directives → session log → top-of-mind → knowledge sweep
Links:           [[wiki-link]] syntax — auto-linked for knowledge/graph/ and sessions/
```
