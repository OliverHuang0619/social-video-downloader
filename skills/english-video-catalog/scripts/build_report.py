#!/usr/bin/env python3
"""Validate catalog results and render a self-contained local HTML report."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path


def e(value: object) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def validate(data: dict) -> None:
    videos = data.get("videos")
    if not isinstance(videos, list) or not videos:
        raise ValueError("results must contain a non-empty videos array")
    required = {"file", "title", "english_title", "key_topics", "summary", "confidence", "evidence_note"}
    for index, video in enumerate(videos, 1):
        missing = sorted(required - video.keys())
        if missing:
            raise ValueError(f"video {index} missing: {', '.join(missing)}")
        title = str(video["title"])
        if len(title) >= 30:
            raise ValueError(f"video {index} title must be under 30 characters: {title!r}")
        english_title = str(video["english_title"])
        if not english_title.strip() or len(english_title) >= 60:
            raise ValueError(f"video {index} english_title must be non-empty and under 60 characters: {english_title!r}")
        if not isinstance(video["key_topics"], list) or not video["key_topics"]:
            raise ValueError(f"video {index} key_topics must be a non-empty array")
        if video["confidence"] not in {"high", "medium", "low"}:
            raise ValueError(f"video {index} confidence must be high, medium, or low")


def card(video: dict, index: int) -> str:
    topics = "".join(f'<span class="topic">{e(topic)}</span>' for topic in video["key_topics"])
    category = video.get("category") or "未分类"
    file_name = Path(video["file"]).name
    copy_text = "\n".join([
        f"中文标题：{video['title']}", f"English Title: {video['english_title']}", f"分类：{category}",
        f"关键话题：{'、'.join(map(str, video['key_topics']))}",
        f"总结：{video['summary']}", f"文件：{video['file']}",
    ])
    search_text = " ".join([
        str(video["title"]), str(video["english_title"]), str(category), " ".join(map(str, video["key_topics"])),
        str(video["summary"]), file_name,
    ]).lower()
    return f'''<article class="card" data-category="{e(category)}" data-search="{e(search_text)}">
      <div class="card-head"><div><span class="number">{index:02d}</span><span class="category">{e(category)}</span></div><button class="copy-one" data-copy="{e(copy_text)}">复制</button></div>
      <h2>{e(video['title'])}</h2>
      <p class="english-title" lang="en">{e(video['english_title'])}</p>
      <div class="topics">{topics}</div>
      <p class="summary">{e(video['summary'])}</p>
      <details><summary>来源与可信度</summary><p><b>{e(video['confidence'])}</b> · {e(video['evidence_note'])}</p><p class="file" title="{e(video['file'])}">{e(file_name)}</p></details>
    </article>'''


def render(data: dict) -> str:
    videos = data["videos"]
    categories = sorted({str(v.get("category") or "未分类") for v in videos})
    options = "".join(f'<option value="{e(c)}">{e(c)}</option>' for c in categories)
    cards = "\n".join(card(video, index) for index, video in enumerate(videos, 1))
    all_text = "\n\n".join(
        f"中文标题：{v['title']}\nEnglish Title: {v['english_title']}\n分类：{v.get('category') or '未分类'}\n关键话题：{'、'.join(map(str, v['key_topics']))}\n{v['summary']}"
        for v in videos
    )
    title = "英文视频目录" if data.get("mode") == "directory" else "视频总结"
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><style>
:root{{--ink:#15211b;--muted:#657068;--paper:#f5f1e8;--card:#fffdf8;--green:#1f5c43;--lime:#dff06c;--line:#d9d5ca}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"PingFang SC",sans-serif}}
header{{background:var(--green);color:white;padding:48px max(24px,calc((100vw - 1120px)/2)) 72px}}header h1{{font-size:clamp(34px,6vw,68px);line-height:1;margin:0 0 16px;letter-spacing:-.04em}}header p{{margin:0;color:#dfeae3;max-width:760px;overflow-wrap:anywhere}}
.bar{{max-width:1120px;margin:-32px auto 28px;padding:18px;background:var(--card);border:1px solid var(--line);border-radius:18px;display:grid;grid-template-columns:1fr 220px auto;gap:12px;box-shadow:0 12px 32px #19342818;position:sticky;top:12px;z-index:5}}
input,select,button{{font:inherit;border:1px solid var(--line);border-radius:10px;padding:11px 13px;background:white;color:var(--ink)}}button{{cursor:pointer;font-weight:700}}button:hover{{border-color:var(--green)}}#copy-all{{background:var(--lime);border-color:#c8d854}}
.meta{{max-width:1120px;margin:0 auto 20px;padding:0 4px;color:var(--muted)}}main{{max-width:1120px;margin:0 auto;padding:0 0 60px;display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px;min-height:270px;display:flex;flex-direction:column}}.card-head{{display:flex;justify-content:space-between;align-items:center}}.number{{font-variant-numeric:tabular-nums;color:var(--muted);margin-right:10px}}.category{{background:#e7eee9;color:var(--green);padding:5px 9px;border-radius:999px;font-size:13px;font-weight:700}}.copy-one{{padding:7px 11px;font-size:13px}}
h2{{font-size:25px;line-height:1.2;margin:20px 0 3px}}.english-title{{margin:0 0 14px;color:var(--green);font:700 15px/1.35 ui-sans-serif,system-ui,sans-serif;letter-spacing:.01em}}.topics{{display:flex;flex-wrap:wrap;gap:7px}}.topic{{font-size:13px;border:1px solid var(--line);border-radius:999px;padding:4px 9px}}.summary{{font-size:16px;flex:1}}details{{border-top:1px solid var(--line);padding-top:12px;color:var(--muted);font-size:13px}}details summary{{cursor:pointer}}.file{{overflow-wrap:anywhere}}.empty{{grid-column:1/-1;text-align:center;padding:50px;color:var(--muted)}}
@media(max-width:700px){{header{{padding-bottom:64px}}.bar{{margin:-26px 14px 22px;grid-template-columns:1fr}}.meta,main{{margin-left:14px;margin-right:14px}}main{{grid-template-columns:1fr}}}}
</style></head><body>
<header><h1>{title}</h1><p>{e(data.get('source'))}</p></header>
<section class="bar"><input id="search" placeholder="搜索中英文标题、分类、话题或总结"><select id="category"><option value="">全部分类</option>{options}</select><button id="copy-all" data-copy="{e(all_text)}">复制全部</button></section>
<div class="meta"><span id="count">{len(videos)}</span> / {len(videos)} 个视频 · 生成于 {e(data.get('generated_at',''))}</div>
<main id="cards">{cards}<div class="empty" hidden>没有匹配结果</div></main>
<script>
const search=document.querySelector('#search'), category=document.querySelector('#category'), cards=[...document.querySelectorAll('.card')], empty=document.querySelector('.empty'), count=document.querySelector('#count');
function filter(){{const q=search.value.trim().toLowerCase(),c=category.value;let n=0;cards.forEach(x=>{{const show=(!q||x.dataset.search.includes(q))&&(!c||x.dataset.category===c);x.hidden=!show;if(show)n++}});count.textContent=n;empty.hidden=n!==0}}
search.addEventListener('input',filter);category.addEventListener('change',filter);
async function copy(button){{try{{await navigator.clipboard.writeText(button.dataset.copy);const old=button.textContent;button.textContent='已复制';setTimeout(()=>button.textContent=old,1200)}}catch(e){{alert('浏览器未允许复制，请在 localhost 页面重试。')}}}}
document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',()=>copy(b)));
</script></body></html>'''


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("results", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    data = json.loads(args.results.expanduser().read_text(encoding="utf-8"))
    validate(data)
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render(data), encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
