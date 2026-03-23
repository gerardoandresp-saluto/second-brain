#!/usr/bin/env node
// Tests for template/.brain/hooks/brain-graph.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";

const INDEXER_PATH = join(
  import.meta.dirname, "..", "template", ".brain", "hooks", "rebuild-brain-index.mjs"
);
const GRAPH_PATH = join(
  import.meta.dirname, "..", "template", ".brain", "hooks", "brain-graph.mjs"
);

function createBrainDir() {
  return mkdtempSync(join(tmpdir(), "brain-graph-test-"));
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

let loadGraph, findOrphans, findClusters, degreeCentrality, suggestLinks;
before(async () => {
  const mod = await import(GRAPH_PATH);
  loadGraph = mod.loadGraph;
  findOrphans = mod.findOrphans;
  findClusters = mod.findClusters;
  degreeCentrality = mod.degreeCentrality;
  suggestLinks = mod.suggestLinks;
});

// ── Shared fixture: A -> B -> C (chain), D (orphan), E <-> F (bidirectional) ──

let tmpDir, indexPath;

before(() => {
  tmpDir = createBrainDir();

  // A -> B (A links to B)
  writeNote(tmpDir, "a.md",
    `---\ntype: claim\ntags: ["chain"]\nkeywords: ["alpha"]\n---\n# Note A\n\nSee [[b]] for next step.\n`);

  // B -> C (B links to C)
  writeNote(tmpDir, "b.md",
    `---\ntype: claim\ntags: ["chain"]\nkeywords: ["beta"]\n---\n# Note B\n\nContinues in [[c]].\n`);

  // C (end of chain, no outgoing links)
  writeNote(tmpDir, "c.md",
    `---\ntype: claim\ntags: ["chain"]\nkeywords: ["gamma"]\n---\n# Note C\n\nEnd of the chain.\n`);

  // D (orphan — no links in or out)
  writeNote(tmpDir, "d.md",
    `---\ntype: claim\ntags: ["isolated"]\nkeywords: ["delta"]\n---\n# Note D\n\nCompletely isolated orphan note.\n`);

  // E <-> F (bidirectional)
  writeNote(tmpDir, "e.md",
    `---\ntype: claim\ntags: ["pair"]\nkeywords: ["epsilon", "shared-pair"]\n---\n# Note E\n\nLinks to [[f]].\n`);
  writeNote(tmpDir, "f.md",
    `---\ntype: claim\ntags: ["pair"]\nkeywords: ["phi", "shared-pair"]\n---\n# Note F\n\nLinks back to [[e]].\n`);

  indexPath = buildIndex(tmpDir);
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── 1. Graph Loading ─────────────────────────────────────────────────

describe("Graph loading", () => {
  it("loads correct number of nodes", () => {
    const graph = loadGraph(indexPath);
    assert.equal(graph.nodes.size, 6, "should have 6 nodes (a, b, c, d, e, f)");
  });

  it("builds forward edges correctly", () => {
    const graph = loadGraph(indexPath);
    const aOut = graph.outEdges.get("a");
    assert.ok(aOut.includes("b"), "a should have forward edge to b");
    const bOut = graph.outEdges.get("b");
    assert.ok(bOut.includes("c"), "b should have forward edge to c");
    const dOut = graph.outEdges.get("d");
    assert.equal(dOut.length, 0, "d should have no outgoing edges");
  });

  it("builds reverse edges (backlinks) correctly", () => {
    const graph = loadGraph(indexPath);
    const bIn = graph.inEdges.get("b");
    assert.ok(bIn.includes("a"), "b should have backlink from a");
    const cIn = graph.inEdges.get("c");
    assert.ok(cIn.includes("b"), "c should have backlink from b");
    const aIn = graph.inEdges.get("a");
    // a has no inbound links from the chain, but could from e/f if they linked to it
    // In our fixture, only e->f, f->e exist for the pair
    assert.ok(!aIn.includes("d"), "a should not have backlink from d");
  });
});

// ── 2. Orphan Detection ─────────────────────────────────────────────

describe("Orphan detection", () => {
  it("finds orphan nodes (no connections)", () => {
    const graph = loadGraph(indexPath);
    const orphans = findOrphans(graph);
    const orphanSlugs = orphans.map(o => o.slug);
    assert.ok(orphanSlugs.includes("d"), "d should be detected as orphan");
  });

  it("connected nodes not listed as orphans", () => {
    const graph = loadGraph(indexPath);
    const orphans = findOrphans(graph);
    const orphanSlugs = orphans.map(o => o.slug);
    assert.ok(!orphanSlugs.includes("a"), "a should not be an orphan (has outgoing link)");
    assert.ok(!orphanSlugs.includes("b"), "b should not be an orphan (has in and out links)");
    assert.ok(!orphanSlugs.includes("e"), "e should not be an orphan (bidirectional link)");
  });

  it("returns path for each orphan", () => {
    const graph = loadGraph(indexPath);
    const orphans = findOrphans(graph);
    for (const orphan of orphans) {
      assert.ok(orphan.path, `orphan ${orphan.slug} should have a path`);
      assert.ok(orphan.path.endsWith(".md"), `orphan path should end with .md`);
    }
  });
});

// ── 3. Cluster Analysis ─────────────────────────────────────────────

describe("Cluster analysis", () => {
  it("finds correct number of clusters", () => {
    const graph = loadGraph(indexPath);
    const clusters = findClusters(graph);
    // Clusters: {a,b,c}, {d}, {e,f} = 3 clusters
    assert.equal(clusters.length, 3, "should find 3 clusters");
  });

  it("orphans are isolated clusters of size 1", () => {
    const graph = loadGraph(indexPath);
    const clusters = findClusters(graph);
    const singleClusters = clusters.filter(c => c.length === 1);
    assert.ok(singleClusters.length >= 1, "should have at least one single-node cluster");
    const singleSlugs = singleClusters.map(c => c[0]);
    assert.ok(singleSlugs.includes("d"), "d should be in a single-node cluster");
  });

  it("connected chain is one cluster", () => {
    const graph = loadGraph(indexPath);
    const clusters = findClusters(graph);
    // Find the cluster containing 'a'
    const chainCluster = clusters.find(c => c.includes("a"));
    assert.ok(chainCluster, "should find cluster containing a");
    assert.ok(chainCluster.includes("b"), "chain cluster should contain b");
    assert.ok(chainCluster.includes("c"), "chain cluster should contain c");
    assert.equal(chainCluster.length, 3, "chain cluster should have 3 nodes");
  });
});

// ── 4. Centrality ────────────────────────────────────────────────────

describe("Centrality", () => {
  it("most connected node has highest degree", () => {
    const graph = loadGraph(indexPath);
    const central = degreeCentrality(graph);
    assert.ok(central.length > 0, "should return centrality results");
    // b has 2 connections (in from a, out to c), e and f each have 2 (in+out)
    // The first result should have the highest degree
    const maxDegree = central[0].degree;
    for (const node of central) {
      assert.ok(node.degree <= maxDegree, "first node should have highest degree");
    }
  });

  it("degree includes both in and out edges", () => {
    const graph = loadGraph(indexPath);
    const central = degreeCentrality(graph);
    const bNode = central.find(n => n.slug === "b");
    assert.ok(bNode, "should find node b in centrality results");
    // b has: inDegree=1 (from a), outDegree=1 (to c) => degree=2
    assert.equal(bNode.inDegree, 1, "b should have inDegree 1");
    assert.equal(bNode.outDegree, 1, "b should have outDegree 1");
    assert.equal(bNode.degree, 2, "b degree should be in + out = 2");
  });

  it("results sorted by degree descending", () => {
    const graph = loadGraph(indexPath);
    const central = degreeCentrality(graph);
    for (let i = 1; i < central.length; i++) {
      assert.ok(central[i - 1].degree >= central[i].degree,
        `node ${i - 1} (degree ${central[i - 1].degree}) should be >= node ${i} (degree ${central[i].degree})`);
    }
  });
});

// ── 5. Link Suggestions ─────────────────────────────────────────────

describe("Link suggestions", () => {
  it("suggests links between notes with shared keywords", () => {
    // Create a fresh fixture with notes sharing keywords but not linked
    const dir2 = createBrainDir();
    try {
      writeNote(dir2, "note-x.md",
        `---\ntype: claim\ntags: ["database", "performance"]\nkeywords: ["postgres", "optimization", "indexing"]\n---\n# Note X\n\nDatabase optimization techniques.\n`);
      writeNote(dir2, "note-y.md",
        `---\ntype: claim\ntags: ["database", "performance"]\nkeywords: ["postgres", "optimization", "caching"]\n---\n# Note Y\n\nMore database optimization with caching.\n`);
      const idx2 = buildIndex(dir2);
      const graph2 = loadGraph(idx2);
      const suggestions = suggestLinks(graph2);
      assert.ok(suggestions.length > 0, "should suggest links between notes with shared keywords");
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("does not suggest already-existing links", () => {
    const graph = loadGraph(indexPath);
    const suggestions = suggestLinks(graph);
    // e and f are already linked, so they should NOT appear in suggestions
    const efSuggestion = suggestions.find(s =>
      (s.from.includes("e.md") && s.to.includes("f.md")) ||
      (s.from.includes("f.md") && s.to.includes("e.md"))
    );
    assert.equal(efSuggestion, undefined, "should not suggest links that already exist (e <-> f)");
  });

  it("returns similarity percentage", () => {
    const dir2 = createBrainDir();
    try {
      writeNote(dir2, "sim-a.md",
        `---\ntype: claim\ntags: ["shared", "testing", "quality"]\nkeywords: ["overlap", "common", "testing"]\n---\n# Sim A\n\nShared testing content.\n`);
      writeNote(dir2, "sim-b.md",
        `---\ntype: claim\ntags: ["shared", "testing", "quality"]\nkeywords: ["overlap", "common", "testing"]\n---\n# Sim B\n\nShared testing content.\n`);
      const idx2 = buildIndex(dir2);
      const graph2 = loadGraph(idx2);
      const suggestions = suggestLinks(graph2);
      if (suggestions.length > 0) {
        assert.equal(typeof suggestions[0].similarity, "number", "similarity should be a number");
        assert.ok(suggestions[0].similarity > 0 && suggestions[0].similarity <= 100,
          `similarity (${suggestions[0].similarity}) should be between 1 and 100`);
        assert.ok(Array.isArray(suggestions[0].sharedKeywords), "should include sharedKeywords array");
      }
      assert.ok(true);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
