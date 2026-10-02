#!/usr/bin/env python3

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT_DIR = Path(__file__).resolve().parent


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build_report = load_module("build_report", "build_report.py")
serve_report = load_module("serve_report", "serve_report.py")


class ReportServicesTest(unittest.TestCase):
    def test_report_contains_history_and_directory_controls(self):
        data = {
            "source": "/tmp/videos",
            "generated_at": "2026-10-02T12:00:00+08:00",
            "mode": "directory",
            "videos": [{
                "file": "/tmp/videos/lesson.mp4",
                "title": "颜色入门",
                "english_title": "Learn Colors",
                "category": "颜色",
                "key_topics": ["颜色词"],
                "summary": "学习常见颜色。",
                "confidence": "high",
                "evidence_note": "Visual sampling",
            }],
        }
        output = build_report.render(data)
        self.assertIn('id="clear-jobs"', output)
        self.assertIn('id="open-catalog"', output)
        self.assertIn('id="force-analysis"', output)
        self.assertIn('data-action="play"', output)
        self.assertIn('id="video-player"', output)
        self.assertIn("/api/media?file=", output)
        self.assertIn("/api/catalog/analyze", output)

    def test_clear_history_keeps_active_batches(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "results.json").write_text(json.dumps({"videos": []}), encoding="utf-8")
            bridge = serve_report.DouyinBrowserBridge(directory, directory / "profile")
            bridge.batches = {
                "done": {"id": "done", "status": "completed", "jobs": [{"status": "published"}]},
            }
            result = bridge.clear_history("done")
            self.assertEqual(result, {"removed": 1, "remaining": 0})
            bridge.batches = {
                "active": {"id": "active", "status": "running", "jobs": [{"status": "uploading"}]},
            }
            with self.assertRaisesRegex(ValueError, "仍有等待或执行中的任务"):
                bridge.clear_history()

    def test_catalog_analysis_places_global_cli_options_before_exec(self):
        analyzer = serve_report.CatalogAnalysisBridge()
        analyzer.codex = Path("/tmp/codex")
        analyzer.task = {"id": "analysis"}
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "videos"
            source.mkdir()
            output = Path(temporary) / "videos-catalog-report"
            failed = type("Result", (), {"returncode": 2, "stdout": "", "stderr": "expected stop"})()
            with mock.patch.object(serve_report.subprocess, "run", return_value=failed) as run:
                analyzer._run("analysis", source, output)
            command = run.call_args.args[0]
            self.assertLess(command.index("--ask-for-approval"), command.index("exec"))
            self.assertEqual(command[command.index("--ask-for-approval") + 1], "never")

    def test_catalog_reuses_complete_existing_report(self):
        analyzer = serve_report.CatalogAnalysisBridge()
        analyzer.codex = None
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "videos"
            source.mkdir()
            output = Path(temporary) / "videos-catalog-report"
            output.mkdir()
            (output / "results.json").write_text(json.dumps({"source": str(source)}), encoding="utf-8")
            (output / "index.html").write_text("<html></html>", encoding="utf-8")
            with mock.patch.object(analyzer, "_serve_report", return_value="http://127.0.0.1:9999/") as serve:
                task = analyzer.start(source)
            self.assertEqual(task["status"], "completed")
            self.assertTrue(task["cached"])
            serve.assert_called_once_with(output.resolve())


if __name__ == "__main__":
    unittest.main()
