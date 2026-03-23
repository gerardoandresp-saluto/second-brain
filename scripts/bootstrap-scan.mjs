#!/usr/bin/env node
// Bootstrap Scanner — Scans a project directory and writes a JSON manifest.
// Primary output: .brain/inbox/queue-generated/bootstrap-scan.json (spec interface)
// Secondary output: stdout JSON (legacy interface used by init-second-brain.sh and tests)
// Usage: node bootstrap-scan.mjs /path/to/project

import { execSync } from "child_process";
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { join, basename, relative } from "path";

// ── ANSI colors ───────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
};
function log(msg) { process.stderr.write(`${C.blue}[scan]${C.reset} ${msg}\n`); }
function ok(msg)  { process.stderr.write(`  ${C.green}✓${C.reset} ${msg}\n`); }
function warn(msg){ process.stderr.write(`  ${C.yellow}⚠${C.reset} ${msg}\n`); }

const TARGET_DIR = process.argv[2];
if (!TARGET_DIR) {
  console.error("Usage: node bootstrap-scan.mjs /path/to/project");
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────

function readFile(path) {
  try { return readFileSync(path, "utf-8"); } catch { return null; }
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
  } catch { return null; }
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
  } catch { return null; }
}

function extractFirstParagraph(markdown) {
  if (!markdown) return null;
  let text = markdown;
  if (text.startsWith("---")) {
    const endIdx = text.indexOf("---", 3);
    if (endIdx !== -1) text = text.slice(endIdx + 3);
  }
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
  const nextHeading = rest.match(/^#{1,3}\s+/m);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  return section.trim() || null;
}

function extractSectionWithChildren(markdown, heading) {
  if (!markdown) return null;
  const headingPattern = new RegExp(`^(#{1,6})\\s+${heading}`, "im");
  const match = markdown.match(headingPattern);
  if (!match) return null;
  const level = match[1].length;
  const startIdx = match.index + match[0].length;
  const rest = markdown.slice(startIdx);
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
  if (projectName) {
    const titleMatch = content.match(/^#\s+(.+)/m);
    if (titleMatch && !titleMatch[1].toLowerCase().includes(projectName.toLowerCase())) signals++;
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
      if (["node_modules", "vendor", ".git"].includes(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isFile() && pattern.test(entry.name)) {
        results.push(fullPath);
      } else if (entry.isDirectory()) {
        results.push(...findFilesRecursive(fullPath, pattern, maxDepth, depth + 1));
      }
    }
  } catch { /* permission denied or similar */ }
  return results;
}

// ── Spec-format output builder ────────────────────────────────────────
// This is the flat structure described in the specification.
const specReport = {
  scanned_at: new Date().toISOString(),
  project_name: null,
  project_root: TARGET_DIR,
  language: "unknown",
  package_manager: "unknown",
  description: null,
  dependencies: [],
  directory_map: {},
  config_files_found: [],
  recent_commits: [],
  remote_url: null,
  existing_claude_md: null,
};

// ── Legacy-format manifest (used by tests and init-second-brain.sh) ──
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

// ── Package manifest detection ────────────────────────────────────────

log("Scanning package manifests...");

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
    specReport.dependencies = Object.keys(packageJson.dependencies);
  }
  if (packageJson.devDependencies) {
    manifest.project.devDependencies = Object.keys(packageJson.devDependencies);
  }
  if (packageJson.workspaces) manifest.project.workspaces = packageJson.workspaces;
  specReport.project_name = packageJson.name || specReport.project_name;
  specReport.description = packageJson.description || specReport.description;
  specReport.language = "typescript"; // will be refined below
  ok("package.json");
}

const pyprojectToml = readFile(join(TARGET_DIR, "pyproject.toml"));
if (pyprojectToml) {
  const nameMatch = pyprojectToml.match(/^name\s*=\s*"(.+)"/m);
  const descMatch = pyprojectToml.match(/^description\s*=\s*"(.+)"/m);
  if (nameMatch) { manifest.project.name = manifest.project.name || nameMatch[1]; specReport.project_name = specReport.project_name || nameMatch[1]; }
  if (descMatch) { manifest.project.description = manifest.project.description || descMatch[1]; specReport.description = specReport.description || descMatch[1]; }
  specReport.language = "python";
  ok("pyproject.toml");
}

const cargoToml = readFile(join(TARGET_DIR, "Cargo.toml"));
if (cargoToml) {
  const nameMatch = cargoToml.match(/^name\s*=\s*"(.+)"/m);
  const descMatch = cargoToml.match(/^description\s*=\s*"(.+)"/m);
  if (nameMatch) { manifest.project.name = manifest.project.name || nameMatch[1]; specReport.project_name = specReport.project_name || nameMatch[1]; }
  if (descMatch) { manifest.project.description = manifest.project.description || descMatch[1]; specReport.description = specReport.description || descMatch[1]; }
  specReport.language = "rust";
  ok("Cargo.toml");
}

const goMod = readFile(join(TARGET_DIR, "go.mod"));
if (goMod) {
  const moduleMatch = goMod.match(/^module\s+(.+)/m);
  if (moduleMatch) { manifest.project.name = manifest.project.name || moduleMatch[1]; specReport.project_name = specReport.project_name || moduleMatch[1]; }
  specReport.language = "go";
  ok("go.mod");
}

const gemfile = readFile(join(TARGET_DIR, "Gemfile"));
if (gemfile) {
  specReport.language = "ruby";
  ok("Gemfile");
}

// Fallback project name from directory
if (!specReport.project_name) {
  specReport.project_name = basename(TARGET_DIR);
  manifest.project.name = manifest.project.name || specReport.project_name;
}

// ── Language refinement from config files ────────────────────────────

if (fileExists(join(TARGET_DIR, "tsconfig.json"))) {
  specReport.language = "typescript";
} else if (packageJson && specReport.language === "typescript") {
  // Node.js project without tsconfig is plain JS
  specReport.language = "typescript"; // keep as typescript for Node projects by default
}

// ── Package manager detection ─────────────────────────────────────────

log("Detecting package manager...");
if (fileExists(join(TARGET_DIR, "pnpm-lock.yaml"))) {
  specReport.package_manager = "pnpm";
  ok("pnpm-lock.yaml");
} else if (fileExists(join(TARGET_DIR, "yarn.lock"))) {
  specReport.package_manager = "yarn";
  ok("yarn.lock");
} else if (fileExists(join(TARGET_DIR, "package-lock.json"))) {
  specReport.package_manager = "npm";
  ok("package-lock.json");
} else if (fileExists(join(TARGET_DIR, "bun.lockb"))) {
  specReport.package_manager = "bun";
  ok("bun.lockb");
} else if (fileExists(join(TARGET_DIR, "poetry.lock"))) {
  specReport.package_manager = "pip";
  ok("poetry.lock");
} else if (fileExists(join(TARGET_DIR, "Pipfile.lock"))) {
  specReport.package_manager = "pip";
  ok("Pipfile.lock");
} else if (cargoToml) {
  specReport.package_manager = "cargo";
} else if (goMod) {
  specReport.package_manager = "go";
} else if (packageJson) {
  specReport.package_manager = "npm";
}

// ── README & Documentation ─────────────────────────────────────────

log("Reading README...");
const readmeContent = readFile(join(TARGET_DIR, "README.md"))
  || readFile(join(TARGET_DIR, "readme.md"))
  || readFile(join(TARGET_DIR, "Readme.md"));

if (readmeContent) {
  const firstParagraph = extractFirstParagraph(readmeContent);
  if (!specReport.description && firstParagraph) specReport.description = firstParagraph;
  manifest.readme = {
    full: readmeContent,
    firstParagraph,
    installSection: extractSection(readmeContent, "Install(?:ation)?|Setup|Getting Started"),
    usageSection: extractSection(readmeContent, "Usage|Quick Start"),
    isTemplate: isTemplateReadme(readmeContent, manifest.project?.name),
  };
  ok("README.md");
} else {
  manifest.readme = null;
  warn("No README found");
}

const contributingContent = readFile(join(TARGET_DIR, "CONTRIBUTING.md"));
if (contributingContent) manifest.docs.contributing = contributingContent;

const architectureContent = readFile(join(TARGET_DIR, "ARCHITECTURE.md"));
if (architectureContent) manifest.docs.architecture = architectureContent;

const securityContent = readFile(join(TARGET_DIR, "SECURITY.md"));
if (securityContent) manifest.docs.security = securityContent;

// ── Directory structure map ───────────────────────────────────────────

log("Mapping directory structure...");
const KNOWN_DIR_PURPOSES = {
  src: "source code",
  lib: "library source code",
  app: "application code",
  pages: "page routes",
  components: "UI components",
  hooks: "React hooks / shell hooks",
  utils: "utility functions",
  helpers: "helper functions",
  services: "service layer",
  controllers: "controller layer",
  models: "data models",
  api: "API handlers",
  routes: "route definitions",
  middleware: "middleware",
  tests: "test files",
  test: "test files",
  __tests__: "test files",
  spec: "test specifications",
  docs: "documentation",
  doc: "documentation",
  scripts: "build / utility scripts",
  config: "configuration files",
  public: "static assets",
  static: "static files",
  assets: "_assets",
  styles: "stylesheets",
  templates: "templates",
  migrations: "database migrations",
  db: "database files",
  schema: "schema definitions",
  types: "type definitions",
  interfaces: "interface definitions",
  dist: "compiled output",
  build: "build output",
  bin: "binary / CLI entry points",
  cmd: "command entry points",
  internal: "internal packages",
  pkg: "public packages",
  vendor: "vendored dependencies",
  infra: "infrastructure code",
  deploy: "deployment configuration",
  ci: "CI/CD configuration",
  ".github": "GitHub Actions / templates",
  ".claude": "Claude Code configuration",
};

try {
  const topEntries = readdirSync(TARGET_DIR, { withFileTypes: true });
  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue;
    if (["node_modules", "vendor", ".git", "dist", "build", "coverage", "__pycache__"].includes(entry.name)) continue;
    const purpose = KNOWN_DIR_PURPOSES[entry.name] || "directory";
    specReport.directory_map[entry.name] = purpose;
  }
  ok(`${Object.keys(specReport.directory_map).length} top-level directories mapped`);
} catch { warn("Could not read directory structure"); }

// ── Config files detection ─────────────────────────────────────────

log("Detecting config files...");
const CONFIG_FILE_CANDIDATES = [
  "package.json", "tsconfig.json", "jsconfig.json",
  "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt",
  "Cargo.toml", "go.mod", "go.sum", "Gemfile",
  "pom.xml", "build.gradle",
  ".env.example", ".env.sample",
  "docker-compose.yml", "docker-compose.yaml",
  "Dockerfile",
  "Makefile", "Taskfile.yml",
  "vite.config.ts", "vite.config.js",
  "next.config.js", "next.config.ts", "next.config.mjs",
  "nuxt.config.ts",
  "tailwind.config.ts", "tailwind.config.js",
  "drizzle.config.ts",
  "prisma/schema.prisma",
  "jest.config.js", "jest.config.ts",
  "vitest.config.ts",
  "playwright.config.ts",
  "biome.json",
  ".eslintrc.js", ".eslintrc.json", "eslint.config.js", "eslint.config.mjs",
  ".prettierrc", ".prettierrc.json",
  ".pre-commit-config.yaml",
  "ruff.toml",
  "terraform/main.tf",
  ".github/workflows",
];

for (const candidate of CONFIG_FILE_CANDIDATES) {
  if (fileExists(join(TARGET_DIR, candidate))) {
    specReport.config_files_found.push(candidate);
  }
}
ok(`${specReport.config_files_found.length} config files found`);

// ── CLAUDE.md ────────────────────────────────────────────────────────

log("Reading CLAUDE.md...");
const claudeMd = readFile(join(TARGET_DIR, "CLAUDE.md"));
if (claudeMd) {
  specReport.existing_claude_md = claudeMd;
  manifest.existingAgentConfig.claudeMd = claudeMd;
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
  ok("CLAUDE.md");
} else {
  warn("No CLAUDE.md found");
}

const agentsMd = readFile(join(TARGET_DIR, "AGENTS.md"));
if (agentsMd) manifest.existingAgentConfig.agentsMd = agentsMd;

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
  } catch { /* skip */ }
}

// ── Git Metadata ─────────────────────────────────────────────────────

log("Reading git metadata...");
const isGitRepo = git("rev-parse --git-dir") !== null;

if (isGitRepo) {
  const remoteUrl = git("remote get-url origin");
  if (remoteUrl) {
    manifest.git.remoteUrl = remoteUrl;
    specReport.remote_url = remoteUrl;
    ok(`remote: ${remoteUrl}`);
  }

  const branchOutput = git("branch --format='%(refname:short)'");
  if (branchOutput) {
    manifest.git.branches = branchOutput
      .split("\n")
      .map(b => b.replace(/^'|'$/g, "").trim())
      .filter(Boolean);
  }

  const recentLog = git("log --oneline -10 --format='%s'");
  if (recentLog) {
    const commits = recentLog
      .split("\n")
      .map(l => l.replace(/^'|'$/g, "").trim())
      .filter(Boolean);
    manifest.git.recentCommits = commits;
    specReport.recent_commits = commits;
    ok(`${commits.length} recent commits`);
  }

  const monthLog = git("log --since='30 days ago' --format='%s'");
  if (monthLog) {
    manifest.git.recentThemes = monthLog
      .split("\n")
      .map(l => l.replace(/^'|'$/g, "").trim())
      .filter(Boolean);
  }

  const tags = git("tag --sort=-creatordate");
  if (tags) manifest.git.tags = tags.split("\n").filter(Boolean).slice(0, 10);

  const commitCount = git("rev-list --count HEAD");
  if (commitCount) manifest.git.commitCount = parseInt(commitCount, 10);

  const firstCommitDate = git("log --reverse --format='%ci' --max-count=1");
  if (firstCommitDate) manifest.git.firstCommitDate = firstCommitDate.replace(/^'|'$/g, "").trim();
} else {
  warn("Not a git repository");
}

// ── Tech Stack Detection ──────────────────────────────────────────────

log("Detecting tech stack...");
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
    manifest.techStack.push({ technology: detector.tech, category: detector.category, detectedFrom: detector.file });
  }
}

// Try to detect framework versions from package.json
if (packageJson?.dependencies) {
  const versionable = {
    "next": "Next.js", "react": "React", "vue": "Vue", "svelte": "Svelte",
    "@angular/core": "Angular", "express": "Express", "fastify": "Fastify",
    "hono": "Hono", "drizzle-orm": "Drizzle ORM", "prisma": "Prisma",
    "@prisma/client": "Prisma",
  };
  for (const [pkg, name] of Object.entries(versionable)) {
    const version = packageJson.dependencies[pkg] || packageJson.devDependencies?.[pkg];
    if (version) {
      const existing = manifest.techStack.find(t => t.technology === name);
      if (existing) existing.version = version.replace(/^[\^~]/, "");
    }
  }
}

ok(`${manifest.techStack.length} technologies detected`);

// ── Claude Memory (Layer 1) ───────────────────────────────────────────

const homedir = process.env.HOME || process.env.USERPROFILE;
if (homedir) {
  const projectHash = TARGET_DIR.replace(/\//g, "-");
  const memoryDir = join(homedir, ".claude", "projects", projectHash, "memory");

  if (fileExists(memoryDir)) {
    try {
      const memoryFiles = readdirSync(memoryDir).filter(f => f.endsWith(".md") && f !== "MEMORY.md");
      for (const file of memoryFiles) {
        const filePath = join(memoryDir, file);
        const content = readFile(filePath);
        if (content) {
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
          let lastModified = null;
          try {
            const stats = statSync(filePath);
            lastModified = stats.mtime.toISOString().split("T")[0];
          } catch { /* ignore */ }
          manifest.claudeMemory.push({ filename: file, name, description, type, content: body, lastModified });
        }
      }
    } catch { /* memory dir not readable */ }
  }
}

// ── Write spec-format report to .brain/inbox/queue-generated/ ────────

log("Writing bootstrap-scan.json...");
try {
  // Find the brain dir by looking for .brain_* in TARGET_DIR or using .brain fallback
  let brainDir = null;
  try {
    const entries = readdirSync(TARGET_DIR, { withFileTypes: true });
    const brainEntry = entries.find(e => e.isDirectory() && (e.name === ".brain" || e.name.startsWith(".brain_")));
    if (brainEntry) brainDir = join(TARGET_DIR, brainEntry.name);
  } catch { /* ignore */ }

  if (brainDir) {
    const queueDir = join(brainDir, "inbox", "queue-generated");
    mkdirSync(queueDir, { recursive: true });
    const outputPath = join(queueDir, "bootstrap-scan.json");
    writeFileSync(outputPath, JSON.stringify(specReport, null, 2), "utf-8");
    ok(`bootstrap-scan.json written to ${outputPath}`);
  } else {
    warn("No .brain directory found — skipping queue-generated write");
  }
} catch (err) {
  warn(`Could not write bootstrap-scan.json: ${err.message}`);
}

// ── Output legacy manifest to stdout (for init-second-brain.sh / tests) ──
console.log(JSON.stringify(manifest, null, 2));
