#!/usr/bin/env node
// Tests for template/.brain/hooks/brain-router.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "child_process";
import { writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const ROUTER_PATH = join(
  import.meta.dirname, "..", "template", ".brain", "hooks", "brain-router.mjs"
);

function runRouter(input) {
  const tmpFile = join(tmpdir(), `router-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(tmpFile, JSON.stringify(input), "utf-8");
  try {
    // Use cat instead of echo to avoid shell interpretation of \n in JSON
    // Redirect stderr to stdout so we can capture advisories (process exits 0)
    const result = execSync(
      `cat ${tmpFile} | node ${ROUTER_PATH} 2>&1`,
      { encoding: "utf-8" }
    );
    // Check if output contains advisory markers to distinguish stderr content
    const hasAdvisory = result.includes("[brain-router]");
    return {
      stdout: hasAdvisory ? "" : result,
      stderr: hasAdvisory ? result : "",
      exitCode: 0
    };
  } catch (e) {
    return { stdout: e.stdout || "", stderr: e.stderr || "", exitCode: e.status };
  } finally {
    try { rmSync(tmpFile); } catch {}
  }
}

// ── 1. Path Filtering ───────────────────────────────────────────────

describe("Path filtering", () => {
  it("non-brain path exits silently", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: { path: "/project/src/app.md", content: "---\ntype: claim\n---\nHello" }
    });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  it("non-markdown file exits silently", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: { path: "/project/.brain/data.json", content: "{}" }
    });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  it("non-Write tool exits silently", () => {
    const result = runRouter({
      tool_name: "Read",
      tool_input: { path: "/project/.brain/note.md", content: "---\ntype: claim\n---\nBody" }
    });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  it("brain markdown Write triggers validation", () => {
    // Missing frontmatter should produce an advisory
    const result = runRouter({
      tool_name: "Write",
      tool_input: { path: "/project/.brain/note.md", content: "No frontmatter here" }
    });
    assert.ok(result.stderr.includes("[brain-router]"), "Should produce advisory");
    assert.equal(result.exitCode, 0);
  });

  it("Edit tool is skipped (only Write)", () => {
    const result = runRouter({
      tool_name: "Edit",
      tool_input: { path: "/project/.brain/note.md", content: "No frontmatter" }
    });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
});

// ── 2. Frontmatter Validation ───────────────────────────────────────

describe("Frontmatter validation", () => {
  it("missing frontmatter produces advisory", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: { path: "/project/.brain/note.md", content: "Just plain text" }
    });
    assert.ok(result.stderr.includes("no YAML frontmatter"));
    assert.equal(result.exitCode, 0);
  });

  it("missing type field produces advisory", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: { path: "/project/.brain/note.md", content: "---\nmaturity: working\n---\nBody" }
    });
    assert.ok(result.stderr.includes("missing a 'type:' field"));
    assert.equal(result.exitCode, 0);
  });

  it("valid frontmatter with type passes silently", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: { path: "/project/.brain/unknown-path/note.md", content: "---\ntype: claim\n---\nBody" }
    });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  it("advisory mentions template usage", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: { path: "/project/.brain/note.md", content: "No frontmatter" }
    });
    assert.ok(result.stderr.includes("template"));
    assert.equal(result.exitCode, 0);
  });

  it("exit code is always 0 (non-blocking)", () => {
    // Even with missing frontmatter
    const r1 = runRouter({
      tool_name: "Write",
      tool_input: { path: "/project/.brain/note.md", content: "No frontmatter" }
    });
    assert.equal(r1.exitCode, 0);

    // With missing type
    const r2 = runRouter({
      tool_name: "Write",
      tool_input: { path: "/project/.brain/note.md", content: "---\nmaturity: working\n---\nBody" }
    });
    assert.equal(r2.exitCode, 0);

    // With valid content
    const r3 = runRouter({
      tool_name: "Write",
      tool_input: { path: "/project/.brain/note.md", content: "---\ntype: claim\n---\nBody" }
    });
    assert.equal(r3.exitCode, 0);
  });
});

// ── 3. Path-Type Matching ───────────────────────────────────────────

describe("Path-type matching", () => {
  it("knowledge/graph/ expects claim or research", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: {
        path: "/project/.brain/knowledge/graph/finding.md",
        content: "---\ntype: claim\n---\nBody"
      }
    });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  it("sessions/ expects session", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: {
        path: "/project/.brain/sessions/2024-01-01.md",
        content: "---\ntype: session\n---\nBody"
      }
    });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  it("atlas/ expects map, moc, or atlas", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: {
        path: "/project/.brain/atlas/projects.md",
        content: "---\ntype: moc\n---\nBody"
      }
    });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  it("goal/ expects goal or project", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: {
        path: "/project/.brain/goal/mission.md",
        content: "---\ntype: goal\n---\nBody"
      }
    });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  it("inbox/ expects inbox or fleeting", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: {
        path: "/project/.brain/inbox/quick-note.md",
        content: "---\ntype: fleeting\n---\nBody"
      }
    });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  it("voice-notes/ expects voice-note or fleeting", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: {
        path: "/project/.brain/voice-notes/recording.md",
        content: "---\ntype: voice-note\n---\nBody"
      }
    });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  it("mismatched type produces advisory", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: {
        path: "/project/.brain/sessions/2024-01-01.md",
        content: "---\ntype: claim\n---\nBody"
      }
    });
    assert.ok(result.stderr.includes("[brain-router]"));
    assert.ok(result.stderr.includes("claim"));
    assert.ok(result.stderr.includes("session"));
    assert.equal(result.exitCode, 0);
  });

  it("matched type passes silently", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: {
        path: "/project/.brain/goal/north-star.md",
        content: "---\ntype: project\n---\nBody"
      }
    });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  it("unknown path has no type requirement", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: {
        path: "/project/.brain/random-dir/note.md",
        content: "---\ntype: anything\n---\nBody"
      }
    });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  it("advisory message includes both declared and expected types", () => {
    const result = runRouter({
      tool_name: "Write",
      tool_input: {
        path: "/project/.brain/atlas/projects.md",
        content: "---\ntype: session\n---\nBody"
      }
    });
    assert.ok(result.stderr.includes("session"), "Should mention declared type");
    assert.ok(result.stderr.includes("map"), "Should mention expected types");
    assert.ok(result.stderr.includes("moc"), "Should mention expected types");
    assert.ok(result.stderr.includes("atlas"), "Should mention expected types");
  });
});
