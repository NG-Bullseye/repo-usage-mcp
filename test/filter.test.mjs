import { test } from "node:test";
import assert from "node:assert/strict";
import { isClaudeModel } from "../dist/usage.js";

// Load-bearing regression guard (Leo's hard constraint, T-178):
// the model filter must keep Claude-Code-mode models and drop everything else.
// If this ever regresses, DeepSeek usage would silently pollute the numbers.

test("keeps real Claude Code models", () => {
  for (const m of [
    "claude-opus-4-8",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
  ]) {
    assert.equal(isClaudeModel(m), true, `expected ${m} to pass`);
  }
});

test("drops DeepSeek and synthetic and junk", () => {
  for (const m of [
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "<synthetic>",
    "",
    undefined,
    null,
    42,
    "not-claude",
  ]) {
    assert.equal(isClaudeModel(m), false, `expected ${String(m)} to be excluded`);
  }
});
