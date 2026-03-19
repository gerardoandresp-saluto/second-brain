#!/usr/bin/env node
// Second Brain Framework — Enhanced Index Builder (v2)
// 4-stage ranking pipeline support: extracts summary, body keywords,
// link density, and MOC classification for intelligent routing.
// No npm dependencies. Pure Node.js.

import { readdir, readFile, writeFile, rename } from 'fs/promises';
import { join, relative, basename } from 'path';

const BRAIN_DIR = process.argv[2] || process.env.CLAUDE_PROJECT_DIR + '/.brain';

// Memory type classification by path prefix
const MEMORY_TYPE_RULES = [
  { pattern: /^goal\//, type: 'goal' },
  { pattern: /^docs\//, type: 'reference' },
  { pattern: /^sessions\//, type: 'episodic' },
  { pattern: /^00-home\/daily\//, type: 'episodic' },
  { pattern: /^knowledge\/graph\/agent-daily\//, type: 'episodic' },
  { pattern: /^knowledge\/graph\/research\//, type: 'semantic' },
  { pattern: /^knowledge\/graph\/repo-research\//, type: 'semantic' },
  { pattern: /^knowledge\/graph\//, type: 'semantic' },
  { pattern: /^inbox\//, type: 'semantic' },
  { pattern: /^atlas\//, type: 'procedural' },
  { pattern: /^knowledge\/memory\//, type: 'procedural' },
  { pattern: /^00-home\/top-of-mind\.md$/, type: 'working' },
  { pattern: /^00-home\/index\.md$/, type: 'working' },
];

const SKIP_PATTERNS = [
  /^_assets\/templates\//,
  /^\.obsidian\//,
  /^hooks\//,
  /brain-index\.json$/,
  /\.last-session-notes$/,
];

// Extended stop words for body keyword extraction
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'some', 'them',
  'than', 'its', 'over', 'such', 'that', 'this', 'with', 'will', 'each',
  'make', 'like', 'from', 'just', 'into', 'about', 'what', 'which', 'when',
  'how', 'where', 'who', 'why', 'does', 'did', 'should', 'would', 'could',
  'please', 'help', 'want', 'need', 'use', 'using', 'used', 'also', 'more',
  'most', 'other', 'after', 'before', 'between', 'through', 'during', 'under',
  'above', 'below', 'then', 'here', 'there', 'these', 'those', 'only', 'very',
  'being', 'they', 'their', 'your', 'what', 'were', 'said', 'many', 'much',
  'well', 'back', 'even', 'give', 'still', 'way', 'take', 'come', 'know',
  'see', 'time', 'get', 'may', 'new', 'now', 'old', 'look', 'think', 'same',
  'tell', 'work', 'first', 'last', 'long', 'great', 'little', 'own', 'right',
  'big', 'high', 'small', 'large', 'next', 'early', 'young', 'important',
  'few', 'public', 'bad', 'good', 'fill', 'todo', 'note', 'notes', 'link',
  'file', 'files', 'section', 'update', 'updated', 'create', 'created',
]);

function classifyMemoryType(relPath) {
  for (const rule of MEMORY_TYPE_RULES) {
    if (rule.pattern.test(relPath)) return rule.type;
  }
  return 'semantic';
}

function isMOC(fm, relPath) {
  if (fm.type === 'home' || fm.type === 'atlas') return true;
  if (Array.isArray(fm.tags) && fm.tags.includes('MOC')) return true;
  // Structural files by name
  if (/^00-home\/(index|top-of-mind)\.md$/.test(relPath)) return true;
  if (/^atlas\/(projects|research)\.md$/.test(relPath)) return true;
  return false;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const fm = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let inArray = false;

  for (const line of lines) {
    if (inArray && /^\s+-\s+(.+)/.test(line)) {
      const val = line.match(/^\s+-\s+(.+)/)[1].replace(/^["']|["']$/g, '').trim();
      if (val) fm[currentKey].push(val);
      continue;
    }

    const kvMatch = line.match(/^(\w[\w_-]*)\s*:\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const rawVal = kvMatch[2].trim();

      if (rawVal.startsWith('[')) {
        const items = rawVal.replace(/[\[\]]/g, '').split(',')
          .map(s => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
        fm[currentKey] = items;
        inArray = false;
        continue;
      }

      if (rawVal === '' || rawVal === '[]') {
        fm[currentKey] = [];
        inArray = true;
        continue;
      }

      fm[currentKey] = rawVal.replace(/^["']|["']$/g, '');
      inArray = false;
    } else {
      inArray = false;
    }
  }

  return fm;
}

function extractWikiLinks(content) {
  const links = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}

function extractSummary(content) {
  // Strip frontmatter
  const body = content.replace(/^---[\s\S]*?---\s*/, '');
  const lines = body.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty, headings, horizontal rules, list markers with placeholder text
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('---')) continue;
    if (trimmed.startsWith('_') && trimmed.endsWith('_')) continue; // italic placeholders
    if (trimmed.length < 15) continue; // too short to be meaningful

    // Clean wiki-links for display
    const cleaned = trimmed.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, link, alias) => alias || link);
    return cleaned.substring(0, 120);
  }
  return '';
}

function extractBodyKeywords(content) {
  // Strip frontmatter
  const body = content.replace(/^---[\s\S]*?---\s*/, '');

  // Tokenize: lowercase, remove markdown syntax, split on non-word
  const words = body
    .toLowerCase()
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // extract wiki-link text
    .replace(/[#*`|>\-=~_\[\](){}]/g, ' ') // strip markdown
    .replace(/https?:\/\/\S+/g, '') // strip URLs
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  // Count frequency
  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  // Sort by frequency, take top 10
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

function extractKeywords(filename, fmKeywords, wikiLinks) {
  const titleWords = filename
    .replace(/\.md$/, '')
    .toLowerCase()
    .split(/[\s\-_]+/)
    .filter(w => w.length > 2);

  const allKeywords = new Set();

  if (Array.isArray(fmKeywords)) {
    fmKeywords.forEach(k => allKeywords.add(k.toLowerCase()));
  }

  titleWords.forEach(w => allKeywords.add(w));

  wikiLinks.slice(0, 3).forEach(link => {
    link.toLowerCase().split(/[\s\-_]+/)
      .filter(w => w.length > 2)
      .forEach(w => allKeywords.add(w));
  });

  return [...allKeywords].slice(0, 10);
}

async function walkDir(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') && entry.name !== '.brain') continue;
      files.push(...await walkDir(fullPath));
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function buildIndex() {
  const mdFiles = await walkDir(BRAIN_DIR);
  const entries = [];
  const allNoteNames = new Map(); // name → entry index for backlink counting

  // First pass: build entries
  for (const filePath of mdFiles) {
    const relPath = relative(BRAIN_DIR, filePath);
    if (SKIP_PATTERNS.some(p => p.test(relPath))) continue;

    const content = await readFile(filePath, 'utf-8');
    const fm = parseFrontmatter(content);
    const wikiLinks = extractWikiLinks(content);
    const filename = basename(relPath);
    const memoryType = fm.memory_type || classifyMemoryType(relPath);

    const keywords = extractKeywords(filename, fm.keywords, wikiLinks);
    const tags = Array.isArray(fm.tags) ? fm.tags.slice(0, 5) : [];
    const links = wikiLinks.slice(0, 5);
    const summary = extractSummary(content);
    const bodyKeywords = extractBodyKeywords(content);
    const mocFlag = isMOC(fm, relPath);

    const entry = { p: relPath, m: memoryType };

    if (mocFlag) entry.moc = true;
    if (tags.length > 0) entry.t = tags;
    if (keywords.length > 0) entry.k = keywords;
    if (bodyKeywords.length > 0) entry.bk = bodyKeywords;
    if (summary) entry.s = summary;
    if (fm.date) entry.d = fm.date.replace(/['"]/g, '');
    if (links.length > 0) entry.l = links;

    // Outbound link count
    entry.lc = wikiLinks.length;

    const noteName = basename(relPath, '.md');
    allNoteNames.set(noteName.toLowerCase(), entries.length);
    entries.push(entry);
  }

  // Second pass: count inbound links (backlinks)
  for (const entry of entries) {
    if (entry.l) {
      for (const link of entry.l) {
        const targetName = basename(link).toLowerCase();
        const targetIdx = allNoteNames.get(targetName);
        if (targetIdx !== undefined) {
          entries[targetIdx].lc = (entries[targetIdx].lc || 0) + 1;
        }
      }
    }
  }

  const index = {
    version: '2.0.0',
    updated: new Date().toISOString(),
    note_count: entries.length,
    entries,
  };

  // Atomic write
  const indexPath = join(BRAIN_DIR, 'brain-index.json');
  const tmpPath = indexPath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(index, null, 2));
  await rename(tmpPath, indexPath);

  return index;
}

try {
  const index = await buildIndex();
  if (process.argv.includes('--verbose')) {
    const mocs = index.entries.filter(e => e.moc).length;
    const withSummary = index.entries.filter(e => e.s).length;
    const withBodyKw = index.entries.filter(e => e.bk && e.bk.length > 0).length;
    console.log(`Brain index v2 rebuilt: ${index.note_count} notes (${mocs} MOCs, ${withSummary} with summaries, ${withBodyKw} with body keywords)`);
  }
} catch (err) {
  if (process.argv.includes('--verbose')) {
    console.error('Index build failed:', err.message);
  }
  process.exit(1);
}
