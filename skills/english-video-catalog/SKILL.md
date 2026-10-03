---
name: english-video-catalog
description: Classify English-language videos from a directory, or summarize one video, then generate and open a local searchable report with Chinese and concise English titles, copy controls, and optional direct Douyin web publishing. Use for local video topic catalogs and per-video key-topic summaries; do not use merely to rename, move, or transcode media.
---

# English Video Catalog

Turn a local video path into an evidence-grounded catalog and a self-contained HTML report.

## Modes

- **Directory:** recursively find supported videos, derive a small coherent category set from the collection, and produce one record per video.
- **Single video:** skip collection-level classification unless a category is useful; return the video's result directly in chat as well as in the HTML report.

Do not move, rename, or modify source videos unless the user separately requests it.

## Workflow

1. Resolve the input path and create an output directory outside the scanned directory. A good default is `<input-parent>/<input-name>-catalog-report`.
2. Run `scripts/prepare_media.py INPUT --output OUTPUT`. It inventories videos with `ffprobe`, discovers sidecar subtitles/transcripts, and creates contact sheets with `ffmpeg`. Reuse its manifest and existing contact sheets on reruns.
3. Analyze every manifest entry using the strongest available evidence, in this order:
   - provided or sidecar transcript/subtitles;
   - embedded captions or a locally available speech-to-text tool;
   - sampled contact sheet plus filename and metadata.
4. If speech is important but no transcript backend exists, do not install software or use a paid API without authorization. Continue from visual/filename evidence when adequate, lower confidence, and state the limitation. Never invent spoken details.
5. For a directory, inspect a representative spread before choosing categories. Prefer 5–12 stable, mutually understandable categories; use `Other` only for true outliers. Classification means labeling in the report, not changing filesystem layout.
6. Write `OUTPUT/results.json` using the schema below, then run `scripts/build_report.py OUTPUT/results.json --output OUTPUT/index.html`.
7. Run `npm install` once in `scripts/` when Douyin web publishing is needed, then start `scripts/serve_report.py OUTPUT` and open the printed localhost URL. Keep the server running while the user views, tracks, filters, copies, or publishes. If browser opening is unavailable, provide a clickable absolute path to `index.html`.

For large directories, process in batches if needed, but do not silently omit files. Compare result count and paths against `manifest.json` before reporting completion.

## Content requirements

For each video provide:

- `title`: specific and natural, fewer than 30 Unicode characters; no trailing ellipsis.
- `english_title`: a concise, natural English learning title that captures the video's central vocabulary or scenario; use title case, keep it under 60 characters, and never copy a truncated filename ending.
- `category`: a concise collection-level label (optional for a single video).
- `key_topics`: 2–5 concrete topics, concepts, objects, or actions.
- `summary`: 1–3 compact sentences explaining what the video covers and, when evident, its teaching or narrative purpose.
- `confidence`: `high`, `medium`, or `low`, reflecting evidence quality.
- `evidence_note`: short disclosure such as `English subtitles + visual sampling` or `Filename + visual sampling; no transcript`.

Match the user's language for titles, categories, topics, and summaries; default to Chinese for a Chinese request. Preserve proper nouns and useful English learning terms where that improves clarity.

## Results schema

```json
{
  "source": "/absolute/input/path",
  "generated_at": "2026-10-02T12:00:00+08:00",
  "language": "zh-CN",
  "mode": "directory",
  "categories": [
    {"name": "数字与计数", "description": "数字识别和顺序计数"}
  ],
  "videos": [
    {
      "file": "/absolute/path/video.mp4",
      "title": "和萌宠一起数到十",
      "english_title": "Count to Ten with Animal Friends",
      "category": "数字与计数",
      "key_topics": ["数字1–10", "顺序计数", "动物词汇"],
      "summary": "通过可爱的动物角色带孩子从1数到10，强化数字顺序和基础英语表达。",
      "confidence": "high",
      "evidence_note": "English subtitles + visual sampling"
    }
  ]
}
```

Every `file` must be the absolute path from the manifest. Keep JSON factual and free of HTML; the renderer handles escaping and layout.

## Report interaction requirements

The HTML report must:

- include the original video filename in search and show it on each card;
- default every video to `未处理`, allow toggling it to `已处理`, persist this state in browser `localStorage`, and filter by `未处理` (the default view), `已处理`, or all states;
- ensure nonmatching cards are actually hidden in the rendered layout, so the visible cards always agree with the filtered count;
- retain title/category/topic/summary search and category filtering;
- provide separate copy buttons for the Chinese title, English title, key topics, and summary, plus a whole-card copy action;
- provide a per-video playback button that opens an in-page player with standard controls and seeking when the report is served locally; only stream video paths listed in the current report;
- use an explicit `搜索` button to apply keyword search, and apply the same search when Enter is pressed in the search field. Keep category and processing-status filters immediate.
- provide a per-video Douyin publish button and multi-select batch publishing controls when the report is served through `serve_report.py`;
- prefill the publish title from `english_title`, enforcing Douyin's 30-character limit, and prefill up to five topics with visible `#` prefixes;
- support immediate or scheduled single-video publishing, plus two batch modes: submit the full schedule to Douyin now, or keep jobs locally and publish each one when due; require a future batch start time, allow editing single-video metadata, and default batch spacing to one hour;
- show persistent local publishing history and link to Douyin's work-management page;
- allow deleting one completed publishing batch or clearing all completed publishing history and its local diagnostic screenshots; never clear a queued, waiting, or running task;
- when served locally, allow selecting another absolute directory and switch to its existing complete report without rerunning analysis; only start a background Codex run when no complete report exists or the user explicitly clicks `重新分析`, write new reports beside the source directory, and switch to the target localhost report;
- show a final confirmation before the local bridge uploads or publishes. Never create a real publishing task merely by opening the report.

## Direct Douyin web publishing

The publishing bridge uses Playwright with the installed system Chrome to operate `https://creator.douyin.com/` directly. It keeps a dedicated persistent browser profile at `~/.config/english-video-catalog/douyin-profile`; never commit, copy, print, or expose that directory because it contains the user's authenticated session.

The first use requires the user to click `登录抖音` and scan the official login QR code. Reuse that session for later jobs. A login expiry, CAPTCHA, account verification, page redesign, or platform risk control may still require manual intervention; report this as `需要登录` or `需要检查` instead of retrying blindly.

Keep browser automation visible and identifiable. Do not alter browser fingerprints, hide automation indicators, bypass CAPTCHA or safety checks, or add randomized “human-like” behavior intended to evade platform detection. Use ordinary DOM interactions with fixed, observable pacing (scroll, click, wait for response, and type text character by character), a fixed cooldown between platform submissions, and stop the batch when any job needs login or manual review.

Use the English title as the work title and append visible `#` topics to the description. The report may request the platform's `内容由AI生成` declaration; keep it selected by default for AI-generated videos but let the user change it before submission. For platform scheduling, validate times as at least two hours and no more than seven days ahead. For local scheduling, persist the queue, require the first execution at least one minute ahead, resume waiting jobs after a service restart, and clearly warn that the local service and computer must remain available. Process every batch serially to avoid concurrent use of the same browser profile.

Before clicking the final publish button, wait until Douyin has visibly generated both the landscape and portrait cover previews and any cover-generation indicator has disappeared. Require that ready state to remain stable across repeated checks. If either preview fails or does not become ready before the timeout, stop without submitting and preserve the diagnostic screenshot.

Directory switching should reuse a complete existing report whose `results.json` source matches the selected directory. Do not invoke Codex again unless the report is missing or the user explicitly chooses `重新分析`. New or forced analysis requires a logged-in local Codex CLI. Prefer the CLI bundled with the ChatGPT desktop app, run it with workspace access limited to the selected directory's parent, and keep the run ephemeral. Require explicit confirmation before starting or rerunning analysis, allow only one active analysis at a time, and never modify the selected source videos. Start the target report on a free localhost port and navigate to it only after both `results.json` and `index.html` exist.

## Scripts

- `scripts/prepare_media.py`: inventory, metadata, subtitle discovery, and contact sheets.
- `scripts/build_report.py`: validate result shape/title length and render a searchable, stateful, filterable, copy-friendly HTML page.
- `scripts/serve_report.py`: serve the report, persist job history, and run confirmed publishing jobs serially.
- `scripts/douyin_publisher.mjs`: open the persistent Chrome profile, upload videos, fill titles/topics, configure immediate or scheduled publication, submit, and capture diagnostic screenshots.
