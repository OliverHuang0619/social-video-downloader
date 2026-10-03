#!/usr/bin/env python3
"""Serve a catalog report and publish confirmed jobs through Douyin Creator Center."""

from __future__ import annotations

import argparse
import http.server
import json
import mimetypes
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from urllib.parse import parse_qs, urlsplit
from datetime import datetime, timedelta, timezone
from pathlib import Path


ACTIVE_STATES = {"launching", "uploading", "scheduling", "waiting_covers", "submitting", "running"}
PENDING_STATES = ACTIVE_STATES | {"queued", "waiting_local"}
BATCH_COOLDOWN_SECONDS = 30


class DouyinBrowserBridge:
    def __init__(self, directory: Path, profile_dir: Path):
        self.directory = directory
        self.profile_dir = profile_dir
        self.script = Path(__file__).with_name("douyin_publisher.mjs")
        self.node = shutil.which("node")
        self.playwright_module = self.script.parent / "node_modules" / "playwright-core"
        results = json.loads((directory / "results.json").read_text(encoding="utf-8"))
        self.allowed_files = {str(Path(item["file"]).expanduser().resolve()) for item in results.get("videos", [])}
        self.jobs_path = directory / "publish-jobs.json"
        self.artifact_dir = directory / "publish-artifacts"
        self.lock = threading.RLock()
        self.browser_lock = threading.Lock()
        self.login_state = {"status": "idle", "message": "尚未检查抖音登录状态"}
        self.batches = self._load_batches()
        self._mark_interrupted_jobs()
        if self._profile_has_session():
            self.login_state = {"status": "ready", "message": "抖音创作者中心已登录，可以直接发布"}
        self._resume_queued_batches()

    def _load_batches(self):
        try:
            data = json.loads(self.jobs_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _save(self):
        temp = self.jobs_path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.batches, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(self.jobs_path)

    def _mark_interrupted_jobs(self):
        changed = False
        for batch in self.batches.values():
            if batch.get("provider") != "douyin-web":
                continue
            for job in batch.get("jobs", []):
                if job.get("status") in ACTIVE_STATES:
                    job["status"] = "interrupted"
                    job["error"] = "本地服务曾在执行中停止；请先到抖音作品管理确认，避免重复发布"
                    changed = True
            if batch.get("status") in ACTIVE_STATES:
                batch["status"] = "interrupted"
                changed = True
        if changed:
            self._save()

    def dependencies_ready(self) -> bool:
        return bool(self.node and self.script.is_file() and self.playwright_module.exists())

    def _profile_has_session(self) -> bool:
        cookies_path = self.profile_dir / "Default" / "Cookies"
        if not cookies_path.is_file():
            return False
        chrome_now = int((time.time() + 11644473600) * 1_000_000)
        try:
            connection = sqlite3.connect(f"file:{cookies_path}?mode=ro", uri=True, timeout=0.2)
            try:
                row = connection.execute(
                    """SELECT 1 FROM cookies
                       WHERE host_key LIKE '%douyin.com'
                         AND name IN ('sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt')
                         AND length(encrypted_value) > 0
                         AND (expires_utc = 0 OR expires_utc > ?)
                       LIMIT 1""",
                    (chrome_now,),
                ).fetchone()
                return row is not None
            finally:
                connection.close()
        except sqlite3.Error:
            return False

    def _resume_queued_batches(self):
        for batch_id, batch in self.batches.items():
            jobs = batch.get("jobs") or []
            is_local = batch.get("dispatchMode") == "local"
            platform_ready = batch.get("status") == "queued" and all(job.get("status") == "queued" for job in jobs)
            local_ready = (
                batch.get("status") in {"queued", "waiting_local"}
                and all(job.get("status") in {"queued", "waiting_local", "published"} for job in jobs)
                and any(job.get("status") in {"queued", "waiting_local"} for job in jobs)
            )
            if batch.get("provider") == "douyin-web" and jobs and (local_ready if is_local else platform_ready):
                threading.Thread(target=self._run_batch, args=(batch_id,), daemon=True).start()

    def status(self):
        ready = self.dependencies_ready()
        if ready and self.login_state["status"] in {"idle", "opening"} and self._profile_has_session():
            self.login_state = {"status": "ready", "message": "抖音创作者中心已登录，可以直接发布"}
        message = self.login_state["message"]
        if not ready:
            message = "缺少浏览器发布依赖，请在技能 scripts 目录运行 npm install"
        elif self.login_state["status"] == "idle" and self.profile_dir.exists():
            message = "已发现抖音登录目录；登录过期时任务会提示重新扫码"
        return {
            "ready": ready,
            "mode": "douyin-web",
            "message": message,
            "loginStatus": self.login_state["status"],
            "creatorUrl": "https://creator.douyin.com/creator-micro/content/upload",
            "manageUrl": "https://creator.douyin.com/creator-micro/content/manage",
        }

    def start_login(self):
        if not self.dependencies_ready():
            raise RuntimeError("缺少 Playwright 依赖，请先在技能 scripts 目录运行 npm install")
        with self.lock:
            if self._profile_has_session():
                self.login_state = {"status": "ready", "message": "抖音创作者中心已登录，可以直接发布"}
                return self.status()
            if self.login_state["status"] == "opening":
                return self.status()
            self.login_state = {"status": "opening", "message": "登录窗口已打开，请使用抖音 App 扫码"}
        threading.Thread(target=self._run_login, daemon=True).start()
        return self.status()

    def _environment(self):
        environment = os.environ.copy()
        environment["DOUYIN_PROFILE_DIR"] = str(self.profile_dir)
        return environment

    def _run_login(self):
        try:
            with self.browser_lock:
                result = subprocess.run(
                    [self.node, str(self.script), "login"], capture_output=True, text=True,
                    env=self._environment(), timeout=660,
                )
            events = self._parse_events(result.stdout)
            ready = any(item.get("event") == "login_ready" for item in events)
            error = next((item.get("message") for item in reversed(events) if item.get("event") == "error"), None)
            with self.lock:
                if result.returncode == 0 and ready:
                    self.login_state = {"status": "ready", "message": "抖音创作者中心已登录，可以直接发布"}
                else:
                    self.login_state = {"status": "error", "message": error or result.stderr.strip() or "登录未完成"}
        except subprocess.TimeoutExpired:
            with self.lock:
                self.login_state = {"status": "error", "message": "等待扫码登录超时，请重新打开登录窗口"}
        except Exception as error:
            with self.lock:
                self.login_state = {"status": "error", "message": f"打开登录窗口失败：{error}"}

    @staticmethod
    def _parse_events(output: str):
        events = []
        for line in output.splitlines():
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict) and item.get("event"):
                events.append(item)
        return events

    @staticmethod
    def normalize_topics(value):
        values = value if isinstance(value, list) else str(value or "").replace("，", " ").replace(",", " ").split()
        output = []
        for value in values:
            topic = "".join(str(value).strip().lstrip("#").split())
            if topic and topic.casefold() not in {item.casefold() for item in output}:
                output.append(topic)
        return output[:5]

    def validate_job(self, job, *, allow_immediate: bool, dispatch_mode: str):
        path = str(Path(str(job.get("file", ""))).expanduser().resolve())
        if path not in self.allowed_files or not Path(path).is_file():
            raise ValueError("视频文件不在本报告清单中")
        title = str(job.get("title", "")).strip()
        if not title or len(title) > 30:
            raise ValueError("英文标题必须为 1–30 个字符")
        topics = self.normalize_topics(job.get("topics", []))
        if not topics:
            raise ValueError("至少需要一个话题")
        publish_at_value = job.get("publishAt")
        publish_at = None
        if publish_at_value:
            try:
                publish_at = datetime.fromisoformat(str(publish_at_value).replace("Z", "+00:00"))
            except ValueError as error:
                raise ValueError("定时发布时间无效") from error
            if publish_at.tzinfo is None:
                raise ValueError("定时发布时间必须包含时区")
            now = datetime.now(timezone.utc)
            minimum = timedelta(minutes=1) if dispatch_mode == "local" else timedelta(hours=2)
            if publish_at < now + minimum:
                raise ValueError("本地定时需至少提前 1 分钟" if dispatch_mode == "local" else "抖音网页定时发布需至少提前 2 小时")
            if dispatch_mode == "platform" and publish_at > now + timedelta(days=7):
                raise ValueError("抖音网页定时发布暂按最多提前 7 天校验")
        elif not allow_immediate or dispatch_mode == "local":
            raise ValueError("批量发布必须指定首条定时时间")
        if Path(path).stat().st_size > 4 * 1024 * 1024 * 1024:
            raise ValueError("抖音网页上传文件不能超过 4GB")
        validated = {
            "file": path, "title": title, "topics": topics,
            "aigc": bool(job.get("aigc", True)),
        }
        if dispatch_mode == "local":
            validated.update({"executeAt": publish_at.isoformat(), "publishAt": None})
        else:
            validated["publishAt"] = publish_at.isoformat() if publish_at else None
        return validated

    def enqueue(self, jobs, dispatch_mode="platform"):
        if not self.dependencies_ready():
            raise RuntimeError("缺少 Playwright 依赖，请先运行 npm install")
        if not isinstance(jobs, list) or not jobs:
            raise ValueError("没有可发布的视频")
        if dispatch_mode not in {"platform", "local"}:
            raise ValueError("批量执行方式无效")
        if dispatch_mode == "local" and len(jobs) == 1:
            raise ValueError("本地定时模式仅用于批量发布")
        validated = [
            self.validate_job(job, allow_immediate=len(jobs) == 1, dispatch_mode=dispatch_mode)
            for job in jobs
        ]
        batch_id = uuid.uuid4().hex[:12]
        batch = {
            "id": batch_id, "provider": "douyin-web", "dispatchMode": dispatch_mode,
            "createdAt": datetime.now().astimezone().isoformat(), "status": "queued",
            "jobs": [{**job, "id": f"{batch_id}-{index + 1:03d}", "status": "queued"} for index, job in enumerate(validated)],
        }
        with self.lock:
            self.batches[batch_id] = batch
            self._save()
        threading.Thread(target=self._run_batch, args=(batch_id,), daemon=True).start()
        return batch

    def clear_history(self, batch_id=None):
        with self.lock:
            if batch_id:
                targets = [batch_id] if batch_id in self.batches else []
                if not targets:
                    raise ValueError("发布任务不存在")
            else:
                targets = list(self.batches)
            active = [
                item_id for item_id in targets
                if self.batches[item_id].get("status") in PENDING_STATES
                or any(job.get("status") in PENDING_STATES for job in self.batches[item_id].get("jobs", []))
            ]
            if active:
                raise ValueError("仍有等待或执行中的任务，完成或停止后才能清除")
            removed = [self.batches.pop(item_id) for item_id in targets]
            self._save()

        artifact_root = self.artifact_dir.resolve()
        for batch in removed:
            for job in batch.get("jobs", []):
                screenshot = job.get("screenshot")
                if not screenshot:
                    continue
                screenshot_path = Path(screenshot).expanduser().resolve()
                if screenshot_path.parent == artifact_root:
                    screenshot_path.unlink(missing_ok=True)
        return {"removed": len(removed), "remaining": len(self.batches)}

    def _set_job(self, batch_id, job, status, **values):
        with self.lock:
            job["status"] = status
            job.update(values)
            self.batches[batch_id]["updatedAt"] = datetime.now().astimezone().isoformat()
            self._save()

    def _run_batch(self, batch_id: str):
        with self.lock:
            batch = self.batches[batch_id]
            batch["status"] = "waiting_local" if batch.get("dispatchMode") == "local" else "running"
            self._save()
        for index, job in enumerate(batch["jobs"]):
            if job.get("status") in {"published", "scheduled"}:
                continue
            if job.get("status") not in {"queued", "waiting_local"}:
                break
            if batch.get("dispatchMode") == "local":
                execute_at = datetime.fromisoformat(job["executeAt"].replace("Z", "+00:00"))
                while True:
                    remaining = (execute_at - datetime.now(timezone.utc)).total_seconds()
                    if remaining <= 0:
                        break
                    with self.lock:
                        job["status"] = "waiting_local"
                        batch["status"] = "waiting_local"
                        batch["nextRunAt"] = job["executeAt"]
                        self._save()
                    time.sleep(min(remaining, 30))
            with self.lock:
                batch["status"] = "running"
                batch.pop("nextRunAt", None)
                self._save()
            self.artifact_dir.mkdir(parents=True, exist_ok=True)
            payload_path = self.artifact_dir / f".{job['id']}.json"
            payload = {**job, "publishAt": None if batch.get("dispatchMode") == "local" else job.get("publishAt"),
                       "artifactDir": str(self.artifact_dir), "jobId": job["id"]}
            payload_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            try:
                with self.browser_lock:
                    process = subprocess.Popen(
                        [self.node, str(self.script), "publish", str(payload_path)],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self._environment(),
                    )
                    error_event = None
                    assert process.stdout is not None
                    for line in process.stdout:
                        events = self._parse_events(line)
                        if not events:
                            continue
                        event = events[-1]
                        name = event["event"]
                        if name == "error":
                            error_event = event
                            continue
                        if name in {"launching", "uploading", "scheduling", "waiting_covers", "submitting", "published", "scheduled"}:
                            extra = {key: value for key, value in event.items() if key != "event"}
                            self._set_job(batch_id, job, name, **extra)
                    stderr = process.stderr.read().strip() if process.stderr else ""
                    return_code = process.wait()
                if return_code != 0:
                    message = (error_event or {}).get("message") or stderr or "抖音网页发布失败"
                    state = "needs_login" if "LOGIN_REQUIRED" in message else "needs_attention"
                    extra = {key: value for key, value in (error_event or {}).items() if key not in {"event", "message"}}
                    self._set_job(batch_id, job, state, error=message.replace("LOGIN_REQUIRED：", ""), **extra)
                elif job.get("status") not in {"published", "scheduled"}:
                    self._set_job(batch_id, job, "needs_attention", error="浏览器已结束，但没有明确发布结果；请到作品管理确认")
            except Exception as error:
                self._set_job(batch_id, job, "failed", error=str(error))
            finally:
                payload_path.unlink(missing_ok=True)
            if job.get("status") in {"failed", "needs_login", "needs_attention"}:
                with self.lock:
                    for remaining_job in batch["jobs"][index + 1:]:
                        if remaining_job.get("status") in {"queued", "waiting_local"}:
                            remaining_job["status"] = "interrupted"
                            remaining_job["error"] = "前序任务需要人工检查，已暂停后续发布以避免重复操作"
                    self._save()
                break
            if batch.get("dispatchMode") != "local" and index + 1 < len(batch["jobs"]):
                time.sleep(BATCH_COOLDOWN_SECONDS)
        with self.lock:
            statuses = {job.get("status") for job in batch["jobs"]}
            if statuses <= {"published", "scheduled"}:
                batch["status"] = "completed"
            elif statuses & {"published", "scheduled"}:
                batch["status"] = "partial"
            elif statuses & {"needs_login", "needs_attention"}:
                batch["status"] = "needs_attention"
            else:
                batch["status"] = "failed"
            self._save()


class CatalogAnalysisBridge:
    def __init__(self):
        bundled = Path("/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex")
        configured = os.environ.get("ENGLISH_VIDEO_CATALOG_CODEX")
        self.codex = Path(configured).expanduser() if configured else (bundled if bundled.is_file() else None)
        if self.codex is None:
            discovered = shutil.which("codex")
            self.codex = Path(discovered) if discovered else None
        self.skill_path = Path.home() / ".codex/skills/english-video-catalog/SKILL.md"
        self.server_script = Path(__file__).resolve()
        self.lock = threading.RLock()
        self.task = None
        self.report_servers = {}

    def status(self):
        with self.lock:
            task = dict(self.task) if self.task else None
        return {
            "ready": bool(self.codex and self.codex.is_file() and self.skill_path.is_file()),
            "message": "可选择新目录并调用 Codex 分析" if self.codex and self.codex.is_file() else "未找到可用的 Codex 命令行",
            "task": task,
        }

    def choose_directory(self):
        osascript = shutil.which("osascript")
        if not osascript:
            raise RuntimeError("当前系统不支持原生目录选择，请直接填写绝对路径")
        script = 'POSIX path of (choose folder with prompt "选择要分析的英文视频目录")'
        result = subprocess.run([osascript, "-e", script], capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            message = result.stderr.strip()
            if "User canceled" in message or "-128" in message:
                raise ValueError("已取消选择目录")
            raise RuntimeError(message or "无法打开目录选择器")
        return str(Path(result.stdout.strip()).expanduser().resolve())

    def _existing_report_ready(self, source, output):
        try:
            results = json.loads((output / "results.json").read_text(encoding="utf-8"))
            source_value = results.get("source")
            if not isinstance(source_value, str) or not source_value.strip():
                return False
            report_source = Path(source_value).expanduser().resolve()
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return False
        return report_source == source and (output / "index.html").is_file()

    def _serve_report(self, output):
        key = str(output.resolve())
        with self.lock:
            existing = self.report_servers.get(key)
            if existing and existing[0].poll() is None:
                return existing[1]
            process = subprocess.Popen(
                [sys.executable, str(self.server_script), str(output), "--port", "0"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True,
            )
            assert process.stdout is not None
            report_url = process.stdout.readline().strip()
            if not report_url.startswith("http://"):
                detail = process.stderr.read().strip() if process.stderr else ""
                process.terminate()
                raise RuntimeError(detail or "报告服务启动失败")
            self.report_servers[key] = (process, report_url)
            return report_url

    def start(self, source_value, force=False):
        source = Path(str(source_value or "")).expanduser().resolve()
        if not source.is_dir():
            raise ValueError("请选择存在的视频目录")
        output = source.parent / f"{source.name}-catalog-report"
        with self.lock:
            if self.task and self.task.get("status") in {"queued", "running", "starting_report"}:
                if not force and self.task.get("source") == str(source):
                    return dict(self.task)
                raise ValueError("已有目录正在分析，请等待当前任务完成")
        if not force and self._existing_report_ready(source, output):
            task_id = uuid.uuid4().hex[:12]
            report_url = self._serve_report(output)
            with self.lock:
                self.task = {
                    "id": task_id, "status": "completed", "source": str(source),
                    "output": str(output), "message": "已找到现有报告，未重复分析",
                    "reportUrl": report_url, "cached": True,
                    "createdAt": datetime.now().astimezone().isoformat(),
                    "completedAt": datetime.now().astimezone().isoformat(),
                }
            return self.status()["task"]
        if not self.codex or not self.codex.is_file() or not self.skill_path.is_file():
            raise RuntimeError("Codex 或 english-video-catalog 技能不可用")
        with self.lock:
            task_id = uuid.uuid4().hex[:12]
            self.task = {
                "id": task_id,
                "status": "queued",
                "source": str(source),
                "output": str(output),
                "message": "分析任务已创建",
                "createdAt": datetime.now().astimezone().isoformat(),
            }
        threading.Thread(target=self._run, args=(task_id, source, output), daemon=True).start()
        return self.status()["task"]

    def _update(self, task_id, **values):
        with self.lock:
            if self.task and self.task.get("id") == task_id:
                self.task.update(values)

    def _run(self, task_id, source, output):
        self._update(task_id, status="running", message="Codex 正在分析视频并生成中文报告")
        prompt = (
            f"使用 $english-video-catalog（{self.skill_path}）分析英文视频目录：{source}\n"
            f"生成中文分类、中文总结和关键英文标题，输出必须写入：{output}\n"
            "完整执行媒体清单、逐视频证据分析、results.json 校验和 index.html 生成。"
            "不要移动或修改源视频，不要启动网页服务器或打开浏览器；完成文件生成后直接结束。"
        )
        command = [
            str(self.codex), "--ask-for-approval", "never",
            "--sandbox", "workspace-write", "--cd", str(source.parent),
            "exec", "--ephemeral", "--skip-git-repo-check", prompt,
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=6 * 60 * 60)
            if result.returncode != 0:
                detail = (result.stderr or result.stdout).strip()[-2000:]
                raise RuntimeError(detail or "Codex 分析失败")
            if not (output / "results.json").is_file() or not (output / "index.html").is_file():
                raise RuntimeError("Codex 已结束，但没有生成完整的 results.json 和 index.html")
            self._update(task_id, status="starting_report", message="分析完成，正在启动新报告")
            report_url = self._serve_report(output)
            self._update(
                task_id, status="completed", message="新目录分析完成",
                reportUrl=report_url, completedAt=datetime.now().astimezone().isoformat(),
            )
        except subprocess.TimeoutExpired:
            self._update(task_id, status="failed", message="目录分析超过 6 小时，已停止")
        except Exception as error:
            self._update(task_id, status="failed", message=str(error))


def make_handler(directory: Path, bridge: DouyinBrowserBridge, analyzer: CatalogAnalysisBridge):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(directory), **kwargs)

        def json_response(self, status, payload):
            body = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def media_response(self, send_body=True):
            query = parse_qs(urlsplit(self.path).query)
            requested = Path(query.get("file", [""])[0]).expanduser().resolve()
            if str(requested) not in bridge.allowed_files or not requested.is_file():
                return self.send_error(404, "Video not found")
            size = requested.stat().st_size
            start, end, status = 0, max(0, size - 1), 200
            range_header = self.headers.get("Range")
            if range_header:
                try:
                    unit, value = range_header.split("=", 1)
                    if unit.strip() != "bytes" or "," in value:
                        raise ValueError
                    first, last = value.strip().split("-", 1)
                    if first:
                        start = int(first)
                        end = int(last) if last else size - 1
                    else:
                        suffix = int(last)
                        start = max(0, size - suffix)
                        end = size - 1
                    if start < 0 or end < start or start >= size:
                        raise ValueError
                    end = min(end, size - 1)
                    status = 206
                except (ValueError, TypeError):
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
            length = end - start + 1 if size else 0
            self.send_response(status)
            self.send_header("Content-Type", mimetypes.guess_type(requested.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "private, max-age=3600")
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            if not send_body:
                return
            try:
                with requested.open("rb") as source:
                    source.seek(start)
                    remaining = length
                    while remaining:
                        chunk = source.read(min(1024 * 1024, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if urlsplit(self.path).path == "/api/media":
                return self.media_response()
            if self.path == "/api/publisher/status":
                return self.json_response(200, bridge.status())
            if self.path == "/api/publisher/jobs":
                with bridge.lock:
                    return self.json_response(200, bridge.batches)
            if self.path == "/api/catalog/status":
                return self.json_response(200, analyzer.status())
            return super().do_GET()

        def do_HEAD(self):
            if urlsplit(self.path).path == "/api/media":
                return self.media_response(send_body=False)
            return super().do_HEAD()

        def do_POST(self):
            try:
                if self.path == "/api/publisher/login":
                    return self.json_response(202, bridge.start_login())
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
                if self.path == "/api/publisher/publish":
                    return self.json_response(202, bridge.enqueue(payload.get("jobs"), payload.get("dispatchMode", "platform")))
                if self.path == "/api/catalog/select-directory":
                    return self.json_response(200, {"source": analyzer.choose_directory()})
                if self.path == "/api/catalog/analyze":
                    return self.json_response(202, analyzer.start(payload.get("source"), payload.get("force") is True))
                return self.json_response(404, {"error": "Not found"})
            except (ValueError, RuntimeError, json.JSONDecodeError) as error:
                return self.json_response(400, {"error": str(error)})

        def do_DELETE(self):
            try:
                prefix = "/api/publisher/jobs/"
                if self.path == "/api/publisher/jobs":
                    return self.json_response(200, bridge.clear_history())
                if self.path.startswith(prefix):
                    return self.json_response(200, bridge.clear_history(self.path[len(prefix):]))
                return self.json_response(404, {"error": "Not found"})
            except (ValueError, RuntimeError) as error:
                return self.json_response(400, {"error": str(error)})

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765, help="Use 0 for any free port")
    parser.add_argument("--douyin-profile-dir", type=Path, default=Path.home() / ".config/english-video-catalog/douyin-profile")
    args = parser.parse_args()
    directory = args.directory.expanduser().resolve()
    if not (directory / "index.html").exists() or not (directory / "results.json").exists():
        parser.error(f"index.html or results.json not found in {directory}")
    bridge = DouyinBrowserBridge(directory, args.douyin_profile_dir.expanduser().resolve())
    analyzer = CatalogAnalysisBridge()
    server = http.server.ThreadingHTTPServer((args.host, args.port), make_handler(directory, bridge, analyzer))
    host, port = server.server_address
    print(f"http://{host}:{port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
