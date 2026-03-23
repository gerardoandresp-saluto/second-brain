#!/usr/bin/env node
// Bootstrap Scanner — Reads a project directory and outputs a JSON manifest
// of everything useful for populating a second brain.
// Usage: node bootstrap-scan.mjs /path/to/project > manifest.json

import { execSync } from "child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, basename, relative } from "path";

const TARGET_DIR = process.argv[2];
if (!TARGET_DIR) {
  console.error("Usage: node bootstrap-scan.mjs /path/to/project");
  process.exit(1);
}

const manifest = {
  project: {},
  readme: null,
  docs: {},
  git: {},
  techStack: [],
  adrs: [],
  scripts: {},
  existingAgentConfig: {},
  claudeMemory: [],
};

// ── Helpers ──────────────────────────────────────────────────────────

function readFile(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function fileExists(path) {
  return existsSync(path);
}

function git(cmd) {
  try {
    return execSync(`git -C "${TARGET_DIR}" ${cmd}`, {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function detectJsonField(filePath, ...fields) {
  const content = readFile(filePath);
  if (!content) return null;
  try {
    const json = JSON.parse(content);
    const result = {};
    for (const field of fields) {
      if (json[field] !== undefined) result[field] = json[field];
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

function extractFirstParagraph(markdown) {
  if (!markdown) return null;
  // Skip frontmatter
  let text = markdown;
  if (text.startsWith("---")) {
    const endIdx = text.indexOf("---", 3);
    if (endIdx !== -1) text = text.slice(endIdx + 3);
  }
  // Skip title lines
  const lines = text.split("\n");
  const paragraphLines = [];
  let foundContent = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!foundContent) {
      if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("![")) continue;
      foundContent = true;
    }
    if (foundContent) {
      if (trimmed === "") {
        if (paragraphLines.length > 0) break;
        continue;
      }
      if (trimmed.startsWith("#")) break;
      paragraphLines.push(trimmed);
    }
  }
  return paragraphLines.length > 0 ? paragraphLines.join(" ") : null;
}

function extractSection(markdown, heading) {
  if (!markdown) return null;
  const headingPattern = new RegExp(`^#{1,3}\\s+${heading}`, "im");
  const match = markdown.match(headingPattern);
  if (!match) return null;
  const startIdx = match.index + match[0].length;
  const rest = markdown.slice(startIdx);
  // Find next heading of same or higher level
  const nextHeading = rest.match(/^#{1,3}\s+/m);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  return section.trim() || null;
}

function extractSectionWithChildren(markdown, heading) {
  if (!markdown) return null;
  const headingPattern = new RegExp(`^(#{1,6})\\s+${heading}`, "im");
  const match = markdown.match(headingPattern);
  if (!match) return null;
  const level = match[1].length; // number of # chars
  const startIdx = match.index + match[0].length;
  const rest = markdown.slice(startIdx);
  // Find next heading of SAME or HIGHER level (fewer or equal # chars)
  const sameLevelPattern = new RegExp(`^#{1,${level}}\\s+`, "m");
  const nextHeading = rest.match(sameLevelPattern);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  return section.trim() || null;
}

function isTemplateReadme(content, projectName) {
  if (!content) return false;
  let signals = 0;
  if (/curl\s+-sSL/.test(content)) signals++;
  if (/init-framework\.sh|claude-agentic-framework/i.test(content)) signals++;
  if (/\/swarm-plan|\/swarm-execute|\/swarm-review/.test(content)) signals++;
  if (/drop-in template|reusable skills/i.test(content)) signals++;
  if (/worker-explorer|worker-builder|worker-reviewer/i.test(content)) signals++;
  // Check if h1 title doesn't match project name
  if (projectName) {
    const titleMatch = content.match(/^#\s+(.+)/m);
    if (titleMatch && !titleMatch[1].toLowerCase().includes(projectName.toLowerCase())) {
      signals++;
    }
  }
  return signals >= 2;
}

function findFilesRecursive(dir, pattern, maxDepth = 3, depth = 0) {
  if (depth > maxDepth) return [];
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules" || entry.name === "vendor" || entry.name === ".git") continue;
      const fullPath = join(dir, entry.name);
      if (entry.isFile() && pattern.test(entry.name)) {
        results.push(fullPath);
      } else if (entry.isDirectory()) {
        results.push(...findFilesRecursive(fullPath, pattern, maxDepth, depth + 1));
      }
    }
  } catch {
    // permission denied or similar
  }
  return results;
}

// ── Package Manager Detection ────────────────────────────────────────

const packageJson = detectJsonField(
  join(TARGET_DIR, "package.json"),
  "name", "description", "keywords", "scripts", "dependencies",
  "devDependencies", "workspaces"
);
if (packageJson) {
  manifest.project.name = packageJson.name;
  manifest.project.description = packageJson.description;
  manifest.project.keywords = packageJson.keywords;
  manifest.scripts = packageJson.scripts || {};
  if (packageJson.dependencies) {
    manifest.project.dependencies = Object.keys(packageJson.dependencies);
  }
  if (packageJson.devDependencies) {
    manifest.project.devDependencies = Object.keys(packageJson.devDependencies);
  }
  if (packageJson.workspaces) {
    manifest.project.workspaces = packageJson.workspaces;
  }
}

const pyprojectToml = readFile(join(TARGET_DIR, "pyproject.toml"));
if (pyprojectToml) {
  const nameMatch = pyprojectToml.match(/^name\s*=\s*"(.+)"/m);
  const descMatch = pyprojectToml.match(/^description\s*=\s*"(.+)"/m);
  if (nameMatch) manifest.project.name = manifest.project.name || nameMatch[1];
  if (descMatch) manifest.project.description = manifest.project.description || descMatch[1];
}

const cargoToml = readFile(join(TARGET_DIR, "Cargo.toml"));
if (cargoToml) {
  const nameMatch = cargoToml.match(/^name\s*=\s*"(.+)"/m);
  const descMatch = cargoToml.match(/^description\s*=\s*"(.+)"/m);
  if (nameMatch) manifest.project.name = manifest.project.name || nameMatch[1];
  if (descMatch) manifest.project.description = manifest.project.description || descMatch[1];
}

const goMod = readFile(join(TARGET_DIR, "go.mod"));
if (goMod) {
  const moduleMatch = goMod.match(/^module\s+(.+)/m);
  if (moduleMatch) manifest.project.name = manifest.project.name || moduleMatch[1];
}

// ── README & Documentation ───────────────────────────────────────────

const readmeContent = readFile(join(TARGET_DIR, "README.md"))
  || readFile(join(TARGET_DIR, "readme.md"))
  || readFile(join(TARGET_DIR, "Readme.md"));

if (readmeContent) {
  manifest.readme = {
    full: readmeContent,
    firstParagraph: extractFirstParagraph(readmeContent),
    installSection: extractSection(readmeContent, "Install(?:ation)?|Setup|Getting Started"),
    usageSection: extractSection(readmeContent, "Usage|Quick Start"),
    isTemplate: isTemplateReadme(readmeContent, manifest.project?.name),
  };
}

const contributingContent = readFile(join(TARGET_DIR, "CONTRIBUTING.md"));
if (contributingContent) {
  manifest.docs.contributing = contributingContent;
}

const architectureContent = readFile(join(TARGET_DIR, "ARCHITECTURE.md"));
if (architectureContent) {
  manifest.docs.architecture = architectureContent;
}

const securityContent = readFile(join(TARGET_DIR, "SECURITY.md"));
if (securityContent) {
  manifest.docs.security = securityContent;
}

// ── ADR Detection ────────────────────────────────────────────────────

const adrDirs = [
  join(TARGET_DIR, ".adr"),
  join(TARGET_DIR, "docs/decisions"),
  join(TARGET_DIR, "docs/adr"),
  join(TARGET_DIR, "adr"),
  join(TARGET_DIR, "docs/architecture/decisions"),
];

for (const adrDir of adrDirs) {
  if (!fileExists(adrDir)) continue;
  try {
    const files = readdirSync(adrDir).filter(f => f.endsWith(".md"));
    for (const file of files) {
      const content = readFile(join(adrDir, file));
      if (content) {
        manifest.adrs.push({
          filename: file,
          sourceDir: relative(TARGET_DIR, adrDir),
          content,
        });
      }
    }
  } catch {
    // skip
  }
}

// ── Git Metadata ─────────────────────────────────────────────────────

const isGitRepo = git("rev-parse --git-dir") !== null;

if (isGitRepo) {
  manifest.git.remoteUrl = git("remote get-url origin");

  const branchOutput = git("branch --format='%(refname:short)'");
  if (branchOutput) {
    manifest.git.branches = branchOutput
      .split("\n")
      .map(b => b.replace(/^'|'$/g, "").trim())
      .filter(Boolean);
  }

  const recentLog = git("log --oneline -20 --format='%s'");
  if (recentLog) {
    manifest.git.recentCommits = recentLog
      .split("\n")
      .map(l => l.replace(/^'|'$/g, "").trim())
      .filter(Boolean);
  }

  const monthLog = git("log --since='30 days ago' --format='%s'");
  if (monthLog) {
    manifest.git.recentThemes = monthLog
      .split("\n")
      .map(l => l.replace(/^'|'$/g, "").trim())
      .filter(Boolean);
  }

  const tags = git("tag --sort=-creatordate");
  if (tags) {
    manifest.git.tags = tags.split("\n").filter(Boolean).slice(0, 10);
  }

  const commitCount = git("rev-list --count HEAD");
  if (commitCount) {
    manifest.git.commitCount = parseInt(commitCount, 10);
  }

  const firstCommitDate = git("log --reverse --format='%ci' --max-count=1");
  if (firstCommitDate) {
    manifest.git.firstCommitDate = firstCommitDate.replace(/^'|'$/g, "").trim();
  }
}

// ── Tech Stack Detection ─────────────────────────────────────────────

const techDetectors = [
  { file: "package.json", tech: "Node.js", category: "Runtime" },
  { file: "tsconfig.json", tech: "TypeScript", category: "Language" },
  { file: "pyproject.toml", tech: "Python", category: "Language" },
  { file: "Cargo.toml", tech: "Rust", category: "Language" },
  { file: "go.mod", tech: "Go", category: "Language" },
  { file: "Gemfile", tech: "Ruby", category: "Language" },
  { file: "pom.xml", tech: "Java (Maven)", category: "Language" },
  { file: "build.gradle", tech: "Java/Kotlin (Gradle)", category: "Language" },
  { file: "next.config.js", tech: "Next.js", category: "Framework" },
  { file: "next.config.ts", tech: "Next.js", category: "Framework" },
  { file: "next.config.mjs", tech: "Next.js", category: "Framework" },
  { file: "nuxt.config.ts", tech: "Nuxt", category: "Framework" },
  { file: "svelte.config.js", tech: "SvelteKit", category: "Framework" },
  { file: "astro.config.mjs", tech: "Astro", category: "Framework" },
  { file: "remix.config.js", tech: "Remix", category: "Framework" },
  { file: "angular.json", tech: "Angular", category: "Framework" },
  { file: "vite.config.ts", tech: "Vite", category: "Build" },
  { file: "vite.config.js", tech: "Vite", category: "Build" },
  { file: "webpack.config.js", tech: "Webpack", category: "Build" },
  { file: "tailwind.config.ts", tech: "Tailwind CSS", category: "Styling" },
  { file: "tailwind.config.js", tech: "Tailwind CSS", category: "Styling" },
  { file: "postcss.config.js", tech: "PostCSS", category: "Styling" },
  { file: "drizzle.config.ts", tech: "Drizzle ORM", category: "Database" },
  { file: "prisma/schema.prisma", tech: "Prisma", category: "Database" },
  { file: "knexfile.js", tech: "Knex.js", category: "Database" },
  { file: "jest.config.js", tech: "Jest", category: "Testing" },
  { file: "jest.config.ts", tech: "Jest", category: "Testing" },
  { file: "vitest.config.ts", tech: "Vitest", category: "Testing" },
  { file: "playwright.config.ts", tech: "Playwright", category: "Testing" },
  { file: "cypress.config.ts", tech: "Cypress", category: "Testing" },
  { file: "pytest.ini", tech: "pytest", category: "Testing" },
  { file: "Dockerfile", tech: "Docker", category: "Infrastructure" },
  { file: "docker-compose.yml", tech: "Docker Compose", category: "Infrastructure" },
  { file: "docker-compose.yaml", tech: "Docker Compose", category: "Infrastructure" },
  { file: "Makefile", tech: "Make", category: "Build" },
  { file: "Taskfile.yml", tech: "Task", category: "Build" },
  { file: "terraform/main.tf", tech: "Terraform", category: "Infrastructure" },
  { file: "pulumi/index.ts", tech: "Pulumi", category: "Infrastructure" },
  { file: ".github/workflows", tech: "GitHub Actions", category: "CI/CD", isDir: true },
  { file: ".gitlab-ci.yml", tech: "GitLab CI", category: "CI/CD" },
  { file: ".circleci/config.yml", tech: "CircleCI", category: "CI/CD" },
  { file: "Jenkinsfile", tech: "Jenkins", category: "CI/CD" },
  { file: ".eslintrc.js", tech: "ESLint", category: "Code Quality" },
  { file: ".eslintrc.json", tech: "ESLint", category: "Code Quality" },
  { file: "eslint.config.js", tech: "ESLint (flat config)", category: "Code Quality" },
  { file: "eslint.config.mjs", tech: "ESLint (flat config)", category: "Code Quality" },
  { file: ".prettierrc", tech: "Prettier", category: "Code Quality" },
  { file: ".prettierrc.json", tech: "Prettier", category: "Code Quality" },
  { file: "biome.json", tech: "Biome", category: "Code Quality" },
  { file: ".pre-commit-config.yaml", tech: "pre-commit", category: "Code Quality" },
  { file: "ruff.toml", tech: "Ruff", category: "Code Quality" },
  { file: "pnpm-lock.yaml", tech: "pnpm", category: "Package Manager" },
  { file: "yarn.lock", tech: "Yarn", category: "Package Manager" },
  { file: "package-lock.json", tech: "npm", category: "Package Manager" },
  { file: "bun.lockb", tech: "Bun", category: "Package Manager" },
  { file: "poetry.lock", tech: "Poetry", category: "Package Manager" },
  { file: "Pipfile.lock", tech: "Pipenv", category: "Package Manager" },
];

const seenTech = new Set();
for (const detector of techDetectors) {
  const fullPath = join(TARGET_DIR, detector.file);
  const exists = detector.isDir
    ? fileExists(fullPath) && statSync(fullPath).isDirectory()
    : fileExists(fullPath);
  if (exists && !seenTech.has(detector.tech)) {
    seenTech.add(detector.tech);
    manifest.techStack.push({
      technology: detector.tech,
      category: detector.category,
      detectedFrom: detector.file,
    });
  }
}

// Try to detect framework versions from package.json
if (packageJson?.dependencies) {
  const versionable = {
    "next": "Next.js",
    "react": "React",
    "vue": "Vue",
    "svelte": "Svelte",
    "@angular/core": "Angular",
    "express": "Express",
    "fastify": "Fastify",
    "hono": "Hono",
    "drizzle-orm": "Drizzle ORM",
    "prisma": "Prisma",
    "@prisma/client": "Prisma",
  };
  for (const [pkg, name] of Object.entries(versionable)) {
    const version = packageJson.dependencies[pkg] || packageJson.devDependencies?.[pkg];
    if (version) {
      const existing = manifest.techStack.find(t => t.technology === name);
      if (existing) {
        existing.version = version.replace(/^[\^~]/, "");
      }
    }
  }
}

// ── Existing Agent Config ────────────────────────────────────────────

const claudeMd = readFile(join(TARGET_DIR, "CLAUDE.md"));
if (claudeMd) {
  manifest.existingAgentConfig.claudeMd = claudeMd;

  // Extract structured sections for the populator
  const sectionMap = {
    projectOverview: "Project Overview",
    architecture: "Architecture",
    database: "Database",
    apiRoutes: "API Routes",
    pageRoutes: "Page Routes",
    storage: "Storage",
    environmentVariables: "Environment Variables",
    quickReference: "Quick Reference",
    testing: "Testing",
    workflow: "Workflow",
  };
  manifest.existingAgentConfig.claudeMdSections = {};
  for (const [key, heading] of Object.entries(sectionMap)) {
    const content = extractSectionWithChildren(claudeMd, heading);
    if (content) manifest.existingAgentConfig.claudeMdSections[key] = content;
  }
}

const agentsMd = readFile(join(TARGET_DIR, "AGENTS.md"));
if (agentsMd) {
  manifest.existingAgentConfig.agentsMd = agentsMd;
}

// ── Claude Memory (Layer 1) ──────────────────────────────────────────

// Claude's auto-memory lives at ~/.claude/projects/<project-hash>/memory/
// The project hash is the absolute path with / replaced by -
const homedir = process.env.HOME || process.env.USERPROFILE;
if (homedir) {
  const projectHash = TARGET_DIR.replace(/\//g, "-");
  const memoryDir = join(homedir, ".claude", "projects", projectHash, "memory");

  if (fileExists(memoryDir)) {
    try {
      const memoryFiles = readdirSync(memoryDir).filter(
        f => f.endsWith(".md") && f !== "MEMORY.md"
      );
      for (const file of memoryFiles) {
        const filePath = join(memoryDir, file);
        const content = readFile(filePath);
        if (content) {
          // Parse frontmatter
          let name = null, description = null, type = null, body = content;
          if (content.startsWith("---")) {
            const endIdx = content.indexOf("---", 3);
            if (endIdx !== -1) {
              const frontmatter = content.slice(3, endIdx);
              body = content.slice(endIdx + 3).trim();
              const nameMatch = frontmatter.match(/^name:\s*(.+)/m);
              const descMatch = frontmatter.match(/^description:\s*(.+)/m);
              const typeMatch = frontmatter.match(/^type:\s*(.+)/m);
              if (nameMatch) name = nameMatch[1].trim();
              if (descMatch) description = descMatch[1].trim();
              if (typeMatch) type = typeMatch[1].trim();
            }
          }
          // Get file modification date for staleness detection
          let lastModified = null;
          try {
            const stats = statSync(filePath);
            lastModified = stats.mtime.toISOString().split("T")[0];
          } catch { /* ignore */ }
          manifest.claudeMemory.push({
            filename: file,
            name,
            description,
            type,
            content: body,
            lastModified,
          });
        }
      }
    } catch {
      // memory dir not readable
    }
  }
}

// ── Output ───────────────────────────────────────────────────────────

console.log(JSON.stringify(manifest, null, 2));
