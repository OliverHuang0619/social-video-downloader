# 工作台 Codex 多平台连接设计

## 目标

让工作台内的 Codex（视频分析与 Hypit 重新制作）可通过设置页切换连接方式，支持：

1. **官方 ChatGPT**：现有设备码登录（默认）
2. **直连供应商**：如腾讯 Token Plan 及其他 OpenAI Responses 兼容端点
3. **CC Switch 代理**：经宿主本机代理转发（Docker 下默认 `host.docker.internal:15721`）

官方 ChatGPT 额度用尽或希望使用第三方时，无需改环境变量或进容器改文件。

## 非目标

- 不在工作台内嵌自建 LLM 代理（不复刻 CC Switch）
- 不读取本机 `~/.cc-switch` 数据库
- 本期不支持 Chat Completions 协议转换（仅 `wire_api = "responses"`）
- 不中断已在运行的分析 / 重新制作任务以热切换配置（新任务生效）

## 连接模式

| 模式 | 说明 |
|------|------|
| `official` | ChatGPT OAuth / 设备码；使用 `auth.json` |
| `provider` | 使用当前选中供应商的 `base_url` + API Key + 模型 |
| `cc_switch` | Codex `base_url` 指向可配置的 CC Switch 代理 URL |

三种模式在设置页互斥切换；分析与 Hypit 共用同一套连接配置。

## 数据存储

文件：`config/codex-providers.json`（与 `config.json` 并列，落在 `SVD_CONFIG_DIR`）。

```ts
type CodexConnectionMode = 'official' | 'provider' | 'cc_switch'

interface CodexProvider {
  id: string
  name: string
  template?: 'tencent_token_plan' | 'custom'
  baseUrl: string
  apiKey: string              // 落盘明文；API 对外打码
  model: string
  reasoningEffort?: string    // 默认 medium
  wireApi: 'responses'
  requiresOpenaiAuth: boolean
}

interface CodexConnectionConfig {
  mode: CodexConnectionMode
  activeProviderId?: string
  ccSwitchBaseUrl: string     // 默认 http://host.docker.internal:15721/v1
  /** cc_switch 模式下使用的模型；可与供应商模板对齐 */
  ccSwitchModel?: string
  ccSwitchReasoningEffort?: string
  providers: CodexProvider[]
}
```

### 内置模板

- **腾讯 Token Plan**（`tencent_token_plan`）
  - 默认 `baseUrl`：`https://tokenhub.tencentmaas.com/plan/v3`
  - 默认模型示例：`tc-code-latest`（可改）
  - `wireApi: "responses"`，`requiresOpenaiAuth: true`（按供应商实际鉴权需求写入 Codex）
  - 新建时预填 URL / 模型，用户填写 API Key

用户可基于模板或空白自定义新增、编辑、删除供应商。允许 `providers` 为空；此时前端禁用切到 `provider` 模式，后端若收到 `mode=provider` 且无可用供应商则返回 400。

### 密钥对外语义

- GET 接口：不返回原始 `apiKey`；返回 `apiKeyMasked`（如 `••••` + 末 4 位，不足 4 位则仅 `••••`）与 `apiKeyConfigured: boolean`
- PUT/POST：`apiKey` 省略或空字符串均表示「不修改已存 Key」。本期不提供经 API 清空 Key；若需更换 Key，提交新的非空值覆盖。

### 环境变量关系

- `SVD_CODEX_MODEL` / `SVD_CODEX_REASONING_EFFORT`：在 **`official` 模式**下仍作为默认模型与推理强度
- `provider` / `cc_switch`：以连接配置中的模型与推理强度为准，写入 Codex 调用参数与 `config.toml`

## Codex 配置同步

工作区路径不变：`config/codex-home/.codex/`（`CODEX_HOME`）。

由 `CodexService`（或抽离的 `CodexConnectionStore`）在以下时机调用 `applyConnection()`：

- 服务启动 `initialize()`
- 切换模式 / 保存供应商 / 修改代理 URL 之后

### 官方登录保留（强制）

切离 `official` 前：若存在 `auth.json`，复制到：

`config/codex-home/.codex/official-auth.stash.json`

切回 `official`：将 stash 恢复为 `auth.json`（若 stash 存在）。不因切换第三方而丢弃官方登录。

### 各模式写入规则

**official**

- 恢复 stash → `auth.json`（如有）
- `config.toml` 移除自定义 `model_provider` / `[model_providers.custom]` 代理段落（或写回官方默认）
- 保留 `cli_auth_credentials_store = "file"`
- 模型来自环境变量默认或状态接口已有逻辑

**provider**

- 写入 `[model_providers.custom]`：`name`、`base_url`、`wire_api = "responses"`、`requires_openai_auth`
- 设置顶层 `model_provider = "custom"`、`model`、按需 `model_reasoning_effort`
- API Key 写入方式（锁定）：在 `[model_providers.custom]` 使用 `experimental_bearer_token = "<apiKey>"`；`requires_openai_auth` 按供应商字段写入。不覆盖 `official-auth.stash.json`；当前生效的 `auth.json` 在切离官方前已 stash，provider 模式可不依赖官方 tokens
- 不删除 `official-auth.stash.json`

**cc_switch**

- `base_url` = `ccSwitchBaseUrl`（默认 `http://host.docker.internal:15721/v1`）
- `requires_openai_auth = false`（代理侧管理上游鉴权；若探测失败可在 UI 提示检查宿主 CC Switch）
- 模型使用 `ccSwitchModel`（或活跃供应商模型作默认建议）
- 不删除官方 stash

### 任务生效时机

- 已在运行的分析 / remake **不**重读配置
- 前端在保存成功后提示：「配置已保存，将在后续新任务中生效」

## 前端（设置 → Codex）

在现有「Codex 视频分析」区块扩展，不新建顶级 Tab：

1. **连接模式**：官方 / 直连供应商 / CC Switch 代理（单选）
2. **供应商列表**（`provider` 模式主用；也可在管理区始终可编辑）
   - 选中当前、新增（模板或自定义）、编辑、删除
3. **表单字段**：名称、Base URL、API Key（打码）、模型、推理强度
4. **CC Switch**：代理 Base URL、可选模型、测试连通
5. **官方**：保留设备码登录 / 取消 / 退出；非 `official` 时禁用登录并说明当前模式
6. **测试连通**：调用后端探测，展示成功或错误摘要
7. 展示当前生效模型 / 推理强度 / 连接模式摘要（扩展现有 `CodexRuntimeStatus`）

## HTTP API

均需管理员会话（与现有 `/api/codex/*` 一致）。

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/api/codex/connection` | 返回模式、供应商列表（Key 打码）、代理 URL、当前 applied 摘要 |
| PUT | `/api/codex/connection` | 更新 mode / activeProviderId / ccSwitch* |
| POST | `/api/codex/providers` | 新建供应商 |
| PUT | `/api/codex/providers/:id` | 更新供应商（Key 留空不改） |
| DELETE | `/api/codex/providers/:id` | 删除；若 `id === activeProviderId` 则先将 `activeProviderId` 置空，若当前 `mode === 'provider'` 则自动回退到 `official` 并 `applyConnection()` |
| POST | `/api/codex/connection/test` | 对当前模式或指定 provider 做连通探测 |

现有 `/api/codex/status|login|logout` 保留；`status` 增加 `mode` 与打码后的连接摘要字段，便于设置页一次刷新。

### 连通探测

- `provider`：对 `baseUrl` 发轻量请求（优先 `GET .../models` 或 Codex/供应商文档推荐的探活路径）；校验 HTTP 成功或可识别的鉴权错误文案
- `cc_switch`：请求 `{ccSwitchBaseUrl}/models`（或 `/v1/models` 已含在 base 时避免重复）
- `official`：沿用 `codex login status` 或现有 status 逻辑，不必强行打外网 models

## 错误与状态展示

- 配置写入失败：API 返回明确错误，不留下半截 toml
- 第三方模式下 `codex login status` 可能非「已登录」：`authenticated` 语义改为「当前模式可用」——官方看 login status，provider 看 Key 已配置且 apply 成功，cc_switch 看代理 URL 已配置；用量条仅在 official 且能读到 rate limit 时显示
- 探测失败：前端显示后端返回的简短 `message`，不堆栈

## 测试

- 单元：连接配置读写、Key 打码与留空不改、官方 auth stash/restore、各模式生成的 `config.toml` 片段、腾讯模板预填
- 单元：删除 active provider 的防护逻辑
- 现有 Codex 登录解析 / analysisArguments 回归
- 手动：Docker 下切腾讯跑一次分析或 Hypit；切回官方确认无需重新设备码登录；CC Switch 开启时探测 `/v1/models`

## 实现约束

- 跟随现有设置页与 `CodexService` 风格；密钥不进 git、不进 SSE 明文
- `compose.yaml` 已有 `host.docker.internal:host-gateway`，cc_switch 默认 URL 依赖此配置
- 文档：在 README 设置/Codex 一节补充多平台说明与腾讯模板字段
