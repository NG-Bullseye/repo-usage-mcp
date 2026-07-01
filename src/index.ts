#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { aggregate, toRow, totalOf, UsageRow } from "./usage.js";

const server = new McpServer({ name: "repo-usage-mcp", version: "0.1.0" });

const fmt = (n: number) => n.toLocaleString("en-US");

function table(header: string[], rows: (string | number)[][]): string {
  const all = [header, ...rows.map((r) => r.map(String))];
  const widths = header.map((_, c) => Math.max(...all.map((r) => r[c].length)));
  const line = (r: string[]) => r.map((cell, c) => cell.padStart(c === 0 ? 0 : widths[c]).padEnd(c === 0 ? widths[c] : cell.length)).join("  ");
  const out = [line(all[0]), widths.map((w) => "-".repeat(w)).join("  ")];
  for (const r of all.slice(1)) out.push(line(r));
  return out.join("\n");
}

server.registerTool(
  "get_repo_usage",
  {
    title: "Claude Code token usage by repository",
    description:
      "Per-repository Claude Code token usage, read from ~/.claude/projects/*.jsonl and grouped " +
      "by the message's cwd. Claude-Code-mode ONLY — DeepSeek and <synthetic> rows are excluded. " +
      "Returns the four token dimensions SEPARATELY (input, output, cache_creation, cache_read) " +
      "plus a total, sorted by total descending. Optional 'since'/'until' (YYYY-MM-DD) filter on " +
      "the line timestamp.",
    inputSchema: {
      since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive start day YYYY-MM-DD"),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive end day YYYY-MM-DD"),
    },
  },
  async ({ since, until }: { since?: string; until?: string }) => {
    const { repos, totalLines, keptMessages, noCwdLines } = await aggregate({ since, until });
    const rows = [...repos.entries()]
      .map(([repo, agg]) => ({ repo, row: toRow(agg.messages, agg.dims) }))
      .sort((a, b) => b.row.total - a.row.total);

    const text = table(
      ["repo", "msgs", "input", "output", "cache_create", "cache_read", "total"],
      rows.map(({ repo, row }) => [repo, fmt(row.messages), fmt(row.input), fmt(row.output), fmt(row.cache_creation), fmt(row.cache_read), fmt(row.total)]),
    );

    const structured = {
      generatedAt: new Date().toISOString(),
      filter: { since: since ?? null, until: until ?? null, model: "claude* only (DeepSeek/synthetic excluded)" },
      scanned: { totalLines, keptClaudeMessages: keptMessages, linesWithoutCwd: noCwdLines },
      repos: rows.map(({ repo, row }) => ({ repo, ...row })),
    };

    return {
      content: [
        { type: "text" as const, text: text || "No Claude-Code usage found." },
        { type: "text" as const, text: JSON.stringify(structured, null, 2) },
      ],
    };
  },
);

server.registerTool(
  "get_repo_breakdown",
  {
    title: "Per-repo usage broken down by model + branch",
    description:
      "For one repo (by label, as shown in get_repo_usage), return its Claude Code usage further " +
      "broken down by model (opus vs sonnet vs haiku) and by gitBranch — the same four token " +
      "dimensions each. Claude-Code-mode ONLY. Optional 'since'/'until' (YYYY-MM-DD).",
    inputSchema: {
      repo: z.string().describe("Repo label, e.g. 'cortex' or 'watchdog'"),
      since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    },
  },
  async ({ repo, since, until }: { repo: string; since?: string; until?: string }) => {
    const { repos } = await aggregate({ since, until });
    const agg = repos.get(repo);
    if (!agg) {
      const known = [...repos.keys()].sort().join(", ");
      return {
        content: [{ type: "text" as const, text: `No usage for repo '${repo}'. Known repos: ${known || "(none)"}` }],
        isError: true,
      };
    }

    const sortRows = (m: Map<string, UsageRow>) =>
      [...m.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, r]) => ({ key: k, ...r, total: totalOf(r) }));
    const models = sortRows(agg.byModel);
    const branches = sortRows(agg.byBranch);

    const modelTable = table(
      ["model", "msgs", "input", "output", "cache_create", "cache_read", "total"],
      models.map((r) => [r.key, fmt(r.messages), fmt(r.input), fmt(r.output), fmt(r.cache_creation), fmt(r.cache_read), fmt(r.total)]),
    );
    const branchTable = table(
      ["branch", "msgs", "input", "output", "cache_create", "cache_read", "total"],
      branches.map((r) => [r.key, fmt(r.messages), fmt(r.input), fmt(r.output), fmt(r.cache_creation), fmt(r.cache_read), fmt(r.total)]),
    );

    return {
      content: [
        { type: "text" as const, text: `Repo '${repo}' — by model:\n${modelTable}\n\nby branch:\n${branchTable}` },
        { type: "text" as const, text: JSON.stringify({ repo, byModel: models, byBranch: branches }, null, 2) },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[repo-usage-mcp] ready on stdio");
}

main().catch((e) => {
  console.error("[repo-usage-mcp] fatal:", e);
  process.exit(1);
});
