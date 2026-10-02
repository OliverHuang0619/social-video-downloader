#!/usr/bin/env python3
"""Inventory videos and create contact sheets for evidence-based analysis."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".quicktime"}
TEXT_EXTS = {".srt", ".vtt", ".txt", ".md", ".json"}


def safe_slug(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-.")
    return slug[:80] or "video"


def probe(path: Path) -> dict:
    command = [
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=index,codec_type,codec_name,width,height",
        "-of", "json", str(path),
    ]
    try:
        data = json.loads(subprocess.check_output(command, text=True, stderr=subprocess.STDOUT))
    except (subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        return {"error": str(exc)}
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), {})
    duration = data.get("format", {}).get("duration")
    return {
        "duration_seconds": round(float(duration), 3) if duration else None,
        "width": video.get("width"),
        "height": video.get("height"),
        "video_codec": video.get("codec_name"),
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
        "has_subtitle_stream": any(s.get("codec_type") == "subtitle" for s in streams),
    }


def sidecars(path: Path) -> list[str]:
    matches = []
    for candidate in path.parent.glob(path.stem + ".*"):
        if candidate != path and candidate.suffix.lower() in TEXT_EXTS:
            matches.append(str(candidate.resolve()))
    return sorted(matches)


def make_contact_sheet(video: Path, output: Path, duration: float | None) -> str | None:
    if output.exists() and output.stat().st_size > 0:
        return None
    fps = 9.0 / max(duration or 9.0, 1.0)
    vf = f"fps={fps:.8f},scale=360:-2:force_original_aspect_ratio=decrease,tile=3x3:padding=6:margin=6"
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video),
        "-vf", vf, "-frames:v", "1", str(output),
    ]
    try:
        subprocess.run(command, check=True)
        return None
    except subprocess.CalledProcessError as exc:
        return f"contact sheet failed: {exc}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="Video file or directory")
    parser.add_argument("--output", required=True, type=Path, help="Report working directory")
    parser.add_argument("--files-json", type=Path, help="Optional JSON array of exact video paths to prepare")
    parser.add_argument("--no-contact-sheets", action="store_true")
    args = parser.parse_args()

    source = args.input.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if not source.exists():
        parser.error(f"input does not exist: {source}")
    if shutil.which("ffprobe") is None:
        parser.error("ffprobe is required")
    if not args.no_contact_sheets and shutil.which("ffmpeg") is None:
        parser.error("ffmpeg is required unless --no-contact-sheets is used")

    if args.files_json:
        try:
            requested = json.loads(args.files_json.expanduser().resolve().read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            parser.error(f"cannot read --files-json: {exc}")
        if not isinstance(requested, list) or not requested:
            parser.error("--files-json must contain a non-empty array")
        videos = [Path(value).expanduser().resolve() for value in requested]
        if any(not video.is_file() or video.suffix.lower() not in VIDEO_EXTS for video in videos):
            parser.error("--files-json contains a missing or unsupported video")
        mode = "directory" if len(videos) > 1 else "single"
    elif source.is_file():
        videos = [source] if source.suffix.lower() in VIDEO_EXTS else []
        mode = "single"
    else:
        videos = sorted(
            p.resolve() for p in source.rglob("*")
            if p.is_file() and p.suffix.lower() in VIDEO_EXTS and output not in p.parents
        )
        mode = "directory"
    if not videos:
        parser.error("no supported video files found")

    sheets = output / "contact-sheets"
    sheets.mkdir(parents=True, exist_ok=True)
    records = []
    for index, video in enumerate(videos, 1):
        print(json.dumps({
            "event": "prepare_started",
            "index": index,
            "total": len(videos),
            "filename": video.name,
        }, ensure_ascii=False), flush=True)
        metadata = probe(video)
        sheet = sheets / f"{index:04d}-{safe_slug(video.stem)}.jpg"
        error = None
        if not args.no_contact_sheets and "error" not in metadata:
            error = make_contact_sheet(video, sheet, metadata.get("duration_seconds"))
        records.append({
            "index": index,
            "file": str(video),
            "filename": video.name,
            "metadata": metadata,
            "sidecar_text": sidecars(video),
            "contact_sheet": str(sheet) if sheet.exists() else None,
            "preparation_note": error,
        })
        print(json.dumps({
            "event": "prepare_completed",
            "index": index,
            "total": len(videos),
            "filename": video.name,
            "duration_seconds": metadata.get("duration_seconds"),
            "resolution": f"{metadata.get('width')}×{metadata.get('height')}" if metadata.get("width") and metadata.get("height") else None,
            "sidecar_count": len(records[-1]["sidecar_text"]),
            "contact_sheet": bool(records[-1]["contact_sheet"]),
            "error": error or metadata.get("error"),
        }, ensure_ascii=False), flush=True)

    manifest = {
        "source": str(source),
        "mode": mode,
        "created_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "video_count": len(records),
        "videos": records,
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(manifest_path)
    print(f"Prepared {len(records)} video(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
