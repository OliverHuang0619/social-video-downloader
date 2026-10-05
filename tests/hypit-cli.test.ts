import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HypitConfigStore } from '../src/server/hypit-config'
import { HYPIT_PACKAGE_SPEC, HypitCliService, npmInstallArgs } from '../src/server/hypit-cli'

describe('Hypit CLI 检测与安装', () => {
  it('npm 安装参数固定为全局安装指定包版本', () => {
    expect(npmInstallArgs('@hypit/hypit@0.2.16')).toEqual([
      'install', '-g', '@hypit/hypit@0.2.16', '--no-fund', '--no-audit',
    ])
    expect(npmInstallArgs()).toEqual([
      'install', '-g', HYPIT_PACKAGE_SPEC, '--no-fund', '--no-audit',
    ])
  })

  it('status 合并配置与 CLI 探测字段', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hypit-cli-'))
    const store = new HypitConfigStore(dir)
    await store.update({ baseUrl: 'https://example.test', apiKey: 'key-abcd' })
    const service = new HypitCliService(store)
    const status = await service.status()
    expect(status.baseUrl).toBe('https://example.test')
    expect(status.apiKeyConfigured).toBe(true)
    expect(status.packageName).toBe(HYPIT_PACKAGE_SPEC)
    expect(typeof status.available).toBe('boolean')
    expect(typeof status.skillAvailable).toBe('boolean')
    expect(status.busy).toBe(false)
    expect(status.message).toBeTruthy()
    expect(status).not.toHaveProperty('apiKey')
  })
})
