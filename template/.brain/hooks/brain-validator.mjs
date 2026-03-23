#!/usr/bin/env node
// brain-validator.mjs — Validate vault health
// Usage: node brain-validator.mjs <brain-dir> [--fix]
// Reports: broken links, missing frontmatter, duplicates, stale notes

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, relative, extname } from "path";

const EXCLUDE_DIRS = new Set(["_assets", ".obsidian", "hooks"]);

const REQUIRED_FRONTMATTER = ["date", "type", "tags", "keywords"];

const VALID_TYPES = new Set([
  "claim", "research", "session", "decision", "project", "goal",
  "daily", "brain-eval", "docs", "ingested", "home", "atlas",
  "map", "moc", "procedural", "reference", "voice-note", "inbox", "fleeting",
]);

const VALID_MATURITY = new Set(["working", "procedural", "reference", "goal"]);

function walkMd(dir, results = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkMd(full, results);
    else if (entry.isFile() && extname(entry.name) === ".md") results.push(full);
  }
  return results;
}

function parseFrontmatter(content) {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return null;
  const block = content.slice(4, end);
  const fields = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!m) continue;
    fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

function extractWikiLinks(text) {
  return [...text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map(m => m[1].trim());
}

export function validate(brainDir) {
  const files = walkMd(brainDir);
  const issues = [];
  const notesByPath = new Map();
  const allNoteSlugs = new Set();

  // First pass: parse all notes
  for (const file of files) {
    const relPath = relative(brainDir, file);
    const content = readFileSync(file, "utf8");
    const fm = parseFrontmatter(content);
    const stat = statSync(file);
    const slug = relPath.replace(/\.md$/, "").split("/").pop().toLowerCase();

    notesByPath.set(relPath, { content, fm, stat, file, slug });
    allNoteSlugs.add(slug);
  }

  // Second pass: validate
  for (const [relPath, note] of notesByPath) {
    // 1. Frontmatter checks
    if (!note.fm) {
      issues.push({ type: "missing-frontmatter", path: relPath, severity: "error",
        message: `No YAML frontmatter found` });
      continue;
    }

    for (const field of REQUIRED_FRONTMATTER) {
      if (!note.fm[field] && field !== "keywords") {
        issues.push({ type: "missing-field", path: relPath, severity: "warning",
          message: `Missing required field: ${field}` });
      }
    }

    if (note.fm.type && !VALID_TYPES.has(note.fm.type.replace(/"/g, ""))) {
      issues.push({ type: "invalid-type", path: relPath, severity: "warning",
        message: `Unknown type: ${note.fm.type}` });
    }

    if (note.fm.maturity && !VALID_MATURITY.has(note.fm.maturity.replace(/"/g, ""))) {
      issues.push({ type: "invalid-maturity", path: relPath, severity: "warning",
        message: `Unknown maturity: ${note.fm.maturity}` });
    }

    // 2. Broken link detection
    const links = extractWikiLinks(note.content);
    for (const link of links) {
      const linkSlug = link.toLowerCase();
      if (!allNoteSlugs.has(linkSlug)) {
        issues.push({ type: "broken-link", path: relPath, severity: "warning",
          message: `Broken wiki-link: [[${link}]]` });
      }
    }

    // 3. Staleness detection (notes not modified in 180+ days)
    const daysSinceModified = (Date.now() - note.stat.mtimeMs) / (1000 * 60 * 60 * 24);
    if (daysSinceModified > 180) {
      issues.push({ type: "stale", path: relPath, severity: "info",
        message: `Note not modified in ${Math.floor(daysSinceModified)} days` });
    }
  }

  // 4. Duplicate detection (Jaccard similarity on body keywords)
  const entries = [...notesByPath.entries()];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [pathA, noteA] = entries[i];
      const [pathB, noteB] = entries[j];
      const wordsA = new Set(noteA.content.toLowerCase().match(/\b\w{4,}\b/g) || []);
      const wordsB = new Set(noteB.content.toLowerCase().match(/\b\w{4,}\b/g) || []);
      if (wordsA.size < 10 || wordsB.size < 10) continue; // Skip small notes
      const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
      const union = new Set([...wordsA, ...wordsB]).size;
      const similarity = intersection / union;
      if (similarity > 0.8) {
        issues.push({ type: "duplicate", path: pathA, severity: "warning",
          message: `~${Math.round(similarity * 100)}% similar to ${pathB}` });
      }
    }
  }

  // 5. Orphan detection (no inbound or outbound links)
  const inboundLinks = new Map();
  for (const [relPath, note] of notesByPath) {
    const links = extractWikiLinks(note.content);
    for (const link of links) {
      const slug = link.toLowerCase();
      if (!inboundLinks.has(slug)) inboundLinks.set(slug, []);
      inboundLinks.get(slug).push(relPath);
    }
  }

  for (const [relPath, note] of notesByPath) {
    const outbound = extractWikiLinks(note.content);
    const slug = note.slug;
    const inbound = inboundLinks.get(slug) || [];
    if (outbound.length === 0 && inbound.length === 0) {
      issues.push({ type: "orphan", path: relPath, severity: "info",
        message: `Orphan note: no inbound or outbound links` });
    }
  }

  return {
    noteCount: notesByPath.size,
    issueCount: issues.length,
    issues,
    summary: {
      errors: issues.filter(i => i.severity === "error").length,
      warnings: issues.filter(i => i.severity === "warning").length,
      info: issues.filter(i => i.severity === "info").length,
    },
  };
}

// CLI mode
if (process.argv[1]?.endsWith("brain-validator.mjs")) {
  const brainDir = process.argv[2];
  if (!brainDir) {
    console.error("Usage: node brain-validator.mjs <brain-dir>");
    process.exit(1);
  }

  const result = validate(brainDir);

  console.log(`\nVault Health Report: ${result.noteCount} notes, ${result.issueCount} issues`);
  console.log(`  Errors: ${result.summary.errors}  Warnings: ${result.summary.warnings}  Info: ${result.summary.info}\n`);

  for (const issue of result.issues) {
    const icon = issue.severity === "error" ? "\u2717" : issue.severity === "warning" ? "\u26A0" : "\u2139";
    console.log(`  ${icon} [${issue.type}] ${issue.path}: ${issue.message}`);
  }

  process.exit(result.summary.errors > 0 ? 1 : 0);
}
