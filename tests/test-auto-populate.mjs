#!/usr/bin/env node
// Tests for scripts/auto-populate-prompt.mjs and auto-detect logic in session-orient.sh

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";

const AUTO_POPULATE_PATH = join(
  import.meta.dirname, "..", "scripts", "auto-populate-prompt.mjs"
);
const ROUTER_SH_PATH = join(
  import.meta.dirname, "..", "template", ".brain", "hooks", "session-orient.sh"
);
const INDEXER_PATH = join(
  import.meta.dirname, "..", "template", ".brain", "hooks", "rebuild-brain-index.mjs"
);
const INIT_SCRIPT_PATH = join(
  import.meta.dirname, "..", "scripts", "init-second-brain.sh"
);

function createFixtureProject() {
  const dir = mkdtempSync(join(tmpdir(), "auto-pop-test-"));

  // package.json
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "test-fixture-project",
    description: "A fixture project for testing auto-populate",
    scripts: { test: "node --test" },
  }));

  // README.md
  writeFileSync(join(dir, "README.md"), "# Test Fixture\n\nThis is a test fixture project.\n");

  // src/index.js
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.js"), "console.log('hello');\n");

  // tsconfig.json
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "node16" },
  }));

  // git repo with commits
  execSync(
    `cd ${dir} && git init && git add -A && git -c user.name=Test -c user.email=t@t.com commit -m "initial commit" && git -c user.name=Test -c user.email=t@t.com commit --allow-empty -m "second commit"`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );

  return dir;
}

function installBrain(projectDir) {
  const brainDir = join(projectDir, ".brain");
  const templateBrain = join(import.meta.dirname, "..", "template", ".brain");

  // Copy template brain into project
  execSync(`cp -r "${templateBrain}" "${brainDir}"`, { encoding: "utf-8" });

  // Build index so existing notes are listed
  execSync(`node ${INDEXER_PATH} ${brainDir}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });

  return brainDir;
}

function runAutoPopulate(brainDir, projectDir) {
  execSync(`node ${AUTO_POPULATE_PATH} ${brainDir} ${projectDir}`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return join(brainDir, "hooks", ".state", "auto-populate-prompt.md");
}

// ── 1. Prompt Generation ─────────────────────────────────────────────

describe("Prompt generation", () => {
  let projectDir, brainDir, promptPath;

  before(() => {
    projectDir = createFixtureProject();
    brainDir = installBrain(projectDir);
    promptPath = runAutoPopulate(brainDir, projectDir);
  });

  after(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("generates prompt file in hooks/.state/", () => {
    assert.ok(existsSync(promptPath), "prompt file should exist at hooks/.state/auto-populate-prompt.md");
  });

  it("prompt contains project structure summary", () => {
    const content = readFileSync(promptPath, "utf-8");
    assert.ok(content.includes("Project Structure Summary"), "should contain project structure summary heading");
  });

  it("prompt lists file counts by extension", () => {
    const content = readFileSync(promptPath, "utf-8");
    assert.ok(content.includes("Files by type"), "should contain files by type section");
    // We created .js, .json, .md files
    assert.ok(content.includes(".js") || content.includes(".json"), "should list at least one extension");
  });

  it("prompt lists existing brain notes to avoid duplication", () => {
    const content = readFileSync(promptPath, "utf-8");
    assert.ok(content.includes("Existing Brain Notes"), "should contain existing brain notes section");
  });

  it("prompt includes git commits when available", () => {
    const content = readFileSync(promptPath, "utf-8");
    assert.ok(content.includes("Recent commits"), "should contain recent commits section");
    assert.ok(content.includes("initial commit") || content.includes("second commit"),
      "should include actual commit messages");
  });

  it("prompt includes branches when available", () => {
    const content = readFileSync(promptPath, "utf-8");
    assert.ok(content.includes("Branches"), "should contain branches section");
    // git init creates main or master
    assert.ok(content.includes("main") || content.includes("master"),
      "should list the default branch");
  });

  it("prompt includes entry points when detected", () => {
    const content = readFileSync(promptPath, "utf-8");
    assert.ok(content.includes("Entry points"), "should contain entry points section");
    assert.ok(content.includes("src/index.js"), "should detect src/index.js as entry point");
  });

  it("prompt includes config files when detected", () => {
    const content = readFileSync(promptPath, "utf-8");
    assert.ok(content.includes("Config files"), "should contain config files section");
    assert.ok(content.includes("tsconfig.json") || content.includes("package.json"),
      "should detect config files");
  });
});

// ── 2. Auto-detect in router ─────────────────────────────────────────

describe("Auto-detect in router", () => {
  it("router detects .brain directory with auto-populate prompt", () => {
    const dir = mkdtempSync(join(tmpdir(), "router-detect-test-"));
    try {
      // Create a .brain directory (the router checks for .brain_* and .brain)
      const brainDir = join(dir, ".brain");
      mkdirSync(join(brainDir, "hooks", ".state"), { recursive: true });
      writeFileSync(join(brainDir, "hooks", ".state", "auto-populate-prompt.md"),
        "# Test Prompt\n\nThis is a test auto-populate prompt.\n");

      // The router.sh checks for brain directories using CLAUDE_PROJECT_DIR
      const result = execSync(
        `echo '{"user_prompt":"test prompt"}' | CLAUDE_PROJECT_DIR="${dir}" bash ${ROUTER_SH_PATH} 2>&1`,
        { encoding: "utf-8", timeout: 10000 }
      );
      assert.ok(result.includes("Auto-populate prompt detected") || result.includes("auto-populate"),
        "router should detect auto-populate prompt in .brain directory");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("router outputs prompt content when file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "router-output-test-"));
    try {
      const brainDir = join(dir, ".brain");
      mkdirSync(join(brainDir, "hooks", ".state"), { recursive: true });
      const promptContent = "# Auto-Populate\n\nSpecific test content xyz123.\n";
      writeFileSync(join(brainDir, "hooks", ".state", "auto-populate-prompt.md"), promptContent);

      const result = execSync(
        `echo '{"user_prompt":"test prompt"}' | CLAUDE_PROJECT_DIR="${dir}" bash ${ROUTER_SH_PATH} 2>&1`,
        { encoding: "utf-8", timeout: 10000 }
      );
      assert.ok(result.includes("xyz123"), "router should output prompt content");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("router renames file to .done after output", () => {
    const dir = mkdtempSync(join(tmpdir(), "router-rename-test-"));
    try {
      const brainDir = join(dir, ".brain");
      mkdirSync(join(brainDir, "hooks", ".state"), { recursive: true });
      const promptPath = join(brainDir, "hooks", ".state", "auto-populate-prompt.md");
      writeFileSync(promptPath, "# Test\n\nContent.\n");

      execSync(
        `echo '{"user_prompt":"test prompt"}' | CLAUDE_PROJECT_DIR="${dir}" bash ${ROUTER_SH_PATH} 2>&1`,
        { encoding: "utf-8", timeout: 10000 }
      );

      assert.ok(!existsSync(promptPath), "original prompt file should be gone");
      assert.ok(existsSync(promptPath + ".done"), "prompt should be renamed to .done");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("router stays silent when no prompt file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "router-silent-test-"));
    try {
      const brainDir = join(dir, ".brain");
      mkdirSync(join(brainDir, "hooks", ".state"), { recursive: true });
      // No auto-populate-prompt.md file

      const result = execSync(
        `echo '{"user_prompt":"test prompt"}' | CLAUDE_PROJECT_DIR="${dir}" bash ${ROUTER_SH_PATH} 2>&1`,
        { encoding: "utf-8", timeout: 10000 }
      );
      assert.ok(!result.includes("Auto-populate prompt detected"),
        "router should not mention auto-populate when no prompt file exists");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── 3. End-to-end ────────────────────────────────────────────────────

describe("End-to-end auto-populate", () => {
  it("auto-populate creates prompt file from scratch", () => {
    const projectDir = createFixtureProject();
    try {
      const brainDir = installBrain(projectDir);
      const promptPath = runAutoPopulate(brainDir, projectDir);
      assert.ok(existsSync(promptPath), "prompt file should be created");
      const content = readFileSync(promptPath, "utf-8");
      assert.ok(content.length > 100, "prompt should have substantial content");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("prompt is valid markdown", () => {
    const projectDir = createFixtureProject();
    try {
      const brainDir = installBrain(projectDir);
      const promptPath = runAutoPopulate(brainDir, projectDir);
      const content = readFileSync(promptPath, "utf-8");

      // Valid markdown should start with a heading
      assert.ok(content.startsWith("#"), "prompt should start with a markdown heading");
      // Should have multiple sections (## headings)
      const headingCount = (content.match(/^##\s/gm) || []).length;
      assert.ok(headingCount >= 3, `prompt should have at least 3 sections, found ${headingCount}`);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("prompt references correct brain folder name", () => {
    const projectDir = createFixtureProject();
    try {
      const brainDir = installBrain(projectDir);
      const promptPath = runAutoPopulate(brainDir, projectDir);
      const content = readFileSync(promptPath, "utf-8");
      // The brain folder name is ".brain" since we installed it directly
      assert.ok(content.includes(".brain/"), "prompt should reference the brain folder name");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
