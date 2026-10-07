# Changelog

## 1.3.0 - 2026-10-07

### Features

- Show the application version and build time in the web interface.
- Add per-platform login setup and authorization checks for Douyin, WeChat Channels, Bilibili, and Toutiao; only authorized platforms appear in the publish dialog.
- Keep platform login sessions in the persistent browser profile.

### Fixes

- Normalize WeChat Channels titles to its supported punctuation and length rules.
- Keep publishing batches moving after an individual platform fails, and record partial completion.
- End publishing tasks that exit without a result or exceed the overall timeout.
- Wait for platform confirmation and report uncertain outcomes for manual review.
- Correct MultiPost platform URLs and enforce expected injector hostnames.

## 1.2.0 - 2026-10-04

### Features

- Add Hypit-powered original video remakes for selected media-library videos.
- Support no-cost editable production planning and explicitly budgeted final rendering.
- Persist remake projects, progress, logs, interruption state, and completed outputs.
- Automatically register rendered remake videos back into the media library.

### Documentation

- Document the Hypit remake workflow, project storage, output location, and provider requirements.

## 1.1.0 - 2026-10-02

### Features

- Unify video downloading, media management, Codex analysis, metadata review, and Douyin publishing in one React and Node.js workbench.
- Add Docker Compose deployment with persistent application, browser, Codex, and publishing state.
- Add direct, scheduled, and batch Douyin publishing with visible browser handoff and persistent history.
- Add searchable English video catalog reports with playback, processing state, and copy controls.
- Add lazy first-frame thumbnails and improved in-page video playback controls.
- Add structured Codex device login with clickable authorization link and copyable one-time code.
- Add deployment helper commands for normal deployment, clean redeployment, status, and logs.
- Improve Instagram batch download and media format workflows.

### Fixes

- Stabilize Douyin scheduling and interrupted publishing recovery.
- Remove terminal control sequences from Codex login output.
- Keep the video player close control visible without scrolling.

### Documentation

- Document quick deployment, persistent directories, Codex login, and Douyin browser setup.
