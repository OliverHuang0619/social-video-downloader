import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { CookieSource, DownloadJob, DownloadOptions, MediaItem, ToolName, ToolStatus, ToolUpdateEvent } from '../../shared/types'
import './tool-progress.css'
import './download-progress.css'

const initialOptions: DownloadOptions = { mode: 'video', quality: 'best', container: 'mp4', audioFormat: 'mp3', audioBitrate: '192', outputRoot: '', cookieSource: 'none' }
const formatDuration = (value: number) => value ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '—'
const statusLabel = { queued: '等待中', downloading: '下载中', completed: '已完成', skipped: '已存在', failed: '失败', cancelled: '已取消' }
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error:\s*/, '')
const toolLabels: Record<ToolName, string> = { 'yt-dlp': 'yt-dlp', 'gallery-dl': 'gallery-dl', ffmpeg: 'FFmpeg' }
const toolNames: ToolName[] = ['yt-dlp', 'gallery-dl', 'ffmpeg']
const formatBytes = (value?: number) => value === undefined ? '' : value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${(value / 1024).toFixed(0)} KB`
const formatEta = (seconds?: number) => seconds === undefined || !Number.isFinite(seconds) ? '' : seconds >= 3600 ? `${Math.ceil(seconds / 3600)} 小时` : seconds >= 60 ? `${Math.ceil(seconds / 60)} 分钟` : `${Math.ceil(seconds)} 秒`

const ToolProgressPanel = memo(function ToolProgressPanel({ progress, updating, ready, onUpdate, onClose }: { progress: Partial<Record<ToolName, ToolUpdateEvent>>; updating: boolean; ready: boolean; onUpdate(): void; onClose(): void }) {
  return <section className="tool-panel" aria-live="polite">
    <div className="tool-panel-head"><div><strong>运行工具</strong><p>{updating ? '正在准备本地下载环境' : ready ? '全部工具已就绪' : '有工具需要安装或检查'}</p></div><button onClick={onClose} aria-label="关闭">×</button></div>
    <div className="tool-progress-list">{toolNames.map(name => {
      const item = progress[name]
      const isActive = item && ['checking', 'downloading', 'installing', 'verifying'].includes(item.phase)
      return <div className={`tool-progress-row ${item?.phase || ''}`} key={name}>
        <span className="tool-state">{item?.phase === 'done' ? '✓' : item?.phase === 'error' ? '!' : isActive ? '↻' : '·'}</span>
        <div className="tool-progress-copy"><div><strong>{toolLabels[name]}</strong><span>{item?.message || '等待检查'}</span></div>
          <div className="tool-progress-track"><i className={item?.progress == null && isActive ? 'indeterminate' : ''} style={item?.progress == null ? undefined : { width: `${item.progress}%` }} /></div>
          {item?.phase === 'downloading' && item.receivedBytes !== undefined ? <small>{formatBytes(item.receivedBytes)}{item.totalBytes ? ` / ${formatBytes(item.totalBytes)} · ${item.progress}%` : ' 已下载'}{item.speedBytesPerSecond ? ` · ${formatBytes(item.speedBytesPerSecond)}/s` : ''}{item.etaSeconds ? ` · 约剩 ${formatEta(item.etaSeconds)}` : ''}</small> : item?.detail ? <small title={item.detail}>{item.detail}</small> : null}
        </div>
      </div>
    })}</div>
    <div className="tool-panel-foot"><span>工具只安装到本机应用目录</span><button onClick={onUpdate} disabled={updating}>{updating ? '更新中…' : ready ? '检查更新' : '重试安装'}</button></div>
  </section>
})

const MediaRow = memo(function MediaRow({ item, onToggle }: { item: MediaItem; onToggle(id: string): void }) {
  const rowRef = useRef<HTMLElement>(null)
  const [thumbnail, setThumbnail] = useState('')
  useEffect(() => {
    if (!item.thumbnail || !rowRef.current) return
    let active = true
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      void window.downloader.thumbnails.load(item.thumbnail).then(value => { if (active && value) setThumbnail(value) })
    }, { rootMargin: '120px' })
    observer.observe(rowRef.current)
    return () => { active = false; observer.disconnect() }
  }, [item.thumbnail])
  return <article ref={rowRef} className={`media-row ${item.selected ? 'selected' : ''}`}>
    <label className="check"><input type="checkbox" checked={item.selected} onChange={() => onToggle(item.id)} /><span /></label>
    <div className="thumb">{thumbnail ? <img src={thumbnail} alt="" /> : <div className="thumb-empty">▶</div>}<small>{formatDuration(item.duration)}</small></div>
    <div className="media-copy"><strong title={item.title}>{item.title}</strong><p>{item.uploader || '未知作者'} · {item.platform.toUpperCase()}</p></div>
  </article>
})

function App() {
  const [mode, setMode] = useState<'links' | 'creator'>('links'); const [input, setInput] = useState(''); const [items, setItems] = useState<MediaItem[]>([])
  const [options, setOptions] = useState(initialOptions); const [jobs, setJobs] = useState<DownloadJob[]>([]); const [tools, setTools] = useState<ToolStatus | null>(null)
  const [busy, setBusy] = useState(false); const [scanning, setScanning] = useState(false); const [message, setMessage] = useState(''); const [showAbout, setShowAbout] = useState(false)
  const [toolUpdating, setToolUpdating] = useState(false); const [toolPanelOpen, setToolPanelOpen] = useState(false); const [toolProgress, setToolProgress] = useState<Partial<Record<ToolName, ToolUpdateEvent>>>({})
  const deferredItems = useDeferredValue(items)
  useEffect(() => { void Promise.all([window.downloader.tools.status(), window.downloader.destination.current(), window.downloader.app.platform()]).then(([status, outputRoot]) => { setTools(status); setOptions(v => ({ ...v, outputRoot })); setToolProgress(Object.fromEntries(status.tools.map(tool => [tool.name, { tool: tool.name, phase: tool.available ? 'done' : 'checking', progress: tool.available ? 100 : 0, message: tool.available ? tool.version || '已就绪' : '尚未安装' }])) as Partial<Record<ToolName, ToolUpdateEvent>>) }) }, [])
  useEffect(() => window.downloader.tools.onProgress(event => setToolProgress(current => ({ ...current, [event.tool]: event }))), [])
  useEffect(() => window.downloader.downloads.onProgress(setJobs), [])
  useEffect(() => window.downloader.creator.onProgress(event => {
    if (event.type === 'item') setItems(current => current.some(i => i.id === event.item.id && i.platform === event.item.platform) ? current : [...current, event.item])
    if (event.type === 'status') setMessage(event.message)
    if (event.type === 'done') { setScanning(false); setMessage(`扫描完成，共发现 ${event.count} 个视频`) }
    if (event.type === 'error') { setScanning(false); setMessage(event.message) }
  }), [])
  const selected = useMemo(() => items.filter(i => i.selected), [items]); const activeCount = jobs.filter(j => ['queued', 'downloading'].includes(j.status)).length
  const analyze = async () => { setMessage(''); if (!input.trim()) return; setBusy(true); setItems([]); try { const urls = input.split(/\r?\n/).filter(Boolean); setItems(await window.downloader.source.analyze({ urls, cookieSource: options.cookieSource })); setMessage(`已解析 ${urls.length} 个链接`) } catch (e) { setMessage(errorMessage(e)) } finally { setBusy(false) } }
  const scan = async () => { setItems([]); setMessage('正在开始扫描…'); setScanning(true); try { await window.downloader.creator.scan({ url: input, cookieSource: options.cookieSource }) } catch (e) { setScanning(false); setMessage(errorMessage(e)) } }
  const toggle = useCallback((id: string) => setItems(current => current.map(i => i.id === id ? { ...i, selected: !i.selected } : i)), [])
  const selectAll = (value: boolean) => setItems(current => current.map(i => ({ ...i, selected: value })))
  const chooseFolder = async () => { const value = await window.downloader.destination.pick(); if (value) setOptions(v => ({ ...v, outputRoot: value })) }
  const start = async () => { if (!selected.length) return; setJobs(await window.downloader.downloads.start({ items: selected, options })) }
  const updateTools = async () => { if (toolUpdating) return; setToolPanelOpen(true); setToolUpdating(true); setMessage(''); setToolProgress(current => Object.fromEntries(toolNames.map(name => [name, current[name]?.phase === 'done' ? current[name] : { tool: name, phase: 'checking', progress: 0, message: '等待处理' }])) as Partial<Record<ToolName, ToolUpdateEvent>>); try { const status = await window.downloader.tools.update(); setTools(status); setMessage(status.ready ? '运行工具已就绪，可以开始解析' : '仍有工具不可用，请打开工具面板查看详情') } catch (e) { setMessage(`工具更新失败：${errorMessage(e)}`) } finally { setToolUpdating(false) } }
  return <div className="app-shell">
    <header><div className="brand"><div className="brand-mark">↓</div><div><h1>视频收集器</h1><p>本地解析与下载，不上传任何内容</p></div></div><div className="header-actions"><button className={`tool-pill ${tools?.ready ? 'ok' : ''} ${toolUpdating ? 'updating' : ''}`} onClick={() => tools?.ready || toolUpdating ? setToolPanelOpen(value => !value) : void updateTools()}>{toolUpdating ? '正在更新工具…' : tools?.ready ? '工具已就绪' : '安装 / 更新工具'}</button><button className="icon-btn" onClick={() => setShowAbout(true)} aria-label="关于">ⓘ</button></div>{toolPanelOpen ? <ToolProgressPanel progress={toolProgress} updating={toolUpdating} ready={Boolean(tools?.ready)} onUpdate={updateTools} onClose={() => setToolPanelOpen(false)} /> : null}</header>
    <main>
      <section className="source-panel">
        <div className="segmented"><button className={mode === 'links' ? 'active' : ''} onClick={() => setMode('links')}>链接下载</button><button className={mode === 'creator' ? 'active' : ''} onClick={() => setMode('creator')}>博主主页</button></div>
        <textarea value={input} onChange={e => setInput(e.target.value)} placeholder={mode === 'links' ? '粘贴一个或多个视频链接，每行一个…' : '粘贴 YouTube 频道或 Instagram 博主主页链接…'} rows={mode === 'links' ? 4 : 2} />
        <div className="source-actions"><div className="cookie"><label>登录 Cookie</label><select value={options.cookieSource} onChange={e => setOptions(v => ({ ...v, cookieSource: e.target.value as CookieSource }))}><option value="none">不使用</option><option value="chrome">Chrome</option><option value="edge">Edge</option><option value="brave">Brave</option><option value="firefox">Firefox</option><option value="safari">Safari（macOS）</option></select></div>
          {mode === 'links' ? <button className="primary" onClick={analyze} disabled={busy}>{busy ? '正在解析…' : '解析链接'}</button> : scanning ? <button className="danger" onClick={() => window.downloader.creator.stop()}>停止扫描</button> : <button className="primary" onClick={scan}>扫描主页</button>}
        </div>{message ? <p className="message">{message}</p> : null}
      </section>
      <section className="workspace">
        <div className="results">
          <div className="section-head"><div><h2>待下载视频</h2><p>{items.length ? `${selected.length} / ${items.length} 项已选择` : '解析后的视频会显示在这里'}</p></div>{items.length ? <div className="tiny-actions"><button onClick={() => selectAll(true)}>全选</button><button onClick={() => selectAll(false)}>取消全选</button></div> : null}</div>
          <div className="media-list">{deferredItems.length ? deferredItems.map(item => <MediaRow key={`${item.platform}-${item.id}`} item={item} onToggle={toggle} />) : <div className="empty"><span>⌁</span><strong>还没有视频</strong><p>从上方粘贴链接并开始解析</p></div>}</div>
        </div>
        <aside className="settings">
          <div className="section-head"><div><h2>下载设置</h2><p>应用到本次选择</p></div></div>
          <label>输出目录</label><button className="folder" onClick={chooseFolder}><span>▣</span><b title={options.outputRoot}>{options.outputRoot || '选择目录'}</b></button>
          <label>内容类型</label><div className="choice"><button className={options.mode === 'video' ? 'active' : ''} onClick={() => setOptions(v => ({ ...v, mode: 'video' }))}>视频</button><button className={options.mode === 'audio' ? 'active' : ''} onClick={() => setOptions(v => ({ ...v, mode: 'audio' }))}>仅音频</button></div>
          {options.mode === 'video' ? <><label>视频质量</label><select value={options.quality} onChange={e => setOptions(v => ({ ...v, quality: e.target.value as DownloadOptions['quality'] }))}>{['best','2160','1440','1080','720','480'].map(v => <option key={v} value={v}>{v === 'best' ? '最佳质量' : `${v}p 以内`}</option>)}</select><label>封装格式</label><select value={options.container} onChange={e => setOptions(v => ({ ...v, container: e.target.value as 'mp4' | 'mkv' }))}><option value="mp4">MP4</option><option value="mkv">MKV</option></select></> : <><label>音频格式</label><select value={options.audioFormat} onChange={e => setOptions(v => ({ ...v, audioFormat: e.target.value as 'mp3' | 'm4a' }))}><option value="mp3">MP3</option><option value="m4a">M4A</option></select><label>音频码率</label><select value={options.audioBitrate} onChange={e => setOptions(v => ({ ...v, audioBitrate: e.target.value as '128'|'192'|'320' }))}><option value="128">128 kbps</option><option value="192">192 kbps</option><option value="320">320 kbps</option></select></>}
          <button className="download" disabled={!selected.length || !options.outputRoot} onClick={start}>下载 {selected.length || ''} 个项目</button>
        </aside>
      </section>
      {jobs.length ? <section className="queue"><div className="section-head"><div><h2>下载队列</h2><p>{activeCount ? `${activeCount} 项进行中 · 最多并发 3 项` : '队列已暂停或完成'}</p></div><button onClick={() => window.downloader.downloads.cancel()}>全部停止</button></div><div className="job-list">{jobs.map(job => <div className="job" key={job.id}><div className="job-top"><strong>{job.item.title}</strong><span className={`status ${job.status}`}>{statusLabel[job.status]}</span></div><div className="bar"><i className={job.status === 'downloading' && job.progress === 0 ? 'indeterminate' : ''} style={job.progress ? { width: `${job.progress}%` } : undefined} /></div><div className="job-meta"><span>{job.progress.toFixed(1)}% · {job.speed || '—'} · {job.eta && job.eta !== 'NA' ? `剩余 ${job.eta}` : '—'}</span><div>{job.status === 'failed' || job.status === 'cancelled' ? <button onClick={() => window.downloader.downloads.retry(job.id)}>重试</button> : null}{job.status === 'downloading' || job.status === 'queued' ? <button onClick={() => window.downloader.downloads.cancel(job.id)}>取消</button> : null}{job.outputPath ? <button onClick={() => window.downloader.destination.open(job.outputPath!)}>打开文件夹</button> : null}</div></div>{job.detail ? <p className="job-detail">{job.detail}</p> : null}{job.error ? <p className="job-error">{job.error}</p> : null}</div>)}</div></section> : null}
    </main>
    {showAbout ? <div className="modal-backdrop" onMouseDown={() => setShowAbout(false)}><div className="modal" onMouseDown={e => e.stopPropagation()}><button className="modal-close" onClick={() => setShowAbout(false)}>×</button><h2>关于视频收集器</h2><p>所有解析与下载都在本机完成。请仅下载你有权保存的内容，并遵守相关平台条款与当地法律。</p><h3>第三方工具</h3><ul><li>yt-dlp · Unlicense</li><li>gallery-dl · GPL-2.0</li><li>FFmpeg · LGPL/GPL（依构建配置）</li></ul></div></div> : null}
  </div>
}
export default App
