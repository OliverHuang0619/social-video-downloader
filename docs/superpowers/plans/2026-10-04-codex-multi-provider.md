# Codex Multi-Provider Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the workbench settings page switch Codex between official ChatGPT, direct providers (e.g. Tencent Token Plan), and a host CC Switch proxy, while always stashing official auth.

**Architecture:** Persist connection state in `config/codex-providers.json`. A pure helper module builds masked API views, provider templates, and `config.toml` fragments; `CodexService` applies them to `config/codex-home/.codex/` on boot and after settings changes. Analysis/remake keep using `codex exec` and pick up the new config on the next job.

**Tech Stack:** TypeScript, Node HTTP server, React 19, Vitest

**Spec:** `docs/superpowers/specs/2026-10-04-codex-multi-provider-design.md`

---

### File map

| File | Responsibility |
|------|----------------|
| `src/shared/types.ts` | Shared connection/provider/status types |
| `src/server/codex-connection.ts` | Load/save JSON, mask keys, templates, toml render, auth stash helpers |
| `src/server/codex.ts` | `applyConnection()`, mode-aware `status()` / `analysisConfig`, login only in official |
| `src/server/index.ts` | Connection + provider CRUD + test routes |
| `src/renderer/src/api.ts` | Client wrappers |
| `src/renderer/src/App.tsx` | Settings UI for modes/providers/proxy |
| `tests/codex-connection.test.ts` | Unit tests for helpers |
| `README.md` | Short multi-provider note |

---

### Task 1: Types + pure connection helpers (TDD)

**Files:**
- Create: `src/server/codex-connection.ts`
- Create: `tests/codex-connection.test.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add shared types**

In `src/shared/types.ts`, add:

```ts
export type CodexConnectionMode = 'official' | 'provider' | 'cc_switch'
export type CodexProviderTemplate = 'tencent_token_plan' | 'custom'

export interface CodexProvider {
  id: string
  name: string
  template?: CodexProviderTemplate
  baseUrl: string
  apiKey: string
  model: string
  reasoningEffort?: string
  wireApi: 'responses'
  requiresOpenaiAuth: boolean
}

export interface CodexConnectionConfig {
  mode: CodexConnectionMode
  activeProviderId?: string
  ccSwitchBaseUrl: string
  ccSwitchModel?: string
  ccSwitchReasoningEffort?: string
  providers: CodexProvider[]
}

export interface CodexProviderPublic extends Omit<CodexProvider, 'apiKey'> {
  apiKeyMasked: string
  apiKeyConfigured: boolean
}

export interface CodexConnectionPublic {
  mode: CodexConnectionMode
  activeProviderId?: string
  ccSwitchBaseUrl: string
  ccSwitchModel?: string
  ccSwitchReasoningEffort?: string
  providers: CodexProviderPublic[]
}

export interface CodexConnectionTestResult { ok: boolean; message: string }

// Extend CodexStatus:
export interface CodexStatus {
  available: boolean
  authenticated: boolean
  busy: boolean
  message: string
  model: string
  reasoningEffort: string
  mode: CodexConnectionMode
  connection?: CodexConnectionPublic
  usage?: CodexUsageStatus
  usageUnavailable?: boolean
  loginOutput?: string
  loginUrl?: string
  loginCode?: string
}
```

- [ ] **Step 2: Write failing tests** in `tests/codex-connection.test.ts`

Cover: default config; Tencent template fields; `maskApiKey` / `toPublicConnection`; merge provider update with empty apiKey keeps old key; `renderCodexToml` for official / provider / cc_switch; `modelsProbeUrl` avoids double `/v1`.

- [ ] **Step 3: Implement `src/server/codex-connection.ts`**

Export at minimum:

- `DEFAULT_CC_SWITCH_BASE_URL = 'http://host.docker.internal:15721/v1'`
- `defaultConnectionConfig()`
- `tencentTokenPlanTemplate(partial?)`
- `maskApiKey(key)`
- `toPublicConnection(config)`
- `mergeProviderUpdate(existing, patch)` — empty/omitted apiKey keeps existing
- `resolveActiveModel(config, envDefaults)` — official → env; provider → active provider; cc_switch → ccSwitchModel || active || env
- `renderCodexToml({ mode, provider?, ccSwitchBaseUrl?, model, reasoningEffort, previousToml })` — preserve non-provider lines where practical; always keep `cli_auth_credentials_store = "file"`; for provider/cc_switch emit `[model_providers.custom]` with `experimental_bearer_token` when key present (cc_switch may use `PROXY_MANAGED` or omit secret)
- `modelsProbeUrl(baseUrl)` — if base ends with `/v1`, append `/models`; else append `/v1/models` only if path lacks models
- `CodexConnectionStore` class: `load/save` under `path.join(SVD_CONFIG_DIR, 'codex-providers.json')`

For cc_switch toml: `requires_openai_auth = false`, `experimental_bearer_token = "PROXY_MANAGED"` (matches host CC Switch pattern).

For provider toml: `experimental_bearer_token = apiKey`, `requires_openai_auth` from provider.

For official toml: strip `model_provider` and `[model_providers.custom]` block; keep other project/plugin sections from `previousToml` if present, or write minimal file with `cli_auth_credentials_store`.

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/codex-connection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/server/codex-connection.ts tests/codex-connection.test.ts
git commit -m "$(cat <<'EOF'
feat(codex): add multi-provider connection helpers

EOF
)"
```

---

### Task 2: Wire CodexService apply + auth stash

**Files:**
- Modify: `src/server/codex.ts`
- Modify: `tests/core.test.ts` (or extend `tests/codex-connection.test.ts` with stash helpers if extracted)

- [ ] **Step 1: Auth stash helpers** in `codex-connection.ts`

```ts
export const OFFICIAL_AUTH_STASH = 'official-auth.stash.json'
export async function stashOfficialAuth(codexDir: string): Promise<void>
export async function restoreOfficialAuth(codexDir: string): Promise<boolean>
```

Copy `auth.json` → stash when leaving official (if auth exists). Restore stash → `auth.json` when entering official.

- [ ] **Step 2: Update `CodexService`**

- Hold `connectionStore = new CodexConnectionStore()`
- `async initialize()`: load connection, `await applyConnection()`
- `async applyConnection()`:
  1. Read current mode from disk
  2. If switching away from official (detect via whether custom provider currently in toml OR track last applied mode in memory): stash auth first when leaving official
  3. Write toml via `renderCodexToml`
  4. If mode official → restore stash
  5. If mode provider/cc_switch → do not delete stash; optionally remove live `auth.json` only after stash succeeded when leaving official (keep stash)
- `resolveRuntimeAnalysisConfig()`: use `resolveActiveModel` so `analysisArguments` use provider/cc_switch model
- `status()`: include `mode`, `connection: toPublicConnection(...)`, redefine `authenticated` as “current mode ready” (official: login status; provider: active provider has key; cc_switch: base URL non-empty); usage only when official + login ok
- `login()` / `logout()`: if mode !== official, no-op or throw clear Error「仅官方模式支持设备码登录」

- [ ] **Step 3: Tests for stash + resolveActiveModel**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(codex): apply connection modes and stash official auth

EOF
)"
```

---

### Task 3: HTTP API routes

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add routes**

```
GET    /api/codex/connection
PUT    /api/codex/connection
POST   /api/codex/providers
PUT    /api/codex/providers/:id
DELETE /api/codex/providers/:id
POST   /api/codex/connection/test
```

Validation:
- `mode=provider` requires `activeProviderId` pointing to a provider with configured key → else 400
- PUT connection updates mode / activeProviderId / ccSwitch* then `applyConnection()` + `changed('codex')`
- POST provider: create from body or `template: 'tencent_token_plan'`
- PUT provider: `mergeProviderUpdate`, save, if active apply
- DELETE: remove; if was active clear id; if mode was provider → set official + apply
- test: official → login status message; provider/cc_switch → fetch `modelsProbeUrl` with Authorization Bearer when key present; return `{ ok, message }`

- [ ] **Step 2: Smoke via typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(codex): expose connection and provider APIs

EOF
)"
```

---

### Task 4: Frontend settings UI

**Files:**
- Modify: `src/renderer/src/api.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify styles only if needed in existing CSS

- [ ] **Step 1: API client**

```ts
codex: {
  status: ...,
  login: ...,
  cancel: ...,
  logout: ...,
  connection: () => request<CodexConnectionPublic>('/api/codex/connection'),
  updateConnection: (value) => request('/api/codex/connection', { method: 'PUT', body: JSON.stringify(value) }),
  createProvider: (value) => post('/api/codex/providers', value),
  updateProvider: (id, value) => request(`/api/codex/providers/${id}`, { method: 'PUT', body: JSON.stringify(value) }),
  deleteProvider: (id) => request(`/api/codex/providers/${id}`, { method: 'DELETE' }),
  testConnection: (value?) => post<CodexConnectionTestResult>('/api/codex/connection/test', value || {}),
}
```

- [ ] **Step 2: Expand SettingsPage Codex section**

- Mode radio: 官方 / 直连供应商 / CC Switch 代理
- Provider list + form (name, baseUrl, apiKey placeholder showing mask, model, reasoningEffort)
- Buttons: 从腾讯模板新建、保存供应商、删除、设为当前
- CC Switch URL + model fields when mode is cc_switch (or always editable in subsection)
- 测试连通 + save feedback:「配置已保存，将在后续新任务中生效」
- Disable device login when mode !== official
- Show `codex.mode` in `CodexRuntimeStatus`

- [ ] **Step 3: Verify**

```bash
npm test
npm run typecheck
npm run build
```

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(settings): configure Codex providers in the UI

EOF
)"
```

---

### Task 5: README + manual check notes

**Files:**
- Modify: `README.md`

- [ ] Document three modes, Tencent template defaults, Docker `host.docker.internal` for CC Switch, official auth stash behavior.

- [ ] Commit docs.

---

### Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Modes official/provider/cc_switch | 1–4 |
| `codex-providers.json` + templates | 1, 3 |
| Key mask / empty=keep | 1, 3 |
| Official auth stash always | 2 |
| toml apply + experimental_bearer_token | 1–2 |
| New task effective only | 4 (UI copy) |
| Settings UI | 4 |
| APIs + test probe | 3 |
| DELETE active → official | 3 |
| README | 5 |
