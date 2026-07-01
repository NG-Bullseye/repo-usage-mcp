import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

export const PROJECTS_DIR = join(homedir(), ".claude", "projects");

/**
 * The load-bearing model filter (Leo's hard constraint, T-178).
 *
 * Only Claude-Code-mode messages count. Every model id emitted by Claude Code
 * for a real Claude turn starts with "claude" (claude-opus-4-8,
 * claude-sonnet-4-6, claude-haiku-4-5-20251001, ...). DeepSeek turns
 * (deepseek-v4-pro, deepseek-v4-flash) and synthetic placeholder rows
 * (<synthetic>) must NEVER appear in the numbers.
 *
 * Kept as a named, exported function so a regression test can pin it and it
 * can never silently drift back to counting DeepSeek.
 */
export function isClaudeModel(model: unknown): boolean {
  return typeof model === "string" && model.startsWith("claude");
}

/** The four token dimensions, always tracked separately (never collapsed). */
export interface TokenDims {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
}

export interface UsageRow extends TokenDims {
  messages: number;
  total: number;
}

function emptyDims(): TokenDims {
  return { input: 0, output: 0, cache_creation: 0, cache_read: 0 };
}

function addUsage(target: TokenDims & { messages?: number }, usage: any): void {
  target.input += usage.input_tokens || 0;
  target.output += usage.output_tokens || 0;
  target.cache_creation += usage.cache_creation_input_tokens || 0;
  target.cache_read += usage.cache_read_input_tokens || 0;
}

export function totalOf(d: TokenDims): number {
  return d.input + d.output + d.cache_creation + d.cache_read;
}

/**
 * Derive a stable repo label from a cwd. basename is enough for our layout
 * (/home/leona/cortex -> cortex, /home/leona/repos/watchdog -> watchdog,
 * /home/leona/esp_repos/cortex-terminal -> cortex-terminal). "/" or empty
 * falls back to "unknown".
 */
export function repoFromCwd(cwd: unknown): string | null {
  if (typeof cwd !== "string" || cwd.length === 0) return null;
  const b = basename(cwd);
  return b || null;
}

/**
 * Fallback when a line has no cwd: decode the encoded project dir name.
 * "-home-leona-repos-watchdog" -> "watchdog". Claude Code encodes the abs path
 * by replacing "/" with "-", so the last segment is the leaf dir.
 */
export function repoFromEncodedDir(dirName: string): string {
  const parts = dirName.split("-").filter((p) => p.length > 0);
  return parts.length ? parts[parts.length - 1] : "unknown";
}

export interface AggregateOptions {
  since?: string; // YYYY-MM-DD inclusive
  until?: string; // YYYY-MM-DD inclusive
}

interface RepoAgg {
  messages: number;
  dims: TokenDims;
  byModel: Map<string, UsageRow>;
  byBranch: Map<string, UsageRow>;
}

function inRange(ts: unknown, since?: string, until?: string): boolean {
  if (!since && !until) return true;
  if (typeof ts !== "string") return true; // don't drop on missing ts
  const day = ts.slice(0, 10); // YYYY-MM-DD lexical compare works for ISO
  if (since && day < since) return false;
  if (until && day > until) return false;
  return true;
}

function bump(map: Map<string, UsageRow>, key: string, usage: any): void {
  let row = map.get(key);
  if (!row) {
    row = { messages: 0, ...emptyDims(), total: 0 };
    map.set(key, row);
  }
  row.messages += 1;
  addUsage(row, usage);
}

/**
 * Stream every session JSONL, keep only Claude-model assistant messages, and
 * aggregate by repo. Read-only, line-by-line (readline), malformed lines are
 * skipped per-line.
 */
export async function aggregate(opts: AggregateOptions = {}): Promise<{
  repos: Map<string, RepoAgg>;
  totalLines: number;
  keptMessages: number;
  noCwdLines: number;
}> {
  const repos = new Map<string, RepoAgg>();
  let totalLines = 0;
  let keptMessages = 0;
  let noCwdLines = 0;

  let dirs: string[];
  try {
    dirs = await readdir(PROJECTS_DIR);
  } catch {
    return { repos, totalLines, keptMessages, noCwdLines };
  }

  for (const dir of dirs) {
    const dirPath = join(PROJECTS_DIR, dir);
    let files: string[];
    try {
      files = (await readdir(dirPath)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue; // not a directory / unreadable
    }

    for (const file of files) {
      const rl = createInterface({
        input: createReadStream(join(dirPath, file), { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
      for await (const line of rl) {
        if (!line.trim()) continue;
        totalLines += 1;
        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        const msg = obj?.message;
        if (!msg || !isClaudeModel(msg.model)) continue;
        const usage = msg.usage;
        if (!usage) continue;
        if (!inRange(obj.timestamp, opts.since, opts.until)) continue;

        let repo = repoFromCwd(obj.cwd);
        if (repo === null) {
          noCwdLines += 1;
          repo = repoFromEncodedDir(dir) || "unknown";
        }

        let agg = repos.get(repo);
        if (!agg) {
          agg = { messages: 0, dims: emptyDims(), byModel: new Map(), byBranch: new Map() };
          repos.set(repo, agg);
        }
        agg.messages += 1;
        addUsage(agg.dims, usage);
        bump(agg.byModel, msg.model, usage);
        bump(agg.byBranch, typeof obj.gitBranch === "string" && obj.gitBranch ? obj.gitBranch : "(none)", usage);

        keptMessages += 1;
      }
    }
  }

  return { repos, totalLines, keptMessages, noCwdLines };
}

export function toRow(messages: number, dims: TokenDims): UsageRow {
  return { messages, ...dims, total: totalOf(dims) };
}
