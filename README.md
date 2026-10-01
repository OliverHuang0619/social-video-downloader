# Social Video Downloader

本地运行的 Electron 社交视频下载器，支持多链接解析、YouTube 频道/播放列表、Instagram 博主帖子与 Reels 扫描、批量选择和三并发下载。

## 开发

```bash
npm install
npm run dev
```

应用优先使用系统中的 `yt-dlp`、`gallery-dl` 与 `ffmpeg`；也可以在界面中点击“安装 / 更新工具”。

## 验证与打包

```bash
npm test
npm run typecheck
npm run build
npm run dist
```

下载功能仅供保存你有权获取的内容。Cookie 由下载工具直接从本机浏览器读取，应用不会存储或上传 Cookie。
