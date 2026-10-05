import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { HypitConfig, HypitConfigPublic } from '../shared/types'
import { maskApiKey } from './codex-connection'

export const DEFAULT_HYPIT_BASE_URL = 'https://hypit.ai'
export const HYPIT_CONFIG_FILE = 'hypit.json'
export const HYPIT_API_KEY_ENV = 'HYPIT_API_KEY'
export const HYPIT_BASE_URL_ENV = 'HYPIT_BASE_URL'

export function defaultHypitConfig(): HypitConfig {
  return { baseUrl: DEFAULT_HYPIT_BASE_URL, apiKey: '' }
}

export function normalizeHypitConfig(value?: Partial<HypitConfig> | null): HypitConfig {
  const defaults = defaultHypitConfig()
  return {
    baseUrl: String(value?.baseUrl || '').trim() || defaults.baseUrl,
    apiKey: String(value?.apiKey || ''),
  }
}

export function toPublicHypitConfig(config: HypitConfig): HypitConfigPublic {
  return {
    baseUrl: config.baseUrl,
    apiKeyMasked: maskApiKey(config.apiKey),
    apiKeyConfigured: Boolean(config.apiKey.trim()),
  }
}

export function mergeHypitConfigUpdate(existing: HypitConfig, patch: Partial<HypitConfig>): HypitConfig {
  const nextKey = patch.apiKey
  return normalizeHypitConfig({
    baseUrl: patch.baseUrl !== undefined ? patch.baseUrl : existing.baseUrl,
    apiKey: nextKey === undefined || nextKey === '' ? existing.apiKey : nextKey,
  })
}

export function buildHypitRuntimeProfile(baseUrl: string) {
  return {
    format: 'hypit.runtime-local@1',
    dataRoot: '.hypit/runtimes/local',
    credentials: {
      env: { use: '@hypit/credential-store-env' },
      platform: { use: '@hypit/credential-store-platform' },
    },
    endpoints: {
      'hypihub.default': {
        use: '@hypit/provider-hypihub',
        config: {
          baseUrl: baseUrl.trim() || DEFAULT_HYPIT_BASE_URL,
          apiKey: { store: 'env', key: HYPIT_API_KEY_ENV },
        },
      },
      'media.local': { use: '@hypit/provider-media-local' },
      'hyperframes.local': { use: '@hypit/provider-hyperframes-local' },
    },
  }
}

export function hypitProcessEnv(config: HypitConfig): Record<string, string> {
  const env: Record<string, string> = {
    [HYPIT_BASE_URL_ENV]: config.baseUrl.trim() || DEFAULT_HYPIT_BASE_URL,
  }
  if (config.apiKey.trim()) env[HYPIT_API_KEY_ENV] = config.apiKey
  return env
}

export class HypitConfigStore {
  readonly file: string
  private data: HypitConfig = defaultHypitConfig()

  constructor(configDir = process.env.SVD_CONFIG_DIR || '/config') {
    this.file = path.join(configDir, HYPIT_CONFIG_FILE)
  }

  get() { return this.data }

  publicView() { return toPublicHypitConfig(this.data) }

  async load() {
    try {
      this.data = normalizeHypitConfig(JSON.parse(await readFile(this.file, 'utf8')) as Partial<HypitConfig>)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.data = defaultHypitConfig()
    }
    return this.data
  }

  async save(next: HypitConfig) {
    this.data = normalizeHypitConfig(next)
    await mkdir(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, this.file)
    return this.data
  }

  async update(patch: Partial<HypitConfig>) {
    return this.save(mergeHypitConfigUpdate(this.data, patch))
  }
}
