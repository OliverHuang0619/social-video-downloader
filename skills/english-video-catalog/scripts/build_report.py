#!/usr/bin/env python3
"""Validate catalog results and render a self-contained local HTML report."""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path


def e(value: object) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def compact_publish_title(value: object) -> str:
    title = " ".join(str(value).split())
    if len(title) <= 30:
        return title
    clipped = title[:30].rstrip()
    if " " in clipped:
        clipped = clipped.rsplit(" ", 1)[0]
    return clipped.rstrip(".,;:!?—- ") or title[:30]


def publish_topic(value: object) -> str:
    return re.sub(r"\s+", "", str(value).strip().lstrip("#"))


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
    topics_text = "、".join(map(str, video["key_topics"]))
    category = video.get("category") or "未分类"
    file_name = Path(video["file"]).name
    copy_text = "\n".join([
        f"中文标题：{video['title']}", f"English Title: {video['english_title']}", f"分类：{category}",
        f"关键话题：{topics_text}",
        f"总结：{video['summary']}", f"文件：{video['file']}",
    ])
    search_text = " ".join([
        str(video["title"]), str(video["english_title"]), str(category), " ".join(map(str, video["key_topics"])),
        str(video["summary"]), file_name,
    ]).lower()
    publish_title = compact_publish_title(video["english_title"])
    publish_topics = " ".join(f"#{publish_topic(topic)}" for topic in video["key_topics"][:5] if publish_topic(topic))
    return f'''<article class="card" data-category="{e(category)}" data-search="{e(search_text)}" data-file="{e(video['file'])}" data-publish-title="{e(publish_title)}" data-publish-topics="{e(publish_topics)}" data-processed="0">
      <div class="card-head"><div><label class="pick"><input class="publish-select" type="checkbox" aria-label="选择发布 {e(file_name)}"><span class="number">{index:02d}</span></label><span class="category">{e(category)}</span></div><div class="head-actions"><button class="play-video" data-action="play">▶ 播放</button><button class="publish-one" data-action="publish">发布到抖音</button><button class="status-toggle" data-action="status" aria-pressed="false">未处理</button><button class="copy-one" data-copy="{e(copy_text)}">复制整条</button></div></div>
      <div class="field-head"><h2>{e(video['title'])}</h2><button class="copy-field" data-copy="{e(video['title'])}">复制中文标题</button></div>
      <div class="field-head english-row"><p class="english-title" lang="en">{e(video['english_title'])}</p><button class="copy-field" data-copy="{e(video['english_title'])}">复制英文标题</button></div>
      <div class="field-head topic-head"><div class="topics">{topics}</div><button class="copy-field" data-copy="{e(topics_text)}">复制主题</button></div>
      <div class="field-head summary-row"><p class="summary">{e(video['summary'])}</p><button class="copy-field" data-copy="{e(video['summary'])}">复制总结</button></div>
      <p class="source-name"><b>原始文件名</b><span>{e(file_name)}</span></p>
      <details><summary>来源与可信度</summary><p><b>{e(video['confidence'])}</b> · {e(video['evidence_note'])}</p><p class="file" title="{e(video['file'])}">{e(file_name)}</p></details>
    </article>'''


def render(data: dict) -> str:
    videos = data["videos"]
    categories = sorted({str(v.get("category") or "未分类") for v in videos})
    options = "".join(f'<option value="{e(c)}">{e(c)}</option>' for c in categories)
    cards = "\n".join(card(video, index) for index, video in enumerate(videos, 1))
    title = "英文视频目录" if data.get("mode") == "directory" else "视频总结"
    storage_key = json.dumps(f"english-video-catalog:processed:{data.get('source', '')}", ensure_ascii=False)
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><style>
:root{{--ink:#15211b;--muted:#657068;--paper:#f5f1e8;--card:#fffdf8;--green:#1f5c43;--lime:#dff06c;--line:#d9d5ca}}
*{{box-sizing:border-box}}[hidden]{{display:none!important}}body{{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"PingFang SC",sans-serif}}
header{{background:var(--green);color:white;padding:48px max(24px,calc((100vw - 1120px)/2)) 72px}}header h1{{font-size:clamp(34px,6vw,68px);line-height:1;margin:0 0 16px;letter-spacing:-.04em}}header p{{margin:0;color:#dfeae3;max-width:760px;overflow-wrap:anywhere}}
    .bar{{max-width:1120px;margin:-32px auto 14px;padding:18px;background:var(--card);border:1px solid var(--line);border-radius:18px;display:grid;grid-template-columns:minmax(240px,1fr) 190px 150px auto;gap:12px;box-shadow:0 12px 32px #19342818;position:sticky;top:12px;z-index:5}}.publish-bar{{max-width:1120px;margin:0 auto 20px;padding:14px 18px;background:#eef4ef;border:1px solid #c8d8cd;border-radius:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}}.publish-bar .spacer{{flex:1}}.publish-note{{color:var(--muted);font-size:13px}}#batch-publish,.publish-one,#confirm-publish,#start-analysis{{background:#171717;color:white;border-color:#171717}}#publisher-status{{font-size:13px;color:var(--muted);flex-basis:100%}}.danger{{color:#a33;border-color:#d8aaa4;background:#fff7f5}}
input,select,button{{font:inherit;border:1px solid var(--line);border-radius:10px;padding:11px 13px;background:white;color:var(--ink)}}button{{cursor:pointer;font-weight:700}}button:hover{{border-color:var(--green)}}#search-button{{background:var(--lime);border-color:#c8d854}}
.meta{{max-width:1120px;margin:0 auto 20px;padding:0 4px;color:var(--muted)}}main{{max-width:1120px;margin:0 auto;padding:0 0 60px;display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px;min-height:330px;display:flex;flex-direction:column}}.card[data-processed="1"]{{border-color:#8fba9f;background:#fbfff9}}.card:has(.publish-select:checked){{outline:3px solid #dff06c}}.card-head,.field-head{{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}}.head-actions{{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}}.pick{{cursor:pointer}}.publish-select{{width:16px;height:16px;margin:0 7px 0 0;vertical-align:-2px}}.number{{font-variant-numeric:tabular-nums;color:var(--muted);margin-right:10px}}.category{{background:#e7eee9;color:var(--green);padding:5px 9px;border-radius:999px;font-size:13px;font-weight:700}}.copy-one,.copy-field,.status-toggle,.publish-one,.play-video{{padding:6px 9px;font-size:12px;white-space:nowrap}}.play-video{{color:var(--green);border-color:#9ec9ad;background:#eff8f1}}.status-toggle{{color:#7d4e00;background:#fff3ce;border-color:#e4c97e}}.card[data-processed="1"] .status-toggle{{color:#155638;background:#dff1e5;border-color:#9ec9ad}}
h2{{font-size:25px;line-height:1.2;margin:20px 0 3px}}.english-row{{align-items:center}}.english-title{{margin:0 0 14px;color:var(--green);font:700 15px/1.35 ui-sans-serif,system-ui,sans-serif;letter-spacing:.01em}}.topics{{display:flex;flex-wrap:wrap;gap:7px}}.topic-head{{margin:4px 0 8px}}.topic{{font-size:13px;border:1px solid var(--line);border-radius:999px;padding:4px 9px}}.summary-row{{align-items:flex-start;flex:1}}.summary{{font-size:16px;margin-top:8px}}.source-name{{margin:12px 0;color:var(--muted);font-size:12px;overflow-wrap:anywhere}}.source-name b{{display:block;color:var(--ink);margin-bottom:3px}}details{{border-top:1px solid var(--line);padding-top:12px;color:var(--muted);font-size:13px}}details summary{{cursor:pointer}}.file{{overflow-wrap:anywhere}}.empty{{grid-column:1/-1;text-align:center;padding:50px;color:var(--muted)}}
    dialog{{border:0;border-radius:18px;padding:0;box-shadow:0 24px 80px #0005;max-width:560px;width:calc(100% - 28px)}}dialog::backdrop{{background:#10251db8}}.dialog-body{{padding:24px}}.dialog-body h2{{margin-top:0}}.form-row{{display:grid;gap:6px;margin:13px 0}}.form-row input,.form-row select{{width:100%}}.check-row{{display:flex;gap:8px;align-items:center;margin:13px 0}}.check-row input{{width:auto}}.dialog-actions{{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}}.warning{{background:#fff3ce;border:1px solid #e4c97e;border-radius:10px;padding:10px 12px;font-size:13px}}#publish-message,#catalog-message{{color:var(--muted);font-size:13px;overflow-wrap:anywhere}}#jobs-dialog{{max-width:900px}}#jobs-list{{display:grid;gap:12px;max-height:65vh;overflow:auto}}.job-batch{{border:1px solid var(--line);border-radius:12px;padding:12px}}.job-batch-head{{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}}.job-batch h3{{margin:0 0 8px;font-size:15px}}.delete-job{{padding:5px 9px;font-size:12px}}.job-row{{display:grid;grid-template-columns:minmax(180px,1fr) 130px 160px;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:13px}}.job-error{{color:#a33;grid-column:1/-1;overflow-wrap:anywhere}}.job-shot{{font-size:12px}}.status-pill{{font-weight:700}}.path-picker{{display:grid;grid-template-columns:1fr auto;gap:8px}}#video-dialog{{max-width:960px}}#video-player{{display:block;width:100%;max-height:72vh;background:#000;border-radius:12px}}#video-file{{color:var(--muted);font-size:13px;overflow-wrap:anywhere}}@media(max-width:700px){{.job-row{{grid-template-columns:1fr}}.job-error{{grid-column:auto}}.path-picker{{grid-template-columns:1fr}}}}
@media(max-width:700px){{header{{padding-bottom:64px}}.bar{{margin:-26px 14px 12px;grid-template-columns:1fr}}.publish-bar,.meta,main{{margin-left:14px;margin-right:14px}}main{{grid-template-columns:1fr}}}}
</style></head><body>
<header><h1>{title}</h1><p>{e(data.get('source'))}</p></header>
<section class="bar"><input id="search" placeholder="搜索原始文件名、中英文标题、主题或总结"><select id="category"><option value="">全部分类</option>{options}</select><select id="status"><option value="unprocessed" selected>未处理</option><option value="processed">已处理</option><option value="">全部状态</option></select><button id="search-button" type="button">搜索</button></section>
    <section class="publish-bar"><button id="select-visible" type="button">选择当前结果</button><button id="clear-selection" type="button">清空选择</button><span id="selection-count">已选择 0 条</span><button id="open-catalog" type="button">分析其他目录</button><span class="spacer"></span><button id="login-douyin" type="button">登录抖音</button><button id="open-manage" type="button">作品管理</button><button id="show-jobs" type="button">发布任务</button><button id="batch-publish" type="button">批量发布</button><span id="publisher-status">正在检查抖音网页发布服务…</span></section>
<div class="meta"><span id="count">{len(videos)}</span> / {len(videos)} 个视频 · 已处理 <span id="processed-count">0</span> · 生成于 {e(data.get('generated_at',''))}</div>
<main id="cards">{cards}<div class="empty" hidden>没有匹配结果</div></main>
<dialog id="publish-dialog"><form class="dialog-body" method="dialog"><h2 id="publish-dialog-title">发布到抖音</h2><p class="warning">确认后将通过可见的本机 Chrome 执行常规页面操作。登录过期、验证码或风控会暂停任务并等待人工处理。</p><label class="form-row single-only">英文标题（最多 30 字符）<input id="publish-title" maxlength="30"></label><label class="form-row single-only">话题（自动加 #，最多 5 个）<input id="publish-topics"></label><label class="form-row single-only">发布方式<select id="publish-mode"><option value="immediate">立即发布</option><option value="scheduled">定时发布</option></select></label><label class="form-row batch-only">批量执行方式<select id="batch-dispatch-mode"><option value="platform">立即提交到抖音排期</option><option value="local">本地按时逐条发布</option></select></label><label class="form-row" id="publish-time-row">首条发布时间<input id="publish-time" type="datetime-local"></label><label class="form-row batch-only">每条间隔（小时）<input id="publish-interval" type="number" min="1" step="1" value="1"></label><label class="check-row"><input id="publish-aigc" type="checkbox" checked> 将“自主声明”设置为“内容由 AI 生成”</label><p id="publish-message"></p><div class="dialog-actions"><button value="cancel">取消</button><button id="confirm-publish" value="default">确认发布</button></div></form></dialog>
    <dialog id="jobs-dialog"><form class="dialog-body" method="dialog"><h2>发布任务</h2><div id="jobs-list">正在读取…</div><div class="dialog-actions"><button id="clear-jobs" class="danger" type="button">清除全部</button><button id="refresh-jobs" type="button">刷新</button><button value="cancel">关闭</button></div></form></dialog>
    <dialog id="catalog-dialog"><form class="dialog-body" method="dialog"><h2>分析其他目录</h2><p class="warning">已有完整报告会直接打开，不会重复分析。只有点击“重新分析”才会再次调用本机 Codex。源视频不会被移动或修改，结果保存在同级的 <b>-catalog-report</b> 目录。</p><label class="form-row">英文视频目录<div class="path-picker"><input id="catalog-path" placeholder="输入绝对路径" value=""><button id="choose-catalog" type="button">选择目录</button></div></label><p id="catalog-message">选择目录后打开已有报告；没有报告时会自动开始分析。</p><div class="dialog-actions"><button value="cancel">取消</button><button id="force-analysis" class="danger" type="button">重新分析</button><button id="start-analysis" type="button">打开或分析</button></div></form></dialog>
    <dialog id="video-dialog"><form class="dialog-body" method="dialog"><h2 id="video-title">播放视频</h2><video id="video-player" controls preload="metadata" playsinline></video><p id="video-file"></p><div class="dialog-actions"><button value="cancel">关闭</button></div></form></dialog>
<script>
const search=document.querySelector('#search'),searchButton=document.querySelector('#search-button'),category=document.querySelector('#category'),statusFilter=document.querySelector('#status'),cards=[...document.querySelectorAll('.card')],empty=document.querySelector('.empty'),count=document.querySelector('#count'),processedCount=document.querySelector('#processed-count'),storageKey={storage_key},publishSyncedKey={storage_key}+':published-jobs';
const dialog=document.querySelector('#publish-dialog'),dialogTitle=document.querySelector('#publish-dialog-title'),titleInput=document.querySelector('#publish-title'),topicsInput=document.querySelector('#publish-topics'),publishMode=document.querySelector('#publish-mode'),batchDispatchMode=document.querySelector('#batch-dispatch-mode'),timeRow=document.querySelector('#publish-time-row'),timeInput=document.querySelector('#publish-time'),intervalInput=document.querySelector('#publish-interval'),aigcInput=document.querySelector('#publish-aigc'),message=document.querySelector('#publish-message'),publisherStatus=document.querySelector('#publisher-status');
    const jobsDialog=document.querySelector('#jobs-dialog'),jobsList=document.querySelector('#jobs-list'),catalogDialog=document.querySelector('#catalog-dialog'),catalogPath=document.querySelector('#catalog-path'),catalogMessage=document.querySelector('#catalog-message'),videoDialog=document.querySelector('#video-dialog'),videoPlayer=document.querySelector('#video-player'),videoTitle=document.querySelector('#video-title'),videoFile=document.querySelector('#video-file');
let processed={{}},syncedPublished={{}},publisher={{creatorUrl:'https://creator.douyin.com/',manageUrl:'https://creator.douyin.com/creator-micro/content/manage'}},publishCards=[];try{{processed=JSON.parse(localStorage.getItem(storageKey)||'{{}}');syncedPublished=JSON.parse(localStorage.getItem(publishSyncedKey)||'{{}}')}}catch(e){{processed={{}};syncedPublished={{}}}}
function setCardState(card,value){{card.dataset.processed=value?'1':'0';const button=card.querySelector('[data-action="status"]');button.textContent=value?'已处理':'未处理';button.setAttribute('aria-pressed',value?'true':'false')}}
cards.forEach(card=>setCardState(card,processed[card.dataset.file]===true));
function updateSelection(){{document.querySelector('#selection-count').textContent=`已选择 ${{cards.filter(x=>x.querySelector('.publish-select').checked).length}} 条`}}
function filter(){{const q=search.value.trim().toLowerCase(),c=category.value,s=statusFilter.value;let n=0,p=0;cards.forEach(x=>{{const done=x.dataset.processed==='1';if(done)p++;const statusOk=!s||(s==='processed'&&done)||(s==='unprocessed'&&!done);const show=(!q||x.dataset.search.includes(q))&&(!c||x.dataset.category===c)&&statusOk;x.hidden=!show;if(show)n++}});count.textContent=n;processedCount.textContent=p;empty.hidden=n!==0}}
searchButton.addEventListener('click',filter);search.addEventListener('keydown',event=>{{if(event.key==='Enter')filter()}});category.addEventListener('change',filter);statusFilter.addEventListener('change',filter);
document.querySelectorAll('[data-action="status"]').forEach(button=>button.addEventListener('click',()=>{{const card=button.closest('.card'),done=card.dataset.processed!=='1';setCardState(card,done);processed[card.dataset.file]=done;try{{localStorage.setItem(storageKey,JSON.stringify(processed))}}catch(e){{}}filter()}}));
document.querySelectorAll('.publish-select').forEach(input=>input.addEventListener('change',updateSelection));
document.querySelector('#select-visible').addEventListener('click',()=>{{cards.filter(x=>!x.hidden).forEach(x=>x.querySelector('.publish-select').checked=true);updateSelection()}});
document.querySelector('#clear-selection').addEventListener('click',()=>{{cards.forEach(x=>x.querySelector('.publish-select').checked=false);updateSelection()}});
async function copy(button){{try{{await navigator.clipboard.writeText(button.dataset.copy);const old=button.textContent;button.textContent='已复制';setTimeout(()=>button.textContent=old,1200)}}catch(e){{alert('浏览器未允许复制，请在 localhost 页面重试。')}}}}
document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',()=>copy(b)));
function openVideo(card){{videoTitle.textContent=card.querySelector('h2').textContent;videoFile.textContent=card.dataset.file.split('/').pop();videoPlayer.src='/api/media?file='+encodeURIComponent(card.dataset.file);videoDialog.showModal();videoPlayer.play().catch(()=>{{}})}}
document.querySelectorAll('[data-action="play"]').forEach(button=>button.addEventListener('click',()=>openVideo(button.closest('.card'))));videoDialog.addEventListener('close',()=>{{videoPlayer.pause();videoPlayer.removeAttribute('src');videoPlayer.load()}});
function localDateValue(date){{return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)}}
function defaultSchedule(){{const step=30*60000;return new Date(Math.ceil((Date.now()+125*60000)/step)*step)}}
function updateTimeVisibility(){{timeRow.hidden=dialog.dataset.batch!=='1'&&publishMode.value==='immediate'}}
async function loadPublisher(){{try{{publisher=await fetch('/api/publisher/status',{{cache:'no-store'}}).then(r=>r.json());publisherStatus.textContent=publisher.message}}catch(e){{publisherStatus.textContent='无法连接抖音网页发布服务'}}}}
const statusNames={{queued:'等待执行',waiting_local:'本地等待中',running:'执行中',launching:'启动浏览器',uploading:'上传中',scheduling:'设置定时',submitting:'正在提交',published:'已发布',scheduled:'已排期',failed:'失败',needs_login:'需要登录',needs_attention:'需要检查',interrupted:'执行被中断',completed:'已完成',partial:'部分完成'}};
function esc(value){{const el=document.createElement('span');el.textContent=value??'';return el.innerHTML}}
function syncCompletedJobs(batches){{let stateChanged=false,syncChanged=false;Object.values(batches).forEach(batch=>(batch.jobs||[]).forEach(job=>{{if(!['published','scheduled'].includes(job.status)||!job.file)return;const token=job.id||`${{batch.id}}:${{job.file}}`;if(syncedPublished[token])return;syncedPublished[token]=true;syncChanged=true;const card=cards.find(item=>item.dataset.file===job.file);if(card){{processed[job.file]=true;setCardState(card,true);card.querySelector('.publish-select').checked=false;stateChanged=true}}}}));try{{if(stateChanged)localStorage.setItem(storageKey,JSON.stringify(processed));if(syncChanged)localStorage.setItem(publishSyncedKey,JSON.stringify(syncedPublished))}}catch(e){{}}if(stateChanged){{updateSelection();filter()}}}}
    async function loadJobs(){{try{{const batches=await fetch('/api/publisher/jobs',{{cache:'no-store'}}).then(r=>r.json()),items=Object.values(batches).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));syncCompletedJobs(batches);jobsList.innerHTML=items.length?items.map(batch=>`<section class="job-batch"><div class="job-batch-head"><h3>${{batch.provider==='douyin-web'?(batch.dispatchMode==='local'?'本地定时直发':(batch.jobs||[]).some(job=>job.publishAt)?'抖音平台排期':'抖音网页直发'):'AiToEarn 历史'}} · ${{esc(batch.id)}} · ${{esc(statusNames[batch.status]||batch.status)}}</h3><button class="delete-job danger" type="button" data-batch="${{esc(batch.id)}}">删除</button></div>${{(batch.jobs||[]).map(job=>`<div class="job-row"><span>${{esc(job.title||job.file?.split('/').pop())}}</span><span class="status-pill">${{esc(statusNames[job.status]||job.status)}}</span><span>${{job.executeAt||job.publishAt?new Date(job.executeAt||job.publishAt).toLocaleString():'立即发布'}}</span>${{job.error?`<span class="job-error">${{esc(job.error)}}</span>`:''}}${{job.screenshot?`<a class="job-shot" target="_blank" href="/publish-artifacts/${{encodeURIComponent(job.screenshot.split('/').pop())}}">查看错误/提交前截图</a>`:''}}</div>`).join('')}}</section>`).join(''):'还没有发布任务。'}}catch(e){{jobsList.textContent='任务读取失败：'+e.message}}}}
async function syncPublishingHistory(){{try{{const batches=await fetch('/api/publisher/jobs',{{cache:'no-store'}}).then(r=>r.json());syncCompletedJobs(batches)}}catch(e){{}}}}
async function pollBatch(id){{try{{const batches=await fetch('/api/publisher/jobs',{{cache:'no-store'}}).then(r=>r.json()),batch=batches[id];if(!batch)return;syncCompletedJobs({{[id]:batch}});const done=batch.jobs.filter(job=>['published','scheduled'].includes(job.status)).length,attention=batch.jobs.filter(job=>['failed','needs_login','needs_attention','interrupted'].includes(job.status)).length;publisherStatus.textContent=`队列 ${{id}}：完成 ${{done}}/${{batch.jobs.length}}${{attention?`，需检查 ${{attention}}`:''}}`;if(!['completed','partial','failed','needs_attention','interrupted'].includes(batch.status))setTimeout(()=>pollBatch(id),2000);if(jobsDialog.open)loadJobs()}}catch(e){{publisherStatus.textContent=`队列 ${{id}}：状态读取失败`}}}}
function openPublish(items,isBatch){{if(!publisher.ready){{alert(publisher.message||'浏览器发布依赖尚未就绪');return}}publishCards=items;dialog.dataset.batch=isBatch?'1':'0';dialogTitle.textContent=isBatch?`批量发布 ${{items.length}} 条视频`:'发布到抖音';document.querySelectorAll('.single-only').forEach(x=>x.hidden=isBatch);document.querySelectorAll('.batch-only').forEach(x=>x.hidden=!isBatch);if(!isBatch){{titleInput.value=items[0].dataset.publishTitle;topicsInput.value=items[0].dataset.publishTopics;publishMode.value='immediate'}}batchDispatchMode.value='platform';timeInput.value=localDateValue(defaultSchedule());intervalInput.value='1';updateTimeVisibility();message.textContent=isBatch?'可立即提交到抖音排期，或由本地服务到点逐条发布；本地模式必须保持服务运行。':'可立即发布，也可切换为定时发布。';dialog.showModal()}}
document.querySelectorAll('[data-action="publish"]').forEach(button=>button.addEventListener('click',()=>openPublish([button.closest('.card')],false)));
document.querySelector('#batch-publish').addEventListener('click',()=>{{const selected=cards.filter(x=>x.querySelector('.publish-select').checked);if(!selected.length){{alert('请先选择要发布的视频。');return}}openPublish(selected,true)}});
publishMode.addEventListener('change',updateTimeVisibility);
document.querySelector('#login-douyin').addEventListener('click',async()=>{{publisherStatus.textContent='正在打开抖音登录窗口…';try{{const response=await fetch('/api/publisher/login',{{method:'POST'}}),result=await response.json();if(!response.ok)throw new Error(result.error||'无法打开登录窗口');publisherStatus.textContent=result.message;const timer=setInterval(async()=>{{await loadPublisher();if(publisher.loginStatus==='ready'||publisher.loginStatus==='error')clearInterval(timer)}},2000)}}catch(error){{publisherStatus.textContent='登录窗口打开失败：'+error.message}}}});
document.querySelector('#open-manage').addEventListener('click',()=>window.open(publisher.manageUrl||'https://creator.douyin.com/creator-micro/content/manage','_blank'));
    async function deleteJobs(batchId){{const label=batchId?`任务 ${{batchId}}`:'全部发布任务历史';if(!confirm(`确定清除${{label}}吗？相关的本地截图也会删除，此操作不可恢复。`))return;try{{const target=batchId?`/api/publisher/jobs/${{encodeURIComponent(batchId)}}`:'/api/publisher/jobs',response=await fetch(target,{{method:'DELETE'}}),result=await response.json();if(!response.ok)throw new Error(result.error||'清除失败');if(!batchId){{syncedPublished={{}};try{{localStorage.removeItem(publishSyncedKey)}}catch(e){{}}}}await loadJobs()}}catch(error){{alert(`清除失败：${{error.message}}`)}}}}
    jobsList.addEventListener('click',event=>{{const button=event.target.closest('[data-batch]');if(button)deleteJobs(button.dataset.batch)}});document.querySelector('#clear-jobs').addEventListener('click',()=>deleteJobs());
    document.querySelector('#show-jobs').addEventListener('click',async()=>{{await loadJobs();jobsDialog.showModal()}});document.querySelector('#refresh-jobs').addEventListener('click',loadJobs);
    let analysisTimer;
    async function pollAnalysis(){{if(analysisTimer)clearTimeout(analysisTimer);analysisTimer=null;try{{const state=await fetch('/api/catalog/status',{{cache:'no-store'}}).then(r=>r.json()),task=state.task;if(!task)return;if(task.source&&!catalogPath.value)catalogPath.value=task.source;catalogMessage.textContent=task.message||'正在分析…';if(task.status==='completed'&&task.reportUrl){{catalogMessage.textContent='分析完成，正在打开新报告…';setTimeout(()=>window.location.assign(task.reportUrl),700);return}}if(task.status==='failed')return;analysisTimer=setTimeout(pollAnalysis,2000)}}catch(error){{catalogMessage.textContent=`读取分析状态失败：${{error.message}}`;analysisTimer=setTimeout(pollAnalysis,5000)}}}}
    document.querySelector('#open-catalog').addEventListener('click',()=>{{catalogMessage.textContent='正在读取分析状态…';catalogDialog.showModal();pollAnalysis()}});
    document.querySelector('#choose-catalog').addEventListener('click',async()=>{{catalogMessage.textContent='正在打开目录选择器…';try{{const response=await fetch('/api/catalog/select-directory',{{method:'POST'}}),result=await response.json();if(!response.ok)throw new Error(result.error||'选择失败');catalogPath.value=result.source;catalogMessage.textContent='目录已选择，可以开始分析。'}}catch(error){{catalogMessage.textContent=error.message}}}});
    async function startAnalysis(force){{const source=catalogPath.value.trim();if(!source){{catalogMessage.textContent='请先选择或填写视频目录。';return}}const action=force?'重新调用 Codex 分析并覆盖现有报告':'打开已有报告；若不存在则调用 Codex 分析';if(!confirm(`${{action}}：\n${{source}}\n\n是否继续？`))return;catalogMessage.textContent=force?'正在创建重新分析任务…':'正在检查已有报告…';try{{const response=await fetch('/api/catalog/analyze',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{source,force}})}}),result=await response.json();if(!response.ok)throw new Error(result.error||'创建分析任务失败');catalogMessage.textContent=result.message||'任务已启动';pollAnalysis()}}catch(error){{catalogMessage.textContent=`启动失败：${{error.message}}`}}}}
    document.querySelector('#start-analysis').addEventListener('click',()=>startAnalysis(false));document.querySelector('#force-analysis').addEventListener('click',()=>startAnalysis(true));
document.querySelector('#confirm-publish').addEventListener('click',async event=>{{event.preventDefault();const isBatch=dialog.dataset.batch==='1',dispatchMode=isBatch?batchDispatchMode.value:'platform',localBatch=isBatch&&dispatchMode==='local',scheduled=isBatch||publishMode.value==='scheduled',start=scheduled?new Date(timeInput.value):null,interval=Math.max(1,Number(intervalInput.value)||1),minimumLead=localBatch?60000:2*3600000;if(scheduled&&(Number.isNaN(start.getTime())||start<=new Date(Date.now()+minimumLead))){{message.textContent=localBatch?'本地定时的首条执行时间需至少晚于当前时间 1 分钟。':'抖音平台定时发布需至少提前 2 小时。';return}}const jobs=publishCards.map((card,index)=>({{file:card.dataset.file,title:isBatch?card.dataset.publishTitle:titleInput.value.trim(),topics:(isBatch?card.dataset.publishTopics:topicsInput.value).split(/[#\\s,，]+/).filter(Boolean).slice(0,5),publishAt:scheduled?new Date(start.getTime()+index*interval*3600000).toISOString():null,aigc:aigcInput.checked}}));if(jobs.some(job=>!job.title||job.title.length>30||!job.topics.length)){{message.textContent='请检查英文标题（1–30 字符）和话题（1–5 个）。';return}}const action=localBatch?`在本地从 ${{start.toLocaleString()}} 起逐条执行（需保持服务运行）`:scheduled?`现在提交到抖音并从 ${{start.toLocaleString()}} 起排期`:'立即公开发布';if(!confirm(`即将${{action}} ${{jobs.length}} 个视频。是否继续？`))return;message.textContent='正在创建本地浏览器发布队列…';try{{const response=await fetch('/api/publisher/publish',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{jobs,dispatchMode}})}}),result=await response.json();if(!response.ok)throw new Error(result.error||'创建失败');message.textContent=localBatch?`本地定时队列 ${{result.id}} 已创建，请保持本地服务运行。`:`发布队列 ${{result.id}} 已创建，Chrome 将自动完成上传和提交。`;publisherStatus.textContent=`队列 ${{result.id}} 正在处理`;pollBatch(result.id);setTimeout(()=>dialog.close(),1800)}}catch(error){{message.textContent=`创建失败：${{error.message}}`}}}});
window.addEventListener('focus',loadPublisher);
    filter();updateSelection();loadPublisher();syncPublishingHistory();pollAnalysis();
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
