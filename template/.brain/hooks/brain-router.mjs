#!/usr/bin/env node
// Second Brain Framework — Memory Router
// Matches user prompts against brain-index.json and returns relevant memories.
// Runs as a UserPromptSubmit hook. No npm dependencies.

import { readFile } from 'fs/promises';
import { join, basename } from 'path';

// BRAIN_DIR passed via env from brain-router.sh (self-discovering)
import { dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_DIR = process.env.BRAIN_DIR || join(__dirname, '..');
const INDEX_PATH = join(BRAIN_DIR, 'brain-index.json');
const MAX_RESULTS = 5;

// Type priority multipliers
const TYPE_WEIGHT = {
  goal: 5,
  working: 3,
  reference: 2.5,
  procedural: 2,
  semantic: 1.5,
  episodic: 1,
};

// Common stop words to ignore in matching
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

function isRecent(dateStr) {
  if (!dateStr) return false;
  try {
    const noteDate = new Date(dateStr);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return noteDate >= weekAgo;
  } catch {
    return false;
  }
}

function scoreEntry(entry, promptWords) {
  let score = 0;
  const promptSet = new Set(promptWords);

  // Keyword matches (+3 each)
  if (entry.k) {
    for (const kw of entry.k) {
      if (promptSet.has(kw)) score += 3;
      // Partial match for compound words
      for (const pw of promptWords) {
        if (pw !== kw && (pw.includes(kw) || kw.includes(pw))) score += 1;
      }
    }
  }

  // Tag matches (+2 each)
  if (entry.t) {
    for (const tag of entry.t) {
      if (promptSet.has(tag.toLowerCase())) score += 2;
    }
  }

  // Title word overlap (+1 each)
  const tWords = titleWords(entry.p);
  for (const tw of tWords) {
    if (promptSet.has(tw)) score += 1;
  }

  // Recency bonus
  if (isRecent(entry.d)) score += 1;

  // Type multiplier
  const multiplier = TYPE_WEIGHT[entry.m] || 1;
  score *= multiplier;

  return score;
}

async function main() {
  // Read stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  // Parse prompt from hook input
  let prompt = '';
  try {
    const data = JSON.parse(input);
    prompt = data.prompt || data.message || '';
  } catch {
    // If not JSON, treat entire input as prompt
    prompt = input;
  }

  if (!prompt.trim()) process.exit(0);

  // Skip if prompt starts with / (command invocation)
  if (prompt.trim().startsWith('/')) process.exit(0);

  // Load index
  let index;
  try {
    const raw = await readFile(INDEX_PATH, 'utf-8');
    index = JSON.parse(raw);
  } catch {
    // No index yet — silently exit
    process.exit(0);
  }

  if (!index.entries || index.entries.length === 0) process.exit(0);

  // Tokenize prompt
  const promptWords = tokenize(prompt);
  if (promptWords.length === 0) process.exit(0);

  // Score all entries
  const scored = index.entries
    .map(entry => ({ entry, score: scoreEntry(entry, promptWords) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);

  if (scored.length === 0) process.exit(0);

  // Format output
  const lines = ['', 'BRAIN MEMORY MATCHES:'];
  for (let i = 0; i < scored.length; i++) {
    const { entry } = scored[i];
    const title = basename(entry.p).replace(/\.md$/, '');
    lines.push(`  ${i + 1}. [${entry.m}] ${title}`);
    const brainFolderName = BRAIN_DIR.split('/').pop();
    lines.push(`     Path: ${brainFolderName}/${entry.p}`);

    const meta = [];
    if (entry.t && entry.t.length > 0) meta.push(`Tags: ${entry.t.join(', ')}`);
    if (entry.d) meta.push(`Date: ${entry.d}`);
    if (meta.length > 0) lines.push(`     ${meta.join(' | ')}`);

    if (entry.l && entry.l.length > 0) {
      lines.push(`     Links: ${entry.l.map(l => `[[${l}]]`).join(', ')}`);
    }
  }
  lines.push('');
  lines.push('To load a memory, read the file at the listed path.');
  lines.push('');

  console.log(lines.join('\n'));
}

main().catch(() => process.exit(0));
