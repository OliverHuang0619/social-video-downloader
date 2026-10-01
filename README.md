# Social Video Downloader

前后端分离的 Web 社交视频下载器。React 前端通过 REST API 与 Node.js 后端通信，扫描和下载进度通过 SSE 实时推送；生产环境中前后端由同一个容器提供服务。

支持多链接解析、YouTube 频道/播放列表、Instagram 帖子与 Reels 扫描、完整格式选择、QuickTime 兼容转换、浏览器下载到本地、批量选择和三并发下载。

解析单个视频后，可以在每一项的格式列表中选择“视频与音频”“仅视频”或“仅音频”流。标记为 `QuickTime` 的格式可直接播放；开启 QuickTime 模式后，其他视频编码会在下载完成后转换为 H.264/AAC。任务完成后点击“下载到本地”即可由浏览器保存文件。

## Docker 部署

Dockerfile 基于 Debian/Node 官方多架构镜像，可构建 `linux/amd64`（x86_64）和 `linux/arm64` 镜像。当前主机直接部署：

```bash
docker compose up -d --build
```

默认只监听服务器的 `127.0.0.1:3000`。可用 SSH 隧道访问：

```bash
ssh -L 3000:127.0.0.1:3000 user@server
```

然后打开 <http://127.0.0.1:3000>。如需公网访问，请在前面配置带身份验证和 HTTPS 的反向代理；本应用自身不提供用户认证，不应直接暴露到公网。

数据目录：

- `./downloads`：下载结果，对应容器内 `/downloads`
- `./config`：配置和可选 Cookie，对应容器内 `/config`

需要登录态时，将 Netscape 格式的 `cookies.txt` 放到 `./config/cookies.txt`，并在页面选择“服务器 cookies.txt”。请将该文件权限限制为仅部署用户可读，且不要提交到 Git。

## 多架构镜像交付

使用 Docker Buildx 构建并推送同一标签下的 amd64/arm64 manifest：

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/team/social-video-downloader:0.2.0 \
  --push .
```

本地单架构验证：

```bash
docker build -t social-video-downloader:local .
docker run --rm -p 127.0.0.1:3000:3000 \
  -v "$PWD/downloads:/downloads" \
  -v "$PWD/config:/config" \
  social-video-downloader:local
```

## 本地开发与验证

```bash
npm install
npm test
npm run typecheck
npm run build
npm start
```

开发模式当前会先构建前后端，再启动服务：

```bash
npm run dev
```

下载功能仅供保存你有权获取的内容。
