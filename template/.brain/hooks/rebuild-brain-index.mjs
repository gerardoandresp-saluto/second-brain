#!/usr/bin/env node
// Second Brain Framework — Index Builder
// Scans .brain/ and generates brain-index.json for token-efficient routing.
// No npm dependencies. Pure Node.js.

import { readdir, readFile, writeFile, rename, stat } from 'fs/promises';
import { join, relative, basename, extname } from 'path';

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

// Paths to skip
const SKIP_PATTERNS = [
  /^_assets\/templates\//,
  /^\.obsidian\//,
  /^hooks\//,
  /brain-index\.json$/,
];

function classifyMemoryType(relPath) {
  for (const rule of MEMORY_TYPE_RULES) {
    if (rule.pattern.test(relPath)) return rule.type;
  }
  return 'semantic'; // default
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const fm = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let inArray = false;

  for (const line of lines) {
    // Array item (indented with -)
    if (inArray && /^\s+-\s+(.+)/.test(line)) {
      const val = line.match(/^\s+-\s+(.+)/)[1].replace(/^["']|["']$/g, '').trim();
      if (val) fm[currentKey].push(val);
      continue;
    }

    // Key-value pair
    const kvMatch = line.match(/^(\w[\w_-]*)\s*:\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const rawVal = kvMatch[2].trim();

      // Inline array: [a, b, c]
      if (rawVal.startsWith('[')) {
        const items = rawVal.replace(/[\[\]]/g, '').split(',')
          .map(s => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
        fm[currentKey] = items;
        inArray = false;
        continue;
      }

      // Empty value followed by array items
      if (rawVal === '' || rawVal === '[]') {
        fm[currentKey] = [];
        inArray = true;
        continue;
      }

      // Scalar value
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

function extractKeywords(filename, fmKeywords, wikiLinks) {
  // Words from filename (the prose-as-title claim)
  const titleWords = filename
    .replace(/\.md$/, '')
    .toLowerCase()
    .split(/[\s\-_]+/)
    .filter(w => w.length > 2); // skip short words

  // Combine: frontmatter keywords + title words + first wiki-link targets
  const allKeywords = new Set();

  // Frontmatter keywords first (highest signal)
  if (Array.isArray(fmKeywords)) {
    fmKeywords.forEach(k => allKeywords.add(k.toLowerCase()));
  }

  // Title words
  titleWords.forEach(w => allKeywords.add(w));

  // Wiki-link targets (first 3)
  wikiLinks.slice(0, 3).forEach(link => {
    link.toLowerCase().split(/[\s\-_]+/)
      .filter(w => w.length > 2)
      .forEach(w => allKeywords.add(w));
  });

  // Cap at 8 keywords
  return [...allKeywords].slice(0, 8);
}

async function walkDir(dir, baseDir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') && entry.name !== '.brain') continue;
      files.push(...await walkDir(fullPath, baseDir));
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function buildIndex() {
  const mdFiles = await walkDir(BRAIN_DIR, BRAIN_DIR);
  const entries = [];

  for (const filePath of mdFiles) {
    const relPath = relative(BRAIN_DIR, filePath);

    // Skip templates, config, hooks
    if (SKIP_PATTERNS.some(p => p.test(relPath))) continue;

    const content = await readFile(filePath, 'utf-8');
    const fm = parseFrontmatter(content);
    const wikiLinks = extractWikiLinks(content);
    const filename = basename(relPath);
    const memoryType = fm.memory_type || classifyMemoryType(relPath);

    const keywords = extractKeywords(filename, fm.keywords, wikiLinks);
    const tags = Array.isArray(fm.tags) ? fm.tags.slice(0, 5) : [];
    const links = wikiLinks.slice(0, 3);

    const entry = { p: relPath, m: memoryType };

    if (tags.length > 0) entry.t = tags;
    if (keywords.length > 0) entry.k = keywords;
    if (fm.date) entry.d = fm.date.replace(/['"]/g, '');
    if (links.length > 0) entry.l = links;

    entries.push(entry);
  }

  const index = {
    version: '1.0.0',
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
  // Silent success in hook mode, verbose when run directly
  if (process.argv.includes('--verbose')) {
    console.log(`Brain index rebuilt: ${index.note_count} notes indexed`);
  }
} catch (err) {
  // Silent failure in hook mode
  if (process.argv.includes('--verbose')) {
    console.error('Index build failed:', err.message);
  }
  process.exit(1);
}
