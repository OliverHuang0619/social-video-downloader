#!/usr/bin/env python3
"""
把一个合集视频按情节切成多个片段，并给每个片段重新命名。

依赖：ffmpeg / ffprobe（必须），yt-dlp（仅 --youtube 时需要）。

三种确定切点的方式（按优先级）：
  1. --segments FILE / --segment "MM:SS 标题" ：手动指定时间点 + 标题（YouTube 章节格式）
  2. --youtube URL_OR_ID                         ：用 yt-dlp 读取 YouTube 章节
  3. 默认自动检测                               ：黑屏 + 静音同时出现的位置视为情节边界

典型流程：
  # 1) 先自动探测并预览，会在输出目录生成 segments.txt 模板
  python3 scripts/split_episodes.py "video.mp4" --dry-run

  # 2) 编辑 segments.txt 里的标题，然后正式切分
  python3 scripts/split_episodes.py "video.mp4" --segments "video/segments.txt"

  # 或者直接给标题（按顺序对应自动探测到的片段）
  python3 scripts/split_episodes.py "video.mp4" --titles "Puppy in the Room" "Mom Finds Out"
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


# --------------------------------------------------------------------------- #
# 基础工具
# --------------------------------------------------------------------------- #
@dataclass
class Segment:
    start: float
    end: float
    title: str

    @property
    def duration(self) -> float:
        return self.end - self.start


def die(msg: str, code: int = 1) -> None:
    print(f"错误: {msg}", file=sys.stderr)
    sys.exit(code)


def require_tool(name: str) -> None:
    if shutil.which(name) is None:
        die(f"找不到 {name}，请先安装（brew install {name}）")


def fmt_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h, rem = divmod(int(round(seconds)), 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def parse_time(text: str) -> float:
    """支持 SS / MM:SS / HH:MM:SS，可带小数。"""
    parts = text.strip().split(":")
    if not 1 <= len(parts) <= 3:
        raise ValueError(f"无法解析时间: {text!r}")
    try:
        nums = [float(p) for p in parts]
    except ValueError as exc:
        raise ValueError(f"无法解析时间: {text!r}") from exc
    total = 0.0
    for n in nums:
        total = total * 60 + n
    return total


def sanitize_filename(name: str, max_len: int = 120) -> str:
    name = re.sub(r'[\\/:*?"<>|\r\n\t]+', " ", name)
    name = re.sub(r"\s+", " ", name).strip(" ._")
    return name[:max_len].rstrip(" ._") or "untitled"


def probe_duration(video: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(video)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    try:
        return float(out)
    except ValueError:
        die(f"ffprobe 无法读取时长: {video}")
        return 0.0  # unreachable


# --------------------------------------------------------------------------- #
# 切点来源 1：手动时间点
# --------------------------------------------------------------------------- #
_LINE_RE = re.compile(r"^\s*(\d{1,2}(?::\d{1,2}){0,2}(?:\.\d+)?)\s*[-–—:|]?\s*(.*?)\s*$")


def parse_marker_lines(lines: list[str], duration: float) -> list[Segment]:
    """每行 `MM:SS 标题`（YouTube 章节格式）。时间点是片段开始；最后一段到视频结尾。"""
    markers: list[tuple[float, str]] = []
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = _LINE_RE.match(line)
        if not m:
            raise ValueError(f"无法解析行: {raw!r}（期望格式：MM:SS 标题）")
        markers.append((parse_time(m.group(1)), m.group(2)))

    if not markers:
        raise ValueError("没有读到任何时间点")
    markers.sort(key=lambda x: x[0])
    if markers[0][0] > 1.0:
        # 第一段没有从 0 开始，自动补上
        markers.insert(0, (0.0, ""))

    segments: list[Segment] = []
    for i, (start, title) in enumerate(markers):
        end = markers[i + 1][0] if i + 1 < len(markers) else duration
        if end - start <= 0.5:
            continue
        segments.append(Segment(start, min(end, duration), title))
    return segments


# --------------------------------------------------------------------------- #
# 切点来源 2：YouTube 章节
# --------------------------------------------------------------------------- #
def fetch_youtube_chapters(url_or_id: str, duration: float) -> list[Segment]:
    require_tool("yt-dlp")
    url = url_or_id
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url_or_id):
        url = f"https://www.youtube.com/watch?v={url_or_id}"
    proc = subprocess.run(
        ["yt-dlp", "--dump-json", "--no-download", "--no-warnings", url],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        die(f"yt-dlp 获取信息失败:\n{proc.stderr.strip()}")
    info = json.loads(proc.stdout.strip().splitlines()[-1])
    chapters = info.get("chapters") or []
    if not chapters:
        die("该视频没有 YouTube 章节信息，请改用 --segments 或自动检测")
    return [
        Segment(float(c["start_time"]), float(c.get("end_time") or duration), c.get("title", ""))
        for c in chapters
        if float(c.get("end_time") or duration) - float(c["start_time"]) > 0.5
    ]


# --------------------------------------------------------------------------- #
# 切点来源 3：黑屏 + 静音自动检测
# --------------------------------------------------------------------------- #
_BLACK_RE = re.compile(r"black_start:(?P<s>[\d.]+)\s+black_end:(?P<e>[\d.]+)")
_SIL_START_RE = re.compile(r"silence_start:\s*(?P<s>[\d.]+)")
_SIL_END_RE = re.compile(r"silence_end:\s*(?P<e>[\d.]+)")


def detect_boundaries(
    video: Path,
    duration: float,
    *,
    black_dur: float,
    black_pix_th: float,
    silence_db: float,
    silence_dur: float,
    min_segment: float,
    black_only: bool,
    verbose: bool,
) -> list[float]:
    """返回情节边界时间点（秒），不含 0 和结尾。"""
    cmd = [
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(video),
        "-vf", f"scale=160:-2,blackdetect=d={black_dur}:pix_th={black_pix_th}",
        "-af", f"silencedetect=n={silence_db}dB:d={silence_dur}",
        "-f", "null", "-",
    ]
    if verbose:
        print("检测命令:", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    log = proc.stderr

    blacks = [(float(m["s"]), float(m["e"])) for m in _BLACK_RE.finditer(log)]
    sil_starts = [float(m["s"]) for m in _SIL_START_RE.finditer(log)]
    sil_ends = [float(m["e"]) for m in _SIL_END_RE.finditer(log)]
    silences = list(zip(sil_starts, sil_ends))

    if verbose:
        print(f"黑屏区间 {len(blacks)} 个: {[(round(s,1), round(e,1)) for s,e in blacks]}")
        print(f"静音区间 {len(silences)} 个: {[(round(s,1), round(e,1)) for s,e in silences]}")

    candidates: list[float] = []
    for bs, be in blacks:
        if black_only:
            candidates.append((bs + be) / 2)
            continue
        # 黑屏与任一静音区间有重叠（允许 1 秒容差）才算情节边界
        for ss, se in silences:
            if bs <= se + 1.0 and be >= ss - 1.0:
                candidates.append((bs + be) / 2)
                break

    # 去掉太靠近开头/结尾、以及彼此太近的边界
    boundaries: list[float] = []
    last = 0.0
    for t in sorted(candidates):
        if t - last < min_segment:
            continue
        if duration - t < min_segment:
            break
        boundaries.append(t)
        last = t
    return boundaries


def boundaries_to_segments(boundaries: list[float], duration: float) -> list[Segment]:
    points = [0.0, *boundaries, duration]
    return [Segment(points[i], points[i + 1], "") for i in range(len(points) - 1)]


# --------------------------------------------------------------------------- #
# 命名与切割
# --------------------------------------------------------------------------- #
def assign_titles(segments: list[Segment], titles: list[str] | None, base: str) -> None:
    if titles:
        if len(titles) != len(segments):
            die(f"--titles 给了 {len(titles)} 个标题，但检测到 {len(segments)} 个片段")
        for seg, title in zip(segments, titles):
            seg.title = title
    for i, seg in enumerate(segments, 1):
        if not seg.title.strip():
            seg.title = f"{base} Part {i}"


def build_filename(template: str, index: int, seg: Segment, base: str, ext: str) -> str:
    name = template.format(
        index=index,
        title=sanitize_filename(seg.title),
        base=sanitize_filename(base),
        start=fmt_time(seg.start).replace(":", "."),
        end=fmt_time(seg.end).replace(":", "."),
    )
    if not name.lower().endswith(ext.lower()):
        name += ext
    return name


def cut_segment(video: Path, seg: Segment, dest: Path, *, reencode: bool, overwrite: bool) -> None:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostats",
           "-y" if overwrite else "-n"]
    if reencode:
        cmd += ["-ss", f"{seg.start:.3f}", "-to", f"{seg.end:.3f}", "-i", str(video),
                "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                "-c:a", "aac", "-b:a", "160k"]
    else:
        cmd += ["-ss", f"{seg.start:.3f}", "-to", f"{seg.end:.3f}", "-i", str(video),
                "-c", "copy", "-avoid_negative_ts", "make_zero"]
    cmd += ["-movflags", "+faststart", str(dest)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        die(f"切割失败 {dest.name}:\n{proc.stderr.strip()}")


def write_segments_template(path: Path, segments: list[Segment]) -> None:
    lines = [
        "# 每行：开始时间 标题。编辑标题后用 --segments 指定此文件重新运行。",
        "# 最后一段自动延续到视频结尾；可以增删行来调整切点。",
    ]
    for seg in segments:
        lines.append(f"{fmt_time(seg.start)} {seg.title}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="按情节切分视频并重命名每个片段",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("video", type=Path, help="输入视频文件")
    p.add_argument("-o", "--out", type=Path, help="输出目录（默认：视频同目录下以视频名命名的文件夹）")

    src = p.add_argument_group("切点来源")
    src.add_argument("--segments", type=Path, help="时间点文件，每行 `MM:SS 标题`")
    src.add_argument("--segment", action="append", default=[], metavar="'MM:SS 标题'",
                     help="直接在命令行给时间点，可重复")
    src.add_argument("--youtube", metavar="URL_OR_ID", help="从 YouTube 章节读取切点（需要 yt-dlp）")

    auto = p.add_argument_group("自动检测参数（无手动切点时生效）")
    auto.add_argument("--min-segment", type=float, default=60.0, help="片段最短秒数，默认 60")
    auto.add_argument("--black-dur", type=float, default=0.3, help="黑屏最短秒数，默认 0.3")
    auto.add_argument("--black-pix-th", type=float, default=0.10, help="黑屏像素阈值，默认 0.10")
    auto.add_argument("--silence-db", type=float, default=-35.0, help="静音阈值 dB，默认 -35")
    auto.add_argument("--silence-dur", type=float, default=0.5, help="静音最短秒数，默认 0.5")
    auto.add_argument("--black-only", action="store_true", help="只用黑屏判断，不要求同时静音")

    name = p.add_argument_group("命名")
    name.add_argument("--titles", nargs="+", help="按顺序给每个片段的标题（与片段数一致）")
    name.add_argument("--template", default="{index:02d} - {title}",
                      help="文件名模板，可用 {index} {title} {base} {start} {end}，默认 '{index:02d} - {title}'")

    p.add_argument("--reencode", action="store_true", help="重新编码以精确到帧（默认流复制，快但切点落在关键帧）")
    p.add_argument("--overwrite", action="store_true", help="覆盖已存在的输出文件")
    p.add_argument("--dry-run", action="store_true", help="只打印计划并生成 segments.txt，不切割")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    require_tool("ffmpeg")
    require_tool("ffprobe")

    video: Path = args.video.expanduser().resolve()
    if not video.is_file():
        die(f"文件不存在: {video}")
    base = video.stem
    ext = video.suffix or ".mp4"
    out_dir: Path = (args.out or video.parent / base).expanduser().resolve()

    duration = probe_duration(video)
    print(f"视频: {video.name}  时长 {fmt_time(duration)}")

    # ---- 决定切点 ----
    if args.segments or args.segment:
        lines: list[str] = []
        if args.segments:
            lines += args.segments.read_text(encoding="utf-8").splitlines()
        lines += args.segment
        try:
            segments = parse_marker_lines(lines, duration)
        except ValueError as exc:
            die(str(exc))
        source = "手动时间点"
    elif args.youtube:
        segments = fetch_youtube_chapters(args.youtube, duration)
        source = "YouTube 章节"
    else:
        print("自动检测情节边界（黑屏 + 静音）...")
        boundaries = detect_boundaries(
            video, duration,
            black_dur=args.black_dur, black_pix_th=args.black_pix_th,
            silence_db=args.silence_db, silence_dur=args.silence_dur,
            min_segment=args.min_segment, black_only=args.black_only,
            verbose=args.verbose,
        )
        segments = boundaries_to_segments(boundaries, duration)
        source = "自动检测"
        if not boundaries:
            print("未检测到情节边界；可尝试 --black-only、调低 --min-segment，或用 --segments 手动指定。")

    assign_titles(segments, args.titles, base)

    # ---- 打印计划 ----
    print(f"\n切点来源: {source}，共 {len(segments)} 段 → {out_dir}")
    plan: list[tuple[Segment, Path]] = []
    for i, seg in enumerate(segments, 1):
        fname = build_filename(args.template, i, seg, base, ext)
        dest = out_dir / fname
        plan.append((seg, dest))
        print(f"  [{i:02d}] {fmt_time(seg.start)} - {fmt_time(seg.end)} ({fmt_time(seg.duration)})  {fname}")

    out_dir.mkdir(parents=True, exist_ok=True)
    template_path = out_dir / "segments.txt"
    if not template_path.exists() or args.overwrite or source != "手动时间点":
        write_segments_template(template_path, segments)
        print(f"\n已写入切点模板: {template_path}")

    if args.dry_run:
        print("dry-run，未切割。编辑 segments.txt 后用 --segments 重新运行即可。")
        return 0

    # ---- 切割 ----
    print()
    for i, (seg, dest) in enumerate(plan, 1):
        if dest.exists() and not args.overwrite:
            print(f"  [{i:02d}] 已存在，跳过: {dest.name}")
            continue
        print(f"  [{i:02d}] 切割 → {dest.name}", flush=True)
        cut_segment(video, seg, dest, reencode=args.reencode, overwrite=args.overwrite)

    print(f"\n完成：{len(plan)} 个片段已输出到 {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
