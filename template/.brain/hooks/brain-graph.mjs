#!/usr/bin/env node
// brain-graph.mjs — Graph analysis for the brain wiki-link network
// Usage: node brain-graph.mjs <brain-dir> [--orphans | --clusters | --central | --suggest-links]

import { readFileSync } from "fs";
import { join } from "path";

export function loadGraph(indexPath) {
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  const entries = index.entries || [];

  // Build adjacency lists
  const nodes = new Map(); // slug -> entry
  const outEdges = new Map(); // slug -> [slug...]
  const inEdges = new Map();  // slug -> [slug...]

  for (const entry of entries) {
    const slug = entry.p.replace(/\.md$/, "").split("/").pop().toLowerCase();
    nodes.set(slug, entry);
    outEdges.set(slug, []);
    inEdges.set(slug, []);
  }

  for (const entry of entries) {
    const slug = entry.p.replace(/\.md$/, "").split("/").pop().toLowerCase();
    for (const link of (entry.l || [])) {
      const targetSlug = link.toLowerCase();
      if (nodes.has(targetSlug)) {
        outEdges.get(slug).push(targetSlug);
        if (!inEdges.has(targetSlug)) inEdges.set(targetSlug, []);
        inEdges.get(targetSlug).push(slug);
      }
    }
  }

  return { nodes, outEdges, inEdges, entries };
}

// Find orphan nodes (no connections)
export function findOrphans(graph) {
  const orphans = [];
  for (const [slug, entry] of graph.nodes) {
    const out = graph.outEdges.get(slug)?.length || 0;
    const inb = graph.inEdges.get(slug)?.length || 0;
    if (out === 0 && inb === 0) {
      orphans.push({ slug, path: entry.p, tags: entry.t });
    }
  }
  return orphans;
}

// Find connected components (clusters)
export function findClusters(graph) {
  const visited = new Set();
  const clusters = [];

  for (const slug of graph.nodes.keys()) {
    if (visited.has(slug)) continue;
    const cluster = [];
    const queue = [slug];
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      cluster.push(current);
      for (const neighbor of [...(graph.outEdges.get(current) || []), ...(graph.inEdges.get(current) || [])]) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    clusters.push(cluster);
  }

  return clusters.sort((a, b) => b.length - a.length);
}

// Calculate degree centrality
export function degreeCentrality(graph) {
  const centrality = [];
  for (const [slug, entry] of graph.nodes) {
    const out = graph.outEdges.get(slug)?.length || 0;
    const inb = graph.inEdges.get(slug)?.length || 0;
    centrality.push({ slug, path: entry.p, degree: out + inb, outDegree: out, inDegree: inb });
  }
  return centrality.sort((a, b) => b.degree - a.degree);
}

// Suggest links based on keyword overlap
export function suggestLinks(graph, maxSuggestions = 10) {
  const suggestions = [];
  const slugs = [...graph.nodes.keys()];

  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const a = graph.nodes.get(slugs[i]);
      const b = graph.nodes.get(slugs[j]);

      // Skip if already linked
      if (graph.outEdges.get(slugs[i])?.includes(slugs[j])) continue;
      if (graph.outEdges.get(slugs[j])?.includes(slugs[i])) continue;

      // Calculate keyword overlap
      const kwA = new Set([...(a.k || []), ...(a.bk || []), ...(a.t || [])].map(s => s.toLowerCase()));
      const kwB = new Set([...(b.k || []), ...(b.bk || []), ...(b.t || [])].map(s => s.toLowerCase()));
      const intersection = [...kwA].filter(w => kwB.has(w)).length;
      const union = new Set([...kwA, ...kwB]).size;
      const similarity = union > 0 ? intersection / union : 0;

      if (similarity > 0.3 && intersection >= 2) {
        suggestions.push({
          from: a.p,
          to: b.p,
          similarity: Math.round(similarity * 100),
          sharedKeywords: [...kwA].filter(w => kwB.has(w)),
        });
      }
    }
  }

  return suggestions.sort((a, b) => b.similarity - a.similarity).slice(0, maxSuggestions);
}

// Multi-hop retrieval: BFS from a starting note
export function expandContext(graph, startSlug, maxHops = 2) {
  const visited = new Map(); // slug -> distance
  const queue = [[startSlug, 0]];

  while (queue.length > 0) {
    const [current, dist] = queue.shift();
    if (visited.has(current) || dist > maxHops) continue;
    visited.set(current, dist);

    const neighbors = [
      ...(graph.outEdges.get(current) || []),
      ...(graph.inEdges.get(current) || []),
    ];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) queue.push([neighbor, dist + 1]);
    }
  }

  return [...visited.entries()]
    .map(([slug, distance]) => ({ slug, path: graph.nodes.get(slug)?.p, distance }))
    .sort((a, b) => a.distance - b.distance);
}

// CLI mode
if (process.argv[1]?.endsWith("brain-graph.mjs")) {
  const brainDir = process.argv[2];
  const mode = process.argv[3] || "--summary";

  if (!brainDir) {
    console.error("Usage: node brain-graph.mjs <brain-dir> [--orphans|--clusters|--central|--suggest-links]");
    process.exit(1);
  }

  const indexPath = join(brainDir, "brain-index.json");
  const graph = loadGraph(indexPath);

  switch (mode) {
    case "--orphans":
      console.log(JSON.stringify(findOrphans(graph), null, 2));
      break;
    case "--clusters":
      console.log(JSON.stringify(findClusters(graph), null, 2));
      break;
    case "--central":
      console.log(JSON.stringify(degreeCentrality(graph).slice(0, 20), null, 2));
      break;
    case "--suggest-links":
      console.log(JSON.stringify(suggestLinks(graph), null, 2));
      break;
    default: {
      const orphans = findOrphans(graph);
      const clusters = findClusters(graph);
      const central = degreeCentrality(graph);
      console.log(`\nBrain Graph Analysis:`);
      console.log(`  Nodes: ${graph.nodes.size}`);
      console.log(`  Clusters: ${clusters.length}`);
      console.log(`  Orphans: ${orphans.length}`);
      console.log(`  Most connected: ${central[0]?.slug || "none"} (${central[0]?.degree || 0} links)`);
    }
  }
}
