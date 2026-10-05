# Creator Subscriptions Design

## 目标

支持订阅 YouTube / Instagram 博主，按可配置的每日时刻巡检是否有新视频；发现新内容时始终写入站内通知并可触发浏览器系统通知，可选自动入队下载。

## 非目标

- 邮件、Webhook、离线 Web Push / Service Worker
- 外部 cron / Bull 等独立调度栈
- 订阅级画质与容器偏好（复用全局下载配置）
- 可配置浅扫深度、多实例分布式锁

## 方案

进程内 `SubscriptionService`，调度模式对齐 `PublisherService`（`scheduleWake` + 15s safety timer + 启动 resume）。扫描复用 `MediaService`（浅扫最多 30 条），下载复用 `DownloadQueue`，实时更新走现有 SSE。

## 决策

| 项 | 选择 |
|----|------|
| 通知 vs 自动下载 | 通知始终开启；`auto_download` 为额外开关 |
| 首次订阅 | 基线快照：当前条目写入 seen，不通知、不下载 |
| 巡检时间 | 设置页可配置 HH:MM；时区用容器 `TZ`（默认 Asia/Shanghai） |
| 浅扫上限 | 固定 30 |

## 数据模型

SQLite（`workbench.sqlite`）：

- `creator_subscriptions` — id, platform, source_url (UNIQUE), display_name, auto_download, enabled, last_polled_at, last_error, created_at, updated_at
- `subscription_seen_items` — (subscription_id, media_key) PK；`media_key` 优先 `MediaItem.id`，否则 `source_url`
- `subscription_notifications` — id, subscription_id, media_key, title, source_url, thumbnail, download_job_id, read_at, created_at

调度状态存 `app_meta`：`subscription_poll_hour` / `minute` / `enabled` / `last_poll_at` / `next_poll_at`。

## 巡检流程

1. 启动时 `resume`：按配置计算下次唤醒
2. 到点或手动 `POST /api/subscriptions/poll`：单飞锁跑一轮
3. 对每个 enabled 订阅浅扫 → 与 seen 求差
4. 新条目：写入 notification；若 `auto_download` 则 `DownloadQueue.start`（库内已有同 `source_url` 则跳过入队）
5. 新条目写入 seen；更新 last_polled_at；SSE `subscriptions`
6. 单订阅失败记 `last_error`，不阻断其余；结束后排下次

订阅创建时立即浅扫一次只写基线 seen。

## 通知

- **站内**：持久未读列表 + 顶栏铃铛角标；API 列表 / 标记已读
- **浏览器**：页面打开且已授权时，经 SSE 触发 `Notification` API；拒绝权限则仅用站内中心

## API

| 方法 | 路径 | 作用 |
|------|------|------|
| GET/POST | `/api/subscriptions` | 列表 / 新增 |
| PATCH/DELETE | `/api/subscriptions/:id` | 更新 / 删除 |
| POST | `/api/subscriptions/poll` | 立即巡检 |
| GET/PATCH | `/api/subscriptions/schedule` | 读/写巡检时间 |
| GET | `/api/subscriptions/notifications` | 通知列表 |
| POST | `/api/subscriptions/notifications/read` | 标记已读 |

## UI

- 下载页子模式「订阅」：添加 URL、列表（自动下载 / 启用、上次巡检、错误、删除）
- 设置：巡检时刻、总开关、立即巡检
- 顶栏铃铛：未读角标与通知面板

## 错误与边界

- 仅 youtube / Instagram 主页类 URL（`detectPlatform`）
- Cookie 失效：该订阅记失败并可见错误，不静默吞掉
- 浅扫上限 30，用户不可配
