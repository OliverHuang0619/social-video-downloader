import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HYPIT_BASE_URL,
  HYPIT_API_KEY_ENV,
  HYPIT_BASE_URL_ENV,
  HypitConfigStore,
  buildHypitRuntimeProfile,
  defaultHypitConfig,
  hypitProcessEnv,
  mergeHypitConfigUpdate,
  toPublicHypitConfig,
} from '../src/server/hypit-config'
import { maskApiKey } from '../src/server/codex-connection'

describe('Hypit 全局配置', () => {
  it('默认 baseUrl 为 HypiHub', () => {
    expect(defaultHypitConfig()).toEqual({ baseUrl: DEFAULT_HYPIT_BASE_URL, apiKey: '' })
  })

  it('公开视图打码且不暴露原始 Key', () => {
    const publicView = toPublicHypitConfig({ baseUrl: DEFAULT_HYPIT_BASE_URL, apiKey: 'sk-secret-key-9999' })
    expect(publicView).toEqual({
      baseUrl: DEFAULT_HYPIT_BASE_URL,
      apiKeyMasked: maskApiKey('sk-secret-key-9999'),
      apiKeyConfigured: true,
    })
    expect(publicView).not.toHaveProperty('apiKey')
  })

  it('更新时空 Key 不覆盖已有值', () => {
    const existing = { baseUrl: 'https://old.example', apiKey: 'keep-me' }
    expect(mergeHypitConfigUpdate(existing, { baseUrl: 'https://new.example', apiKey: '' }).apiKey).toBe('keep-me')
    expect(mergeHypitConfigUpdate(existing, { baseUrl: 'https://new.example' }).apiKey).toBe('keep-me')
    expect(mergeHypitConfigUpdate(existing, { apiKey: 'fresh' }).apiKey).toBe('fresh')
    expect(mergeHypitConfigUpdate(existing, { baseUrl: 'https://new.example' }).baseUrl).toBe('https://new.example')
  })

  it('Runtime Profile 使用 env 凭据并保留本地渲染 endpoint', () => {
    const profile = buildHypitRuntimeProfile('https://custom.hypit.example')
    expect(profile.format).toBe('hypit.runtime-local@1')
    expect(profile.credentials.env).toEqual({ use: '@hypit/credential-store-env' })
    expect(profile.endpoints['hypihub.default']).toMatchObject({
      use: '@hypit/provider-hypihub',
      config: {
        baseUrl: 'https://custom.hypit.example',
        apiKey: { store: 'env', key: HYPIT_API_KEY_ENV },
      },
    })
    expect(profile.endpoints['media.local']).toEqual({ use: '@hypit/provider-media-local' })
    expect(profile.endpoints['hyperframes.local']).toEqual({ use: '@hypit/provider-hyperframes-local' })
  })

  it('进程环境注入 BASE_URL，仅在有 Key 时注入 API Key', () => {
    expect(hypitProcessEnv({ baseUrl: 'https://x.example', apiKey: '' })).toEqual({
      [HYPIT_BASE_URL_ENV]: 'https://x.example',
    })
    expect(hypitProcessEnv({ baseUrl: 'https://x.example', apiKey: 'secret' })).toEqual({
      [HYPIT_BASE_URL_ENV]: 'https://x.example',
      [HYPIT_API_KEY_ENV]: 'secret',
    })
  })

  it('可持久化到 config/hypit.json', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hypit-config-'))
    const store = new HypitConfigStore(dir)
    await store.load()
    expect(store.publicView().apiKeyConfigured).toBe(false)
    await store.update({ baseUrl: 'https://saved.example', apiKey: 'saved-key-1234' })
    const raw = JSON.parse(await readFile(path.join(dir, 'hypit.json'), 'utf8')) as { baseUrl: string; apiKey: string }
    expect(raw).toEqual({ baseUrl: 'https://saved.example', apiKey: 'saved-key-1234' })
    const reloaded = new HypitConfigStore(dir)
    await reloaded.load()
    expect(reloaded.publicView()).toMatchObject({
      baseUrl: 'https://saved.example',
      apiKeyConfigured: true,
      apiKeyMasked: '••••1234',
    })
    await reloaded.update({ baseUrl: 'https://kept-key.example', apiKey: '' })
    expect(reloaded.get().apiKey).toBe('saved-key-1234')
  })
})
