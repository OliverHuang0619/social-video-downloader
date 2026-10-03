# Library Directories and Publish Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add media-directory filtering and make Douyin cover waiting optional while removing duplicate titles from descriptions.

**Architecture:** Derive media directories in shared browser-safe TypeScript and compose that predicate with existing library filters. Persist a `waitForCovers` flag on each publish job and pass it to the Playwright script, which delegates description and cover-wait decisions to a small testable JavaScript helper.

**Tech Stack:** TypeScript, React 19, SQLite, Node.js, Playwright, Vitest

---

### Task 1: Directory filter

**Files:**
- Modify: `tests/core.test.ts`
- Modify: `src/shared/core.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] Add failing tests for parent-directory derivation and directory filtering.
- [ ] Verify the focused test fails.
- [ ] Add `mediaAssetDirectory` and an optional directory argument to `filterMediaAssets`.
- [ ] Add an “全部目录” select populated from asset parent directories.
- [ ] Verify focused tests pass.

### Task 2: Persist the optional cover-wait flag

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/db.ts`
- Modify: `src/server/migration.ts`
- Modify: `src/server/publisher.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `tests/workbench.test.ts`

- [ ] Add failing assertions that publish jobs default `waitForCovers` to false and preserve an explicit true value.
- [ ] Verify the test fails.
- [ ] Add the shared field, SQLite migration, input normalization, payload propagation, and default-off checkbox.
- [ ] Verify workbench tests pass.

### Task 3: Remove title duplication and conditionally wait for covers

**Files:**
- Create: `skills/english-video-catalog/scripts/douyin_publish_payload.mjs`
- Create: `skills/english-video-catalog/scripts/douyin_publish_payload.d.mts`
- Create: `tests/douyin-publisher.test.ts`
- Modify: `skills/english-video-catalog/scripts/douyin_publisher.mjs`

- [ ] Add failing tests for a topics-only description and strict opt-in cover waiting.
- [ ] Verify the focused test fails.
- [ ] Implement and use the payload helpers.
- [ ] Emit `waiting_covers` and poll covers only when `waitForCovers` is true.
- [ ] Verify focused tests pass.

### Task 4: Full verification

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Check IDE diagnostics and inspect the final diff.
