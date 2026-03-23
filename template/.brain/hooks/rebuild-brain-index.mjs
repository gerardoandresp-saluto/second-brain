#!/usr/bin/env node
// rebuild-brain-index.mjs — Walk .brain/, extract metadata, write brain-index.json
// Usage: node rebuild-brain-index.mjs <brain-dir>

import { readdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join, relative, extname } from "path";

const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","be","been","have","has","had",
  "do","does","did","will","would","could","should","may","might","can",
  "shall","for","and","but","or","not","no","nor","so","yet","both",
  "either","neither","each","every","all","any","few","more","most",
  "other","some","such","than","too","very","just","also","now","then",
  "here","there","when","where","how","what","which","who","whom","this",
  "that","these","those","with","from","into","through","during","before",
  "after","above","below","between","about","i","me","my","we","our",
  "you","your","he","she","it","they","them","their","its","s","t","re",
  "ve","ll","d","m","in","on","at","to","of","up","by","as","if","use",
  "used","using","make","made","get","set","new","one","two","see","note",
]);

const EXCLUDE_DIRS = new Set(["_assets", ".obsidian", "hooks"]);

function walkMd(dir, results = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMd(full, results);
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      results.push(full);
    }
  }
  return results;
}

function parseFrontmatter(content) {
  if (!content.startsWith("---")) return { fields: {}, bodyStart: 0 };
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { fields: {}, bodyStart: 0 };
  const block = content.slice(4, end);
  const fields = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    if (val.startsWith("[")) {
      try { fields[key] = JSON.parse(val.replace(/'/g, '"')); } catch { fields[key] = val; }
    } else {
      fields[key] = val;
    }
  }
  return { fields, bodyStart: end + 4 };
}

function extractWikiLinks(text) {
  const matches = [...text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)];
  return [...new Set(matches.map(m => m[1].trim()))];
}

function extractSummary(body) {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) continue;
    return trimmed.slice(0, 100);
  }
  return "";
}

function extractBodyKeywords(body, relPath, topN = 10) {
  // Extract title words from filename for weighting (5x boost)
  const filename = relPath.split("/").pop().replace(/\.md$/, "").replace(/-/g, " ");
  const titleWords = filename
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));

  const words = body
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));

  const freq = {};
  // Title words get 5x weight
  for (const w of titleWords) freq[w] = (freq[w] ?? 0) + 5;
  for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w);
}

function normalizeTagList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    const stripped = raw.replace(/^\[|\]$/g, "").trim();
    if (!stripped) return [];
    return stripped.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function processFile(fullPath, brainDir) {
  let raw;
  try {
    raw = readFileSync(fullPath, "utf8");
  } catch {
    return null;
  }

  const { fields, bodyStart } = parseFrontmatter(raw);
  const body = raw.slice(bodyStart);
  const relPath = relative(brainDir, fullPath);
  const tags = normalizeTagList(fields.tags);
  const isMoc = tags.some(t => /^moc$/i.test(t));
  const links = extractWikiLinks(body);

  // Calculate age in days since last modified
  const stat = statSync(fullPath);
  const age = Math.floor((Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24));

  return {
    p:   relPath,
    m:   fields.maturity ?? "working",
    moc: isMoc,
    t:   tags,
    k:   normalizeTagList(fields.keywords),
    bk:  extractBodyKeywords(body, relPath),
    s:   extractSummary(body),
    l:   links,
    lc:  links.length,
    bl:  [],   // backlinks — populated in second pass
    age: age,  // days since last modified
  };
}

(function main() {
  const brainDir = process.argv[2];
  const verbose = process.argv.includes("--verbose");

  if (!brainDir) {
    console.error("Usage: node rebuild-brain-index.mjs <brain-dir> [--verbose]");
    process.exit(1);
  }

  const files = walkMd(brainDir);
  const entries = files
    .map(f => processFile(f, brainDir))
    .filter(Boolean)
    .sort((a, b) => a.p.localeCompare(b.p));

  // Second pass: calculate backlinks (reverse links)
  const slugToEntry = new Map();
  for (const entry of entries) {
    const slug = entry.p.replace(/\.md$/, "").split("/").pop().toLowerCase();
    slugToEntry.set(slug, entry);
  }
  for (const entry of entries) {
    const sourceSlug = entry.p.replace(/\.md$/, "").split("/").pop().toLowerCase();
    for (const link of entry.l) {
      const targetSlug = link.toLowerCase();
      const target = slugToEntry.get(targetSlug);
      if (target && !target.bl.includes(sourceSlug)) {
        target.bl.push(sourceSlug);
      }
    }
  }

  const index = {
    version:    3,
    updated:    new Date().toISOString(),
    note_count: entries.length,
    entries,
  };

  const outPath = join(brainDir, "brain-index.json");
  writeFileSync(outPath, JSON.stringify(index, null, 2) + "\n", "utf8");
  console.log(`[rebuild-brain-index] Indexed ${entries.length} notes → ${outPath}`);

  if (verbose) {
    const mocCount = entries.filter(e => e.moc).length;
    const withSummary = entries.filter(e => e.s && e.s.length > 0).length;
    const withBodyKw = entries.filter(e => e.bk && e.bk.length > 0).length;
    console.log(`Brain index v3 rebuilt: ${entries.length} notes (${mocCount} MOCs, ${withSummary} with summaries, ${withBodyKw} with body keywords)`);
  }
})();
