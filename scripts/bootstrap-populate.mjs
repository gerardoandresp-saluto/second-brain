#!/usr/bin/env node
// Bootstrap Populator — Reads a scan manifest and generates brain notes.
//
// Spec interface:   node bootstrap-populate.mjs /path/to/project
//   Reads manifest from: <project>/.brain*/inbox/queue-generated/bootstrap-scan.json
//   Writes notes to:     <project>/.brain*/
//
// Legacy interface: node bootstrap-populate.mjs /path/to/.brain /path/to/manifest.json
//   Used by init-second-brain.sh and tests.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";
import { execSync } from "child_process";

// ── ANSI colors ───────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
};
function log(msg)  { process.stderr.write(`${C.blue}[populate]${C.reset} ${msg}\n`); }
function ok(msg)   { process.stderr.write(`  ${C.green}✓${C.reset} ${msg}\n`); }
function skip(msg) { process.stderr.write(`  ${C.dim}~${C.reset} ${msg}\n`); }
function warn(msg) { process.stderr.write(`  ${C.yellow}⚠${C.reset} ${msg}\n`); }

// ── Argument resolution ───────────────────────────────────────────────
// Detect calling convention: spec (1 arg = project dir) vs legacy (2 args = brainDir + manifestPath)

let BRAIN_DIR;
let MANIFEST_PATH;

function findBrainDir(projectDir) {
  try {
    const entries = readdirSync(projectDir, { withFileTypes: true });
    const brainEntry = entries.find(e => e.isDirectory() && (e.name === ".brain" || e.name.startsWith(".brain_")));
    return brainEntry ? join(projectDir, brainEntry.name) : null;
  } catch { return null; }
}

if (process.argv.length === 3) {
  // Spec interface: node bootstrap-populate.mjs /path/to/project
  const projectDir = process.argv[2];
  BRAIN_DIR = findBrainDir(projectDir);
  if (!BRAIN_DIR) {
    console.error(`No .brain directory found in ${projectDir}`);
    console.error("Run init-second-brain.sh first, or use: node bootstrap-populate.mjs <brainDir> <manifestPath>");
    process.exit(1);
  }
  MANIFEST_PATH = join(BRAIN_DIR, "inbox", "queue-generated", "bootstrap-scan.json");
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`Scan report not found: ${MANIFEST_PATH}`);
    console.error("Run bootstrap-scan.mjs first: node bootstrap-scan.mjs /path/to/project");
    process.exit(1);
  }
} else if (process.argv.length >= 4) {
  // Legacy interface: node bootstrap-populate.mjs /path/to/.brain /path/to/manifest.json
  BRAIN_DIR = process.argv[2];
  MANIFEST_PATH = process.argv[3];
  if (!BRAIN_DIR || !MANIFEST_PATH) {
    console.error("Usage: node bootstrap-populate.mjs /path/to/.brain /path/to/manifest.json");
    process.exit(1);
  }
} else {
  console.error("Usage:");
  console.error("  node bootstrap-populate.mjs /path/to/project              # spec interface");
  console.error("  node bootstrap-populate.mjs /path/to/.brain manifest.json  # legacy interface");
  process.exit(1);
}

// ── Load manifest ─────────────────────────────────────────────────────
// Support both spec format (flat keys) and legacy format (nested: .project, .readme, etc.)

let rawManifest;
try {
  rawManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
} catch (err) {
  console.error(`Failed to read manifest: ${err.message}`);
  process.exit(1);
}

// Normalise to legacy shape so all downstream functions work regardless of source format.
// Spec format has: project_name, language, description, dependencies, directory_map,
//                  config_files_found, recent_commits, remote_url, existing_claude_md
// Legacy format has: project{name,description}, readme{}, techStack[], git{}, ...
function normaliseScanReport(raw) {
  // Already legacy format?
  if (raw.project !== undefined && raw.techStack !== undefined) return raw;

  // Spec format — convert to legacy shape
  return {
    project: {
      name: raw.project_name || null,
      description: raw.description || null,
      dependencies: raw.dependencies || [],
    },
    readme: null,                     // spec format doesn't carry full readme
    docs: {},
    git: {
      remoteUrl: raw.remote_url || null,
      recentCommits: raw.recent_commits || [],
      branches: [],
      commitCount: 0,
      tags: [],
    },
    techStack: buildTechStackFromSpec(raw),
    adrs: [],
    scripts: {},
    existingAgentConfig: raw.existing_claude_md
      ? { claudeMd: raw.existing_claude_md, claudeMdSections: {} }
      : {},
    claudeMemory: [],
    // Preserve spec extras for context
    _spec: {
      language: raw.language,
      package_manager: raw.package_manager,
      directory_map: raw.directory_map || {},
      config_files_found: raw.config_files_found || [],
    },
  };
}

function buildTechStackFromSpec(raw) {
  const stack = [];
  const lang = raw.language;
  const pm = raw.package_manager;
  const configs = raw.config_files_found || [];

  const langMap = {
    typescript: { technology: "TypeScript", category: "Language", detectedFrom: "tsconfig.json" },
    python: { technology: "Python", category: "Language", detectedFrom: "pyproject.toml" },
    rust: { technology: "Rust", category: "Language", detectedFrom: "Cargo.toml" },
    go: { technology: "Go", category: "Language", detectedFrom: "go.mod" },
    ruby: { technology: "Ruby", category: "Language", detectedFrom: "Gemfile" },
  };
  if (lang && langMap[lang]) stack.push(langMap[lang]);
  if (configs.includes("package.json")) stack.push({ technology: "Node.js", category: "Runtime", detectedFrom: "package.json" });

  const pmMap = {
    pnpm: { technology: "pnpm", category: "Package Manager", detectedFrom: "pnpm-lock.yaml" },
    yarn: { technology: "Yarn", category: "Package Manager", detectedFrom: "yarn.lock" },
    npm: { technology: "npm", category: "Package Manager", detectedFrom: "package-lock.json" },
    cargo: { technology: "Cargo", category: "Package Manager", detectedFrom: "Cargo.toml" },
    go: { technology: "Go modules", category: "Package Manager", detectedFrom: "go.mod" },
  };
  if (pm && pmMap[pm]) stack.push(pmMap[pm]);

  // Detect frameworks from config files
  const frameworkDetectors = [
    ["next.config.js", "Next.js", "Framework"],
    ["next.config.ts", "Next.js", "Framework"],
    ["next.config.mjs", "Next.js", "Framework"],
    ["nuxt.config.ts", "Nuxt", "Framework"],
    ["vite.config.ts", "Vite", "Build"],
    ["vite.config.js", "Vite", "Build"],
    ["tailwind.config.ts", "Tailwind CSS", "Styling"],
    ["tailwind.config.js", "Tailwind CSS", "Styling"],
    ["drizzle.config.ts", "Drizzle ORM", "Database"],
    ["prisma/schema.prisma", "Prisma", "Database"],
    ["vitest.config.ts", "Vitest", "Testing"],
    ["playwright.config.ts", "Playwright", "Testing"],
    ["Dockerfile", "Docker", "Infrastructure"],
    ["docker-compose.yml", "Docker Compose", "Infrastructure"],
    ["biome.json", "Biome", "Code Quality"],
  ];
  const seenTech = new Set(stack.map(t => t.technology));
  for (const [file, tech, cat] of frameworkDetectors) {
    if (configs.includes(file) && !seenTech.has(tech)) {
      stack.push({ technology: tech, category: cat, detectedFrom: file });
      seenTech.add(tech);
    }
  }
  return stack;
}

const manifest = normaliseScanReport(rawManifest);
const today = new Date().toISOString().split("T")[0];

const BANNER = "> [!WARNING] **[BOOTSTRAPPED — REVIEW]**\n> Auto-generated from project data. Verify accuracy and remove this banner once reviewed.\n";
const BOOTSTRAP_FRONTMATTER = `source: bootstrap\nbootstrapped: true\nreview_status: pending`;

let filesCreated = 0;

// ── Helpers ──────────────────────────────────────────────────────────

function isTemplateDefault(filePath) {
  try {
    const existing = readFileSync(filePath, "utf-8");
    if (existing.includes("bootstrapped: true")) return false;
    if (existing.includes("_Define the north star")) return true;
    if (existing.includes("_What's active right now?")) return true;
    if (existing.includes("_Map of all tracked projects")) return true;
    if (existing.includes("_These guide every decision")) return true;
    return false;
  } catch { return false; }
}

function writeBrainNote(filePath, content) {
  if (existsSync(filePath) && !isTemplateDefault(filePath)) {
    skip(basename(filePath) + " already exists, skipping");
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
  let staleWarning = "";
  if (recentCommits?.length > 0 && desc) {
    const skipWords = new Set(["the", "and", "for", "from", "with", "this", "that", "after", "next", "task", "phase", "plan", "planned", "implementation"]);
    const keywords = desc.toLowerCase().match(/\b[a-z]{3,}\b/g)?.filter(w => !skipWords.has(w)) || [];
    const commitText = recentCommits.join(" ").toLowerCase();
    const matchCount = keywords.filter(kw => commitText.includes(kw)).length;
    if (matchCount >= 2) staleWarning = " **[may be stale — check recent commits]**";
  }
  return `- ${desc}${dateSuffix}${staleWarning}`;
}

// ── Language-based default principles ────────────────────────────────

function defaultPrinciplesForLanguage(language) {
  const defaults = {
    typescript: [
      "Type safety over convenience — avoid `any`",
      "Prefer explicit return types on exported functions",
      "Test before ship — run vitest / jest before every commit",
      "Single responsibility per module",
      "No premature abstraction — extract only when it repeats 3+ times",
    ],
    python: [
      "Explicit over implicit — follow the Zen of Python",
      "Type hints on all public functions",
      "Test with pytest — aim for high coverage on business logic",
      "Use dataclasses or msgspec for data shapes, not raw dicts",
      "Single responsibility per module",
    ],
    go: [
      "Errors are values — handle them, don't ignore them",
      "Accept interfaces, return structs",
      "Table-driven tests for predictable coverage",
      "Keep packages small with clear boundaries",
      "No premature optimisation — profile before tuning",
    ],
    rust: [
      "Ownership first — avoid unnecessary clones",
      "Use Result / Option, never unwrap in library code",
      "Document public APIs with doc comments",
      "Write integration tests alongside unit tests",
      "Keep unsafe blocks minimal and well-commented",
    ],
    ruby: [
      "Convention over configuration",
      "Fat models, thin controllers",
      "Write RSpec examples for every public method",
      "Prefer composition over inheritance",
      "Keep methods short — extract when over 10 lines",
    ],
  };
  return defaults[language] || [
    "Write tests for every feature",
    "Single responsibility per module",
    "No premature abstraction",
    "Document non-obvious decisions",
    "Prefer clarity over cleverness",
  ];
}

// ── 1. goal/mission.md ────────────────────────────────────────────────

function populateMission() {
  const missionPath = join(BRAIN_DIR, "goal", "mission.md");
  const isTemplateReadme = manifest.readme?.isTemplate;
  const claudeSections = manifest.existingAgentConfig?.claudeMdSections;

  let missionStatement = null;
  let description = null;

  if (manifest.readme?.firstParagraph && !isTemplateReadme) {
    missionStatement = manifest.readme.firstParagraph;
  }
  if (manifest.project?.description) {
    description = manifest.project.description;
    if (!missionStatement) missionStatement = description;
  }
  if (claudeSections?.projectOverview) {
    missionStatement = claudeSections.projectOverview.trim();
  }

  if (!missionStatement) {
    warn("goal/mission.md — no description found, using project name");
    missionStatement = `${manifest.project?.name || "This project"} — purpose not yet documented.`;
  }

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

_TODO: refine this — what does success look like for this project?_

-

## Non-Negotiables

_Review and define — what must always be true?_

-

## Out of Scope

_Review and define — what is explicitly NOT part of this mission?_

-
`;

  if (writeBrainNote(missionPath, content)) ok("goal/mission.md");
}

// ── 2. goal/principles.md ─────────────────────────────────────────────

function populatePrinciples() {
  const principlesPath = join(BRAIN_DIR, "goal", "principles.md");

  const language = manifest._spec?.language || "unknown";
  const projectName = manifest.project?.name || "Project";

  let principlesContent = "";
  let source = "language defaults";

  // Try to extract principles from CLAUDE.md first
  if (manifest.existingAgentConfig?.claudeMd) {
    const claudeMd = manifest.existingAgentConfig.claudeMd;
    const principlesMatch = claudeMd.match(
      /##\s+(?:Core Principles|Principles|Guidelines|Conventions)\n+([\s\S]*?)(?=\n##\s|\n$)/
    );
    if (principlesMatch) {
      principlesContent = principlesMatch[1].trim();
      source = "CLAUDE.md";
    }
    const styleMatch = claudeMd.match(/##\s+Code Style\n+([\s\S]*?)(?=\n##\s|\n$)/);
    if (styleMatch) {
      principlesContent += "\n\n## Code Style\n\n" + styleMatch[1].trim();
    }
  }

  // From CONTRIBUTING.md
  if (manifest.docs?.contributing) {
    principlesContent += "\n\n## Contributing Guidelines\n\n" +
      manifest.docs.contributing.slice(0, 2000);
    source = source === "language defaults" ? "CONTRIBUTING.md" : source + " + CONTRIBUTING.md";
  }

  // Generate language defaults if nothing found
  if (!principlesContent) {
    const defaults = defaultPrinciplesForLanguage(language);
    principlesContent = defaults.map(p => `- ${p}`).join("\n");
  }

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
  - ${projectName}
${BOOTSTRAP_FRONTMATTER}
---

# ${projectName} — Principles

${BANNER}

_Source: ${source}. TODO: customize these for your project._

## Core Principles

${principlesContent}

## Decision Hierarchy

_TODO: customize — when rules conflict, how do you resolve?_

1. Security requirements
2. Correctness over performance
3. Clarity over cleverness
4. Consistency with existing patterns
`;

  if (writeBrainNote(principlesPath, content)) ok("goal/principles.md");
}

// ── 3. atlas/projects.md ──────────────────────────────────────────────

function populateProjects() {
  const projectsPath = join(BRAIN_DIR, "atlas", "projects.md");
  const projectName = manifest.project?.name || basename(BRAIN_DIR).replace(/^\.brain_?/, "") || "Unknown Project";
  const description = manifest.project?.description || "_Add a description_";

  const branches = manifest.git?.branches || [];
  const mainBranches = ["main", "master", "develop", "development"];
  const activeBranches = branches.filter(b => !mainBranches.includes(b));
  const tags = manifest.git?.tags || [];

  let activeSection = `### ${projectName}\n\n- **Status**: Active\n- **Description**: ${description}\n`;
  if (activeBranches.length > 0) {
    activeSection += `- **Active branches**: ${activeBranches.map(b => `\`${b}\``).join(", ")}\n`;
  }

  const projectMemories = (manifest.claudeMemory || []).filter(m => m.type === "project");
  if (projectMemories.length > 0) {
    activeSection += "\n**From Claude memory:**\n" +
      projectMemories.map(m => formatMemoryEntry(m, manifest.git?.recentCommits)).join("\n") + "\n";
  }

  const completedSection = tags.length > 0
    ? tags.slice(0, 10).map(t => `- \`${t}\``).join("\n")
    : "_No release tags detected._";

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

  if (writeBrainNote(projectsPath, content)) ok("atlas/projects.md");
}

// ── 4. 00-home/top-of-mind.md ────────────────────────────────────────

function populateTopOfMind() {
  const tomPath = join(BRAIN_DIR, "00-home", "top-of-mind.md");

  let phase = "Unknown";
  const commitCount = manifest.git?.commitCount || 0;
  if (commitCount === 0) phase = "Pre-development";
  else if (commitCount < 10) phase = "Early development";
  else if (commitCount < 50) phase = "Active development";
  else if (commitCount < 200) phase = "Maturing";
  else phase = "Established";

  const activeBranches = (manifest.git?.branches || [])
    .filter(b => !["main", "master", "develop", "development"].includes(b));

  const recentCommits = (manifest.git?.recentCommits || []).slice(0, 7);

  const projectMemories = (manifest.claudeMemory || []).filter(m => m.type === "project");

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
  if (!activeProjectsSection) activeProjectsSection = "_No active branches detected._";

  const recentActivitySection = recentCommits.length > 0
    ? recentCommits.map(c => `- ${c}`).join("\n")
    : "_No recent commits._";

  const focusItem = manifest.project?.name
    ? `Getting started with second brain for **${manifest.project.name}**`
    : "Getting started with second brain";

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

## This Week's Focus

- ${focusItem}

## Open Questions

_Review — what are the current unknowns?_

## Blocked On

_Review — what's blocking progress?_
`;

  if (writeBrainNote(tomPath, content)) ok("00-home/top-of-mind.md");
}

// ── 5. knowledge/graph/repo-research/project-overview.md ─────────────

function populateKnowledgeProjectOverview() {
  const overviewPath = join(BRAIN_DIR, "knowledge", "graph", "repo-research", "project-overview.md");

  const projectName = manifest.project?.name || "Project";
  const description = manifest.project?.description || "_Not detected._";
  const language = manifest._spec?.language || manifest.techStack.find(t => t.category === "Language")?.technology || "unknown";
  const packageManager = manifest._spec?.package_manager || "unknown";

  // Tech stack summary grouped by category
  const byCategory = {};
  for (const item of manifest.techStack) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item.technology + (item.version ? ` ${item.version}` : ""));
  }

  let techStackRows = "";
  for (const [category, items] of Object.entries(byCategory)) {
    techStackRows += `| ${category} | ${items.join(", ")} |\n`;
  }
  if (!techStackRows) techStackRows = `| Language | ${language} |\n`;

  // Directory map
  const dirMap = manifest._spec?.directory_map || {};
  const dirMapSection = Object.keys(dirMap).length > 0
    ? Object.entries(dirMap).map(([dir, purpose]) => `- \`${dir}/\` — ${purpose}`).join("\n")
    : "_Directory structure not mapped._";

  // Key dependencies
  const deps = manifest.project?.dependencies || [];
  const depsSection = deps.length > 0
    ? deps.slice(0, 20).map(d => `- \`${d}\``).join("\n")
    : "_No dependencies detected._";

  // Config files
  const configs = manifest._spec?.config_files_found || [];
  const configSection = configs.length > 0
    ? configs.map(f => `- \`${f}\``).join("\n")
    : "_No config files detected._";

  const remoteUrl = manifest.git?.remoteUrl || rawManifest.remote_url || "_Not detected._";

  const content = `---
date: "${today}"
type: claim
claim: "${projectName} is a ${language} project"
status: evergreen
confidence: high
tags:
  - knowledge
  - project-overview
  - repo-research
keywords:
  - ${projectName}
  - ${language}
  - tech-stack
  - overview
${BOOTSTRAP_FRONTMATTER}
last_verified: "${today}"
---

# ${projectName} — Project Overview

${BANNER}

## Claim

**${projectName}** is a **${language}** project (package manager: ${packageManager}).

## Description

${description}

## Tech Stack

| Category | Technologies |
|----------|-------------|
${techStackRows}

## Directory Structure

${dirMapSection}

## Key Dependencies

${depsSection}

## Config Files

${configSection}

## Repository

- **Remote**: ${remoteUrl}

## Notes

_TODO: customize — add architectural observations, known quirks, and important context._
`;

  if (writeBrainNote(overviewPath, content)) ok("knowledge/graph/repo-research/project-overview.md");
}

// ── 6. Project overview in docs/ ─────────────────────────────────────

function populateProjectOverview() {
  const overviewPath = join(BRAIN_DIR, "docs", "project-overview.md");
  const projectName = manifest.project?.name || "Project";
  const isTemplateReadme = manifest.readme?.isTemplate;
  const claudeSections = manifest.existingAgentConfig?.claudeMdSections;

  let overviewContent = "";
  let sourceLabel = "";

  if (isTemplateReadme) {
    const parts = [];
    if (claudeSections?.projectOverview) parts.push("## Project Overview\n\n" + claudeSections.projectOverview);
    if (claudeSections?.architecture) parts.push("## Architecture\n\n" + claudeSections.architecture);
    if (claudeSections?.database) parts.push("## Database\n\n" + claudeSections.database);
    if (claudeSections?.storage) parts.push("## Storage\n\n" + claudeSections.storage);
    if (parts.length === 0) return;
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

  if (writeBrainNote(overviewPath, content)) ok("docs/project-overview.md");
}

// ── 7. docs/tech-stack.md ─────────────────────────────────────────────

function populateTechStack() {
  if (manifest.techStack.length === 0) return;

  const techPath = join(BRAIN_DIR, "docs", "tech-stack.md");
  const projectName = manifest.project?.name || "Project";

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

  let depsSection = "";
  if (manifest.project?.dependencies?.length > 0) {
    depsSection = `\n## Key Dependencies\n\n${manifest.project.dependencies.map(d => `- \`${d}\``).join("\n")}\n`;
  }

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

  if (writeBrainNote(techPath, content)) ok("docs/tech-stack.md");
}

// ── 8. ADR → Decision Records ─────────────────────────────────────────

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

    if (writeBrainNote(notePath, content)) ok(`knowledge/graph/research/${slug}.md`);
  }
}

// ── 9. Setup note ─────────────────────────────────────────────────────

function populateSetup() {
  const setupPath = join(BRAIN_DIR, "knowledge", "memory", "how to set up and run this project.md");
  const isTemplateReadme = manifest.readme?.isTemplate;
  const claudeSections = manifest.existingAgentConfig?.claudeMdSections;

  let setupContent = "";

  if (claudeSections?.quickReference) {
    setupContent += "## Quick Reference\n\n" + claudeSections.quickReference + "\n\n";
  }
  if (!isTemplateReadme) {
    if (manifest.readme?.installSection) {
      setupContent += "## Installation\n\n" + manifest.readme.installSection + "\n\n";
    }
    if (manifest.readme?.usageSection) {
      setupContent += "## Usage\n\n" + manifest.readme.usageSection + "\n\n";
    }
  }

  const scripts = manifest.scripts || {};
  if (Object.keys(scripts).length > 0) {
    setupContent += "## Available Scripts\n\n";
    for (const [name, cmd] of Object.entries(scripts)) {
      setupContent += `- \`${name}\`: \`${cmd}\`\n`;
    }
    setupContent += "\n";
  }

  if (claudeSections?.environmentVariables) {
    setupContent += "## Environment Variables\n\n" + claudeSections.environmentVariables + "\n\n";
  }
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

  if (writeBrainNote(setupPath, content)) ok("knowledge/memory/how to set up and run this project.md");
}

// ── 10. Claude Memory → Knowledge Notes ──────────────────────────────

function populateFromClaudeMemory() {
  if (!manifest.claudeMemory || manifest.claudeMemory.length === 0) return;

  const memoryDir = join(BRAIN_DIR, "knowledge", "memory");
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });

  for (const mem of manifest.claudeMemory) {
    let brainType = "procedural";
    let tags = ["claude-memory"];

    if (mem.type === "project") { brainType = "procedural"; tags.push("project-context"); }
    else if (mem.type === "feedback") { brainType = "procedural"; tags.push("feedback", "convention"); }
    else if (mem.type === "reference") { brainType = "reference"; tags.push("reference"); }
    else if (mem.type === "user") continue;

    const slug = slugify(mem.name || mem.filename.replace(/\.md$/, ""));
    const notePath = join(memoryDir, `claude-memory-${slug}.md`);
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

    if (writeBrainNote(notePath, content)) ok(`knowledge/memory/claude-memory-${slug}.md`);
  }
}

// ── 11. Architecture docs from CLAUDE.md ──────────────────────────────

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

    if (writeBrainNote(docPath, content)) ok(`docs/${doc.file}`);
  }
}

// ── Run all populators ────────────────────────────────────────────────

log(`Populating brain at ${BRAIN_DIR}...`);

populateMission();
populatePrinciples();
populateTopOfMind();
populateProjects();
populateKnowledgeProjectOverview();
populateProjectOverview();
populateArchitectureFromClaudeMd();
populateTechStack();
populateDecisionRecords();
populateSetup();
populateFromClaudeMemory();

// ── Rebuild brain index ───────────────────────────────────────────────

if (filesCreated > 0) {
  log("Rebuilding brain index...");
  const rebuildScript = join(BRAIN_DIR, "hooks", "rebuild-brain-index.mjs");
  if (existsSync(rebuildScript)) {
    try {
      execSync(`node "${rebuildScript}" "${BRAIN_DIR}"`, {
        encoding: "utf-8",
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      ok("brain-index.json rebuilt");
    } catch (err) {
      warn(`brain-index rebuild failed: ${err.message}`);
    }
  } else {
    // Try the shell wrapper
    const rebuildSh = join(BRAIN_DIR, "hooks", "rebuild-brain-index.sh");
    if (existsSync(rebuildSh)) {
      try {
        execSync(`bash "${rebuildSh}" "${BRAIN_DIR}"`, {
          encoding: "utf-8",
          timeout: 30000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        ok("brain-index.json rebuilt");
      } catch (err) {
        warn(`brain-index rebuild failed: ${err.message}`);
      }
    } else {
      warn("No rebuild-brain-index script found — index not updated");
    }
  }
}

console.log(`\n  ${filesCreated} brain note(s) generated`);
