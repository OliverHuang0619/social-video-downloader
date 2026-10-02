---
name: english-video-catalog
description: Classify English-language videos from a directory, or summarize one video, then generate and open a local searchable report with Chinese and concise English titles plus copy buttons. Use for local video topic catalogs and per-video key-topic summaries; do not use merely to rename, move, or transcode media.
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
7. Start `scripts/serve_report.py OUTPUT` and open the printed localhost URL in the local browser. Keep the server running long enough for the user to view, track, filter, and copy results. If browser opening is unavailable, provide a clickable absolute path to `index.html`.

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
- use an explicit `搜索` button to apply keyword search, and apply the same search when Enter is pressed in the search field. Keep category and processing-status filters immediate.

## Scripts

- `scripts/prepare_media.py`: inventory, metadata, subtitle discovery, and contact sheets.
- `scripts/build_report.py`: validate result shape/title length and render a searchable, stateful, filterable, copy-friendly HTML page.
- `scripts/serve_report.py`: serve the report on localhost and print its URL.
