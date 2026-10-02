#!/usr/bin/env python3
"""Serve a catalog report and publish confirmed jobs through Douyin Creator Center."""

from __future__ import annotations

import argparse
import http.server
import json
import os
import shutil
import sqlite3
import subprocess
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path


ACTIVE_STATES = {"launching", "uploading", "scheduling", "submitting", "running"}


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
            if (
                batch.get("provider") == "douyin-web"
                and batch.get("status") == "queued"
                and batch.get("jobs")
                and all(job.get("status") == "queued" for job in batch["jobs"])
            ):
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

    def validate_job(self, job, *, allow_immediate: bool):
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
            if publish_at < now + timedelta(hours=2):
                raise ValueError("抖音网页定时发布需至少提前 2 小时")
            if publish_at > now + timedelta(days=7):
                raise ValueError("抖音网页定时发布暂按最多提前 7 天校验")
        elif not allow_immediate:
            raise ValueError("批量发布必须指定首条定时时间")
        if Path(path).stat().st_size > 4 * 1024 * 1024 * 1024:
            raise ValueError("抖音网页上传文件不能超过 4GB")
        return {
            "file": path, "title": title, "topics": topics,
            "publishAt": publish_at.isoformat() if publish_at else None,
            "aigc": bool(job.get("aigc", True)),
        }

    def enqueue(self, jobs):
        if not self.dependencies_ready():
            raise RuntimeError("缺少 Playwright 依赖，请先运行 npm install")
        if not isinstance(jobs, list) or not jobs:
            raise ValueError("没有可发布的视频")
        validated = [self.validate_job(job, allow_immediate=len(jobs) == 1) for job in jobs]
        batch_id = uuid.uuid4().hex[:12]
        batch = {
            "id": batch_id, "provider": "douyin-web",
            "createdAt": datetime.now().astimezone().isoformat(), "status": "queued",
            "jobs": [{**job, "id": f"{batch_id}-{index + 1:03d}", "status": "queued"} for index, job in enumerate(validated)],
        }
        with self.lock:
            self.batches[batch_id] = batch
            self._save()
        threading.Thread(target=self._run_batch, args=(batch_id,), daemon=True).start()
        return batch

    def _set_job(self, batch_id, job, status, **values):
        with self.lock:
            job["status"] = status
            job.update(values)
            self.batches[batch_id]["updatedAt"] = datetime.now().astimezone().isoformat()
            self._save()

    def _run_batch(self, batch_id: str):
        with self.browser_lock:
            with self.lock:
                batch = self.batches[batch_id]
                batch["status"] = "running"
                self._save()
            for job in batch["jobs"]:
                self.artifact_dir.mkdir(parents=True, exist_ok=True)
                payload_path = self.artifact_dir / f".{job['id']}.json"
                payload = {**job, "artifactDir": str(self.artifact_dir), "jobId": job["id"]}
                payload_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
                try:
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
                        if name in {"launching", "uploading", "scheduling", "submitting", "published", "scheduled"}:
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


def make_handler(directory: Path, bridge: DouyinBrowserBridge):
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

        def do_GET(self):
            if self.path == "/api/publisher/status":
                return self.json_response(200, bridge.status())
            if self.path == "/api/publisher/jobs":
                with bridge.lock:
                    return self.json_response(200, bridge.batches)
            return super().do_GET()

        def do_POST(self):
            try:
                if self.path == "/api/publisher/login":
                    return self.json_response(202, bridge.start_login())
                if self.path != "/api/publisher/publish":
                    return self.json_response(404, {"error": "Not found"})
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
                return self.json_response(202, bridge.enqueue(payload.get("jobs")))
            except (ValueError, RuntimeError, json.JSONDecodeError) as error:
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
    server = http.server.ThreadingHTTPServer((args.host, args.port), make_handler(directory, bridge))
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
