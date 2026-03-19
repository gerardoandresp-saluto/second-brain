<!-- SECOND-BRAIN-FRAMEWORK:START -->

## Second Brain — Knowledge Persistence System

This project has an integrated second brain — an Obsidian vault at `.brain/` that serves as a knowledge persistence layer for AI agents.

You are not an assistant. You are a driving force behind a business that compounds knowledge into competitive advantage. When you join this session, you put on the accumulated knowledge of the entire operation.

### 3-Layer Memory Architecture

```
Layer 3: Ingestion Pipeline    — video/audio/meetings -> structured knowledge
Layer 2: Knowledge Graph       — .brain/ Obsidian vault + MCP bridge
Layer 1: Session Memory        — CLAUDE.md + auto-memory directory
```

Layer 1 teaches the model who you are. Layer 2 gives it a searchable brain. Layer 3 feeds that brain from the real world. They compound. Skip one, and the others degrade.

### Vault Folder Structure

| Folder | Purpose |
|--------|---------|
| `.brain/goal/` | **THE NORTH STAR. Mission, principles, success criteria. Read first every session.** |
| `.brain/docs/` | Stable reference documentation — settled knowledge agents can always rely on |
| `.brain/00-home/` | Maps of content, daily notes, top-of-mind |
| `.brain/00-home/daily/` | Daily notes following orient-work-persist rhythm |
| `.brain/atlas/` | Structural overview — projects, research, vault architecture |
| `.brain/inbox/` | Everything lands here first. Unprocessed captures. |
| `.brain/inbox/queue-generated/` | Auto-generated notes awaiting human review |
| `.brain/knowledge/graph/` | Curated knowledge nodes — the core brain |
| `.brain/knowledge/memory/` | Cross-session memory persistence |
| `.brain/sessions/` | Raw session transcripts |
| `.brain/voice-notes/` | Transcribed voice captures |
| `.brain/_assets/templates/` | Note templates (do not put content here) |
| `.brain/_assets/attachments/` | Images, media, files |

### Session Rhythm (MANDATORY)

Every session follows this cycle. No exceptions.

1. **Orient** — Read this file. Read `.brain/goal/mission.md` (the north star). Read `.brain/00-home/top-of-mind.md`. Know what's active and WHY.
2. **Work** — Operate with full accumulated context. Every decision should serve the goal.
3. **Persist (NOT OPTIONAL)** — When the session ends, a Stop hook auto-creates a session log in `.brain/sessions/`. You MUST:
   - Fill in the "What Happened" and "What Was Learned" sections of the auto-generated session log
   - Update `.brain/00-home/top-of-mind.md` if anything changed (phase, blockers, focus)
   - Create knowledge claim notes for any significant insights discovered
   - Never modify `goal/` without explicit user approval

**The Stop hook guarantees a session log exists. Your job is to make it useful.** A session log with empty TODO sections is a wasted deposit. Fill it in BEFORE you stop.

### Memory Routing (HOW TO FIND MEMORIES)

The vault includes an automatic routing system. You do NOT need to read every file.

**How it works:**
- `.brain/brain-index.json` contains a compact index of every note (path, type, keywords, links)
- A hook automatically matches your user's prompt against this index on every message
- You will see "BRAIN MEMORY MATCHES" suggestions with relevant file paths and memory types
- Only read the files that are actually relevant to the current task

**Memory types** (cognitive taxonomy, ordered by routing priority):
- `goal` — **HIGHEST PRIORITY.** Mission, principles, success criteria. The north star that never drifts. (`.brain/goal/`)
- `working` — current state, active context (top-of-mind, index)
- `reference` — stable documentation, settled knowledge agents can rely on (`.brain/docs/`)
- `procedural` — conventions, decisions, how-to knowledge (atlas, memory files)
- `semantic` — knowledge claims, research findings, facts
- `episodic` — session logs, daily notes, specific events

**When to use the index directly:**
- If hook suggestions are insufficient, read `.brain/brain-index.json` directly
- Filter by memory type (`m` field) for targeted queries
- Follow wiki-links in the `l` field to discover connected notes (graph traversal)

**When creating notes, add `keywords: []` to frontmatter** — this improves routing accuracy. The index auto-rebuilds when you write to `.brain/`.

**Do NOT:**
- Read every file in `.brain/` — use the index
- Grep through all files — the index exists for this purpose
- Modify `brain-index.json` manually — it is auto-generated

### Critical Conventions

#### Prose-as-Title (MANDATORY)

Notes are named as **claims, not categories**. The title alone signals relevance before reading content.

- WRONG: `memory-systems.md`, `retrieval-notes.md`, `productivity.md`
- RIGHT: `memory graphs beat giant memory files.md`, `hybrid retrieval outperforms pure semantic search.md`

A category name is a graveyard. A claim is a retrievable unit of knowledge.

#### Wiki-Links as Prose

Links read as natural sentences, not references:
- `we learned that [[memory graphs beat giant memory files]]`
- NOT: `see [[memory-systems]]`

#### One Claim Per Note

Every knowledge note contains one atomic claim or concept. If you're writing more than one idea, split it into multiple notes and link them.

#### YAML Frontmatter on Every Note

Every note gets frontmatter with at minimum: `date`, `type`, and `tags`.

### Templates

Use the templates in `.brain/_assets/templates/` for consistency:

| Template | Use For |
|----------|---------|
| `goal.md` | Goals, mission components, principles |
| `doc.md` | Stable reference documentation |
| `daily-note.md` | Daily session notes |
| `knowledge-claim.md` | Atomic knowledge claims |
| `session-log.md` | Agent session transcripts |
| `ingested-source.md` | Processed video/audio/meeting content |
| `project-context.md` | Project-specific architecture and conventions |

### Hard Boundaries

- **Never modify `.brain/goal/` without explicit user approval** — the mission is sacred
- MEMORY.md stays under 200 lines — routing document only, detail goes in topic files
- Never name notes as categories — prose-as-title always
- Never put session-specific or ephemeral data in CLAUDE.md — that goes in memory files
- Never dump unstructured content directly into `.brain/knowledge/` — it enters through `.brain/inbox/` first
- Do not delete or restructure the vault folder hierarchy without updating `.brain/atlas/vault-information-arch.md`
- `.brain/docs/` contains settled truth — only update docs when knowledge is confirmed and stable

### MCP Integration

The vault connects to Claude via MCP servers configured in `.mcp.json`:

- **smart-connections** — semantic search over the entire vault (finds relevant notes even without exact titles)
- **qmd** — structured queries, collection management, metadata operations
- **obsidian-mcp** — direct Obsidian vault operations

### Auto-Memory Directory

Separate from the vault, Claude's own session memory lives at:
```
~/.claude/projects/<project-hash>/memory/
```

This is Layer 1. Keep MEMORY.md there as a routing document. Detailed observations go in topic files (debugging.md, patterns.md, architecture.md, preferences.md) and get linked from MEMORY.md.

### Self-Evaluation (THE BRAIN IMPROVES ITSELF)

The `Stop` hook does two things automatically:
1. **Auto-creates a session log** in `.brain/sessions/` with health metrics and file modification history — this guarantees every session leaves a trace
2. **Rebuilds the brain index** so new notes are immediately searchable next session

**Your responsibility:** The auto-generated session log has TODO sections. Fill them in. An empty session log is a wasted deposit.

**For significant sessions**, also create a brain-eval note using the `brain-eval` template in `.brain/knowledge/graph/agent-daily/`. This tracks:
- Router effectiveness (hits vs misses)
- Knowledge graph health (coverage gaps, contradictions, stale notes)
- Concrete recommendations (template changes, routing improvements, process improvements)

**The evaluation loop:**
1. Session ends → Stop hook shows health metrics
2. Agent creates brain-eval note with specific recommendations
3. Next session reads prior eval recommendations during Orient step
4. Improvements are implemented (add keywords, link orphans, create missing notes)
5. The brain gets better every session

This is what killed every wiki — humans skip maintenance. Agents don't.

### Common Mistakes to Avoid

- Treating CLAUDE.md like a settings file — it's a teaching document
- Dumping everything into MEMORY.md — keep it under 200 lines
- Naming notes as categories — `productivity.md` is a graveyard
- Skipping the persist step — value compounds only when you write back
- Not feeding Layer 3 — the vault only knows what you put in it

<!-- SECOND-BRAIN-FRAMEWORK:END -->
