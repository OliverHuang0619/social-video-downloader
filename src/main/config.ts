import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { CookieSource, DownloadOptions } from '../shared/types'

interface AppConfig { outputRoot: string; cookieSource: CookieSource; options: Omit<DownloadOptions, 'outputRoot' | 'cookieSource'> }
const defaults: AppConfig = {
  outputRoot: path.join(os.homedir(), 'Downloads'), cookieSource: 'none',
  options: { mode: 'video', quality: 'best', container: 'mp4', audioFormat: 'mp3', audioBitrate: '192' }
}

export class ConfigStore {
  private file = path.join(app.getPath('userData'), 'config.json')
  private data: AppConfig = structuredClone(defaults)
  async load() {
    try { this.data = { ...defaults, ...JSON.parse(await readFile(this.file, 'utf8')) } } catch { /* first run */ }
    return this.data
  }
  get() { return this.data }
  async patch(value: Partial<AppConfig>) {
    this.data = { ...this.data, ...value }
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(this.data, null, 2))
  }
}
