#!/usr/bin/env node
// Second Brain Framework — 4-Stage Memory Router (v2)
// Stage 1: FILTER — remove MOC/structural notes (unless queried)
// Stage 2: SCORE — enhanced scoring with body keywords + link density
// Stage 3: CLUSTER — group by topic for diverse results
// Stage 4: DISPLAY — show summary preview + connections
// No npm dependencies. Pure Node.js.

import { readFile } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_DIR = process.env.BRAIN_DIR || join(__dirname, '..');
const INDEX_PATH = join(BRAIN_DIR, 'brain-index.json');
const MAX_RESULTS = 7;

// Type priority multipliers
const TYPE_WEIGHT = {
  goal: 5,
  working: 3,
  reference: 2.5,
  procedural: 2,
  semantic: 1.5,
  episodic: 1,
};

// Terms that indicate the user IS asking about structure/navigation
const STRUCTURAL_TERMS = new Set([
  'index', 'navigation', 'structure', 'vault', 'brain',
  'template', 'folder', 'organize',
]);

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'some', 'them',
  'than', 'its', 'over', 'such', 'that', 'this', 'with', 'will', 'each',
  'make', 'like', 'from', 'just', 'into', 'about', 'what', 'which', 'when',
  'how', 'where', 'who', 'why', 'does', 'did', 'should', 'would', 'could',
  'please', 'help', 'want', 'need', 'use', 'using', 'used',
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function titleWords(path) {
  return basename(path)
    .replace(/\.md$/, '')
    .toLowerCase()
    .split(/[\s\-_]+/)
    .filter(w => w.length > 2);
}

function isRecent(dateStr, days) {
  if (!dateStr) return false;
  try {
    const noteDate = new Date(dateStr);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return noteDate >= cutoff;
  } catch {
    return false;
  }
}

// ── STAGE 1: FILTER ─────────────────────────────────────────────────
function filterEntries(entries, promptWords) {
  const isStructuralQuery = promptWords.some(w => STRUCTURAL_TERMS.has(w));
  if (isStructuralQuery) return entries;
  return entries.filter(e => !e.moc);
}

// ── STAGE 2: SCORE ──────────────────────────────────────────────────
function scoreEntry(entry, promptWords) {
  let score = 0;
  const promptSet = new Set(promptWords);

  // Frontmatter keyword matches (+5 each — explicit, high-signal)
  if (entry.k) {
    for (const kw of entry.k) {
      if (promptSet.has(kw)) score += 5;
      for (const pw of promptWords) {
        if (pw !== kw && pw.length > 3 && kw.length > 3) {
          if (pw.includes(kw) || kw.includes(pw)) score += 1;
        }
      }
    }
  }

  // Body keyword matches (+2 each — content-level signal)
  if (entry.bk) {
    for (const bkw of entry.bk) {
      if (promptSet.has(bkw)) score += 2;
      for (const pw of promptWords) {
        if (pw !== bkw && pw.length > 3 && bkw.length > 3) {
          if (pw.includes(bkw) || bkw.includes(pw)) score += 0.5;
        }
      }
    }
  }

  // Tag matches (+3 each)
  if (entry.t) {
    for (const tag of entry.t) {
      if (promptSet.has(tag.toLowerCase())) score += 3;
    }
  }

  // Title word overlap (+1 each)
  const tWords = titleWords(entry.p);
  for (const tw of tWords) {
    if (promptSet.has(tw)) score += 1;
  }

  // Link density bonus (well-connected = better curated)
  const lc = entry.lc || 0;
  if (lc > 5) score += 2;
  if (lc > 10) score += 1;

  // Recency bonuses (tiered)
  if (isRecent(entry.d, 1)) score += 3;
  else if (isRecent(entry.d, 7)) score += 2;
  else if (isRecent(entry.d, 30)) score += 1;

  // Type multiplier
  score *= TYPE_WEIGHT[entry.m] || 1;

  return score;
}

// ── STAGE 3: CLUSTER ────────────────────────────────────────────────
function clusterResults(scored) {
  if (scored.length <= MAX_RESULTS) return scored;

  // Group by shared wiki-links for diversity
  const clusters = new Map();

  for (const item of scored) {
    const links = item.entry.l || [];
    let assigned = false;

    for (const [, cluster] of clusters) {
      const clusterLinks = cluster.flatMap(c => c.entry.l || []);
      if (links.some(l => clusterLinks.includes(l))) {
        cluster.push(item);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      clusters.set(item.entry.p, [item]);
    }
  }

  // Round-robin across clusters for diversity
  const result = [];
  const clusterList = [...clusters.values()].sort((a, b) => b[0].score - a[0].score);
  let remaining = MAX_RESULTS;

  for (const cluster of clusterList) {
    if (remaining <= 0) break;
    const take = cluster === clusterList[0] ? Math.min(3, remaining) : Math.min(2, remaining);
    result.push(...cluster.slice(0, take));
    remaining -= take;
  }

  return result.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}

// ── STAGE 4: DISPLAY ────────────────────────────────────────────────
function formatOutput(results) {
  const brainFolderName = BRAIN_DIR.split('/').pop();
  const lines = ['', 'BRAIN MEMORY MATCHES:'];

  for (let i = 0; i < results.length; i++) {
    const { entry } = results[i];
    const title = basename(entry.p).replace(/\.md$/, '');

    lines.push(`  ${i + 1}. [${entry.m}] ${title}`);
    lines.push(`     ${brainFolderName}/${entry.p}`);

    // Summary preview — lets agent validate relevance without reading file
    if (entry.s) {
      lines.push(`     "${entry.s}"`);
    }

    const meta = [];
    if (entry.t && entry.t.length > 0) meta.push(`Tags: ${entry.t.join(', ')}`);
    if (entry.d) meta.push(`Date: ${entry.d}`);
    if (entry.lc) meta.push(`Links: ${entry.lc}`);
    if (meta.length > 0) lines.push(`     ${meta.join(' | ')}`);

    if (entry.l && entry.l.length > 0) {
      lines.push(`     Connected: ${entry.l.map(l => `[[${l}]]`).join(', ')}`);
    }
  }

  lines.push('');
  lines.push('Read the files above that are relevant. Follow [[links]] for deeper context.');
  lines.push('');

  return lines.join('\n');
}

// ── MAIN ────────────────────────────────────────────────────────────
async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let prompt = '';
  try {
    const data = JSON.parse(input);
    prompt = data.prompt || data.message || '';
  } catch {
    prompt = input;
  }

  if (!prompt.trim()) process.exit(0);
  if (prompt.trim().startsWith('/')) process.exit(0);

  let index;
  try {
    const raw = await readFile(INDEX_PATH, 'utf-8');
    index = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  if (!index.entries || index.entries.length === 0) process.exit(0);

  const promptWords = tokenize(prompt);
  if (promptWords.length === 0) process.exit(0);

  // Stage 1: Filter
  const candidates = filterEntries(index.entries, promptWords);

  // Stage 2: Score
  const scored = candidates
    .map(entry => ({ entry, score: scoreEntry(entry, promptWords) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) process.exit(0);

  // Stage 3: Cluster
  const clustered = clusterResults(scored);

  // Stage 4: Display
  console.log(formatOutput(clustered));
}

main().catch(() => process.exit(0));
