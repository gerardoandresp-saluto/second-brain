#!/usr/bin/env node
// Tests for scripts/bootstrap-scan.mjs and scripts/bootstrap-populate.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync,
  existsSync, chmodSync
} from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";

const SCANNER_PATH = join(import.meta.dirname, "..", "scripts", "bootstrap-scan.mjs");
const POPULATOR_PATH = join(import.meta.dirname, "..", "scripts", "bootstrap-populate.mjs");

function createProjectDir() {
  const dir = mkdtempSync(join(tmpdir(), "project-test-"));
  return dir;
}

function createBrainDir() {
  const dir = mkdtempSync(join(tmpdir(), "brain-pop-test-"));
  // Create required subdirs that the populator expects
  for (const sub of ["goal", "00-home", "atlas", "docs", "knowledge/memory"]) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  return dir;
}

function runScanner(projectDir) {
  const output = execSync(`node ${SCANNER_PATH} ${projectDir}`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function runPopulator(brainDir, manifestPath) {
  execSync(`node ${POPULATOR_PATH} ${brainDir} ${manifestPath}`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// ── 1. Scanner Tests ────────────────────────────────────────────────

describe("Scanner", () => {
  it("detects package.json name and description", () => {
    const dir = createProjectDir();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        name: "my-cool-project",
        description: "A cool project for testing"
      }));
      const manifest = runScanner(dir);
      assert.equal(manifest.project.name, "my-cool-project");
      assert.equal(manifest.project.description, "A cool project for testing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects tech stack from config files", () => {
    const dir = createProjectDir();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test" }));
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
      const manifest = runScanner(dir);
      const techs = manifest.techStack.map(t => t.technology);
      assert.ok(techs.includes("Node.js"), "Should detect Node.js from package.json");
      assert.ok(techs.includes("TypeScript"), "Should detect TypeScript from tsconfig.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("extracts README first paragraph", () => {
    const dir = createProjectDir();
    try {
      writeFileSync(join(dir, "README.md"), "# My Project\n\nThis is the first paragraph of the readme.\n\nSecond paragraph.");
      const manifest = runScanner(dir);
      assert.equal(manifest.readme.firstParagraph, "This is the first paragraph of the readme.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("extracts README install section", () => {
    const dir = createProjectDir();
    try {
      writeFileSync(join(dir, "README.md"), "# Project\n\nIntro.\n\n## Installation\n\nRun `npm install` to get started.\n\n## Usage\n\nUse it.");
      const manifest = runScanner(dir);
      assert.ok(manifest.readme.installSection);
      assert.ok(manifest.readme.installSection.includes("npm install"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects template READMEs", () => {
    const dir = createProjectDir();
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app" }));
      writeFileSync(join(dir, "README.md"),
        "# Claude Agentic Framework\n\ncurl -sSL https://example.com | bash\n\n/swarm-plan and /swarm-execute\n\ndrop-in template for reusable skills\n\nworker-explorer does things");
      const manifest = runScanner(dir);
      assert.equal(manifest.readme.isTemplate, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads git metadata from a real git repo", () => {
    const dir = createProjectDir();
    try {
      execSync(`cd ${dir} && git init && git add -A 2>/dev/null; git -c user.name=Test -c user.email=t@t.com commit --allow-empty -m "initial commit" && git -c user.name=Test -c user.email=t@t.com commit --allow-empty -m "second commit"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const manifest = runScanner(dir);
      assert.ok(manifest.git.commitCount >= 2);
      assert.ok(manifest.git.recentCommits.length >= 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns valid JSON manifest", () => {
    const dir = createProjectDir();
    try {
      const output = execSync(`node ${SCANNER_PATH} ${dir}`, { encoding: "utf-8" });
      assert.doesNotThrow(() => JSON.parse(output));
      const manifest = JSON.parse(output);
      assert.ok("project" in manifest);
      assert.ok("readme" in manifest);
      assert.ok("techStack" in manifest);
      assert.ok("git" in manifest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles missing files gracefully", () => {
    const dir = createProjectDir();
    try {
      // Empty project dir - no package.json, no README, no git
      const manifest = runScanner(dir);
      assert.equal(manifest.readme, null);
      assert.deepEqual(manifest.techStack, []);
      // Scanner falls back to basename of project dir when no package.json/git
      assert.ok(typeof manifest.project.name === "string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── 2. Populator Tests ──────────────────────────────────────────────

describe("Populator", () => {
  function createManifestFile(dir, manifest) {
    const manifestPath = join(dir, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf-8");
    return manifestPath;
  }

  it("creates mission.md from manifest", () => {
    const brainDir = createBrainDir();
    const projectDir = createProjectDir();
    try {
      const manifestPath = createManifestFile(projectDir, {
        project: { name: "test-project", description: "A test project" },
        readme: { firstParagraph: "This project does great things.", isTemplate: false },
        docs: {},
        git: {},
        techStack: [],
        adrs: [],
        scripts: {},
        existingAgentConfig: {},
        claudeMemory: [],
      });
      runPopulator(brainDir, manifestPath);
      assert.ok(existsSync(join(brainDir, "goal", "mission.md")));
      const content = readFileSync(join(brainDir, "goal", "mission.md"), "utf-8");
      assert.ok(content.includes("test-project"));
      assert.ok(content.includes("This project does great things."));
    } finally {
      rmSync(brainDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("creates top-of-mind.md with phase detection", () => {
    const brainDir = createBrainDir();
    const projectDir = createProjectDir();
    try {
      const manifestPath = createManifestFile(projectDir, {
        project: { name: "test" },
        readme: null,
        docs: {},
        git: { commitCount: 75, recentCommits: ["fix bug", "add feature"], branches: ["main"] },
        techStack: [],
        adrs: [],
        scripts: {},
        existingAgentConfig: {},
        claudeMemory: [],
      });
      runPopulator(brainDir, manifestPath);
      const content = readFileSync(join(brainDir, "00-home", "top-of-mind.md"), "utf-8");
      assert.ok(content.includes("Maturing"), "75 commits should be 'Maturing' phase");
      assert.ok(content.includes("75 commits"));
    } finally {
      rmSync(brainDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("creates tech-stack.md with detected technologies", () => {
    const brainDir = createBrainDir();
    const projectDir = createProjectDir();
    try {
      const manifestPath = createManifestFile(projectDir, {
        project: { name: "test" },
        readme: null,
        docs: {},
        git: {},
        techStack: [
          { technology: "Node.js", category: "Runtime", detectedFrom: "package.json" },
          { technology: "TypeScript", category: "Language", detectedFrom: "tsconfig.json" },
        ],
        adrs: [],
        scripts: {},
        existingAgentConfig: {},
        claudeMemory: [],
      });
      runPopulator(brainDir, manifestPath);
      assert.ok(existsSync(join(brainDir, "docs", "tech-stack.md")));
      const content = readFileSync(join(brainDir, "docs", "tech-stack.md"), "utf-8");
      assert.ok(content.includes("Node.js"));
      assert.ok(content.includes("TypeScript"));
    } finally {
      rmSync(brainDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("creates project-overview.md from README", () => {
    const brainDir = createBrainDir();
    const projectDir = createProjectDir();
    try {
      const manifestPath = createManifestFile(projectDir, {
        project: { name: "test-project" },
        readme: { full: "# Test Project\n\nFull readme content here.", isTemplate: false },
        docs: {},
        git: {},
        techStack: [],
        adrs: [],
        scripts: {},
        existingAgentConfig: {},
        claudeMemory: [],
      });
      runPopulator(brainDir, manifestPath);
      assert.ok(existsSync(join(brainDir, "docs", "project-overview.md")));
      const content = readFileSync(join(brainDir, "docs", "project-overview.md"), "utf-8");
      assert.ok(content.includes("Full readme content here."));
      assert.ok(content.includes("test-project"));
    } finally {
      rmSync(brainDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("won't overwrite existing non-template notes", () => {
    const brainDir = createBrainDir();
    const projectDir = createProjectDir();
    try {
      // Write a custom mission.md that is NOT a template default
      writeFileSync(join(brainDir, "goal", "mission.md"), "# My custom mission\n\nThis is user content.", "utf-8");

      const manifestPath = createManifestFile(projectDir, {
        project: { name: "test", description: "test desc" },
        readme: { firstParagraph: "Override attempt", isTemplate: false },
        docs: {},
        git: {},
        techStack: [],
        adrs: [],
        scripts: {},
        existingAgentConfig: {},
        claudeMemory: [],
      });
      runPopulator(brainDir, manifestPath);
      const content = readFileSync(join(brainDir, "goal", "mission.md"), "utf-8");
      assert.ok(content.includes("My custom mission"), "Should preserve user content");
      assert.ok(!content.includes("Override attempt"), "Should not have overwritten");
    } finally {
      rmSync(brainDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("marks all notes with bootstrapped: true", () => {
    const brainDir = createBrainDir();
    const projectDir = createProjectDir();
    try {
      const manifestPath = createManifestFile(projectDir, {
        project: { name: "test", description: "A test" },
        readme: { firstParagraph: "Intro.", full: "# README\n\nIntro.", isTemplate: false },
        docs: {},
        git: { commitCount: 5, recentCommits: ["init"], branches: ["main"] },
        techStack: [{ technology: "Node.js", category: "Runtime", detectedFrom: "package.json" }],
        adrs: [],
        scripts: {},
        existingAgentConfig: {},
        claudeMemory: [],
      });
      runPopulator(brainDir, manifestPath);

      // Check all created files for bootstrapped: true
      const filesToCheck = [
        join(brainDir, "goal", "mission.md"),
        join(brainDir, "00-home", "top-of-mind.md"),
        join(brainDir, "docs", "tech-stack.md"),
        join(brainDir, "docs", "project-overview.md"),
      ];

      for (const file of filesToCheck) {
        if (existsSync(file)) {
          const content = readFileSync(file, "utf-8");
          assert.ok(content.includes("bootstrapped: true"), `${file} should have bootstrapped: true`);
        }
      }
    } finally {
      rmSync(brainDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("all generated notes have valid frontmatter", () => {
    const brainDir = createBrainDir();
    const projectDir = createProjectDir();
    try {
      const manifestPath = createManifestFile(projectDir, {
        project: { name: "test", description: "A test" },
        readme: { firstParagraph: "Intro.", full: "# README\n\nIntro.", isTemplate: false },
        docs: {},
        git: { commitCount: 15, recentCommits: ["fix"], branches: ["main", "feature"] },
        techStack: [{ technology: "Node.js", category: "Runtime", detectedFrom: "package.json" }],
        adrs: [],
        scripts: {},
        existingAgentConfig: {},
        claudeMemory: [],
      });
      runPopulator(brainDir, manifestPath);

      const filesToCheck = [
        join(brainDir, "goal", "mission.md"),
        join(brainDir, "00-home", "top-of-mind.md"),
        join(brainDir, "docs", "tech-stack.md"),
        join(brainDir, "docs", "project-overview.md"),
      ];

      for (const file of filesToCheck) {
        if (existsSync(file)) {
          const content = readFileSync(file, "utf-8");
          assert.ok(content.startsWith("---"), `${file} should start with ---`);
          const endIdx = content.indexOf("\n---", 3);
          assert.ok(endIdx !== -1, `${file} should have closing ---`);
          // Check that type field exists
          const frontmatter = content.slice(3, endIdx);
          assert.ok(frontmatter.includes("type:"), `${file} should have a type field`);
        }
      }
    } finally {
      rmSync(brainDir, { recursive: true, force: true });
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
