# Social Video 工作台

一个自托管的视频工作流：解析并下载 YouTube、Instagram 等平台视频，将完成文件登记到媒体库，使用 Codex 分析英文视频，再经人工审核后通过可见 Chromium 发布到抖音。

## 功能

- 多链接解析、频道/主页扫描、格式选择、三并发下载和 QuickTime 兼容转换
- 持久媒体库、目录导入、在线播放、搜索、分类和处理状态
- 手动批量启动 Codex 分析，生成中文标题、英文标题、话题、摘要和证据置信度
- 对媒体库所选视频启动 Hypit 原创重新制作：先产出可编辑工程，或在明确预算授权后生成成片并自动回库
- 抖音扫码登录、单条立即/定时发布、批量平台排期和本地定时发布
- 订阅新视频站内通知、页面打开时的系统通知，以及按浏览器设备启用的离线 Web Push
- 站内受保护的 noVNC 远程浏览器，用于扫码、验证码和人工检查
- SQLite 持久任务、发布历史和旧 `*-catalog-report` 自动导入
- 单管理员登录、CSRF、防暴力登录和受限文件访问

## Docker Compose 部署

要求 Docker 及 Compose v2。推荐使用快捷脚本；首次运行会创建持久目录，并交互设置管理员密码和生成 session secret：

```bash
./deploy.sh deploy
```

拉取基础镜像、清除构建缓存并重新部署（不会删除 `downloads`、`imports` 或 `config`）：

```bash
./deploy.sh redeploy
```

## 部署冒烟检查

运行 `npm run smoke:deployments` 可在隔离临时目录中构建并启动本地与 Docker 运行模式，检查健康接口、登录、订阅时区配置、Push 设备注册/撤销，以及进程重启后的配置和设备持久化。临时数据会在检查结束后清理。

## Cloudflare 部署（实验性）

Cloudflare 配置位于 `cloudflare/`，Worker 提供静态前端、订阅巡检 Cron/Queue 入口和容器代理；Cron 直接检查 D1 的下次巡检时间和到期任务，只在需要时投递队列，避免每分钟唤醒容器。运行中的下载、分析、制作、发布和订阅扫描会通过 Durable Object 活动租约续期，空闲后容器仍可休眠。容器镜像同时包含 Chromium/noVNC。需要 Cloudflare Workers Paid、已登录 Wrangler、Docker，以及可用的 Cloudflare Containers 账户权限。

先登录 Wrangler，然后运行资源初始化命令。脚本会按配置名称复用或创建 D1、R2 bucket 和 Queue，并自动把 D1 UUID 写入 Wrangler 配置。在 Cloudflare R2 中另建具备该 bucket 对象读写权限的 S3 API Token；初始化脚本会提示输入 Account ID 与这组凭据，用于生成浏览器直传/直下的一小时签名 URL：

```bash
npx wrangler login
npm run cloudflare:resources
```

资源创建后，运行初始化脚本并设置至少 12 字符的管理员密码；脚本会提示输入 R2 Account ID 与 S3 API 凭据，并自动生成其余密钥：

```bash
./cloudflare/set-secrets.sh
```

脚本会在 `cloudflare/.secrets.json` 生成权限为 `0600`、且已加入 Git 忽略的临时文件。首次运行 `npm run cloudflare:deploy` 时，Wrangler 会随 Worker 首次部署一起上传 Secrets；成功后临时文件会自动删除。后续部署会核对 Worker 已有的 Secret 名称并保留云端值。完整部署脚本先检查 Wrangler 登录、D1 ID、Docker 和必需 Secrets，再构建容器、应用 D1 迁移、配置 R2 CORS 并发布。日常发布前端和容器更新时可运行 `npm run cloudflare:publish`；它会重新构建项目并发布，不重复应用 D1 迁移或修改 CORS。Cloudflare 以全新安装启动，不会导入 Docker/本地数据。Cloudflare 容器磁盘仅作临时工作空间；业务表和任务状态使用 D1，视频写入 R2，浏览器上传、播放和下载使用 R2 签名 URL，Chromium 登录资料与 `/config` 中非 SQLite 文件会加密后备份至 R2。D1 迁移按版本向前应用；不要在生产环境手动删除或回滚迁移记录，应新增修复迁移。完成容器重启、队列重试与空账号首次部署的 Cloudflare 端到端验证前，此配置仍标记为实验性。Docker 服务器与本地部署仍使用上面的既有命令。

### 本地电脑浏览器模式

在 macOS 或 Linux 本机部署时，可以让发布器使用桌面上的 Chrome/Chromium，而不是 Browser 容器：

```bash
./deploy.sh deploy-local
```

脚本会启动一个可见的本地浏览器窗口，使用独立的 `config/local-browser-profile` 持久资料目录。Chrome 的 CDP 只监听 `127.0.0.1`；本地连接助手通过 64 位随机令牌鉴权后供 App 容器访问，未授权请求会被拒绝。首次使用需要在这个独立窗口中登录抖音。重新部署使用：

```bash
./deploy.sh redeploy-local
```

下载页提供 YouTube 与 Instagram Cookie 管理。可分别在工作台浏览器中打开平台并等待用户完成登录，再自动合并导出到 `config/cookies.txt`；也可手动粘贴 Netscape cookies.txt、浏览器扩展 JSON 或 `Cookie:` 请求头。查看功能默认隐藏 Cookie 值，只有用户明确点击后才显示完整文件。文件以仅当前用户可读写的权限保存，Cookie 内容不会写入服务日志。

如果没有自动找到浏览器，可设置 `LOCAL_BROWSER_BIN='/浏览器可执行文件路径'`。可以使用 `./local-browser.sh start|stop|status` 单独管理本地浏览器。服务器、NAS 或无人值守部署仍应使用默认的 Browser 容器模式。

查看状态与日志：

```bash
./deploy.sh status
./deploy.sh logs
```

非交互式首次部署可通过 `SVD_ADMIN_PASSWORD='强管理员密码' ./deploy.sh deploy` 提供密码。脚本会等待 App 与 Browser 健康检查，启动失败时输出相关容器日志。直接使用 Compose 仍然受支持。

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

视频分析默认固定使用 `gpt-5.6-sol` 和 `medium` 推理强度，避免 Codex CLI 的内置默认值升级后改变分析行为。如需要临时覆盖，可在部署时设置 `SVD_CODEX_MODEL` 和 `SVD_CODEX_REASONING_EFFORT`。

### Codex 多平台连接

设置页「Codex 视频分析」支持三种连接模式（分析与 Hypit 共用）：

1. **官方 ChatGPT**：设备码登录（默认）
2. **直连供应商**：如腾讯 Token Plan（模板预填 `https://tokenhub.tencentmaas.com/plan/v3` 与 `tc-code-latest`），填写 API Key 后切换
3. **CC Switch 代理**：默认 `http://host.docker.internal:15721/v1`（依赖 compose 的 `extra_hosts`）；供应商切换仍在宿主 CC Switch 完成

连接配置保存在 `config/codex-providers.json`。切换离开官方模式时会把 `auth.json` 备份为 `official-auth.stash.json`，切回官方可恢复，无需重新设备码登录。配置变更对**后续新任务**生效，不会中断正在运行的分析/重新制作。

### 首次登录抖音

进入“设置”，先打开“远程浏览器”，再点击“登录抖音”并在远程 Chromium 中扫码。登录态保存在 `config/douyin-profile`。遇到验证码、账号验证或风险控制时，任务会暂停等待人工处理，不会尝试绕过。

## 使用流程

1. 在“下载”页解析链接并创建下载任务。
2. 下载完成后，文件自动进入“媒体库”。也可导入 `/downloads` 或 `/imports` 中的目录。
3. 在媒体库选择视频并点击“分析”；已有结果需要显式点击“重新分析”。
4. 需要原创改编时点击“Hypit 重新制作”，填写创意方向。默认只建立原创方案与可编辑工程，不产生付费生成；生成成片必须明确填写预算或免费额度范围，并先在设置页配置 Hypit。
5. 审核标题、话题和摘要，选择单个或多个视频发布到抖音。
6. 在“任务”页查看分析、Hypit 制作和发布进度。

订阅巡检时区可在“设置 → 订阅巡检”配置 IANA 名称，默认 `Asia/Shanghai`。首次从设置页启用 Web Push 时，浏览器会请求通知权限；服务器公网访问需要 HTTPS，本地访问 `localhost` 可使用浏览器 Push API。每台设备可单独撤销。VAPID 密钥会自动生成并持久保存；也可通过 `SVD_VAPID_PUBLIC_KEY` 和 `SVD_VAPID_PRIVATE_KEY` 同时提供外部托管密钥。

Docker 镜像内置 Hypit CLI 与技能。Hypit 工程持久保存在 `config/hypit-projects`，成片写入 `downloads/remakes` 并自动进入媒体库。设置页「Hypit 生成服务」可检查/安装 Hypit CLI（缺失时通过 npm 安装与镜像同版本的 `@hypit/hypit`），并配置 `HYPIT_BASE_URL` 与 `HYPIT_API_KEY`（落盘于 `config/hypit.json`）；新建重新制作任务会自动写入工程 Runtime，并把变量注入任务进程。安装 CLI 本身不附带模型账号或额度。本地开发若技能不在默认容器路径，可用 `SVD_HYPIT_SKILL_FILE=/绝对路径/SKILL.md` 指定。

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
