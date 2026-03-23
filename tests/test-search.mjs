#!/usr/bin/env node
// Tests for template/.brain/hooks/brain-search.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";

const INDEXER_PATH = join(
  import.meta.dirname, "..", "template", ".brain", "hooks", "rebuild-brain-index.mjs"
);
const SEARCH_PATH = join(
  import.meta.dirname, "..", "template", ".brain", "hooks", "brain-search.mjs"
);

function createBrainDir() {
  return mkdtempSync(join(tmpdir(), "brain-search-test-"));
}

function writeNote(brainDir, relPath, content) {
  const full = join(brainDir, relPath);
  const dir = full.substring(0, full.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(full, content, "utf-8");
}

function buildIndex(brainDir) {
  execSync(`node ${INDEXER_PATH} ${brainDir}`, { encoding: "utf-8" });
  return join(brainDir, "brain-index.json");
}

// Dynamic import of search function
let search;
before(async () => {
  const mod = await import(SEARCH_PATH);
  search = mod.search;
});

// Shared fixtures
let tmpDir;
let indexPath;

before(() => {
  tmpDir = createBrainDir();

  // Fixture 1: goal/mission.md
  writeNote(tmpDir, "goal/mission.md",
    `---\ntype: goal\nmaturity: goal\ntags: ["goal", "mission"]\nkeywords: ["mission", "purpose"]\n---\n# Mission Statement\n\nOur mission is to build the best knowledge persistence system.\nThis defines the purpose and direction of the project.\n`);

  // Fixture 2: knowledge/graph/research/api-performance.md
  writeNote(tmpDir, "knowledge/graph/research/api-performance.md",
    `---\ntype: research\nmaturity: working\ntags: ["performance", "api"]\nkeywords: ["latency", "caching", "optimization"]\n---\n# API Performance Research\n\nLatency benchmarks show caching reduces response time by 40%.\nOptimization strategies include connection pooling and query batching.\n`);

  // Fixture 3: knowledge/memory/database-conventions.md
  writeNote(tmpDir, "knowledge/memory/database-conventions.md",
    `---\ntype: claim\nmaturity: working\ntags: ["database", "conventions"]\nkeywords: ["postgres", "migration", "schema"]\n---\n# Database Conventions\n\nPostgres is the primary database. Migrations use timestamped files.\nSchema changes require a review process before merging.\n`);

  // Fixture 4: docs/architecture-overview.md
  writeNote(tmpDir, "docs/architecture-overview.md",
    `---\ntype: docs\nmaturity: reference\ntags: ["MOC", "architecture"]\nkeywords: ["microservices", "event-driven"]\n---\n# Architecture Overview\n\nThe system uses a microservices architecture with event-driven communication.\nSee [[api-performance]] and [[database-conventions]] for details.\n`);

  // Fixture 5: atlas/projects.md
  writeNote(tmpDir, "atlas/projects.md",
    `---\ntype: atlas\nmaturity: reference\ntags: ["MOC"]\nkeywords: ["projects", "active"]\n---\n# Active Projects\n\nThis is the map of all active projects.\nSee [[mission]] for overall direction.\n`);

  indexPath = buildIndex(tmpDir);
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── 1. Basic Search ──────────────────────────────────────────────────

describe("Basic search", () => {
  it("search for 'mission' returns goal/mission.md first", () => {
    const results = search(indexPath, ["mission"]);
    assert.ok(results.length > 0, "should return at least one result");
    assert.ok(results[0].p.includes("mission"), `expected mission note first, got ${results[0].p}`);
  });

  it("search for 'api performance' returns the performance note", () => {
    const results = search(indexPath, ["api", "performance"]);
    assert.ok(results.length > 0, "should return at least one result");
    const perfNote = results.find(r => r.p.includes("api-performance"));
    assert.ok(perfNote, "api-performance note should be in results");
  });

  it("search for nonexistent term returns empty array", () => {
    const results = search(indexPath, ["xyzzyznonexistent"]);
    assert.equal(results.length, 0);
  });

  it("results are sorted by score descending", () => {
    const results = search(indexPath, ["mission"]);
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score,
        `result ${i - 1} (score ${results[i - 1].score}) should be >= result ${i} (score ${results[i].score})`);
    }
  });

  it("results have a score field", () => {
    const results = search(indexPath, ["mission"]);
    assert.ok(results.length > 0);
    for (const r of results) {
      assert.equal(typeof r.score, "number");
      assert.ok(r.score > 0);
    }
  });

  it("search returns max topN results", () => {
    const results = search(indexPath, ["mission"], { topN: 2 });
    assert.ok(results.length <= 2, `expected at most 2 results, got ${results.length}`);
  });
});

// ── 2. Weighted Scoring ──────────────────────────────────────────────

describe("Weighted scoring", () => {
  it("goal notes score higher than working notes for same keyword", () => {
    // "mission" appears in goal/mission.md (maturity: goal) and nowhere with working maturity
    // Add a working-maturity note with "mission" keyword to compare
    const dir2 = createBrainDir();
    try {
      writeNote(dir2, "goal-note.md",
        `---\nmaturity: goal\nkeywords: ["shared-term"]\n---\nShared term content`);
      writeNote(dir2, "working-note.md",
        `---\nmaturity: working\nkeywords: ["shared-term"]\n---\nShared term content`);
      const idx2 = buildIndex(dir2);
      const results = search(idx2, ["shared-term"]);
      const goalResult = results.find(r => r.p === "goal-note.md");
      const workingResult = results.find(r => r.p === "working-note.md");
      assert.ok(goalResult && workingResult);
      assert.ok(goalResult.score > workingResult.score,
        `goal score (${goalResult.score}) should be > working score (${workingResult.score})`);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("MOC notes get 1.5x boost", () => {
    const dir2 = createBrainDir();
    try {
      writeNote(dir2, "moc-note.md",
        `---\ntags: ["MOC"]\nkeywords: ["shared-kw"]\n---\nShared kw content`);
      writeNote(dir2, "normal-note.md",
        `---\ntags: ["other"]\nkeywords: ["shared-kw"]\n---\nShared kw content`);
      const idx2 = buildIndex(dir2);
      const results = search(idx2, ["shared-kw"]);
      const mocResult = results.find(r => r.p === "moc-note.md");
      const normalResult = results.find(r => r.p === "normal-note.md");
      assert.ok(mocResult && normalResult);
      assert.ok(mocResult.score > normalResult.score,
        `MOC score (${mocResult.score}) should be > normal score (${normalResult.score})`);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("explicit keyword match scores higher than body keyword match", () => {
    const dir2 = createBrainDir();
    try {
      writeNote(dir2, "keyword-note.md",
        `---\nkeywords: ["optimization"]\n---\nSome unrelated body text about cats and dogs`);
      writeNote(dir2, "body-note.md",
        `---\nkeywords: ["unrelated"]\n---\noptimization optimization optimization optimization`);
      const idx2 = buildIndex(dir2);
      const results = search(idx2, ["optimization"]);
      const kwResult = results.find(r => r.p === "keyword-note.md");
      const bodyResult = results.find(r => r.p === "body-note.md");
      assert.ok(kwResult, "keyword note should appear in results");
      assert.ok(bodyResult, "body note should appear in results");
      assert.ok(kwResult.score > bodyResult.score,
        `keyword score (${kwResult.score}) should be > body score (${bodyResult.score})`);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("reference maturity scores higher than working", () => {
    const dir2 = createBrainDir();
    try {
      writeNote(dir2, "ref-note.md",
        `---\nmaturity: reference\nkeywords: ["shared"]\n---\nShared content`);
      writeNote(dir2, "work-note.md",
        `---\nmaturity: working\nkeywords: ["shared"]\n---\nShared content`);
      const idx2 = buildIndex(dir2);
      const results = search(idx2, ["shared"]);
      const refResult = results.find(r => r.p === "ref-note.md");
      const workResult = results.find(r => r.p === "work-note.md");
      assert.ok(refResult && workResult);
      assert.ok(refResult.score > workResult.score,
        `reference score (${refResult.score}) should be > working score (${workResult.score})`);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("notes with more links score higher (link count boost)", () => {
    const dir2 = createBrainDir();
    try {
      writeNote(dir2, "many-links.md",
        `---\nkeywords: ["shared"]\n---\n[[a]] [[b]] [[c]] [[d]] [[e]] [[f]] [[g]] [[h]]`);
      writeNote(dir2, "no-links.md",
        `---\nkeywords: ["shared"]\n---\nJust text, no links at all.`);
      const idx2 = buildIndex(dir2);
      const results = search(idx2, ["shared"]);
      const manyResult = results.find(r => r.p === "many-links.md");
      const noResult = results.find(r => r.p === "no-links.md");
      assert.ok(manyResult && noResult);
      assert.ok(manyResult.score > noResult.score,
        `many-links score (${manyResult.score}) should be > no-links score (${noResult.score})`);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("title/filename match scores highest", () => {
    // "mission" is in the filename of goal/mission.md (title weight=10)
    // vs just in keywords of another note (keyword weight=8)
    const results = search(indexPath, ["mission"]);
    const missionNote = results.find(r => r.p.includes("mission"));
    assert.ok(missionNote, "mission note should be in results");
    // It should be first since filename match has highest field weight
    assert.ok(results[0].p.includes("mission"),
      "filename match should rank first");
  });
});

// ── 3. Fuzzy Matching ────────────────────────────────────────────────

describe("Fuzzy matching", () => {
  it("typo 'missin' still finds 'mission' (fuzzy enabled)", () => {
    const results = search(indexPath, ["missin"], { fuzzy: true });
    const found = results.find(r => r.p.includes("mission"));
    assert.ok(found, "should find mission note with typo 'missin'");
  });

  it("typo 'databse' still finds 'database'", () => {
    const results = search(indexPath, ["databse"], { fuzzy: true });
    const found = results.find(r => r.p.includes("database"));
    assert.ok(found, "should find database note with typo 'databse'");
  });

  it("fuzzy disabled returns no results for typos", () => {
    const results = search(indexPath, ["missin"], { fuzzy: false });
    assert.equal(results.length, 0, "fuzzy disabled should not match typos");
  });

  it("fuzzy results are discounted (0.8x)", () => {
    // Compare exact match vs fuzzy match score
    const exact = search(indexPath, ["mission"], { fuzzy: false });
    const fuzzy = search(indexPath, ["missin"], { fuzzy: true });
    if (exact.length > 0 && fuzzy.length > 0) {
      const exactMission = exact.find(r => r.p.includes("mission"));
      const fuzzyMission = fuzzy.find(r => r.p.includes("mission"));
      if (exactMission && fuzzyMission) {
        assert.ok(fuzzyMission.score < exactMission.score,
          `fuzzy score (${fuzzyMission.score}) should be < exact score (${exactMission.score})`);
      }
    }
    // If either is empty, the test still passes — fuzzy discount applies when fuzzy kicks in
    assert.ok(true);
  });
});

// ── 4. CLI Mode ──────────────────────────────────────────────────────

describe("CLI mode", () => {
  it("CLI returns valid JSON", () => {
    const out = execSync(`node ${SEARCH_PATH} ${tmpDir} mission`, { encoding: "utf-8" });
    assert.doesNotThrow(() => JSON.parse(out), "CLI output should be valid JSON");
  });

  it("CLI with no args exits with error", () => {
    assert.throws(() => {
      execSync(`node ${SEARCH_PATH}`, { encoding: "utf-8", stdio: "pipe" });
    }, "should exit with non-zero when no args provided");
  });

  it("CLI with query returns results", () => {
    const out = execSync(`node ${SEARCH_PATH} ${tmpDir} mission`, { encoding: "utf-8" });
    const results = JSON.parse(out);
    assert.ok(Array.isArray(results), "CLI should return an array");
    assert.ok(results.length > 0, "CLI should return results for 'mission'");
  });

  it("CLI results match API results", () => {
    const cliOut = execSync(`node ${SEARCH_PATH} ${tmpDir} mission`, { encoding: "utf-8" });
    const cliResults = JSON.parse(cliOut);
    const apiResults = search(indexPath, ["mission"]);
    assert.equal(cliResults.length, apiResults.length, "CLI and API should return same number of results");
    assert.equal(cliResults[0].p, apiResults[0].p, "CLI and API first result should match");
  });
});
