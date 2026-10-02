# Social Video 工作台

一个自托管的视频工作流：解析并下载 YouTube、Instagram 等平台视频，将完成文件登记到媒体库，使用 Codex 分析英文视频，再经人工审核后通过可见 Chromium 发布到抖音。

## 功能

- 多链接解析、频道/主页扫描、格式选择、三并发下载和 QuickTime 兼容转换
- 持久媒体库、目录导入、在线播放、搜索、分类和处理状态
- 手动批量启动 Codex 分析，生成中文标题、英文标题、话题、摘要和证据置信度
- 抖音扫码登录、单条立即/定时发布、批量平台排期和本地定时发布
- 站内受保护的 noVNC 远程浏览器，用于扫码、验证码和人工检查
- SQLite 持久任务、发布历史和旧 `*-catalog-report` 自动导入
- 单管理员登录、CSRF、防暴力登录和受限文件访问

## Docker Compose 部署

要求 Docker 及 Compose v2。首次部署先创建持久目录和两个 secret：

```bash
mkdir -p downloads imports config
printf '%s' '替换为强管理员密码' > config/admin_password
openssl rand -hex 32 > config/session_secret
chmod 600 config/admin_password config/session_secret
docker compose up -d --build
```

默认只监听 `127.0.0.1:3000`。打开 <http://127.0.0.1:3000>，用 `config/admin_password` 中的密码登录。

局域网监听：

```bash
BIND_ADDRESS=0.0.0.0 docker compose up -d
```

公网部署必须使用 HTTPS 反向代理，并设置 `SVD_SECURE_COOKIE=true`。不要直接暴露 browser 服务的 6080 或 9222 端口。

### 持久目录

- `./downloads` → `/downloads`：下载结果和旧报告
- `./imports` → `/imports`：只读导入目录
- `./config` → `/config`：SQLite、Codex 登录态、分析产物、发布历史与抖音浏览器资料

这些目录可能包含账号凭据、Cookie 和未公开视频，应限制文件权限并纳入私密备份。

### 首次登录 Codex

进入“设置”，点击“设备代码登录”，按页面输出的地址与一次性代码完成 ChatGPT 登录。设备代码登录需要先在 ChatGPT 安全设置中启用；登录缓存保存在 `config/codex-home/.codex`。官方也支持先在可信机器登录后复制 `auth.json` 到无头环境。[OpenAI Codex 认证说明](https://learn.chatgpt.com/docs/auth)

### 首次登录抖音

进入“设置”，先打开“远程浏览器”，再点击“登录抖音”并在远程 Chromium 中扫码。登录态保存在 `config/douyin-profile`。遇到验证码、账号验证或风险控制时，任务会暂停等待人工处理，不会尝试绕过。

## 使用流程

1. 在“下载”页解析链接并创建下载任务。
2. 下载完成后，文件自动进入“媒体库”。也可导入 `/downloads` 或 `/imports` 中的目录。
3. 在媒体库选择视频并点击“分析”；已有结果需要显式点击“重新分析”。
4. 审核标题、话题和摘要，选择单个或多个视频发布到抖音。
5. 在“任务”页查看进度、失败原因、重试和历史。

真实发布前始终会出现最终确认。平台排期需至少提前 2 小时且不超过 7 天；本地定时至少提前 1 分钟，并要求服务持续运行。

## 旧数据迁移

首次启动会幂等扫描 `/downloads`：

- 导入已有视频与 `*-catalog-report/results.json`
- 导入 `publish-jobs.json` 发布历史
- 成功发布或排期的视频标为“已处理”，其余标为“未处理”
- 不移动、重命名或覆盖任何旧文件

迁移完成标记保存在 SQLite；需要重新迁移时应先备份并使用专门迁移工具，不要直接删除生产数据库。

## 本地开发与验证

```bash
npm install
npm test
npm run typecheck
npm run build
```

开发模式使用 `admin` 作为首次默认密码，仅适用于本机；生产模式缺少管理员密码或 session secret 时会拒绝启动。

```bash
npm run dev
```

Docker 配置检查与构建：

```bash
docker compose config
docker compose build
```

下载和发布功能仅用于你有权保存与发布的内容。请遵守来源平台、抖音平台条款和当地法律。
