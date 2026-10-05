# 设置页 Tab 切换设计

## 目标

设置页不再把工具、Codex、Hypit、浏览器、安全堆在同一屏；改为顶部 Tab，一次只显示一个区块。

## 方案

复用任务页 `task-tabs` 样式与交互：

| Tab id | 标签 | 说明 |
|--------|------|------|
| `tools` | 运行工具 | 下载/转码 CLI |
| `codex` | Codex | 视频分析连接与登录 |
| `hypit` | Hypit | 生成服务配置 |
| `browser` | 抖音浏览器 | 远程/本地浏览器与登录 |
| `security` | 安全 | 退出工作台 |

- 默认选中 `codex`
- `localStorage` 键：`social-video-workbench:settings-tab:v1`
- 各区块内部逻辑不变，仅外层改为单面板渲染
- 布局：单个 `panel` + Tab 栏 + 当前面板内容（取消双列 `settings-grid`）

## 非目标

- 不改各设置区块的业务 API
- 不新增顶级主导航项
