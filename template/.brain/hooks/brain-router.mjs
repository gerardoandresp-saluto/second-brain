#!/usr/bin/env node
// brain-router.mjs — Advisory validator for .brain/ file routing
// Triggered on: PreToolUse (Write|Edit)
// Reads JSON from stdin: { tool_name, tool_input }

import { createInterface } from "readline";

const PATH_TYPE_RULES = [
  { pattern: /\/.brain\/knowledge\/graph\//,  expected: ["claim", "research"] },
  { pattern: /\/.brain\/knowledge\//,          expected: ["concept", "claim", "research", "reference"] },
  { pattern: /\/.brain\/sessions\//,           expected: ["session"] },
  { pattern: /\/.brain\/atlas\//,              expected: ["map", "moc", "atlas"] },
  { pattern: /\/.brain\/goal\//,               expected: ["goal", "project"] },
  { pattern: /\/.brain\/inbox\//,              expected: ["inbox", "fleeting"] },
  { pattern: /\/.brain\/voice-notes\//,        expected: ["voice-note", "fleeting"] },
];

function parseFrontmatter(content) {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = content.slice(4, end);
  const fields = {};
  for (const line of block.split("\n")) {
    const match = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (match) fields[match[1].trim()] = match[2].trim();
  }
  return fields;
}

async function readStdin() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = [];
  for await (const line of rl) lines.push(line);
  return lines.join("\n");
}

(async () => {
  let raw;
  try {
    raw = await readStdin();
  } catch {
    process.exit(0);
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const toolName = input.tool_name ?? "";
  const toolInput = input.tool_input ?? {};
  const filePath = toolInput.path ?? toolInput.file_path ?? "";
  const content = toolInput.content ?? "";

  if (!filePath.includes("/.brain/")) process.exit(0);
  if (!filePath.endsWith(".md")) process.exit(0);
  if (toolName !== "Write") process.exit(0);

  const frontmatter = parseFrontmatter(content);
  const declaredType = frontmatter?.type ?? null;

  if (!frontmatter) {
    console.error(`[brain-router] Advisory: '${filePath}' has no YAML frontmatter.`);
    console.error(`[brain-router] Use a template from .brain/_assets/templates/ to add required fields.`);
    process.exit(0);
  }

  if (!declaredType) {
    console.error(`[brain-router] Advisory: '${filePath}' frontmatter is missing a 'type:' field.`);
    console.error(`[brain-router] Add 'type: <value>' so the brain-index can categorize this note.`);
    process.exit(0);
  }

  for (const rule of PATH_TYPE_RULES) {
    if (rule.pattern.test(filePath)) {
      if (!rule.expected.includes(declaredType)) {
        console.error(
          `[brain-router] Advisory: '${filePath}' has type '${declaredType}' but this path expects one of: ${rule.expected.join(", ")}.`
        );
      }
      break;
    }
  }

  process.exit(0);
})();
