# repo-usage-mcp

Read-only MCP server that traces **Claude Code** token usage **per repository**.

Reads `~/.claude/projects/*.jsonl` (the session logs Claude Code already writes),
keeps only Claude-Code-mode messages (DeepSeek and `<synthetic>` are
**excluded** — Leo's hard constraint, enforced by a tested `isClaudeModel()`
function), and reports the **four token dimensions separately**:

| Dimension | Field |
|---|---|
| **input** | `usage.input_tokens` |
| **output** | `usage.output_tokens` |
| **cache creation** | `usage.cache_creation_input_tokens` |
| **cache read** | `usage.cache_read_input_tokens` |

---

## Tools

### `get_repo_usage`

Per-repo aggregated usage across all projects, sorted by total tokens
descending. Optional `since` / `until` (YYYY-MM-DD) date filter.

```json
{"name": "get_repo_usage", "arguments": {"since": "2026-06-01"}}
```

### `get_repo_breakdown`

Breakdown for a single repo — by model and by git branch.

```json
{"name": "get_repo_breakdown", "arguments": {"repo": "cortex"}}
```

---

## Setup

```bash
./setup.sh
claude mcp add repo-usage -s user -- node "$PWD/dist/index.js"
```

## Testing

```bash
npm test
```

## License

MIT
