#!/usr/bin/env node
// brain-search.mjs — Search brain-index.json with weighted scoring
// Usage: node brain-search.mjs <brain-dir> <query...>
// Returns: JSON array of matched entries sorted by relevance score

import { readFileSync } from "fs";
import { join } from "path";

// Maturity priority multipliers
const MATURITY_WEIGHT = {
  goal: 5.0,
  reference: 2.5,
  procedural: 1.5,
  working: 1.0,
};

// Field weights for scoring
const FIELD_WEIGHT = {
  title: 10,    // filename match
  keywords: 8,  // explicit keywords (k field)
  tags: 6,      // tags (t field)
  bodyKeywords: 2,  // extracted body keywords (bk field)
  summary: 1,   // summary text (s field)
};

// TF-IDF inspired scoring
function score(entry, queryTerms) {
  let total = 0;
  const path = entry.p.toLowerCase();
  const filename = path.split("/").pop().replace(".md", "").replace(/-/g, " ");

  for (const term of queryTerms) {
    const t = term.toLowerCase();

    // Title/filename match
    if (filename.includes(t)) total += FIELD_WEIGHT.title;

    // Explicit keywords match
    if (entry.k?.some(k => k.toLowerCase().includes(t))) total += FIELD_WEIGHT.keywords;

    // Tags match
    if (entry.t?.some(tag => tag.toLowerCase().includes(t))) total += FIELD_WEIGHT.tags;

    // Body keywords match
    if (entry.bk?.some(bk => bk.toLowerCase().includes(t))) total += FIELD_WEIGHT.bodyKeywords;

    // Summary match
    if (entry.s?.toLowerCase().includes(t)) total += FIELD_WEIGHT.summary;
  }

  // Apply maturity multiplier
  total *= MATURITY_WEIGHT[entry.m] || 1.0;

  // MOC boost (central nodes get 1.5x)
  if (entry.moc) total *= 1.5;

  // Link count boost (logarithmic)
  if (entry.lc > 0) total *= (1 + Math.log2(entry.lc) * 0.2);

  return total;
}

// Fuzzy matching — Levenshtein distance for typo tolerance
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function fuzzyMatch(term, candidates, maxDistance = 2) {
  return candidates.filter(c => levenshtein(term.toLowerCase(), c.toLowerCase()) <= maxDistance);
}

export function search(indexPath, queryTerms, options = {}) {
  const { topN = 10, fuzzy = true, minScore = 0.1 } = options;

  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  const entries = index.entries || [];

  // Score each entry
  const scored = entries.map(entry => ({
    ...entry,
    score: score(entry, queryTerms),
  }));

  // If fuzzy matching is enabled and we have low results, try fuzzy
  let results = scored.filter(e => e.score >= minScore);

  if (fuzzy && results.length < 3) {
    const allKeywords = [...new Set(entries.flatMap(e => [...(e.k || []), ...(e.bk || [])]))];
    const fuzzyTerms = queryTerms.flatMap(t => fuzzyMatch(t, allKeywords));
    if (fuzzyTerms.length > 0) {
      const fuzzyScored = entries.map(entry => ({
        ...entry,
        score: score(entry, [...queryTerms, ...fuzzyTerms]) * 0.8, // Discount fuzzy matches
      }));
      results = fuzzyScored.filter(e => e.score >= minScore);
    }
  }

  // Sort by score descending, then by link count descending
  results.sort((a, b) => b.score - a.score || b.lc - a.lc);

  return results.slice(0, topN);
}

// CLI mode
if (process.argv[1]?.endsWith("brain-search.mjs")) {
  const brainDir = process.argv[2];
  const queryTerms = process.argv.slice(3);

  if (!brainDir || queryTerms.length === 0) {
    console.error("Usage: node brain-search.mjs <brain-dir> <query terms...>");
    process.exit(1);
  }

  const indexPath = join(brainDir, "brain-index.json");
  const results = search(indexPath, queryTerms);

  console.log(JSON.stringify(results, null, 2));
}
