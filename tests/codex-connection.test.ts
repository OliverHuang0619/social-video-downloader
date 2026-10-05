import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CC_SWITCH_BASE_URL,
  defaultConnectionConfig,
  maskApiKey,
  mergeProviderUpdate,
  modelsProbeUrl,
  renderCodexToml,
  resolveActiveModel,
  restoreOfficialAuth,
  stashOfficialAuth,
  tencentTokenPlanTemplate,
  toPublicConnection,
  TENCENT_TOKEN_PLAN_BASE_URL,
  normalizeProviderBaseUrl,
} from '../src/server/codex-connection'
import { isCodexProviderModeSelectable, shouldShowCodexProvidersManager } from '../src/shared/codex-connection-ui'

describe('Codex 连接面板可见性', () => {
  it('任意模式下都展示供应商管理，避免 CC Switch 下无法新建直连供应商', () => {
    expect(shouldShowCodexProvidersManager('cc_switch')).toBe(true)
    expect(shouldShowCodexProvidersManager('official')).toBe(true)
    expect(shouldShowCodexProvidersManager('provider')).toBe(true)
  })

  it('供应商为空时仍可选中直连模式，以便展示新建入口', () => {
    expect(isCodexProviderModeSelectable(0)).toBe(true)
    expect(isCodexProviderModeSelectable(2)).toBe(true)
  })
})

describe('Codex 多平台连接辅助', () => {
  it('默认配置为官方模式', () => {
    expect(defaultConnectionConfig()).toMatchObject({
      mode: 'official',
      ccSwitchBaseUrl: DEFAULT_CC_SWITCH_BASE_URL,
      providers: [],
    })
  })

  it('腾讯 Token Plan 模板预填端点与模型', () => {
    const provider = tencentTokenPlanTemplate()
    expect(provider).toMatchObject({
      template: 'tencent_token_plan',
      baseUrl: TENCENT_TOKEN_PLAN_BASE_URL,
      model: 'tc-code-latest',
      wireApi: 'responses',
      requiresOpenaiAuth: true,
      apiKey: '',
    })
    expect(provider.id).toBeTruthy()
  })

  it('把腾讯云产品介绍页改写成 Token Plan API 地址', () => {
    expect(normalizeProviderBaseUrl('https://cloud.tencent.com/product/tokenhub')).toBe(TENCENT_TOKEN_PLAN_BASE_URL)
    expect(normalizeProviderBaseUrl('https://cloud.tencent.com/document/product/1823/130666', 'tencent_token_plan')).toBe(TENCENT_TOKEN_PLAN_BASE_URL)
    expect(normalizeProviderBaseUrl('https://tokenhub.tencentmaas.com/plan/v3/')).toBe(TENCENT_TOKEN_PLAN_BASE_URL)
    expect(mergeProviderUpdate(
      tencentTokenPlanTemplate({ id: 'p1', apiKey: 'x', baseUrl: TENCENT_TOKEN_PLAN_BASE_URL }),
      { baseUrl: 'https://cloud.tencent.com/product/tokenhub' },
    ).baseUrl).toBe(TENCENT_TOKEN_PLAN_BASE_URL)
  })

  it('打码 API Key 并生成公开视图', () => {
    expect(maskApiKey('')).toBe('')
    expect(maskApiKey('abcd')).toBe('••••')
    expect(maskApiKey('sk-1234567890')).toBe('••••7890')
    const publicView = toPublicConnection({
      mode: 'provider',
      activeProviderId: 'p1',
      ccSwitchBaseUrl: DEFAULT_CC_SWITCH_BASE_URL,
      providers: [tencentTokenPlanTemplate({ id: 'p1', apiKey: 'sk-secret-key-9999' })],
    })
    expect(publicView.providers[0]).toMatchObject({
      id: 'p1',
      apiKeyMasked: '••••9999',
      apiKeyConfigured: true,
    })
    expect(publicView.providers[0]).not.toHaveProperty('apiKey')
  })

  it('更新供应商时留空 Key 不覆盖', () => {
    const existing = tencentTokenPlanTemplate({ id: 'p1', apiKey: 'keep-me', model: 'old' })
    expect(mergeProviderUpdate(existing, { model: 'new', apiKey: '' }).apiKey).toBe('keep-me')
    expect(mergeProviderUpdate(existing, { model: 'new' }).apiKey).toBe('keep-me')
    expect(mergeProviderUpdate(existing, { apiKey: 'fresh' }).apiKey).toBe('fresh')
  })

  it('按模式解析生效模型', () => {
    const env = { model: 'gpt-5.6-sol', reasoningEffort: 'medium' }
    const provider = tencentTokenPlanTemplate({ id: 'p1', model: 'tc-code-latest', reasoningEffort: 'high', apiKey: 'x' })
    expect(resolveActiveModel({ mode: 'official', ccSwitchBaseUrl: DEFAULT_CC_SWITCH_BASE_URL, providers: [provider] }, env)).toEqual(env)
    expect(resolveActiveModel({
      mode: 'provider',
      activeProviderId: 'p1',
      ccSwitchBaseUrl: DEFAULT_CC_SWITCH_BASE_URL,
      providers: [provider],
    }, env)).toEqual({ model: 'tc-code-latest', reasoningEffort: 'high' })
    expect(resolveActiveModel({
      mode: 'cc_switch',
      activeProviderId: 'p1',
      ccSwitchBaseUrl: DEFAULT_CC_SWITCH_BASE_URL,
      ccSwitchModel: 'proxy-model',
      ccSwitchReasoningEffort: 'low',
      providers: [provider],
    }, env)).toEqual({ model: 'proxy-model', reasoningEffort: 'low' })
    expect(resolveActiveModel({
      mode: 'cc_switch',
      ccSwitchBaseUrl: DEFAULT_CC_SWITCH_BASE_URL,
      providers: [],
    }, env)).toEqual({ model: 'tc-code-latest', reasoningEffort: 'high' })
  })

  it('生成 models 探测 URL 且避免重复 v1', () => {
    expect(modelsProbeUrl('http://127.0.0.1:15721/v1')).toBe('http://127.0.0.1:15721/v1/models')
    expect(modelsProbeUrl('http://127.0.0.1:15721/v1/')).toBe('http://127.0.0.1:15721/v1/models')
    expect(modelsProbeUrl('https://tokenhub.tencentmaas.com/plan/v3')).toBe('https://tokenhub.tencentmaas.com/plan/v3/models')
    expect(modelsProbeUrl('https://example.com/v1/models')).toBe('https://example.com/v1/models')
  })

  it('渲染官方 / 供应商 / CC Switch 的 config.toml', () => {
    const previous = 'cli_auth_credentials_store = "file"\n\n[projects."/tmp"]\ntrust_level = "trusted"\n'
    const official = renderCodexToml({
      mode: 'official',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      previousToml: `${previous}\nmodel_provider = "custom"\nmodel = "x"\n\n[model_providers.custom]\nbase_url = "http://x"\n`,
    })
    expect(official).toContain('cli_auth_credentials_store = "file"')
    expect(official).toContain('[projects."/tmp"]')
    expect(official).not.toContain('model_provider')
    expect(official).not.toContain('[model_providers.custom]')

    const provider = tencentTokenPlanTemplate({ apiKey: 'sk-test', name: 'Tencent' })
    const providerToml = renderCodexToml({
      mode: 'provider',
      provider,
      model: provider.model,
      reasoningEffort: 'high',
      previousToml: previous,
    })
    expect(providerToml).toContain('model_provider = "custom"')
    expect(providerToml).toContain('base_url = "https://tokenhub.tencentmaas.com/plan/v3"')
    expect(providerToml).toContain('experimental_bearer_token = "sk-test"')
    expect(providerToml).toContain('requires_openai_auth = true')
    expect(providerToml).toContain('[projects."/tmp"]')

    const proxyToml = renderCodexToml({
      mode: 'cc_switch',
      ccSwitchBaseUrl: 'http://host.docker.internal:15721/v1',
      model: 'tc-code-latest',
      reasoningEffort: 'high',
      previousToml: previous,
    })
    expect(proxyToml).toContain('base_url = "http://host.docker.internal:15721/v1"')
    expect(proxyToml).toContain('requires_openai_auth = false')
    expect(proxyToml).toContain('experimental_bearer_token = "PROXY_MANAGED"')
  })

  it('官方 auth stash 与 restore', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'codex-auth-'))
    await writeFile(path.join(dir, 'auth.json'), '{"auth_mode":"chatgpt"}')
    await stashOfficialAuth(dir)
    await writeFile(path.join(dir, 'auth.json'), '{"auth_mode":"gone"}')
    expect(await restoreOfficialAuth(dir)).toBe(true)
    expect(await readFile(path.join(dir, 'auth.json'), 'utf8')).toBe('{"auth_mode":"chatgpt"}')
  })
})
