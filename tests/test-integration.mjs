#!/usr/bin/env node
// Integration tests — full workflow end-to-end

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";

const INDEXER_PATH = join(
  import.meta.dirname, "..", "template", ".brain", "hooks", "rebuild-brain-index.mjs"
);
const SEARCH_PATH = join(
  import.meta.dirname, "..", "template", ".brain", "hooks", "brain-search.mjs"
);
const VALIDATOR_PATH = join(
  import.meta.dirname, "..", "template", ".brain", "hooks", "brain-validator.mjs"
);
const GRAPH_PATH = join(
  import.meta.dirname, "..", "template", ".brain", "hooks", "brain-graph.mjs"
);
const SCANNER_PATH = join(
  import.meta.dirname, "..", "scripts", "bootstrap-scan.mjs"
);
const POPULATOR_PATH = join(
  import.meta.dirname, "..", "scripts", "bootstrap-populate.mjs"
);

function createBrainDir() {
  const dir = mkdtempSync(join(tmpdir(), "integ-brain-"));
  return dir;
}

function writeNote(brainDir, relPath, content) {
  const full = join(brainDir, relPath);
  const dirPath = full.substring(0, full.lastIndexOf("/"));
  mkdirSync(dirPath, { recursive: true });
  writeFileSync(full, content, "utf-8");
}

function buildIndex(brainDir) {
  execSync(`node ${INDEXER_PATH} ${brainDir}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  return join(brainDir, "brain-index.json");
}

// Dynamic imports
let search, validate, loadGraph, findOrphans, findClusters, degreeCentrality;
before(async () => {
  const searchMod = await import(SEARCH_PATH);
  search = searchMod.search;
  const validatorMod = await import(VALIDATOR_PATH);
  validate = validatorMod.validate;
  const graphMod = await import(GRAPH_PATH);
  loadGraph = graphMod.loadGraph;
  findOrphans = graphMod.findOrphans;
  findClusters = graphMod.findClusters;
  degreeCentrality = graphMod.degreeCentrality;
});

// ── 1. Full Workflow ─────────────────────────────────────────────────

describe("Full workflow", () => {
  it("init -> bootstrap -> index -> search returns results", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "integ-project-"));
    const brainDir = createBrainDir();
    try {
      // Create project with package.json
      writeFileSync(join(projectDir, "package.json"), JSON.stringify({
        name: "integration-test",
        description: "An integration test project",
      }));

      // Create brain subdirs that populator expects
      for (const sub of ["goal", "00-home", "atlas", "docs", "knowledge/memory"]) {
        mkdirSync(join(brainDir, sub), { recursive: true });
      }

      // Scan project
      const manifestOutput = execSync(`node ${SCANNER_PATH} ${projectDir}`, {
        encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });
      const manifestPath = join(projectDir, "manifest.json");
      writeFileSync(manifestPath, manifestOutput);

      // Populate brain
      execSync(`node ${POPULATOR_PATH} ${brainDir} ${manifestPath}`, {
        encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });

      // Build index
      const indexPath = buildIndex(brainDir);

      // Search for the project name
      const results = search(indexPath, ["integration"]);
      assert.ok(results.length > 0, "search should return results after bootstrap");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(brainDir, { recursive: true, force: true });
    }
  });

  it("init -> create note -> index rebuilds -> search finds new note", () => {
    const brainDir = createBrainDir();
    try {
      // Start with one note, build index
      writeNote(brainDir, "knowledge/graph/research/original.md",
        `---\ntype: research\ntags: ["testing"]\nkeywords: ["original"]\n---\n# Original Note\n\nOriginal content.\n`);
      let indexPath = buildIndex(brainDir);
      let results = search(indexPath, ["flamingo"]);
      assert.equal(results.length, 0, "flamingo should not exist yet");

      // Create new note about flamingos
      writeNote(brainDir, "knowledge/graph/research/flamingo-behavior.md",
        `---\ntype: research\ntags: ["biology"]\nkeywords: ["flamingo", "behavior"]\n---\n# Flamingo Behavior\n\nFlamingos stand on one leg for thermoregulation.\n`);

      // Rebuild index
      indexPath = buildIndex(brainDir);
      results = search(indexPath, ["flamingo"]);
      assert.ok(results.length > 0, "search should find the new flamingo note");
      assert.ok(results[0].p.includes("flamingo"), "first result should be the flamingo note");
    } finally {
      rmSync(brainDir, { recursive: true, force: true });
    }
  });

  it("validator detects issues in bootstrapped brain", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "integ-val-"));
    const brainDir = createBrainDir();
    try {
      // Create brain subdirs
      for (const sub of ["goal", "00-home", "atlas", "docs", "knowledge/memory"]) {
        mkdirSync(join(brainDir, sub), { recursive: true });
      }

      writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "test" }));
      const manifestOutput = execSync(`node ${SCANNER_PATH} ${projectDir}`, {
        encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });
      const manifestPath = join(projectDir, "manifest.json");
      writeFileSync(manifestPath, manifestOutput);
      execSync(`node ${POPULATOR_PATH} ${brainDir} ${manifestPath}`, {
        encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });

      // Add a deliberately broken note
      writeNote(brainDir, "broken.md", "No frontmatter here, just plain text.");

      const result = validate(brainDir);
      assert.ok(result.issueCount > 0, "validator should detect issues");
      const fmIssues = result.issues.filter(i => i.type === "missing-frontmatter");
      assert.ok(fmIssues.length > 0, "should detect missing frontmatter");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(brainDir, { recursive: true, force: true });
    }
  });

  it("graph analysis works on bootstrapped brain", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "integ-graph-"));
    const brainDir = createBrainDir();
    try {
      for (const sub of ["goal", "00-home", "atlas", "docs", "knowledge/memory"]) {
        mkdirSync(join(brainDir, sub), { recursive: true });
      }

      writeFileSync(join(projectDir, "package.json"), JSON.stringify({
        name: "test", description: "A test project",
      }));
      writeFileSync(join(projectDir, "README.md"), "# Test\n\nThis is a test.\n");
      const manifestOutput = execSync(`node ${SCANNER_PATH} ${projectDir}`, {
        encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });
      const manifestPath = join(projectDir, "manifest.json");
      writeFileSync(manifestPath, manifestOutput);
      execSync(`node ${POPULATOR_PATH} ${brainDir} ${manifestPath}`, {
        encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });

      const indexPath = buildIndex(brainDir);
      const graph = loadGraph(indexPath);
      assert.ok(graph.nodes.size > 0, "graph should have nodes from bootstrapped brain");

      const clusters = findClusters(graph);
      assert.ok(clusters.length > 0, "graph should have at least one cluster");

      const central = degreeCentrality(graph);
      assert.ok(central.length > 0, "centrality analysis should return results");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(brainDir, { recursive: true, force: true });
    }
  });

  it("search scores goal notes higher than working notes", () => {
    const brainDir = createBrainDir();
    try {
      writeNote(brainDir, "goal/mission.md",
        `---\ntype: goal\nmaturity: goal\ntags: ["goal"]\nkeywords: ["testing", "quality"]\n---\n# Mission\n\nOur mission is testing quality.\n`);
      writeNote(brainDir, "knowledge/memory/testing-notes.md",
        `---\ntype: claim\nmaturity: working\ntags: ["testing"]\nkeywords: ["testing", "quality"]\n---\n# Testing Notes\n\nSome notes about testing quality.\n`);

      const indexPath = buildIndex(brainDir);
      const results = search(indexPath, ["testing", "quality"]);
      assert.ok(results.length >= 2, "should return both notes");

      const goalResult = results.find(r => r.p.includes("mission"));
      const workingResult = results.find(r => r.p.includes("testing-notes"));
      assert.ok(goalResult && workingResult, "both notes should be in results");
      assert.ok(goalResult.score > workingResult.score,
        `goal score (${goalResult.score}) should be > working score (${workingResult.score})`);
    } finally {
      rmSync(brainDir, { recursive: true, force: true });
    }
  });
});

// ── 2. Index v3 Features ─────────────────────────────────────────────

describe("Index v3 features", () => {
  let brainDir, indexPath, index;

  before(() => {
    brainDir = createBrainDir();

    // A links to B
    writeNote(brainDir, "note-a.md",
      `---\ntype: claim\ntags: ["test"]\nkeywords: ["alpha"]\n---\n# Note A\n\nSee [[note-b]] for details.\n`);
    // B links to C
    writeNote(brainDir, "note-b.md",
      `---\ntype: claim\ntags: ["test"]\nkeywords: ["beta"]\n---\n# Note B\n\nSee [[note-c]] for more.\n`);
    // C has no outbound links
    writeNote(brainDir, "note-c.md",
      `---\ntype: claim\ntags: ["test"]\nkeywords: ["gamma"]\n---\n# Note C\n\nEnd of chain.\n`);

    indexPath = buildIndex(brainDir);
    index = JSON.parse(readFileSync(indexPath, "utf-8"));
  });

  after(() => {
    rmSync(brainDir, { recursive: true, force: true });
  });

  it("index has backlinks (bl field)", () => {
    for (const entry of index.entries) {
      assert.ok(Array.isArray(entry.bl), `entry ${entry.p} should have bl array`);
    }
  });

  it("index has age field", () => {
    for (const entry of index.entries) {
      assert.ok("age" in entry, `entry ${entry.p} should have age field`);
      assert.equal(typeof entry.age, "number", `age should be a number for ${entry.p}`);
    }
  });

  it("backlinks are correctly calculated (if A links to B, B's bl contains A's path slug)", () => {
    const entryB = index.entries.find(e => e.p === "note-b.md");
    assert.ok(entryB, "note-b.md should exist in index");
    assert.ok(entryB.bl.includes("note-a"), `note-b's backlinks should include 'note-a', got: ${JSON.stringify(entryB.bl)}`);

    const entryC = index.entries.find(e => e.p === "note-c.md");
    assert.ok(entryC, "note-c.md should exist in index");
    assert.ok(entryC.bl.includes("note-b"), `note-c's backlinks should include 'note-b', got: ${JSON.stringify(entryC.bl)}`);
  });

  it("age is a non-negative number", () => {
    for (const entry of index.entries) {
      assert.ok(entry.age >= 0, `age should be >= 0 for ${entry.p}, got ${entry.age}`);
    }
  });

  it("title words boost body keyword extraction", () => {
    // Note A's filename is "note-a.md", which splits to "note a"
    // "note" is in the stopwords list, but "note-a" splits to "note" and "a"
    // which are both < 4 chars. Let's use a more descriptive filename.
    const dir = mkdtempSync(join(tmpdir(), "title-boost-test-"));
    try {
      // The filename "architecture-overview" -> title words ["architecture", "overview"]
      // These should appear in bk even if they only appear once in body
      writeNote(dir, "architecture-overview.md",
        `---\ntype: docs\n---\n# Architecture Overview\n\nThe system uses microservices.\n`);
      const idx = buildIndex(dir);
      const data = JSON.parse(readFileSync(idx, "utf-8"));
      const entry = data.entries[0];
      assert.ok(entry.bk.includes("architecture"),
        `body keywords should include title word "architecture", got: ${JSON.stringify(entry.bk)}`);
      assert.ok(entry.bk.includes("overview"),
        `body keywords should include title word "overview", got: ${JSON.stringify(entry.bk)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
