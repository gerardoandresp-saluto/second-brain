#!/usr/bin/env node
// Bootstrap Populator — Reads a scan manifest and generates brain notes.
// Usage: node bootstrap-populate.mjs /path/to/.brain /path/to/manifest.json

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";

const BRAIN_DIR = process.argv[2];
const MANIFEST_PATH = process.argv[3];

if (!BRAIN_DIR || !MANIFEST_PATH) {
  console.error("Usage: node bootstrap-populate.mjs /path/to/.brain /path/to/manifest.json");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
const today = new Date().toISOString().split("T")[0];

const BANNER = "> [!WARNING] **[BOOTSTRAPPED — REVIEW]**\n> Auto-generated from project data. Verify accuracy and remove this banner once reviewed.\n";
const BOOTSTRAP_FRONTMATTER = `source: bootstrap\nbootstrapped: true\nreview_status: pending`;

let filesCreated = 0;

// ── Helpers ──────────────────────────────────────────────────────────

function isTemplateDefault(filePath) {
  // Check if a file is still the empty template (no real content added)
  try {
    const existing = readFileSync(filePath, "utf-8");
    if (existing.includes("bootstrapped: true")) return false; // Already bootstrapped
    if (existing.includes("_Define the north star")) return true;
    if (existing.includes("_What's active right now?")) return true;
    if (existing.includes("_Map of all tracked projects")) return true;
    if (existing.includes("_These guide every decision")) return true;
    return false;
  } catch {
    return false;
  }
}

function writeBrainNote(filePath, content) {
  if (existsSync(filePath) && !isTemplateDefault(filePath)) {
    return false;
  }
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, "utf-8");
  filesCreated++;
  return true;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function formatMemoryEntry(mem, recentCommits) {
  const desc = mem.description || mem.name;
  const dateSuffix = mem.lastModified ? ` (as of ${mem.lastModified})` : "";

  // Check if memory might be stale by cross-referencing with recent commits
  let staleWarning = "";
  if (recentCommits?.length > 0 && desc) {
    const skipWords = new Set(["the", "and", "for", "from", "with", "this", "that", "after", "next", "task", "phase", "plan", "planned", "implementation"]);
    const keywords = desc.toLowerCase().match(/\b[a-z]{3,}\b/g)?.filter(w => !skipWords.has(w)) || [];
    const commitText = recentCommits.join(" ").toLowerCase();
    const matchCount = keywords.filter(kw => commitText.includes(kw)).length;
    if (matchCount >= 2) {
      staleWarning = " **[may be stale — check recent commits]**";
    }
  }

  return `- ${desc}${dateSuffix}${staleWarning}`;
}

// ── 1. Goal / Mission ────────────────────────────────────────────────

function populateMission() {
  const missionPath = join(BRAIN_DIR, "goal", "mission.md");
  const isTemplateReadme = manifest.readme?.isTemplate;
  const claudeSections = manifest.existingAgentConfig?.claudeMdSections;

  // Build mission from available sources
  let missionStatement = null;
  let description = null;

  // Try README first paragraph (skip if template README)
  if (manifest.readme?.firstParagraph && !isTemplateReadme) {
    missionStatement = manifest.readme.firstParagraph;
  }

  // Package.json description as fallback or supplement
  if (manifest.project?.description) {
    description = manifest.project.description;
    if (!missionStatement) missionStatement = description;
  }

  // Try CLAUDE.md "Project Overview" section (preferred when README is template)
  if (claudeSections?.projectOverview) {
    missionStatement = claudeSections.projectOverview.trim();
  }

  if (!missionStatement) return;

  const projectName = manifest.project?.name || "Unknown Project";

  const content = `---
date: "${today}"
type: goal
tags:
  - goal
  - mission
keywords:
  - mission
  - purpose
  - vision
  - objective
${BOOTSTRAP_FRONTMATTER}
---

# ${projectName} — Mission

${BANNER}

## Mission Statement

${missionStatement}

## Description

${description || "_Not detected — fill in manually._"}

## Success Criteria

_Review and define — what does success look like for this project?_

-

## Non-Negotiables

_Review and define — what must always be true?_

-

## Out of Scope

_Review and define — what is explicitly NOT part of this mission?_

-
`;

  if (writeBrainNote(missionPath, content)) {
    console.log("  ✓ goal/mission.md");
  }
}

// ── 2. Top of Mind ───────────────────────────────────────────────────

function populateTopOfMind() {
  const tomPath = join(BRAIN_DIR, "00-home", "top-of-mind.md");

  // Estimate project phase from git data
  let phase = "Unknown";
  const commitCount = manifest.git?.commitCount || 0;
  if (commitCount === 0) phase = "Pre-development";
  else if (commitCount < 10) phase = "Early development";
  else if (commitCount < 50) phase = "Active development";
  else if (commitCount < 200) phase = "Maturing";
  else phase = "Established";

  // Active branches (exclude main/master/develop)
  const activeBranches = (manifest.git?.branches || [])
    .filter(b => !["main", "master", "develop", "development"].includes(b));

  // Recent commits
  const recentCommits = (manifest.git?.recentCommits || []).slice(0, 7);

  // Claude memory insights for active work
  const projectMemories = (manifest.claudeMemory || [])
    .filter(m => m.type === "project");

  let activeProjectsSection = "";
  if (activeBranches.length > 0) {
    activeProjectsSection = activeBranches.map(b => `- \`${b}\``).join("\n");
  }
  if (projectMemories.length > 0) {
    const memoryInsights = projectMemories
      .map(m => formatMemoryEntry(m, manifest.git?.recentCommits))
      .join("\n");
    activeProjectsSection += (activeProjectsSection ? "\n\n" : "") +
      "**From Claude memory:**\n" + memoryInsights;
  }
  if (!activeProjectsSection) {
    activeProjectsSection = "_No active branches detected._";
  }

  let recentActivitySection = "";
  if (recentCommits.length > 0) {
    recentActivitySection = recentCommits.map(c => `- ${c}`).join("\n");
  } else {
    recentActivitySection = "_No recent commits._";
  }

  const content = `---
type: home
tags:
  - MOC
keywords:
  - active
  - current
  - focus
  - status
  - priorities
${BOOTSTRAP_FRONTMATTER}
---

# Top of Mind

${BANNER}

## Current Phase

**${phase}** (${commitCount} commits)

## Active Projects

${activeProjectsSection}

## Recent Activity

${recentActivitySection}

## Open Questions

_Review — what are the current unknowns?_

## Blocked On

_Review — what's blocking progress?_

## This Week's Focus

_Review — what should this week's work prioritize?_

`;

  if (writeBrainNote(tomPath, content)) {
    console.log("  ✓ 00-home/top-of-mind.md");
  }
}

// ── 3. Projects ──────────────────────────────────────────────────────

function populateProjects() {
  const projectsPath = join(BRAIN_DIR, "atlas", "projects.md");

  const branches = manifest.git?.branches || [];
  const mainBranches = ["main", "master", "develop", "development"];
  const activeBranches = branches.filter(b => !mainBranches.includes(b));
  const tags = manifest.git?.tags || [];

  let activeSection = activeBranches.length > 0
    ? activeBranches.map(b => `- \`${b}\``).join("\n")
    : "_No feature branches detected._";

  let completedSection = tags.length > 0
    ? tags.slice(0, 10).map(t => `- \`${t}\``).join("\n")
    : "_No release tags detected._";

  // Enrich with Claude memory project entries
  const projectMemories = (manifest.claudeMemory || [])
    .filter(m => m.type === "project");
  if (projectMemories.length > 0) {
    activeSection += "\n\n**From Claude memory:**\n" +
      projectMemories.map(m => formatMemoryEntry(m, manifest.git?.recentCommits)).join("\n");
  }

  const content = `---
type: atlas
tags:
  - MOC
  - atlas
keywords:
  - projects
  - active
  - paused
  - completed
${BOOTSTRAP_FRONTMATTER}
---

# Projects

${BANNER}

## Active

${activeSection}

## Paused

_Review — any paused work?_

## Completed

${completedSection}

`;

  if (writeBrainNote(projectsPath, content)) {
    console.log("  ✓ atlas/projects.md");
  }
}

// ── 4. Project Overview (docs) ───────────────────────────────────────

function populateProjectOverview() {
  const overviewPath = join(BRAIN_DIR, "docs", "project-overview.md");
  const projectName = manifest.project?.name || "Project";
  const isTemplateReadme = manifest.readme?.isTemplate;
  const claudeSections = manifest.existingAgentConfig?.claudeMdSections;

  let overviewContent = "";
  let sourceLabel = "";

  if (isTemplateReadme) {
    // README is a framework template — use CLAUDE.md sections instead
    const parts = [];
    if (claudeSections?.projectOverview) parts.push("## Project Overview\n\n" + claudeSections.projectOverview);
    if (claudeSections?.architecture) parts.push("## Architecture\n\n" + claudeSections.architecture);
    if (claudeSections?.database) parts.push("## Database\n\n" + claudeSections.database);
    if (claudeSections?.storage) parts.push("## Storage\n\n" + claudeSections.storage);
    if (parts.length === 0) return; // No useful content from either source
    overviewContent = parts.join("\n\n");
    sourceLabel = "_Project overview extracted from CLAUDE.md (README was a framework template)._";
  } else if (manifest.readme?.full) {
    overviewContent = manifest.readme.full;
    sourceLabel = "_Full README content imported as reference documentation._";
  } else {
    return;
  }

  const content = `---
date: "${today}"
type: docs
tags:
  - docs
  - overview
keywords:
  - readme
  - overview
  - documentation
  - architecture
  - ${projectName}
${BOOTSTRAP_FRONTMATTER}
last_verified: "${today}"
---

# ${projectName} — Project Overview

${BANNER}

${sourceLabel}

---

${overviewContent}
`;

  if (writeBrainNote(overviewPath, content)) {
    console.log("  ✓ docs/project-overview.md");
  }
}

// ── 5. Tech Stack (docs) ─────────────────────────────────────────────

function populateTechStack() {
  if (manifest.techStack.length === 0) return;

  const techPath = join(BRAIN_DIR, "docs", "tech-stack.md");
  const projectName = manifest.project?.name || "Project";

  // Group by category
  const byCategory = {};
  for (const item of manifest.techStack) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  }

  let tableRows = "";
  for (const [category, items] of Object.entries(byCategory)) {
    for (const item of items) {
      const version = item.version ? ` ${item.version}` : "";
      tableRows += `| ${category} | ${item.technology}${version} | \`${item.detectedFrom}\` |\n`;
    }
  }

  // Include key dependencies from package.json
  let depsSection = "";
  if (manifest.project?.dependencies?.length > 0) {
    depsSection = `\n## Key Dependencies\n\n${manifest.project.dependencies.map(d => `- \`${d}\``).join("\n")}\n`;
  }

  // Include build scripts
  let scriptsSection = "";
  const scripts = manifest.scripts || {};
  if (Object.keys(scripts).length > 0) {
    scriptsSection = "\n## Build Scripts\n\n| Script | Command |\n|--------|--------|\n";
    for (const [name, cmd] of Object.entries(scripts)) {
      scriptsSection += `| \`${name}\` | \`${cmd}\` |\n`;
    }
    scriptsSection += "\n";
  }

  const content = `---
date: "${today}"
type: docs
tags:
  - docs
  - tech-stack
keywords:
  - technology
  - stack
  - dependencies
  - tooling
  - ${projectName}
${BOOTSTRAP_FRONTMATTER}
last_verified: "${today}"
---

# ${projectName} — Tech Stack

${BANNER}

## Detected Stack

| Category | Technology | Detected From |
|----------|-----------|---------------|
${tableRows}
${depsSection}${scriptsSection}`;

  if (writeBrainNote(techPath, content)) {
    console.log("  ✓ docs/tech-stack.md");
  }
}

// ── 6. ADR → Decision Records ────────────────────────────────────────

function populateDecisionRecords() {
  if (manifest.adrs.length === 0) return;

  const decisionDir = join(BRAIN_DIR, "knowledge", "graph", "research");
  if (!existsSync(decisionDir)) mkdirSync(decisionDir, { recursive: true });

  for (const adr of manifest.adrs) {
    const slug = slugify(adr.filename.replace(/\.md$/, ""));
    const notePath = join(decisionDir, `${slug}.md`);

    let title = adr.filename.replace(/\.md$/, "").replace(/[-_]/g, " ");
    const titleMatch = adr.content.match(/^#\s+(.+)/m);
    if (titleMatch) title = titleMatch[1];

    const content = `---
date: "${today}"
type: decision
decision: "${title}"
status: accepted
tags:
  - decision
  - adr
keywords:
  - ${slug.split("-").join("\n  - ")}
${BOOTSTRAP_FRONTMATTER}
---

# ${title}

${BANNER}

_Imported from \`${adr.sourceDir}/${adr.filename}\`_

---

${adr.content}
`;

    if (writeBrainNote(notePath, content)) {
      console.log(`  ✓ knowledge/graph/research/${slug}.md`);
    }
  }
}

// ── 7. Setup (knowledge/memory) ──────────────────────────────────────

function populateSetup() {
  const setupPath = join(BRAIN_DIR, "knowledge", "memory", "how to set up and run this project.md");
  const isTemplateReadme = manifest.readme?.isTemplate;
  const claudeSections = manifest.existingAgentConfig?.claudeMdSections;

  let setupContent = "";

  // CLAUDE.md quick reference gets priority (always accurate)
  if (claudeSections?.quickReference) {
    setupContent += "## Quick Reference\n\n" + claudeSections.quickReference + "\n\n";
  }

  // README install/usage sections (skip if template README)
  if (!isTemplateReadme) {
    if (manifest.readme?.installSection) {
      setupContent += "## Installation\n\n" + manifest.readme.installSection + "\n\n";
    }
    if (manifest.readme?.usageSection) {
      setupContent += "## Usage\n\n" + manifest.readme.usageSection + "\n\n";
    }
  }

  // From scripts
  const scripts = manifest.scripts || {};
  if (Object.keys(scripts).length > 0) {
    setupContent += "## Available Scripts\n\n";
    for (const [name, cmd] of Object.entries(scripts)) {
      setupContent += `- \`${name}\`: \`${cmd}\`\n`;
    }
    setupContent += "\n";
  }

  // Environment variables from CLAUDE.md
  if (claudeSections?.environmentVariables) {
    setupContent += "## Environment Variables\n\n" + claudeSections.environmentVariables + "\n\n";
  }

  // Testing from CLAUDE.md
  if (claudeSections?.testing) {
    setupContent += "## Testing\n\n" + claudeSections.testing + "\n\n";
  }

  if (!setupContent) return;

  const projectName = manifest.project?.name || "Project";

  const content = `---
date: "${today}"
type: procedural
tags:
  - setup
  - how-to
keywords:
  - setup
  - install
  - build
  - run
  - scripts
  - ${projectName}
${BOOTSTRAP_FRONTMATTER}
---

# ${projectName} — Setup & Development

${BANNER}

${setupContent}`;

  if (writeBrainNote(setupPath, content)) {
    console.log("  ✓ knowledge/memory/how to set up and run this project.md");
  }
}

// ── 8. Claude Memory → Knowledge Notes ───────────────────────────────

function populateFromClaudeMemory() {
  if (!manifest.claudeMemory || manifest.claudeMemory.length === 0) return;

  const memoryDir = join(BRAIN_DIR, "knowledge", "memory");
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });

  for (const mem of manifest.claudeMemory) {
    let brainType = "procedural";
    let targetDir = memoryDir;
    let tags = ["claude-memory"];

    if (mem.type === "project") {
      brainType = "procedural";
      tags.push("project-context");
    } else if (mem.type === "feedback") {
      brainType = "procedural";
      tags.push("feedback", "convention");
    } else if (mem.type === "reference") {
      brainType = "reference";
      tags.push("reference");
    } else if (mem.type === "user") {
      continue; // Skip user-type memories
    }

    const slug = slugify(mem.name || mem.filename.replace(/\.md$/, ""));
    const notePath = join(targetDir, `claude-memory-${slug}.md`);
    const title = mem.description || mem.name || slug;

    const content = `---
date: "${today}"
type: ${brainType}
tags:
  - ${tags.join("\n  - ")}
keywords:
  - claude-memory
  - ${slug.split("-").slice(0, 5).join("\n  - ")}
${BOOTSTRAP_FRONTMATTER}
---

# ${title}

${BANNER}

_Imported from Claude auto-memory: \`${mem.filename}\`_

---

${mem.content}
`;

    if (writeBrainNote(notePath, content)) {
      console.log(`  ✓ knowledge/memory/claude-memory-${slug}.md`);
    }
  }
}

// ── 9. Principles (from CLAUDE.md) ───────────────────────────────────

function populatePrinciples() {
  const principlesPath = join(BRAIN_DIR, "goal", "principles.md");

  let principlesContent = "";

  // Try to extract principles/conventions from CLAUDE.md
  if (manifest.existingAgentConfig?.claudeMd) {
    const principlesMatch = manifest.existingAgentConfig.claudeMd.match(
      /##\s+(?:Core Principles|Principles|Guidelines|Conventions)\n+([\s\S]*?)(?=\n##\s|\n$)/
    );
    if (principlesMatch) {
      principlesContent = principlesMatch[1].trim();
    }

    // Also grab code style
    const styleMatch = manifest.existingAgentConfig.claudeMd.match(
      /##\s+Code Style\n+([\s\S]*?)(?=\n##\s|\n$)/
    );
    if (styleMatch) {
      principlesContent += "\n\n## Code Style\n\n" + styleMatch[1].trim();
    }
  }

  // From CONTRIBUTING.md
  if (manifest.docs?.contributing) {
    principlesContent += "\n\n## Contributing Guidelines\n\n" +
      manifest.docs.contributing.slice(0, 2000);
  }

  if (!principlesContent) return;

  const content = `---
date: "${today}"
type: goal
tags:
  - goal
  - principles
keywords:
  - principles
  - conventions
  - code-style
  - guidelines
${BOOTSTRAP_FRONTMATTER}
---

# Project Principles

${BANNER}

${principlesContent}
`;

  if (writeBrainNote(principlesPath, content)) {
    console.log("  ✓ goal/principles.md");
  }
}

// ── 10. Architecture Docs from CLAUDE.md ─────────────────────────────

function populateArchitectureFromClaudeMd() {
  const claudeSections = manifest.existingAgentConfig?.claudeMdSections;
  if (!claudeSections) return;

  const projectName = manifest.project?.name || "Project";

  const sectionDocs = [
    { key: "architecture", file: "architecture-reference.md", title: "Architecture", kw: ["architecture", "data-flow", "patterns"] },
    { key: "database", file: "database-schema-and-types.md", title: "Database Schema & Types", kw: ["database", "schema", "tables", "types", "enums"] },
    { key: "apiRoutes", file: "api-routes-reference.md", title: "API Routes", kw: ["api", "routes", "endpoints"] },
    { key: "pageRoutes", file: "page-routes-reference.md", title: "Page Routes", kw: ["pages", "routes", "navigation", "ui"] },
  ];

  for (const doc of sectionDocs) {
    const sectionContent = claudeSections[doc.key];
    if (!sectionContent) continue;

    const docPath = join(BRAIN_DIR, "docs", doc.file);

    const content = `---
date: "${today}"
type: docs
tags:
  - docs
  - reference
keywords:
  - ${doc.kw.join("\n  - ")}
  - ${projectName}
${BOOTSTRAP_FRONTMATTER}
last_verified: "${today}"
---

# ${projectName} — ${doc.title}

${BANNER}

_Extracted from CLAUDE.md \`## ${doc.title}\` section._

---

${sectionContent}
`;

    if (writeBrainNote(docPath, content)) {
      console.log(`  ✓ docs/${doc.file}`);
    }
  }
}

// ── Run All ──────────────────────────────────────────────────────────

populateMission();
populateTopOfMind();
populateProjects();
populateProjectOverview();
populateArchitectureFromClaudeMd();
populateTechStack();
populateDecisionRecords();
populateSetup();
populateFromClaudeMemory();
populatePrinciples();

console.log(`\n  ${filesCreated} brain note(s) generated`);
