#!/usr/bin/env node
// Tests for template/.brain/hooks/brain-validator.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";

const VALIDATOR_PATH = join(
  import.meta.dirname, "..", "template", ".brain", "hooks", "brain-validator.mjs"
);

function createBrainDir() {
  return mkdtempSync(join(tmpdir(), "brain-validator-test-"));
}

function writeNote(brainDir, relPath, content) {
  const full = join(brainDir, relPath);
  const dir = full.substring(0, full.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(full, content, "utf-8");
}

let validate;
before(async () => {
  const mod = await import(VALIDATOR_PATH);
  validate = mod.validate;
});

// ── 1. Frontmatter Validation ────────────────────────────────────────

describe("Frontmatter validation", () => {
  it("valid note produces no errors", () => {
    const dir = createBrainDir();
    try {
      writeNote(dir, "valid.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["test"]\nkeywords: ["testing"]\n---\n# Valid Note\n\nThis is a valid note with all required fields and a wiki-link to itself.\n`);
      const result = validate(dir);
      const errors = result.issues.filter(i => i.severity === "error");
      assert.equal(errors.length, 0, `expected no errors, got: ${JSON.stringify(errors)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("missing frontmatter is flagged as error", () => {
    const dir = createBrainDir();
    try {
      writeNote(dir, "no-fm.md", "# No Frontmatter\n\nJust a plain note without YAML frontmatter.");
      const result = validate(dir);
      const fmIssues = result.issues.filter(i => i.type === "missing-frontmatter");
      assert.ok(fmIssues.length > 0, "should flag missing frontmatter");
      assert.equal(fmIssues[0].severity, "error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("missing required field (type) is flagged as warning", () => {
    const dir = createBrainDir();
    try {
      writeNote(dir, "no-type.md",
        `---\ndate: 2025-01-01\ntags: ["test"]\n---\n# Missing Type\n\nNote without type field.\n`);
      const result = validate(dir);
      const typeIssues = result.issues.filter(i =>
        i.type === "missing-field" && i.message.includes("type"));
      assert.ok(typeIssues.length > 0, "should flag missing type field");
      assert.equal(typeIssues[0].severity, "warning");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("invalid type is flagged as warning", () => {
    const dir = createBrainDir();
    try {
      writeNote(dir, "bad-type.md",
        `---\ndate: 2025-01-01\ntype: nonexistent-type\ntags: ["test"]\n---\n# Bad Type\n\nNote with invalid type.\n`);
      const result = validate(dir);
      const typeIssues = result.issues.filter(i => i.type === "invalid-type");
      assert.ok(typeIssues.length > 0, "should flag invalid type");
      assert.equal(typeIssues[0].severity, "warning");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("invalid maturity is flagged as warning", () => {
    const dir = createBrainDir();
    try {
      writeNote(dir, "bad-maturity.md",
        `---\ndate: 2025-01-01\ntype: claim\nmaturity: nonexistent-maturity\ntags: ["test"]\n---\n# Bad Maturity\n\nNote with invalid maturity.\n`);
      const result = validate(dir);
      const matIssues = result.issues.filter(i => i.type === "invalid-maturity");
      assert.ok(matIssues.length > 0, "should flag invalid maturity");
      assert.equal(matIssues[0].severity, "warning");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── 2. Link Health ───────────────────────────────────────────────────

describe("Link health", () => {
  it("broken wiki-link detected", () => {
    const dir = createBrainDir();
    try {
      writeNote(dir, "linker.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["test"]\n---\n# Linker\n\nSee [[nonexistent-target]] for details.\n`);
      const result = validate(dir);
      const brokenLinks = result.issues.filter(i => i.type === "broken-link");
      assert.ok(brokenLinks.length > 0, "should detect broken wiki-link");
      assert.ok(brokenLinks[0].message.includes("nonexistent-target"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("valid wiki-link not flagged", () => {
    const dir = createBrainDir();
    try {
      writeNote(dir, "source.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["test"]\n---\n# Source\n\nSee [[target]] for details.\n`);
      writeNote(dir, "target.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["test"]\n---\n# Target\n\nTarget note content.\n`);
      const result = validate(dir);
      const brokenLinks = result.issues.filter(i => i.type === "broken-link");
      assert.equal(brokenLinks.length, 0, "valid link should not be flagged as broken");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("orphan note detected", () => {
    const dir = createBrainDir();
    try {
      writeNote(dir, "orphan.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["test"]\n---\n# Orphan\n\nThis note has no links in or out.\n`);
      const result = validate(dir);
      const orphans = result.issues.filter(i => i.type === "orphan");
      assert.ok(orphans.length > 0, "should detect orphan note");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("note with both in and out links not flagged as orphan", () => {
    const dir = createBrainDir();
    try {
      writeNote(dir, "a.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["test"]\n---\n# Note A\n\nSee [[b]] for details.\n`);
      writeNote(dir, "b.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["test"]\n---\n# Note B\n\nSee [[a]] for details.\n`);
      const result = validate(dir);
      const orphans = result.issues.filter(i => i.type === "orphan");
      assert.equal(orphans.length, 0, "connected notes should not be flagged as orphans");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── 3. Duplicate Detection ───────────────────────────────────────────

describe("Duplicate detection", () => {
  it("very similar notes flagged as duplicates", () => {
    const dir = createBrainDir();
    try {
      const sharedContent = "The comprehensive database migration strategy involves careful planning " +
        "of schema changes across multiple environments. PostgreSQL provides robust transactional " +
        "DDL support that makes migrations safer. Each migration should be tested in staging before " +
        "production deployment. Rollback procedures must be documented for every migration step. " +
        "Database conventions ensure consistency across the entire engineering team and projects.";
      writeNote(dir, "note-a.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["db"]\n---\n# Note A\n\n${sharedContent}\n`);
      writeNote(dir, "note-b.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["db"]\n---\n# Note B\n\n${sharedContent}\n`);
      const result = validate(dir);
      const dupes = result.issues.filter(i => i.type === "duplicate");
      assert.ok(dupes.length > 0, "very similar notes should be flagged as duplicates");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("different notes not flagged as duplicates", () => {
    const dir = createBrainDir();
    try {
      writeNote(dir, "cats.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["animals"]\n---\n# Cats\n\n` +
        "Cats are independent domesticated felines known for their agility and hunting " +
        "prowess. They have retractable claws and excellent night vision. Domestic cats " +
        "typically weigh between eight and eleven pounds. Their behavior includes purring " +
        "kneading and grooming themselves regularly throughout the day.\n");
      writeNote(dir, "rockets.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["space"]\n---\n# Rockets\n\n` +
        "Rockets operate through Newton's third law of motion using chemical propulsion " +
        "systems to generate thrust. Modern spacecraft utilize liquid hydrogen and liquid " +
        "oxygen as propellants. Orbital mechanics governs trajectory calculations for " +
        "interplanetary missions. Reusable launch vehicles have dramatically reduced costs.\n");
      const result = validate(dir);
      const dupes = result.issues.filter(i => i.type === "duplicate");
      assert.equal(dupes.length, 0, "different notes should not be flagged as duplicates");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("small notes (< 10 words) excluded from comparison", () => {
    const dir = createBrainDir();
    try {
      writeNote(dir, "tiny-a.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["test"]\n---\n# Tiny\n\nSmall note.\n`);
      writeNote(dir, "tiny-b.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["test"]\n---\n# Tiny\n\nSmall note.\n`);
      const result = validate(dir);
      const dupes = result.issues.filter(i => i.type === "duplicate");
      assert.equal(dupes.length, 0, "small notes should be excluded from duplicate detection");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── 4. CLI and Summary ───────────────────────────────────────────────

describe("CLI and summary", () => {
  it("CLI exits 1 on errors, 0 on clean", () => {
    const dirClean = createBrainDir();
    const dirError = createBrainDir();
    try {
      // Clean vault
      writeNote(dirClean, "valid.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["test"]\n---\n# Valid\n\nContent.\n`);
      const cleanResult = execSync(`node ${VALIDATOR_PATH} ${dirClean}; echo "EXIT:$?"`,
        { encoding: "utf-8", stdio: "pipe" });
      assert.ok(cleanResult.includes("EXIT:0"), "should exit 0 on clean vault");

      // Vault with errors (missing frontmatter)
      writeNote(dirError, "broken.md", "No frontmatter at all, just plain text.");
      const errorResult = execSync(`node ${VALIDATOR_PATH} ${dirError}; echo "EXIT:$?"`,
        { encoding: "utf-8", stdio: "pipe" });
      assert.ok(errorResult.includes("EXIT:1"), "should exit 1 on vault with errors");
    } finally {
      rmSync(dirClean, { recursive: true, force: true });
      rmSync(dirError, { recursive: true, force: true });
    }
  });

  it("summary counts are correct", () => {
    const dir = createBrainDir();
    try {
      // 1 error: missing frontmatter
      writeNote(dir, "no-fm.md", "Plain text, no frontmatter.");
      // 1 warning: invalid type
      writeNote(dir, "bad-type.md",
        `---\ndate: 2025-01-01\ntype: fake-type\ntags: ["test"]\n---\n# Bad\n\nContent.\n`);
      // 1 clean note (will be orphan = info)
      writeNote(dir, "clean.md",
        `---\ndate: 2025-01-01\ntype: claim\ntags: ["test"]\n---\n# Clean\n\nContent.\n`);

      const result = validate(dir);
      assert.equal(result.summary.errors, 1, "should have 1 error (missing frontmatter)");
      assert.ok(result.summary.warnings >= 1, "should have at least 1 warning (invalid type)");
      assert.ok(result.summary.info >= 0, "info count should be non-negative");
      assert.equal(result.issueCount, result.summary.errors + result.summary.warnings + result.summary.info,
        "total issue count should equal sum of severities");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("report includes all issue types", () => {
    const dir = createBrainDir();
    try {
      writeNote(dir, "no-fm.md", "Plain text, no frontmatter.");
      writeNote(dir, "bad-type.md",
        `---\ndate: 2025-01-01\ntype: fake-type\ntags: ["test"]\n---\n# Bad\n\nLinks to [[nonexistent]] note.\n`);
      const result = validate(dir);
      const types = new Set(result.issues.map(i => i.type));
      assert.ok(types.has("missing-frontmatter"), "should include missing-frontmatter");
      assert.ok(types.has("invalid-type"), "should include invalid-type");
      assert.ok(types.has("broken-link"), "should include broken-link");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
