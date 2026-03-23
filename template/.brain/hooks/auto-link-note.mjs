#!/usr/bin/env node
// auto-link-note.mjs — Auto-link new notes into relevant MOCs and index.md
// Usage: node auto-link-note.mjs <brain-dir> <note-absolute-path>
// Called by brain-index-updater.sh on Write operations

import { readFileSync, writeFileSync } from "fs";
import { relative, basename } from "path";
import { join } from "path";

const LINK_RULES = [
  {
    pathMatch: /^knowledge\/graph\/(research|repo-research)\//,
    targets: [
      { moc: "atlas/research.md", section: "## Active Threads" },
      { moc: "00-home/index.md", section: "## Knowledge Entry Points" },
    ],
  },
  {
    pathMatch: /^knowledge\/graph\//,
    targets: [
      { moc: "00-home/index.md", section: "## Knowledge Entry Points" },
    ],
  },
  {
    pathMatch: /^sessions\//,
    targets: [
      { moc: "00-home/index.md", section: "## Recent Sessions" },
    ],
  },
  {
    pathMatch: /^atlas\//,
    typeMatch: "project",
    targets: [
      { moc: "atlas/projects.md", section: "## Active" },
    ],
  },
];

function parseFrontmatter(content) {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 4);
  if (end === -1) return {};
  const block = content.slice(4, end);
  const fields = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return fields;
}

function insertLinkInSection(mocContent, sectionHeader, wikiLink) {
  const lines = mocContent.split("\n");
  let sectionIdx = -1;

  // Find the section header
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === sectionHeader) {
      sectionIdx = i;
      break;
    }
  }

  if (sectionIdx === -1) return null; // Section not found

  // Find insertion point: after the header and any existing links/content,
  // but before the next section header or end of file
  let insertIdx = sectionIdx + 1;

  // Skip blank lines after header
  while (insertIdx < lines.length && lines[insertIdx].trim() === "") {
    insertIdx++;
  }

  // Check if there's placeholder text (starts with _)
  if (insertIdx < lines.length && lines[insertIdx].trim().startsWith("_")) {
    // Replace placeholder with the link
    lines[insertIdx] = `- ${wikiLink}`;
    return lines.join("\n");
  }

  // Find the end of existing list items in this section
  let lastItemIdx = insertIdx - 1;
  while (insertIdx < lines.length) {
    const line = lines[insertIdx].trim();
    if (line.startsWith("##")) break; // Next section
    if (line.startsWith("- ") || line.startsWith("* ")) {
      lastItemIdx = insertIdx;
    }
    insertIdx++;
  }

  // Insert after the last list item, or right after header if empty section
  const insertAt = lastItemIdx + 1;
  lines.splice(insertAt, 0, `- ${wikiLink}`);
  return lines.join("\n");
}

function main() {
  const brainDir = process.argv[2];
  const notePath = process.argv[3];

  if (!brainDir || !notePath) {
    process.exit(1);
  }

  // Get relative path from brain dir
  const relPath = relative(brainDir, notePath);

  // Skip non-markdown or excluded paths
  if (!relPath.endsWith(".md")) process.exit(0);
  if (relPath.startsWith("_assets/") || relPath.startsWith(".obsidian/") || relPath.startsWith("hooks/")) {
    process.exit(0);
  }

  // Read the note to get its type
  let noteContent;
  try {
    noteContent = readFileSync(notePath, "utf-8");
  } catch {
    process.exit(0);
  }

  const frontmatter = parseFrontmatter(noteContent);
  const slug = basename(notePath, ".md");
  const wikiLink = `[[${slug}]]`;

  // Find matching rules (first match wins for rules with same path pattern,
  // but more specific rules are listed first)
  const matchedTargets = new Set();

  for (const rule of LINK_RULES) {
    if (!rule.pathMatch.test(relPath)) continue;
    if (rule.typeMatch && frontmatter.type !== rule.typeMatch) continue;

    for (const target of rule.targets) {
      const targetKey = `${target.moc}:${target.section}`;
      if (matchedTargets.has(targetKey)) continue;
      matchedTargets.add(targetKey);

      const mocPath = join(brainDir, target.moc);
      let mocContent;
      try {
        mocContent = readFileSync(mocPath, "utf-8");
      } catch {
        continue; // MOC doesn't exist
      }

      // Check if link already exists
      if (mocContent.includes(`[[${slug}]]`) || mocContent.includes(`[[${slug}|`)) {
        continue;
      }

      const updated = insertLinkInSection(mocContent, target.section, wikiLink);
      if (updated !== null) {
        writeFileSync(mocPath, updated);
      }
    }
  }
}

main();
