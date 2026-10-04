import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  CodexConnectionConfig,
  CodexConnectionMode,
  CodexConnectionPublic,
  CodexProvider,
  CodexProviderPublic,
} from '../shared/types'

export const DEFAULT_CC_SWITCH_BASE_URL = 'http://host.docker.internal:15721/v1'
export const DEFAULT_CC_SWITCH_MODEL = 'tc-code-latest'
export const OFFICIAL_AUTH_STASH = 'official-auth.stash.json'
export const CONNECTION_FILE = 'codex-providers.json'

const TENCENT_BASE = 'https://tokenhub.tencentmaas.com/plan/v3'
const TENCENT_MODEL = 'tc-code-latest'

export function defaultConnectionConfig(): CodexConnectionConfig {
  return {
    mode: 'official',
    ccSwitchBaseUrl: DEFAULT_CC_SWITCH_BASE_URL,
    providers: [],
  }
}

export function tencentTokenPlanTemplate(partial: Partial<CodexProvider> = {}): CodexProvider {
  return {
    id: partial.id || randomUUID(),
    name: partial.name || '腾讯 Token Plan',
    template: 'tencent_token_plan',
    baseUrl: partial.baseUrl || TENCENT_BASE,
    apiKey: partial.apiKey || '',
    model: partial.model || TENCENT_MODEL,
    reasoningEffort: partial.reasoningEffort || 'high',
    wireApi: 'responses',
    requiresOpenaiAuth: partial.requiresOpenaiAuth ?? true,
  }
}

export function maskApiKey(key: string) {
  const value = key.trim()
  if (!value) return ''
  if (value.length <= 4) return '••••'
  return `••••${value.slice(-4)}`
}

export function toPublicProvider(provider: CodexProvider): CodexProviderPublic {
  const { apiKey, ...rest } = provider
  return {
    ...rest,
    apiKeyMasked: maskApiKey(apiKey),
    apiKeyConfigured: Boolean(apiKey.trim()),
  }
}

export function toPublicConnection(config: CodexConnectionConfig): CodexConnectionPublic {
  return {
    mode: config.mode,
    activeProviderId: config.activeProviderId,
    ccSwitchBaseUrl: config.ccSwitchBaseUrl,
    ccSwitchModel: config.ccSwitchModel,
    ccSwitchReasoningEffort: config.ccSwitchReasoningEffort,
    providers: config.providers.map(toPublicProvider),
  }
}

export function mergeProviderUpdate(existing: CodexProvider, patch: Partial<CodexProvider>): CodexProvider {
  const nextKey = patch.apiKey
  return {
    ...existing,
    ...patch,
    id: existing.id,
    wireApi: 'responses',
    apiKey: nextKey === undefined || nextKey === '' ? existing.apiKey : nextKey,
  }
}

export function resolveActiveModel(
  config: CodexConnectionConfig,
  envDefaults: { model: string; reasoningEffort: string },
): { model: string; reasoningEffort: string } {
  if (config.mode === 'provider') {
    const provider = config.providers.find(item => item.id === config.activeProviderId)
    if (provider) {
      return {
        model: provider.model || envDefaults.model,
        reasoningEffort: (provider.reasoningEffort || envDefaults.reasoningEffort).toLowerCase(),
      }
    }
  }
  if (config.mode === 'cc_switch') {
    const provider = config.providers.find(item => item.id === config.activeProviderId)
    return {
      model: config.ccSwitchModel || provider?.model || DEFAULT_CC_SWITCH_MODEL,
      reasoningEffort: (config.ccSwitchReasoningEffort || provider?.reasoningEffort || 'high').toLowerCase(),
    }
  }
  return envDefaults
}

export function modelsProbeUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/\/models$/i.test(trimmed)) return trimmed
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/models`
  return `${trimmed}/models`
}

function stripManagedSections(toml: string) {
  const withoutCustomBlock = toml
    .replace(/\n?\[model_providers\.custom\][\s\S]*?(?=\n\[|\s*$)/g, '\n')
    .replace(/\n?\[model_providers\]\s*(?=\n\[|\s*$)/g, '\n')
  return withoutCustomBlock
    .split('\n')
    .filter(line => {
      const trimmed = line.trim()
      return !/^model_provider\s*=/.test(trimmed)
        && !/^model\s*=/.test(trimmed)
        && !/^model_reasoning_effort\s*=/.test(trimmed)
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function ensureAuthStore(toml: string) {
  if (toml.includes('cli_auth_credentials_store')) return toml.endsWith('\n') ? toml : `${toml}\n`
  return `${toml}${toml && !toml.endsWith('\n') ? '\n' : ''}cli_auth_credentials_store = "file"\n`
}

function escapeTomlString(value: string) {
  return JSON.stringify(value)
}

export function renderCodexToml(input: {
  mode: CodexConnectionMode
  provider?: CodexProvider
  ccSwitchBaseUrl?: string
  model: string
  reasoningEffort: string
  previousToml?: string
}) {
  const preserved = ensureAuthStore(stripManagedSections(input.previousToml || ''))
  if (input.mode === 'official') return preserved

  if (input.mode === 'cc_switch') {
    const baseUrl = input.ccSwitchBaseUrl || DEFAULT_CC_SWITCH_BASE_URL
    const block = [
      `model = ${escapeTomlString(input.model)}`,
      `model_reasoning_effort = ${escapeTomlString(input.reasoningEffort)}`,
      'model_provider = "custom"',
      '',
      '[model_providers.custom]',
      'name = "cc_switch"',
      `base_url = ${escapeTomlString(baseUrl)}`,
      'wire_api = "responses"',
      'requires_openai_auth = false',
      'experimental_bearer_token = "PROXY_MANAGED"',
      '',
    ].join('\n')
    return `${block}${preserved.startsWith('cli_auth') || preserved.includes('cli_auth_credentials_store') ? preserved : ensureAuthStore(preserved)}`
  }

  const provider = input.provider
  if (!provider) throw new Error('直连模式需要选中供应商')
  const block = [
    `model = ${escapeTomlString(input.model)}`,
    `model_reasoning_effort = ${escapeTomlString(input.reasoningEffort)}`,
    'model_provider = "custom"',
    '',
    '[model_providers.custom]',
    `name = ${escapeTomlString(provider.name || 'custom')}`,
    `base_url = ${escapeTomlString(provider.baseUrl)}`,
    'wire_api = "responses"',
    `requires_openai_auth = ${provider.requiresOpenaiAuth ? 'true' : 'false'}`,
    ...(provider.apiKey.trim() ? [`experimental_bearer_token = ${escapeTomlString(provider.apiKey.trim())}`] : []),
    '',
  ].join('\n')
  return `${block}${preserved.includes('cli_auth_credentials_store') ? preserved : ensureAuthStore(preserved)}`
}

export async function stashOfficialAuth(codexDir: string) {
  const auth = path.join(codexDir, 'auth.json')
  const stash = path.join(codexDir, OFFICIAL_AUTH_STASH)
  try {
    await copyFile(auth, stash)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function restoreOfficialAuth(codexDir: string) {
  const auth = path.join(codexDir, 'auth.json')
  const stash = path.join(codexDir, OFFICIAL_AUTH_STASH)
  try {
    await copyFile(stash, auth)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function removeLiveAuth(codexDir: string) {
  try {
    await unlink(path.join(codexDir, 'auth.json'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function normalizeLoaded(raw: Partial<CodexConnectionConfig> | null | undefined): CodexConnectionConfig {
  const defaults = defaultConnectionConfig()
  if (!raw || typeof raw !== 'object') return defaults
  const mode = raw.mode === 'provider' || raw.mode === 'cc_switch' || raw.mode === 'official' ? raw.mode : 'official'
  const providers = Array.isArray(raw.providers)
    ? raw.providers.filter(Boolean).map(provider => ({
      id: String(provider.id || randomUUID()),
      name: String(provider.name || '未命名供应商'),
      template: provider.template === 'tencent_token_plan' ? 'tencent_token_plan' as const : provider.template === 'custom' ? 'custom' as const : undefined,
      baseUrl: String(provider.baseUrl || ''),
      apiKey: String(provider.apiKey || ''),
      model: String(provider.model || ''),
      reasoningEffort: provider.reasoningEffort ? String(provider.reasoningEffort) : undefined,
      wireApi: 'responses' as const,
      requiresOpenaiAuth: provider.requiresOpenaiAuth !== false,
    }))
    : []
  return {
    mode,
    activeProviderId: raw.activeProviderId ? String(raw.activeProviderId) : undefined,
    ccSwitchBaseUrl: String(raw.ccSwitchBaseUrl || DEFAULT_CC_SWITCH_BASE_URL),
    ccSwitchModel: raw.ccSwitchModel ? String(raw.ccSwitchModel) : undefined,
    ccSwitchReasoningEffort: raw.ccSwitchReasoningEffort ? String(raw.ccSwitchReasoningEffort) : undefined,
    providers,
  }
}

export class CodexConnectionStore {
  readonly file: string
  private data: CodexConnectionConfig = defaultConnectionConfig()

  constructor(configDir = process.env.SVD_CONFIG_DIR || '/config') {
    this.file = path.join(configDir, CONNECTION_FILE)
  }

  get() { return this.data }

  async load() {
    try {
      this.data = normalizeLoaded(JSON.parse(await readFile(this.file, 'utf8')) as Partial<CodexConnectionConfig>)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.data = defaultConnectionConfig()
    }
    return this.data
  }

  async save(next: CodexConnectionConfig) {
    this.data = normalizeLoaded(next)
    await mkdir(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, this.file)
    return this.data
  }
}
