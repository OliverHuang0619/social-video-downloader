# Library Awaiting Analysis Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a media-library status option that displays every asset whose analysis result is absent.

**Architecture:** Put the filtering predicate in `src/shared/core.ts` so it can be tested without rendering React. The media-library component will use that helper and add `awaiting-analysis` to its local filter state and select options.

**Tech Stack:** TypeScript, React 19, Vitest

---

### Task 1: Test and implement the shared library filter

**Files:**
- Modify: `tests/core.test.ts`
- Modify: `src/shared/core.ts`

- [ ] **Step 1: Write the failing tests**

Import `filterMediaAssets` and `MediaAsset`, create analyzed and unanalyzed fixtures in both processing states, and assert:

```ts
expect(filterMediaAssets(assets, 'awaiting-analysis', 'all', '')).toEqual([unprocessedAwaiting, processedAwaiting])
expect(filterMediaAssets(assets, 'processed', 'all', '')).toEqual([processedAwaiting, processedAnalyzed])
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run in WSL:

```bash
npm test -- tests/core.test.ts
```

Expected: FAIL because `filterMediaAssets` is not exported.

- [ ] **Step 3: Add the minimal filtering implementation**

Add the following type and function to `src/shared/core.ts`:

```ts
export type LibraryStateFilter = ProcessingState | 'awaiting-analysis' | 'all'

export function filterMediaAssets(
  assets: MediaAsset[],
  state: LibraryStateFilter,
  category: string,
  query: string
): MediaAsset[] {
  const needle = query.toLocaleLowerCase()
  return assets.filter(asset =>
    (state === 'all' || (state === 'awaiting-analysis' ? !asset.analysis : asset.processingState === state)) &&
    (category === 'all' || asset.analysis?.category === category) &&
    (!needle || [asset.filename, asset.analysis?.title, asset.analysis?.englishTitle, asset.analysis?.summary, ...(asset.analysis?.keyTopics || [])]
      .some(value => value?.toLocaleLowerCase().includes(needle)))
  )
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run in WSL:

```bash
npm test -- tests/core.test.ts
```

Expected: PASS.

### Task 2: Connect the media-library select to the shared filter

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Import `filterMediaAssets` and `LibraryStateFilter`**

```ts
import { filterMediaAssets, type LibraryStateFilter } from '../../shared/core'
```

- [ ] **Step 2: Use the shared filter and extend the select**

Type the state as `LibraryStateFilter`, replace the inline filtering callback with `filterMediaAssets(assets, state, category, query)`, and add:

```tsx
<option value="awaiting-analysis">等待分析</option>
```

The default remains `unprocessed`.

- [ ] **Step 3: Verify the project**

Run in WSL:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands exit successfully.
