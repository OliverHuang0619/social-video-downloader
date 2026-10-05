import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { AnalysisJob, BrowserStatus, CodexConnectionPublic, CodexProviderPublic, CodexStatus, CookieFileView, CookieManagerStatus, CookiePlatform, DownloadJob, DownloadOptions, HypitStatus, MediaAsset, MediaFileHash, MediaFileMetadata, MediaFormat, MediaFormatKind, MediaItem, PublishBatch, QuickTimeQuality, RemakeJob, ToolStatus } from '../../shared/types'
import { automaticPlatformPublishTimes, filterMediaAssets, mediaAssetDirectory, normalizePublishTopics, type LibraryStateFilter } from '../../shared/core'
import { api, onEvent, type WorkbenchEvent } from './api'
import './styles.css'
import './task-tabs.css'
import './compact-library.css'

type Tab = 'download' | 'library' | 'tasks' | 'settings'
type TaskTab = 'analysis' | 'remake' | 'publisher'
const NAVIGATION_STORAGE_KEY = 'social-video-workbench:navigation:v1'
const TASK_TAB_STORAGE_KEY = 'social-video-workbench:task-tab:v1'
const LIBRARY_DIRECTORY_STORAGE_KEY = 'social-video-workbench:library-directory:v1'
const tabs = new Set<Tab>(['download', 'library', 'tasks', 'settings'])
const taskTabs = new Set<TaskTab>(['analysis', 'remake', 'publisher'])
function storedChoice<T extends string>(key: string, allowed: Set<T>, fallback: T) {
  try { const value = window.localStorage.getItem(key) as T | null; return value && allowed.has(value) ? value : fallback } catch { return fallback }
}
function storedValue(key: string, fallback: string) { try { return window.localStorage.getItem(key) || fallback } catch { return fallback } }
const initialOptions: DownloadOptions = { mode: 'video', quality: 'best', container: 'mp4', audioFormat: 'mp3', audioBitrate: '192', outputRoot: '', cookieSource: 'file', quickTimeCompatible: true, quickTimeQuality: '1080' }
const quickTimeQualities: Array<{ value: QuickTimeQuality; label: string }> = [
  { value: '1080', label: '1080p（推荐，省内存更快）' },
  { value: 'original', label: '保持原始分辨率' },
  { value: '720', label: '720p（最小体积）' },
]
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const formatDuration = (value?: number) => value ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '—'
const formatBytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`
const formatGroups: Record<MediaFormatKind, string> = { 'video-audio': '视频与音频', 'video-only': '仅视频', 'audio-only': '仅音频' }
const formatLabel = (format: MediaFormat) => `${format.height ? `${format.height}p` : format.bitrate ? `${Math.round(format.bitrate)}kbps` : '音频'} · ${format.ext.toUpperCase()}${format.quickTimeCompatible ? ' · QuickTime' : ''}`
const taskNames: Record<string, string> = { queued: '等待中', downloading: '下载中', skipped: '已跳过', preparing: '准备媒体', analyzing: '分析中', directing: '创意制作中', building: '生成成片中', completed: '已完成', failed: '失败', cancelled: '已取消', waiting_local: '本地等待', running: '执行中', launching: '启动浏览器', uploading: '上传中', scheduling: '设置排期', waiting_covers: '等待横竖封面', submitting: '提交中', published: '已发布', scheduled: '已排期', needs_login: '需要登录', needs_attention: '需要检查', interrupted: '已中断', partial: '部分完成' }
const confidenceNames: Record<string, string> = { high: '高', medium: '中', low: '低' }
type LibraryViewFilter = LibraryStateFilter | 'remade'
const stateNames: Record<LibraryViewFilter, string> = { unprocessed: '未处理', processed: '已处理', 'awaiting-analysis': '等待分析', remade: '已重新制作', all: '全部' }
const stateOrder: LibraryViewFilter[] = ['unprocessed', 'processed', 'awaiting-analysis', 'remade', 'all']

/* ---------------------------------------------------------------- toast */

type Toast = { id: number; message: string; tone: 'ok' | 'bad' }
const toastListeners = new Set<(toast: Toast) => void>()
let toastSequence = 0
function toast(message: string, tone: Toast['tone'] = 'ok') { const item = { id: ++toastSequence, message, tone }; toastListeners.forEach(listener => listener(item)) }
async function copyText(value: string, label: string) {
  try { await navigator.clipboard.writeText(value); toast(`已复制${label}`) } catch { toast('复制失败，请手动选择文本', 'bad') }
}
function Toaster() {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => {
    const listener = (item: Toast) => { setItems(current => [...current.slice(-2), item]); window.setTimeout(() => setItems(current => current.filter(value => value.id !== item.id)), 2400) }
    toastListeners.add(listener)
    return () => { toastListeners.delete(listener) }
  }, [])
  return <div className="toaster" aria-live="polite">{items.map(item => <div className={`toast ${item.tone}`} key={item.id}>{item.message}</div>)}</div>
}

/* ---------------------------------------------------------------- login */

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState(''), [message, setMessage] = useState('')
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setMessage(''); try { await api.auth.login(password); onLogin() } catch (error) { setMessage(errorText(error)) } }
  return <main className="login-page">
    <form className="login-card" onSubmit={submit}>
      <div className="brand-mark">▶</div>
      <h1>Social Video 工作台</h1>
      <p>把视频从下载一路送到抖音发布</p>
      <div className="stage-list" aria-hidden="true"><span>下载</span><i /><span>分析</span><i /><span>审核</span><i /><span>发布</span></div>
      <label>管理员密码<input type="password" autoFocus value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button className="primary wide" type="submit">登录</button>
      {message ? <p className="error">{message}</p> : null}
    </form>
  </main>
}

/* ------------------------------------------------------------- download */

const MediaResult = memo(function MediaResult({ item, toggle, format }: { item: MediaItem; toggle: (id: string) => void; format: (id: string, value: string) => void }) {
  return <article className={`download-item ${item.selected ? 'selected' : ''}`}>
    <input type="checkbox" checked={item.selected} onChange={() => toggle(item.id)} aria-label={`选择 ${item.title}`} />
    {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <div className="placeholder">▶</div>}
    <div>
      <strong title={item.title}>{item.title}</strong>
      <small>{item.uploader || '未知作者'} · <span className="data">{formatDuration(item.duration)}</span></small>
      {item.formats?.length ? <select value={item.selectedFormatId} onChange={event => format(item.id, event.target.value)} aria-label="下载格式">
        {(['video-audio', 'video-only', 'audio-only'] as MediaFormatKind[]).map(kind => { const list = item.formats!.filter(value => value.kind === kind); return list.length ? <optgroup key={kind} label={formatGroups[kind]}>{list.map(value => <option key={value.id} value={value.id}>{formatLabel(value)}</option>)}</optgroup> : null })}
      </select> : null}
    </div>
  </article>
})

const cookiePlatformNames: Record<CookiePlatform, string> = { youtube: 'YouTube', instagram: 'Instagram' }

function CookieManager({ cookieSource, setCookieSource }: { cookieSource: 'none' | 'file'; setCookieSource: (value: 'none' | 'file') => void }) {
  const [status, setStatus] = useState<CookieManagerStatus | null>(null)
  const [dialog, setDialog] = useState<'manage' | 'view'>()
  const [platform, setPlatform] = useState<CookiePlatform>('youtube')
  const [contents, setContents] = useState('')
  const [view, setView] = useState<CookieFileView | null>(null)
  const [message, setMessage] = useState('')
  const loadStatus = useCallback(() => { void api.cookies.status().then(setStatus).catch(error => setMessage(errorText(error))) }, [])
  useEffect(loadStatus, [loadStatus])
  useEffect(() => {
    if (!status?.runningPlatform) return
    const timer = window.setInterval(loadStatus, 1500)
    return () => window.clearInterval(timer)
  }, [loadStatus, status?.runningPlatform])
  const update = async (target: CookiePlatform) => {
    setMessage(''); setCookieSource('file')
    try { setStatus(await api.cookies.update(target)) } catch (error) { setMessage(errorText(error)) }
  }
  const submitManual = async () => {
    setMessage('')
    try { setStatus(await api.cookies.manual(platform, contents)); setCookieSource('file'); setContents(''); toast(`已保存 ${cookiePlatformNames[platform]} Cookie`) } catch (error) { setMessage(errorText(error)) }
  }
  const openView = async (reveal = false) => {
    setMessage('')
    try { setView(await api.cookies.view(reveal)); setDialog('view') } catch (error) { setMessage(errorText(error)) }
  }
  const running = Boolean(status?.runningPlatform)
  const chipTone = (value: CookiePlatform) => { const item = status?.platforms[value]; if (!item) return ''; if (item.running) return 'run'; if (item.status === 'error') return 'bad'; return item.cookieCount || item.status === 'ready' ? 'ok' : '' }
  const chipText = (value: CookiePlatform) => { const item = status?.platforms[value]; if (!item) return '检查中'; if (item.running) return '登录中…'; if (item.status === 'error') return '出错'; return item.cookieCount ? `${item.cookieCount} 条` : '未保存' }
  return <>
    <div className="cookie-row">
      <label className="check"><input type="checkbox" checked={cookieSource === 'file'} onChange={event => setCookieSource(event.target.checked ? 'file' : 'none')} />使用已保存的登录 Cookie</label>
      {(['youtube', 'instagram'] as CookiePlatform[]).map(value => <span className={`chip ${chipTone(value)}`} key={value} title={status?.platforms[value]?.message}>{cookiePlatformNames[value]} <em>{chipText(value)}</em></span>)}
      <button type="button" className="ghost" onClick={() => { setMessage(''); setDialog('manage') }}>管理 Cookie</button>
    </div>
    {dialog === 'manage' ? <div className="modal-bg" role="dialog" aria-modal="true" aria-label="管理登录 Cookie" onMouseDown={() => setDialog(undefined)}>
      <div className="modal cookie-modal" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-head"><h2>登录 Cookie</h2><p>用于解析需要登录才能访问的视频。Cookie 保存在服务器 config/cookies.txt，不会写入日志。</p></div>
        <div className="cookie-platforms">{(['youtube', 'instagram'] as CookiePlatform[]).map(value => {
          const item = status?.platforms[value]
          return <div className="cookie-platform" key={value}>
            <strong>{cookiePlatformNames[value]}</strong>
            <div className={`status ${item?.status === 'error' ? 'error' : ''}`}><span>{item?.message || '检查中…'}</span>{item?.updatedAt ? <small>更新于 {new Date(item.updatedAt).toLocaleString()}</small> : null}</div>
            <button type="button" disabled={running} onClick={() => void update(value)}>{item?.running ? '等待登录…' : '在浏览器中登录'}</button>
          </div>
        })}</div>
        <div className="cookie-manual">
          <h3>手动粘贴</h3>
          <p className="hint">只会替换所选平台的 Cookie，另一个平台和其他域名的数据会保留。</p>
          <label>平台<select value={platform} onChange={event => setPlatform(event.target.value as CookiePlatform)}><option value="youtube">YouTube</option><option value="instagram">Instagram</option></select></label>
          <label>Cookie 内容<textarea rows={8} value={contents} onChange={event => setContents(event.target.value)} placeholder="支持 Netscape cookies.txt、浏览器扩展导出的 JSON，或 Cookie: name=value; name2=value2" /></label>
        </div>
        {message ? <p className="error">{message}</p> : null}
        <div className="modal-foot">
          <button type="button" className="ghost" onClick={() => void openView()}>查看已保存的 Cookie</button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => setDialog(undefined)}>关闭</button>
          <button type="button" className="primary" disabled={!contents.trim() || running} onClick={() => void submitManual()}>保存粘贴内容</button>
        </div>
      </div>
    </div> : null}
    {dialog === 'view' && view ? <div className="modal-bg" role="dialog" aria-modal="true" aria-label="查看 Cookie" onMouseDown={() => setDialog('manage')}>
      <div className="modal cookie-view" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-head"><h2>已保存的 Cookie</h2><p>{view.entries.length} 条{view.updatedAt ? ` · 更新于 ${new Date(view.updatedAt).toLocaleString()}` : ''}</p></div>
        <p className="warning">Cookie 可用于登录账号，请勿发送给其他人。默认只显示名称；仅在确有需要时显示完整值。</p>
        {view.raw ? <textarea rows={16} readOnly value={view.raw} /> : <div className="cookie-entry-list">{view.entries.length ? view.entries.map((entry, index) => <div className="cookie-entry" key={`${entry.domain}-${entry.path}-${entry.name}-${index}`}><strong>{entry.name}</strong><span>{entry.platform} · {entry.domain}</span><small>{entry.expires ? `到期 ${new Date(entry.expires * 1000).toLocaleString()}` : '会话 Cookie'}{entry.httpOnly ? ' · HttpOnly' : ''}{entry.secure ? ' · Secure' : ''}</small></div>) : <p className="muted">当前没有 Cookie。</p>}</div>}
        <div className="modal-foot">
          <button className="ghost" onClick={() => void openView(!view.raw)}>{view.raw ? '隐藏完整值' : '显示完整值'}</button>
          <span style={{ flex: 1 }} />
          <button disabled={!view.raw} onClick={() => view.raw && void copyText(view.raw, 'Cookie 文件')}>复制完整文件</button>
          <button onClick={() => setDialog('manage')}>返回</button>
        </div>
      </div>
    </div> : null}
  </>
}

function DownloadPage({ jobs, setJobs }: { jobs: DownloadJob[]; setJobs: (jobs: DownloadJob[]) => void }) {
  const [mode, setMode] = useState<'links' | 'creator'>('links'), [input, setInput] = useState(''), [items, setItems] = useState<MediaItem[]>([]), [options, setOptions] = useState(initialOptions), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [queueView, setQueueView] = useState<'active' | 'failed' | 'all'>('active')
  const deferred = useDeferredValue(items), selected = useMemo(() => items.filter(item => item.selected), [items])
  useEffect(() => { void Promise.all([api.destination.current(), api.downloads.list()]).then(([outputRoot, history]) => { setOptions(value => ({ ...value, outputRoot })); if (history.length) setJobs(history) }) }, [setJobs])
  useEffect(() => onEvent(raw => { const event = raw as WorkbenchEvent; if (event.type === 'downloads') setJobs(event.jobs); if (event.type === 'creator') { const update = event.event; if (update.type === 'item') setItems(current => current.some(item => item.id === update.item.id) ? current : [...current, update.item]); if (update.type === 'status') setMessage(update.message); if (update.type === 'done') { setBusy(false); setMessage(`扫描完成，共 ${update.count} 个视频`) } if (update.type === 'error') { setBusy(false); setMessage(update.message) } } }), [setJobs])
  const analyze = async () => { if (!input.trim()) return; setBusy(true); setMessage(''); try { const urls = input.split(/\r?\n/).map(value => value.trim()).filter(Boolean); setItems(await api.source.analyze(urls, options.cookieSource)); setMessage(`已解析 ${urls.length} 个链接`) } catch (error) { setMessage(errorText(error)) } finally { setBusy(false) } }
  const scan = async () => { setItems([]); setBusy(true); setMessage('正在扫描主页…'); try { await api.creator.scan(input, options.cookieSource) } catch (error) { setBusy(false); setMessage(errorText(error)) } }
  const toggle = useCallback((id: string) => setItems(current => current.map(item => item.id === id ? { ...item, selected: !item.selected } : item)), [])
  const format = useCallback((id: string, value: string) => setItems(current => current.map(item => item.id === id ? { ...item, selectedFormatId: value } : item)), [])
  const setCookieSource = useCallback((cookieSource: 'none' | 'file') => setOptions(value => ({ ...value, cookieSource })), [])
  const start = async () => { try { setJobs(await api.downloads.start({ items: selected, options })); toast(`已创建 ${selected.length} 个下载任务`); setMessage('下载完成后会自动进入媒体库') } catch (error) { setMessage(errorText(error)) } }
  const allSelected = items.length > 0 && selected.length === items.length
  const newestFirst = useMemo(() => [...jobs].reverse(), [jobs])
  const active = newestFirst.filter(job => ['queued', 'downloading'].includes(job.status)), failedJobs = newestFirst.filter(job => job.status === 'failed')
  const finished = jobs.length - active.length
  const visibleJobs = queueView === 'all' ? newestFirst : queueView === 'failed' ? failedJobs : active
  const retry = async (id?: string) => { try { const result = await api.downloads.retry(id); toast(id ? '已重新加入队列，将复用本地已下载的部分' : `已重试 ${result.count} 个失败任务`) } catch (error) { toast(errorText(error), 'bad') } }
  return <div className="page-stack">
    <section className="panel source">
      <div className="source-head">
        <div className="segmented" role="tablist" aria-label="来源类型"><button role="tab" aria-selected={mode === 'links'} className={mode === 'links' ? 'active' : ''} onClick={() => setMode('links')}>视频链接</button><button role="tab" aria-selected={mode === 'creator'} className={mode === 'creator' ? 'active' : ''} onClick={() => setMode('creator')}>博主主页</button></div>
        <CookieManager cookieSource={options.cookieSource} setCookieSource={setCookieSource} />
      </div>
      <textarea rows={4} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && input.trim() && !busy) void (mode === 'links' ? analyze() : scan()) }} placeholder={mode === 'links' ? '粘贴 YouTube 或 Instagram 视频链接，每行一个' : '粘贴 YouTube 频道或 Instagram 主页地址'} aria-label={mode === 'links' ? '视频链接' : '博主主页地址'} />
      <div className="source-foot">
        <p className="hint">{mode === 'links' ? '解析后可逐个选择画质与格式；⌘/Ctrl + Enter 快速解析' : '扫描会列出该主页的全部视频，结果逐条出现'}</p>
        <button className="primary" disabled={busy || !input.trim()} onClick={() => void (mode === 'links' ? analyze() : scan())}>{busy ? '处理中…' : mode === 'links' ? '解析链接' : '扫描主页'}</button>
      </div>
      {message ? <p className="notice">{message}</p> : null}
    </section>
    <section className="split">
      <div className="panel">
        <div className="panel-head">
          <div><h2>待下载</h2><p>{selected.length} / {items.length} 已选</p></div>
          {items.length ? <button className="ghost" onClick={() => setItems(current => current.map(item => ({ ...item, selected: !allSelected })))}>{allSelected ? '取消全选' : '全选'}</button> : null}
        </div>
        <div className="result-list">{deferred.length ? deferred.map(item => <MediaResult key={`${item.platform}-${item.id}`} item={item} toggle={toggle} format={format} />) : <div className="empty"><strong>还没有解析结果</strong>在上方粘贴链接或主页地址，解析后在这里勾选要下载的视频</div>}</div>
      </div>
      <aside className="panel settings-card">
        <h2>下载设置</h2>
        <label>视频质量<select value={options.quality} onChange={event => setOptions(value => ({ ...value, quality: event.target.value as DownloadOptions['quality'] }))}>{['best', '2160', '1440', '1080', '720', '480'].map(value => <option key={value} value={value}>{value === 'best' ? '最佳质量' : `${value}p 以内`}</option>)}</select></label>
        <label>封装格式<select value={options.container} onChange={event => setOptions(value => ({ ...value, container: event.target.value as 'mp4' | 'mkv' }))}><option>mp4</option><option>mkv</option></select></label>
        <label className="check"><input type="checkbox" checked={options.quickTimeCompatible} onChange={event => setOptions(value => ({ ...value, quickTimeCompatible: event.target.checked }))} />QuickTime 兼容转换</label>
        {options.quickTimeCompatible ? <label>转换画质<select value={options.quickTimeQuality || '1080'} onChange={event => setOptions(value => ({ ...value, quickTimeQuality: event.target.value as QuickTimeQuality }))}>{quickTimeQualities.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <span className="hint">{options.quickTimeQuality === 'original' ? '4K 源文件转换需要约 2.5 GB 内存，耗时较长；只在确实需要原始分辨率时选择' : '仅在源文件不是 H.264/AAC 时才会转换；分辨率低于上限的视频不会被放大'}</span></label> : null}
        <button className="primary wide" disabled={!selected.length} onClick={() => void start()}>{selected.length ? `下载 ${selected.length} 个视频` : '先勾选要下载的视频'}</button>
      </aside>
    </section>
    {jobs.length ? <section className="panel">
      <div className="panel-head">
        <div><h2>下载队列</h2><p>{active.length} 进行中 · {finished - failedJobs.length} 已完成{failedJobs.length ? ` · ${failedJobs.length} 失败` : ''}</p></div>
        <div className="row">
          <div className="state-chips" role="tablist" aria-label="队列视图">
            <button role="tab" aria-selected={queueView === 'active'} className={`chip ${queueView === 'active' ? 'active' : ''}`} onClick={() => setQueueView('active')}>进行中<em>{active.length}</em></button>
            <button role="tab" aria-selected={queueView === 'failed'} className={`chip ${queueView === 'failed' ? 'active' : ''} ${failedJobs.length ? 'has-failed' : ''}`} onClick={() => setQueueView('failed')}>失败<em>{failedJobs.length}</em></button>
            <button role="tab" aria-selected={queueView === 'all'} className={`chip ${queueView === 'all' ? 'active' : ''}`} onClick={() => setQueueView('all')}>全部<em>{jobs.length}</em></button>
          </div>
          {failedJobs.length ? <button onClick={() => void retry()}>重试全部失败</button> : null}
          {active.length ? <button className="ghost" onClick={() => void api.downloads.cancel()}>全部停止</button> : null}
        </div>
      </div>
      <div className="task-list">{visibleJobs.length ? visibleJobs.map(job => <div className={`task ${job.status === 'failed' ? 'task-failed' : ''}`} key={job.id}>
        <div className="row between"><span className="task-title" title={job.item.title}>{job.item.title}</span><span className="row">{['failed', 'cancelled'].includes(job.status) ? <button className="ghost small" onClick={() => void retry(job.id)}>重试</button> : null}<span className={`pill ${job.status}`}>{taskNames[job.status] || job.status}</span></span></div>
        <div className={`progress ${['completed', 'skipped'].includes(job.status) ? 'done' : job.status === 'failed' ? 'bad' : ''}`}><i style={{ width: `${job.progress}%` }} /></div>
        {job.status === 'failed' ? <p className="error task-error">{job.error || '下载失败'}</p> : <div className="task-meta"><span className="data">{job.progress.toFixed(1)}%</span><span>·</span><span>{job.detail || '等待中'}</span>{job.speed ? <span className="data">· {job.speed}</span> : null}{job.eta ? <span className="data">· 剩余 {job.eta}</span> : null}</div>}
      </div>) : <div className="empty small">{queueView === 'failed' ? '没有失败的下载' : queueView === 'active' ? '没有进行中的下载' : '队列为空'}</div>}</div>
    </section> : null}
  </div>
}

/* -------------------------------------------------------------- publish */

function PublishDialog({ assets, close, done }: { assets: MediaAsset[]; close: () => void; done: () => void }) {
  const single = assets.length === 1, [dispatchMode, setDispatch] = useState<'platform' | 'local'>('platform'), [scheduled, setScheduled] = useState(!single), [start, setStart] = useState(''), [interval, setIntervalValue] = useState(1), [title, setTitle] = useState(assets[0]?.analysis?.englishTitle.slice(0, 30) || assets[0]?.filename.slice(0, 30) || ''), [topics, setTopics] = useState(normalizePublishTopics(assets[0]?.analysis?.englishTitle.slice(0, 30) || assets[0]?.filename.slice(0, 30) || '', assets[0]?.analysis?.keyTopics || []).join(' ')), [aigc, setAigc] = useState(true), [waitForCovers, setWaitForCovers] = useState(false), [message, setMessage] = useState('')
  const topicCount = topics.split(/[#\s,，]+/).filter(Boolean).length
  const submit = async () => { const startDate = start ? new Date(start) : undefined; const automatic = !single && dispatchMode === 'platform' && !start, automaticTimes = automatic ? automaticPlatformPublishTimes(assets.length, interval) : []; if (scheduled && ((!startDate && !automatic) || (startDate && Number.isNaN(startDate.getTime())))) return setMessage('请选择有效的首条发布时间'); const jobs = assets.map((asset, index) => ({ assetId: asset.id, title: single ? title : (asset.analysis?.englishTitle || asset.filename).slice(0, 30), topics: (single ? topics.split(/[#\s,，]+/) : asset.analysis?.keyTopics || ['英语学习']).filter(Boolean).slice(0, 5), publishAt: startDate ? new Date(startDate.getTime() + index * interval * 3600_000).toISOString() : automaticTimes[index], aigc, waitForCovers })); const action = dispatchMode === 'local' ? '创建本地定时发布队列' : automatic ? '立即发布首条并按配置间隔提交其余抖音平台排期' : scheduled ? '立即提交抖音平台排期' : '立即公开发布'; if (!window.confirm(`即将${action} ${jobs.length} 个视频；浏览器每次提交将随机间隔 1–3 分钟，是否继续？`)) return; try { await api.publisher.publish({ jobs, dispatchMode, idempotencyKey: crypto.randomUUID() }); toast(`已创建 ${jobs.length} 个发布任务`); done() } catch (error) { setMessage(errorText(error)) } }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  return <div className="modal-bg" role="dialog" aria-modal="true" aria-label="发布到抖音" onMouseDown={close}>
    <div className="modal" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-head"><h2>发布到抖音</h2><p>{single ? (assets[0].analysis?.title || assets[0].filename) : `${assets.length} 个视频，标题与话题取自各自的分析结果`}</p></div>
      {single ? <>
        <label><span className="label-row">英文标题<span>{title.length} / 30</span></span><input maxLength={30} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label><span className="label-row">话题<span>{topicCount} / 5</span></span><input value={topics} onChange={event => setTopics(event.target.value)} placeholder="用空格分隔，最多 5 个" /></label>
        <div className="field"><span id="publish-timing">发布时间</span><div className="segmented" role="tablist" aria-labelledby="publish-timing"><button type="button" role="tab" aria-selected={!scheduled} className={scheduled ? '' : 'active'} onClick={() => setScheduled(false)}>立即发布</button><button type="button" role="tab" aria-selected={scheduled} className={scheduled ? 'active' : ''} onClick={() => setScheduled(true)}>定时发布</button></div></div>
      </> : <label>批量执行方式<select value={dispatchMode} onChange={event => setDispatch(event.target.value as 'platform' | 'local')}><option value="platform">一次性提交到抖音平台排期</option><option value="local">本地到点后逐条提交</option></select></label>}
      {scheduled ? <>
        <label>{!single && dispatchMode === 'platform' ? '首条发布时间（留空：首条立即发布，其余从至少 2 小时后开始）' : '首条发布时间'}<input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></label>
        {!single ? <label>相邻作品的发布间隔（小时）<input type="number" min="1" value={interval} onChange={event => setIntervalValue(Math.max(1, Number(event.target.value)))} /></label> : null}
      </> : null}
      <fieldset>
        <legend>发布选项</legend>
        <label className="check"><input type="checkbox" checked={aigc} onChange={event => setAigc(event.target.checked)} />声明“内容由 AI 生成”</label>
        <label className="check"><input type="checkbox" checked={waitForCovers} onChange={event => setWaitForCovers(event.target.checked)} />等待横竖封面生成完成后再提交</label>
      </fieldset>
      <p className="warning">将通过可见的浏览器操作抖音创作者中心；相邻作品随机间隔 1–3 分钟提交。遇到验证码或风控会暂停，并在任务页提示需要检查。</p>
      {message ? <p className="error">{message}</p> : null}
      <div className="modal-foot"><button onClick={close}>取消</button><button className="primary" onClick={() => void submit()}>确认发布</button></div>
    </div>
  </div>
}

/* -------------------------------------------------------------- library */

function RemakeDialog({ assets, close, done }: { assets: MediaAsset[]; close: () => void; done: () => void }) {
  const [direction, setDirection] = useState('保留核心信息与吸引人的节奏，重新设计脚本、画面、声音与包装，制作面向短视频平台的原创版本。')
  const [mode, setMode] = useState<RemakeJob['mode']>('editable'), [budget, setBudget] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const submit = async () => {
    if (direction.trim().length < 6) return setMessage('请补充原创改编方向')
    if (mode === 'render' && !budget.trim()) return setMessage('生成成片前，请填写可接受的预算或免费额度范围')
    setBusy(true); setMessage('')
    try { await api.remakes.start(assets.map(asset => asset.id), direction, mode, budget); toast(`已创建 ${assets.length} 个视频的 Hypit 重新制作任务`); done() }
    catch (error) { setMessage(errorText(error)); setBusy(false) }
  }
  return <div className="modal-bg" role="dialog" aria-modal="true" aria-label="使用 Hypit 重新制作" onMouseDown={() => { if (!busy) close() }}>
    <div className="modal remake-modal" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-head"><h2>使用 Hypit 重新制作</h2><p>{assets.length} 个参考视频将分别建立原创制作工程，原文件不会被覆盖。</p></div>
      <label>原创改编方向<textarea rows={5} value={direction} onChange={event => setDirection(event.target.value)} placeholder="例如：改成轻松幽默的英文启蒙短片，重写旁白，使用全新的角色、场景与配乐…" /></label>
      <fieldset className="remake-modes"><legend>制作范围</legend>
        <div className="remake-mode-grid">
          <label className={`remake-mode ${mode === 'editable' ? 'selected' : ''}`}><input type="radio" name="remake-mode" checked={mode === 'editable'} onChange={() => setMode('editable')} /><span><strong>可编辑工程</strong><small>先完成原创方案和完整工程，不使用付费生成</small></span><em>推荐</em></label>
          <label className={`remake-mode ${mode === 'render' ? 'selected' : ''}`}><input type="radio" name="remake-mode" checked={mode === 'render'} onChange={() => setMode('render')} /><span><strong>生成成片</strong><small>使用已配置的 Hypit 服务生成并检查最终视频</small></span></label>
        </div>
      </fieldset>
      {mode === 'render' ? <label>费用授权<input value={budget} onChange={event => setBudget(event.target.value)} placeholder="例如：本批最多 ¥50；或仅使用账户免费额度" /></label> : null}
      <p className="warning">重新制作会重构脚本、视觉、声音和节奏，不会采用镜像、变速、裁剪等伪原创手段；平台是否认定原创仍由平台规则与实际作品决定。</p>
      {message ? <p className="error">{message}</p> : null}
      <div className="modal-foot"><button disabled={busy} onClick={close}>取消</button><button className="primary" disabled={busy} onClick={() => void submit()}>{busy ? '正在创建…' : mode === 'render' ? '开始制作成片' : '创建原创工程'}</button></div>
    </div>
  </div>
}

function DeleteDialog({ assets, close, done }: { assets: MediaAsset[]; close: () => void; done: () => void }) {
  const [deleteFiles, setDeleteFiles] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const published = assets.filter(asset => asset.processingState === 'processed').length
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, close])
  const submit = async () => {
    setBusy(true); setMessage('')
    try {
      const result = await api.library.remove(assets.map(asset => asset.id), deleteFiles)
      toast(result.failed.length ? `已删除 ${result.count} 个视频，${result.failed.length} 个文件删除失败` : deleteFiles ? `已删除 ${result.count} 个视频及文件` : `已从媒体库移出 ${result.count} 个视频`, result.failed.length ? 'bad' : 'ok')
      done()
    } catch (error) { setMessage(errorText(error)); setBusy(false) }
  }
  return <div className="modal-bg" role="dialog" aria-modal="true" aria-label="删除视频" onMouseDown={() => { if (!busy) close() }}>
    <div className="modal" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-head"><h2>删除 {assets.length} 个视频</h2><p>相关的分析结果与发布历史会一起删除，操作无法撤销。</p></div>
      <ul className="delete-list">{assets.slice(0, 6).map(asset => <li key={asset.id}><span className="filename">{asset.filename}</span></li>)}{assets.length > 6 ? <li className="hint">还有 {assets.length - 6} 个…</li> : null}</ul>
      <fieldset>
        <legend>删除范围</legend>
        <label className="check"><input type="checkbox" checked={deleteFiles} onChange={event => setDeleteFiles(event.target.checked)} />同时删除服务器上的视频文件</label>
        <p className="hint">{deleteFiles ? '文件会从 /downloads 或 /imports 中永久删除。' : '只移出媒体库，文件保留；重新导入目录时会再次登记。'}</p>
      </fieldset>
      {published ? <p className="warning">其中 {published} 个已标为已处理，可能已发布到抖音。删除不会撤回抖音上的作品。</p> : null}
      {message ? <p className="error">{message}</p> : null}
      <div className="modal-foot"><button disabled={busy} onClick={close}>取消</button><button className="danger" disabled={busy} onClick={() => void submit()}>{busy ? '删除中…' : deleteFiles ? `删除 ${assets.length} 个视频及文件` : `移出媒体库`}</button></div>
    </div>
  </div>
}

const FirstFrame = memo(function FirstFrame({ asset }: { asset: MediaAsset }) {
  const [failed, setFailed] = useState(false)
  return failed
    ? <span className="preview-fallback" aria-hidden="true">▶</span>
    : <img loading="lazy" decoding="async" src={api.library.thumbnailUrl(asset.id)} alt={`${asset.analysis?.title || asset.filename} 首帧`} onError={() => setFailed(true)} />
})

const SearchIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>

const AssetCard = memo(function AssetCard({ asset, selected, remade, toggle, play, mark, publish }: { asset: MediaAsset; selected: boolean; remade: boolean; toggle: (id: string) => void; play: (asset: MediaAsset) => void; mark: (asset: MediaAsset) => void; publish: (asset: MediaAsset) => void }) {
  const analysis = asset.analysis
  const cardRef = useRef<HTMLElement>(null), [metadata, setMetadata] = useState<MediaFileMetadata | null>()
  useEffect(() => {
    const element = cardRef.current; if (!element) return
    const load = () => { void api.library.metadata(asset.id).then(setMetadata).catch(() => setMetadata(null)) }
    if (!('IntersectionObserver' in window)) { load(); return }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load() } }, { rootMargin: '320px' })
    observer.observe(element); return () => observer.disconnect()
  }, [asset.id])
  const duration = metadata?.duration || asset.duration
  return <article ref={cardRef} className={`asset-card ${selected ? 'selected' : ''}`}>
    <div className="asset-top">
      <label className="select" title={selected ? '取消选择' : '选择'}><input type="checkbox" checked={selected} onChange={() => toggle(asset.id)} aria-label={`选择 ${analysis?.title || asset.filename}`} /></label>
      <span className="asset-badges">{remade ? <span className="pill remade">已重新制作</span> : null}<span className={`pill ${asset.processingState}`}>{asset.processingState === 'processed' ? '已处理' : analysis ? '未处理' : '等待分析'}</span></span>
    </div>
    <button className="preview" onClick={() => play(asset)} aria-label="播放预览"><FirstFrame asset={asset} />{duration ? <span className="duration">{formatDuration(duration)}</span> : null}</button>
    <div className="asset-copy">
      <h2 title={analysis?.title || asset.filename}>{analysis?.title || asset.filename}</h2>
      {analysis ? <p className="english" title={analysis.englishTitle}>{analysis.englishTitle}</p> : null}
      <p className="filename" title={asset.file}>{asset.filename}</p>
      <p className="asset-media-meta"><span>{metadata === undefined ? '读取大小…' : metadata ? formatBytes(metadata.size) : '大小未知'}</span><i /> <span>{duration ? formatDuration(duration) : metadata === undefined ? '读取时长…' : '时长未知'}</span></p>
      {analysis ? <>
        <div className="asset-tags"><span className="category">{analysis.category}</span><span className="evidence" title={analysis.evidenceNote}><i className={`dot ${analysis.confidence}`} />置信度{confidenceNames[analysis.confidence] || analysis.confidence}</span></div>
        <div className="topics">{analysis.keyTopics.map(topic => <span key={topic}>#{topic}</span>)}</div>
        <p className="summary" title={analysis.summary}>{analysis.summary}</p>
        <div className="copy-row"><span>复制</span><button onClick={() => void copyText(analysis.title, '中文标题')}>中文标题</button><button onClick={() => void copyText(analysis.englishTitle, '英文标题')}>英文标题</button><button onClick={() => void copyText(analysis.keyTopics.map(value => `#${value}`).join(' '), '话题')}>话题</button><button onClick={() => void copyText(analysis.summary, '摘要')}>摘要</button></div>
      </> : <p className="muted">尚未分析。勾选后点击「分析」，这里会显示分类、标题、话题和摘要。</p>}
    </div>
    <div className="card-actions">
      <button className="ghost" onClick={() => mark(asset)}>{asset.processingState === 'processed' ? '标为未处理' : '标为已处理'}</button>
      <div className="row"><a className="button ghost" href={api.library.fileUrl(asset.id)}>下载</a><button disabled={!analysis} title={analysis ? undefined : '需要先完成分析'} onClick={() => publish(asset)}>发布</button></div>
    </div>
  </article>
})

function LibraryPage({ assets, remakes, reload, openTasks }: { assets: MediaAsset[]; remakes: RemakeJob[]; reload: () => void; openTasks: (taskTab: TaskTab) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set()), [queryInput, setQueryInput] = useState(''), [state, setState] = useState<LibraryViewFilter>('unprocessed'), [category, setCategory] = useState('all'), [directory, setDirectory] = useState(() => storedValue(LIBRARY_DIRECTORY_STORAGE_KEY, 'all')), [playing, setPlaying] = useState<MediaAsset>(), [publishing, setPublishing] = useState<MediaAsset[]>(), [remaking, setRemaking] = useState<MediaAsset[]>(), [deleting, setDeleting] = useState<MediaAsset[]>(), [importOpen, setImportOpen] = useState(false), [importPath, setImportPath] = useState('/downloads'), [importing, setImporting] = useState(false), [message, setMessage] = useState('')
  const query = useDeferredValue(queryInput.trim())
  const categories = useMemo(() => [...new Set(assets.map(asset => asset.analysis?.category).filter(Boolean) as string[])].sort(), [assets])
  const directories = useMemo(() => [...new Set(assets.map(asset => mediaAssetDirectory(asset.file)))].sort(), [assets])
  const remadeAssets = useMemo(() => { const ids = new Set<string>(), files = new Set<string>(); for (const job of remakes) if (job.status === 'completed') { job.assetIds.forEach(id => ids.add(id)); job.outputs.forEach(file => files.add(file)) } return { ids, files } }, [remakes])
  const visible = useMemo(() => { const filtered = filterMediaAssets(assets, state === 'remade' ? 'all' : state, category, query, directory); return state === 'remade' ? filtered.filter(asset => remadeAssets.ids.has(asset.id) || remadeAssets.files.has(asset.file)) : filtered }, [assets, state, category, query, directory, remadeAssets])
  const stateCounts = useMemo(() => Object.fromEntries(stateOrder.map(value => { const filtered = filterMediaAssets(assets, value === 'remade' ? 'all' : value, category, query, directory); return [value, value === 'remade' ? filtered.filter(asset => remadeAssets.ids.has(asset.id) || remadeAssets.files.has(asset.file)).length : filtered.length] })) as Record<LibraryViewFilter, number>, [assets, category, query, directory, remadeAssets])
  const chosen = useMemo(() => assets.filter(asset => selected.has(asset.id)), [assets, selected])
  const filtered = state !== 'unprocessed' || category !== 'all' || directory !== 'all' || Boolean(query)
  useEffect(() => {
    if (!playing) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPlaying(undefined) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [playing])
  useEffect(() => { try { window.localStorage.setItem(LIBRARY_DIRECTORY_STORAGE_KEY, directory) } catch { /* storage unavailable */ } }, [directory])
  useEffect(() => { if (assets.length && directory !== 'all' && !directories.includes(directory)) setDirectory('all') }, [assets.length, directories, directory])
  const toggle = useCallback((id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }), [])
  const play = useCallback((asset: MediaAsset) => setPlaying(asset), [])
  const publishOne = useCallback((asset: MediaAsset) => setPublishing([asset]), [])
  const mark = useCallback(async (asset: MediaAsset) => { const next = asset.processingState === 'processed' ? 'unprocessed' : 'processed'; try { await api.library.state(asset.id, next); toast(next === 'processed' ? '已标为已处理' : '已标为未处理'); reload() } catch (error) { toast(errorText(error), 'bad') } }, [reload])
  const analyze = async (force = false) => { if (!chosen.length) return; if (force && !window.confirm('将重新分析所选视频并覆盖已有分析结果，是否继续？')) return; try { await api.analysis.start(chosen.map(asset => asset.id), force); toast(`已为 ${chosen.length} 个视频创建分析任务`); openTasks('analysis') } catch (error) { setMessage(errorText(error)) } }
  const runImport = async () => { setImporting(true); setMessage(''); try { const result = await api.library.import(importPath); toast(`已导入 ${result.count} 个视频`); reload() } catch (error) { setMessage(errorText(error)) } finally { setImporting(false) } }
  const allVisibleSelected = visible.length > 0 && visible.every(asset => selected.has(asset.id))
  return <div className="page-stack">
    <section className="panel toolbar">
      <div className="toolbar-row">
        <div className="search"><SearchIcon /><input type="search" value={queryInput} onChange={event => setQueryInput(event.target.value)} placeholder="搜索文件名、标题、话题或摘要" aria-label="搜索媒体库" /></div>
        <select value={directory} onChange={event => setDirectory(event.target.value)} aria-label="媒体目录"><option value="all">全部目录</option>{directories.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <select value={category} onChange={event => setCategory(event.target.value)} aria-label="分类"><option value="all">全部分类</option>{categories.map(value => <option key={value}>{value}</option>)}</select>
        <button className="ghost" aria-expanded={importOpen} onClick={() => setImportOpen(value => !value)}>导入目录</button>
      </div>
      <div className="toolbar-row between">
        <div className="state-chips" role="tablist" aria-label="处理状态"><span className="label">状态</span>{stateOrder.map(value => <button role="tab" aria-selected={state === value} className={`chip ${state === value ? 'active' : ''}`} key={value} onClick={() => setState(value)}>{stateNames[value]}<em>{stateCounts[value]}</em></button>)}</div>
        {filtered ? <button className="ghost" onClick={() => { setQueryInput(''); setState('unprocessed'); setCategory('all'); setDirectory('all') }}>重置筛选</button> : null}
      </div>
      {importOpen ? <div className="import-row">
        <input value={importPath} onChange={event => setImportPath(event.target.value)} aria-label="服务器目录" />
        <button disabled={importing || !importPath.trim()} onClick={() => void runImport()}>{importing ? '导入中…' : '导入该目录'}</button>
        <span className="hint">扫描服务器目录中的视频并登记到媒体库，仅允许 /downloads 与 /imports</span>
        {message ? <span className="error">{message}</span> : null}
      </div> : null}
    </section>
    <section className="panel actionbar">
      <div className="summary"><span>已选 <strong>{selected.size}</strong> 项</span><span className="hint">· 显示 <span className="data">{visible.length}</span> / <span className="data">{assets.length}</span></span></div>
      <div className="row">
        <button className="ghost" disabled={!visible.length} onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map(asset => asset.id)))}>{allVisibleSelected ? '取消全选' : '全选当前结果'}</button>
        {selected.size ? <button className="ghost" onClick={() => setSelected(new Set())}>清空选择</button> : null}
        <span className="divider" />
        <button className="danger-text" disabled={!chosen.length} onClick={() => setDeleting(chosen)}>删除</button>
        <button disabled={!chosen.length} onClick={() => void analyze()}>分析</button>
        <button disabled={!chosen.some(asset => asset.analysis)} onClick={() => void analyze(true)}>重新分析</button>
        <button disabled={!chosen.length} onClick={() => setRemaking(chosen)}>重新制作{chosen.length > 1 ? ` (${chosen.length})` : ''}</button>
        <button className="primary" disabled={!chosen.length || chosen.some(asset => !asset.analysis)} title={chosen.some(asset => !asset.analysis) ? '所选视频需要先完成分析' : undefined} onClick={() => setPublishing(chosen)}>发布到抖音{chosen.length > 1 ? ` (${chosen.length})` : ''}</button>
      </div>
    </section>
    {message && !importOpen ? <p className="error">{message}</p> : null}
    {visible.length ? <main className="asset-grid">{visible.map(asset => <AssetCard key={asset.id} asset={asset} selected={selected.has(asset.id)} remade={remadeAssets.ids.has(asset.id) || remadeAssets.files.has(asset.file)} toggle={toggle} play={play} mark={mark} publish={publishOne} />)}</main>
      : <section className="panel"><div className="empty">{assets.length ? <><strong>没有符合条件的视频</strong>试试切换状态、分类或目录，或清空搜索词</> : <><strong>媒体库是空的</strong>完成下载后视频会自动出现，也可以点击「导入目录」登记服务器上的文件</>}</div></section>}
    {playing ? <div className="modal-bg" role="dialog" aria-modal="true" aria-label="视频播放" onMouseDown={() => setPlaying(undefined)}><div className="modal player" onMouseDown={event => event.stopPropagation()}><button className="player-close" aria-label="关闭播放" title="关闭 (Esc)" onClick={() => setPlaying(undefined)}>×</button><h2>{playing.analysis?.title || playing.filename}</h2><video controls autoPlay src={api.library.mediaUrl(playing.id)} /><p className="filename">{playing.filename}</p></div></div> : null}
    {publishing ? <PublishDialog assets={publishing} close={() => setPublishing(undefined)} done={() => { setPublishing(undefined); openTasks('publisher') }} /> : null}
    {remaking ? <RemakeDialog assets={remaking} close={() => setRemaking(undefined)} done={() => { setRemaking(undefined); openTasks('remake') }} /> : null}
    {deleting ? <DeleteDialog assets={deleting} close={() => setDeleting(undefined)} done={() => { setDeleting(undefined); setSelected(new Set()); reload() }} /> : null}
  </div>
}

/* ---------------------------------------------------------------- tasks */

const analysisStageNames = { queue: '队列', prepare: '媒体', codex: 'Codex', validate: '校验', complete: '完成' }

function AnalysisTask({ job, reload }: { job: AnalysisJob; reload: () => void }) {
  const active = ['preparing', 'analyzing', 'queued'].includes(job.status)
  const logs = job.logs || [], visibleLogs = logs.slice(-100), totalItems = job.totalItems || job.assetIds.length
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (active && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [active, logs.length])
  return <article className="task analysis-task">
    <div className="row between"><span className="task-title">{job.assetIds.length} 个视频 <span className="data muted">· {job.id.slice(0, 8)}</span></span><span className={`pill ${job.status}`}>{taskNames[job.status] || job.status}</span></div>
    <div className={`progress ${job.status === 'completed' ? 'done' : job.status === 'failed' ? 'bad' : ''}`}><i style={{ width: `${job.progress}%` }} /></div>
    <div className="analysis-summary"><span>{Math.round(job.progress)}%</span><span>{job.processedItems || 0}/{totalItems} 个媒体已准备</span><span>更新于 {new Date(job.updatedAt).toLocaleTimeString()}</span></div>
    <p>{job.message}</p>
    {job.currentItem ? <p className="analysis-current" title={job.currentItem}>当前文件：{job.currentItem}</p> : null}
    {job.error ? <p className="error">{job.error}</p> : null}
    <details className="analysis-details" open={active}>
      <summary>具体执行信息 {logs.length > visibleLogs.length ? `（显示最近 ${visibleLogs.length} 条）` : `（${visibleLogs.length} 条）`}</summary>
      <div className="analysis-log" role="log" aria-live="polite" ref={logRef}>
        {visibleLogs.length ? visibleLogs.map((entry, index) => <div className={`analysis-log-line ${entry.level}`} key={`${entry.at}-${index}`}><time>{new Date(entry.at).toLocaleTimeString()}</time><span className="analysis-stage">{analysisStageNames[entry.stage]}</span><span>{entry.message}</span></div>) : <div className="analysis-log-empty">等待详细输出…</div>}
      </div>
    </details>
    <div className="row end">{active ? <button onClick={() => void api.analysis.cancel(job.id).then(reload)}>取消</button> : null}{['failed', 'cancelled'].includes(job.status) ? <button onClick={() => void api.analysis.retry(job.id).then(reload)}>重试</button> : null}{!active ? <button className="danger-text" onClick={() => { if (window.confirm('确认删除该分析任务历史？已写入媒体库的分析结果不会删除。')) void api.analysis.delete(job.id).then(reload) }}>删除历史</button> : null}</div>
  </article>
}

function PublishBatchCard({ batch, reload }: { batch: PublishBatch; reload: () => void }) {
  return <article className="batch">
    <div className="row between"><span className="task-title">{batch.dispatchMode === 'local' ? '本地定时' : '抖音平台排期'} <span className="data muted">· {batch.id.slice(0, 8)} · {new Date(batch.createdAt).toLocaleString()}</span></span><span className={`pill ${batch.status}`}>{taskNames[batch.status] || batch.status}</span></div>
    <div className="publish-job publish-job-head"><span>作品</span><span>状态</span><span>本地提交时间</span><span>抖音发布时间</span><span /></div>
    {batch.jobs.map(job => <div className="publish-job" key={job.id}>
      <span title={job.title}>{job.title}</span>
      <span className={`pill ${job.status}`}>{taskNames[job.status] || job.status}</span>
      <time>{job.submitAt ? new Date(job.submitAt).toLocaleString() : job.executeAt ? new Date(job.executeAt).toLocaleString() : '—'}</time>
      <time>{job.publishAt ? new Date(job.publishAt).toLocaleString() : batch.dispatchMode === 'local' ? '提交后立即发布' : '立即发布'}</time>
      <span className="actions">{job.screenshot ? <a target="_blank" rel="noreferrer" href={`/api/publisher/artifacts/${encodeURIComponent(job.screenshot.split('/').pop()!)}`}>诊断截图</a> : null}{['failed', 'needs_login', 'needs_attention', 'interrupted', 'cancelled'].includes(job.status) ? <button onClick={() => void api.publisher.retry(job.id).then(reload)}>重试</button> : null}</span>
      {job.error ? <p className="error">{job.error}</p> : null}
    </div>)}
    <div className="batch-foot">
      {['queued', 'waiting_local', 'running'].includes(batch.status) ? <button className="danger-text" onClick={() => { if (window.confirm('确认取消该发布批次？已发布到抖音的作品不会撤回，未执行的任务将停止。')) void api.publisher.cancelBatch(batch.id).then(reload) }}>取消批次</button> : null}
      {['completed', 'partial', 'failed', 'needs_attention', 'interrupted', 'cancelled'].includes(batch.status) ? <button className="danger-text" onClick={() => { if (window.confirm('确认删除该批次历史及关联诊断记录？')) void api.publisher.deleteBatch(batch.id).then(reload) }}>删除历史</button> : null}
    </div>
  </article>
}

function CompareDialog({ originals, remade, close }: { originals: MediaAsset[]; remade: MediaAsset[]; close: () => void }) {
  const [originalId, setOriginalId] = useState(originals[0]?.id || ''), [remadeId, setRemadeId] = useState(remade[0]?.id || ''), [hashes, setHashes] = useState<Record<string, MediaFileHash | 'loading' | 'error'>>({}), [durations, setDurations] = useState<Record<string, number>>({}), [playing, setPlaying] = useState(false)
  const left = useRef<HTMLVideoElement>(null), right = useRef<HTMLVideoElement>(null)
  const original = originals.find(asset => asset.id === originalId), output = remade.find(asset => asset.id === remadeId)
  useEffect(() => { for (const id of [originalId, remadeId]) if (id && !hashes[id]) { setHashes(current => ({ ...current, [id]: 'loading' })); void api.library.hash(id).then(value => setHashes(current => ({ ...current, [id]: value }))).catch(() => setHashes(current => ({ ...current, [id]: 'error' }))) } }, [originalId, remadeId, hashes])
  useEffect(() => { setPlaying(false) }, [originalId, remadeId])
  const playBoth = async () => { if (!left.current || !right.current) return; right.current.currentTime = Math.min(left.current.currentTime, right.current.duration || left.current.currentTime); const results = await Promise.allSettled([left.current.play(), right.current.play()]); setPlaying(results.some(result => result.status === 'fulfilled')) }
  const pauseBoth = () => { left.current?.pause(); right.current?.pause(); setPlaying(false) }
  const resetBoth = () => { pauseBoth(); if (left.current) left.current.currentTime = 0; if (right.current) right.current.currentTime = 0 }
  const syncRight = () => { if (!left.current || !right.current || !Number.isFinite(right.current.duration)) return; const target = Math.min(left.current.currentTime, right.current.duration); if (Math.abs(right.current.currentTime - target) > .3) right.current.currentTime = target }
  const hashView = (asset?: MediaAsset) => { const value = asset ? hashes[asset.id] : undefined, duration = asset ? durations[asset.id] ?? asset.duration : undefined; return <><div className="compare-file-meta"><span>大小<strong>{typeof value === 'object' ? formatBytes(value.size) : value === 'error' ? '读取失败' : '读取中…'}</strong></span><span>时长<strong>{duration ? formatDuration(duration) : '读取中…'}</strong></span></div><div className="compare-hash"><span>SHA-256</span><code title={typeof value === 'object' ? value.hash : undefined}>{value === 'loading' || !value ? '计算中…' : value === 'error' ? '计算失败' : value.hash}</code>{typeof value === 'object' ? <small>文件修改于 {new Date(value.modifiedAt).toLocaleString()}</small> : null}</div></> }
  return <div className="modal-bg" role="dialog" aria-modal="true" aria-label="原视频与重新制作视频对比" onMouseDown={close}>
    <div className="modal compare-modal" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-head"><h2>视频前后对比</h2><p>使用统一控制同时播放；拖动左侧视频进度时，右侧会同步到相同时间。</p></div>
      <div className="compare-toolbar"><button className="primary" onClick={() => void (playing ? pauseBoth() : playBoth())}>{playing ? '同时暂停' : '同时播放'}</button><button onClick={resetBoth}>回到开头</button></div>
      <div className="compare-grid">
        <section><div className="compare-title"><strong>原视频</strong><select value={originalId} onChange={event => setOriginalId(event.target.value)}>{originals.map(asset => <option value={asset.id} key={asset.id}>{asset.analysis?.title || asset.filename}</option>)}</select></div>{original ? <video ref={left} playsInline src={api.library.mediaUrl(original.id)} onLoadedMetadata={event => setDurations(current => ({ ...current, [original.id]: event.currentTarget.duration }))} onPlay={() => void playBoth()} onPause={pauseBoth} onSeeked={syncRight} onTimeUpdate={syncRight} onEnded={pauseBoth} /> : null}{hashView(original)}</section>
        <section><div className="compare-title"><strong>重新制作后</strong><select value={remadeId} onChange={event => setRemadeId(event.target.value)}>{remade.map(asset => <option value={asset.id} key={asset.id}>{asset.analysis?.title || asset.filename}</option>)}</select></div>{output ? <video ref={right} playsInline src={api.library.mediaUrl(output.id)} onLoadedMetadata={event => setDurations(current => ({ ...current, [output.id]: event.currentTarget.duration }))} onEnded={pauseBoth} /> : null}{hashView(output)}</section>
      </div>
      <div className="modal-foot"><button onClick={close}>关闭</button></div>
    </div>
  </div>
}

function RemakeTask({ job, assets, reload }: { job: RemakeJob; assets: MediaAsset[]; reload: () => void }) {
  const active = ['queued', 'preparing', 'directing', 'building'].includes(job.status)
  const [comparing, setComparing] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const originals = assets.filter(asset => job.assetIds.includes(asset.id)), outputs = assets.filter(asset => job.outputs.includes(asset.file))
  useEffect(() => { if (active && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [active, job.logs.length])
  return <article className="task analysis-task">
    <div className="row between"><span className="task-title">{job.assetIds.length} 个视频 · {job.mode === 'render' ? '生成成片' : '可编辑工程'} <span className="data muted">· {job.id.slice(0, 8)}</span></span><span className={`pill ${job.status}`}>{taskNames[job.status] || job.status}</span></div>
    <div className={`progress ${job.status === 'completed' ? 'done' : job.status === 'failed' ? 'bad' : ''}`}><i style={{ width: `${job.progress}%` }} /></div>
    <p>{job.message}</p><p className="muted">{job.direction}</p>
    {job.outputs.length ? <p className="notice">已生成 {job.outputs.length} 个成片，并加入媒体库。</p> : null}
    {job.error ? <p className="error">{job.error}</p> : null}
    <details className="analysis-details" open={active}><summary>制作记录（{job.logs.length} 条）</summary><div className="analysis-log" role="log" aria-live="polite" ref={logRef}>{job.logs.map((entry, index) => <div className={`analysis-log-line ${entry.level}`} key={`${entry.at}-${index}`}><time>{new Date(entry.at).toLocaleTimeString()}</time><span className="analysis-stage">{analysisStageNames[entry.stage]}</span><span>{entry.message}</span></div>)}</div></details>
    <div className="row end">{originals.length && outputs.length ? <button onClick={() => setComparing(true)}>前后对比与哈希</button> : null}{active ? <button onClick={() => void api.remakes.cancel(job.id).then(reload)}>取消</button> : <button className="danger-text" onClick={() => { if (window.confirm('确认删除该 Hypit 任务记录？项目工程与已生成视频会保留。')) void api.remakes.delete(job.id).then(reload) }}>删除历史</button>}</div>
    {comparing ? <CompareDialog originals={originals} remade={outputs} close={() => setComparing(false)} /> : null}
  </article>
}

function TasksPage({ analysis, remakes, batches, assets, reload }: { analysis: AnalysisJob[]; remakes: RemakeJob[]; batches: PublishBatch[]; assets: MediaAsset[]; reload: () => void }) {
  const [taskTab, setTaskTab] = useState<TaskTab>(() => storedChoice(TASK_TAB_STORAGE_KEY, taskTabs, 'analysis'))
  const historyCount = analysis.filter(job => !['queued', 'preparing', 'analyzing'].includes(job.status)).length
  useEffect(() => { try { window.localStorage.setItem(TASK_TAB_STORAGE_KEY, taskTab) } catch { /* storage unavailable */ } }, [taskTab])
  return <section className="panel task-panel">
    <div className="task-tabs" role="tablist" aria-label="任务类型">
      <button role="tab" aria-selected={taskTab === 'analysis'} className={taskTab === 'analysis' ? 'active' : ''} onClick={() => setTaskTab('analysis')}><strong>分析任务</strong><span>Codex 逐个执行</span><em>{analysis.length}</em></button>
      <button role="tab" aria-selected={taskTab === 'remake'} className={taskTab === 'remake' ? 'active' : ''} onClick={() => setTaskTab('remake')}><strong>Hypit 重新制作</strong><span>原创方案、工程与成片</span><em>{remakes.length}</em></button>
      <button role="tab" aria-selected={taskTab === 'publisher'} className={taskTab === 'publisher' ? 'active' : ''} onClick={() => setTaskTab('publisher')}><strong>抖音发布任务</strong><span>共用一个浏览器串行提交</span><em>{batches.length}</em></button>
      {taskTab === 'publisher' ? <a target="_blank" rel="noreferrer" href="https://creator.douyin.com/creator-micro/content/manage">在抖音查看作品管理 ↗</a> : null}
    </div>
    {taskTab === 'analysis' ? <>
      <div className="task-history-actions"><span>共 <span className="data">{analysis.length}</span> 条记录，<span className="data">{historyCount}</span> 条已结束</span><button className="danger-text" disabled={!historyCount} onClick={() => { if (window.confirm(`确认清除全部 ${historyCount} 条已结束的分析历史？运行中的任务和媒体库分析结果将保留。`)) void api.analysis.clearHistory().then(reload) }}>清除已结束的历史</button></div>
      <div className="task-list" role="tabpanel">{analysis.length ? analysis.map(job => <AnalysisTask job={job} reload={reload} key={job.id} />) : <div className="empty"><strong>还没有分析任务</strong>在媒体库勾选视频后点击「分析」</div>}</div>
    </> : taskTab === 'remake' ? <div className="task-list" role="tabpanel">{remakes.length ? remakes.map(job => <RemakeTask job={job} assets={assets} reload={reload} key={job.id} />) : <div className="empty"><strong>还没有重新制作任务</strong>在媒体库选择视频后点击「重新制作」</div>}</div> : <div className="task-list" role="tabpanel">{batches.length ? batches.map(batch => <PublishBatchCard batch={batch} reload={reload} key={batch.id} />) : <div className="empty"><strong>还没有发布任务</strong>在媒体库选择已分析的视频后点击「发布到抖音」</div>}</div>}
  </section>
}

/* ------------------------------------------------------------- settings */

function CodexLoginDetails({ status }: { status: CodexStatus }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => setCopyState('idle'), [status.loginCode])
  const copyCode = async () => {
    if (!status.loginCode) return
    try { await navigator.clipboard.writeText(status.loginCode); setCopyState('copied') }
    catch { setCopyState('failed') }
  }
  return <div className="codex-login-details">{status.loginUrl || status.loginCode ? <div className="codex-login-actions">{status.loginUrl ? <a className="codex-login-link" href={status.loginUrl} target="_blank" rel="noreferrer">打开 OpenAI 设备登录页面 ↗</a> : null}{status.loginCode ? <div className="codex-login-code"><span>一次性登录码</span><code>{status.loginCode}</code><button onClick={() => void copyCode()}>{copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制登录码'}</button></div> : null}</div> : null}{status.loginOutput ? <pre>{status.loginOutput}</pre> : null}</div>
}

function usageWindowName(minutes?: number) {
  if (!minutes) return '用量额度'
  if (minutes % 1440 === 0) return `${minutes / 1440} 天额度`
  if (minutes % 60 === 0) return `${minutes / 60} 小时额度`
  return `${minutes} 分钟额度`
}

function CodexRuntimeStatus({ status }: { status: CodexStatus }) {
  const modeLabel = status.mode === 'provider' ? '直连供应商' : status.mode === 'cc_switch' ? 'CC Switch 代理' : '官方 ChatGPT'
  const windows = status.usage?.limits.flatMap(limit => [limit.primary, limit.secondary].filter(Boolean).map((window, index) => ({ ...window!, key: `${limit.id}-${index}`, name: limit.name || usageWindowName(window!.windowDurationMins) }))) || []
  return <div className="codex-runtime"><div className="codex-runtime-grid"><div><span>连接模式</span><strong>{modeLabel}</strong></div><div><span>当前模型</span><strong>{status.model}</strong></div><div><span>推理强度</span><strong>{status.reasoningEffort}</strong></div>{status.usage?.planType ? <div><span>账号套餐</span><strong>{status.usage.planType.toUpperCase()}</strong></div> : null}</div>{windows.map(window => <div className="codex-usage" key={window.key}><div className="row between"><span>{window.name}</span><strong>剩余 {window.remainingPercent}%</strong></div><div className="codex-usage-bar" role="progressbar" aria-label={window.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.remainingPercent}><i style={{ width: `${window.remainingPercent}%` }} /></div><small>已使用 {window.usedPercent}%{window.resetsAt ? ` · ${new Date(window.resetsAt * 1000).toLocaleString()} 重置` : ''}</small></div>)}{status.usage?.ordinaryUsageAllowed === false ? <p className="error">当前普通包含用量已不可用。</p> : null}{status.usageUnavailable ? <p className="muted">Codex 暂未返回剩余用量，可稍后刷新。</p> : null}</div>
}

const shortVersion = (value?: string) => value?.match(/\d+(\.\d+)+/)?.[0] || value || '已就绪'

function CodexConnectionPanel({ connection, refresh }: { connection: CodexConnectionPublic; refresh: () => void }) {
  const active = connection.providers.find(item => item.id === connection.activeProviderId)
  const [mode, setMode] = useState(connection.mode)
  const [ccSwitchBaseUrl, setCcSwitchBaseUrl] = useState(connection.ccSwitchBaseUrl)
  const [ccSwitchModel, setCcSwitchModel] = useState(connection.ccSwitchModel || '')
  const [selectedId, setSelectedId] = useState(connection.activeProviderId || connection.providers[0]?.id || '')
  const selected = connection.providers.find(item => item.id === selectedId) || active
  const [name, setName] = useState(selected?.name || '')
  const [baseUrl, setBaseUrl] = useState(selected?.baseUrl || '')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(selected?.model || '')
  const [reasoningEffort, setReasoningEffort] = useState(selected?.reasoningEffort || 'medium')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setMode(connection.mode)
    setCcSwitchBaseUrl(connection.ccSwitchBaseUrl)
    setCcSwitchModel(connection.ccSwitchModel || '')
    const nextSelected = connection.activeProviderId || connection.providers[0]?.id || ''
    setSelectedId(nextSelected)
  }, [connection])

  useEffect(() => {
    const provider = connection.providers.find(item => item.id === selectedId)
    setName(provider?.name || '')
    setBaseUrl(provider?.baseUrl || '')
    setModel(provider?.model || '')
    setReasoningEffort(provider?.reasoningEffort || 'medium')
    setApiKey('')
  }, [selectedId, connection.providers])

  const run = async (action: () => Promise<unknown>, success = '配置已保存，将在后续新任务中生效') => {
    setBusy(true); setMessage('')
    try { await action(); setMessage(success); refresh() }
    catch (error) { setMessage(errorText(error)) }
    finally { setBusy(false) }
  }

  const testConnectivity = async () => {
    setBusy(true); setMessage('')
    try {
      const result = await api.codex.testConnection({
        mode,
        providerId: selectedId || undefined,
        ccSwitchBaseUrl: mode === 'cc_switch' ? ccSwitchBaseUrl : undefined,
        ccSwitchModel: mode === 'cc_switch' ? (ccSwitchModel || undefined) : undefined,
        baseUrl: mode === 'provider' ? baseUrl : undefined,
        apiKey: mode === 'provider' ? (apiKey || undefined) : undefined,
      })
      setMessage(result.ok ? result.message : `测试失败：${result.message}`)
      if (result.ok) refresh()
    } catch (error) { setMessage(errorText(error)) }
    finally { setBusy(false) }
  }

  return <div className="codex-connection">
    <div className="codex-mode-grid" role="radiogroup" aria-label="Codex 连接模式">
      {([
        ['official', '官方 ChatGPT', '设备码登录，使用 ChatGPT / Codex 官方额度'],
        ['provider', '直连供应商', '填写 Base URL 与 API Key，如腾讯 Token Plan'],
        ['cc_switch', 'CC Switch 代理', '经宿主本地代理转发，由 CC Switch 选上游'],
      ] as const).map(([value, label, hint]) => (
        <label key={value} className={`codex-mode ${mode === value ? 'selected' : ''}`}>
          <input type="radio" name="codex-mode" value={value} checked={mode === value} disabled={busy || (value === 'provider' && !connection.providers.length)} onChange={() => setMode(value)} />
          <span><strong>{label}</strong><small>{hint}</small></span>
        </label>
      ))}
    </div>
    <div className="row">
      <button className="primary" disabled={busy} onClick={() => void run(() => api.codex.updateConnection({
        mode,
        activeProviderId: selectedId || undefined,
        ccSwitchBaseUrl,
        ccSwitchModel: ccSwitchModel || undefined,
      }))}>应用连接模式</button>
      <button disabled={busy} onClick={() => void testConnectivity()}>测试连通</button>
    </div>

    {mode === 'cc_switch' ? <div className="codex-form-grid">
      <label>代理 Base URL<input value={ccSwitchBaseUrl} onChange={event => setCcSwitchBaseUrl(event.target.value)} placeholder="http://host.docker.internal:15721/v1" /></label>
      <label>代理模型<input value={ccSwitchModel} onChange={event => setCcSwitchModel(event.target.value)} placeholder="tc-code-latest" /></label>
    </div> : null}

    {mode === 'cc_switch' ? <p className="muted">CC Switch 模式不需要在工作台里再建供应商，上游由本机 CC Switch 选择。把代理模型改成腾讯侧实际模型（如 <code>tc-code-latest</code> 或 <code>deepseek-v4-pro</code>）后点「应用连接模式」或「测试连通」。</p> : null}

    {mode !== 'cc_switch' ? <div className="codex-providers">
      <div className="row between">
        <h3>供应商</h3>
        <div className="row">
          <button disabled={busy} onClick={() => void run(async () => { const created = await api.codex.createProvider({ template: 'tencent_token_plan' }); setSelectedId(created.id) }, '已创建腾讯 Token Plan 模板')}>从腾讯模板新建</button>
          <button disabled={busy} onClick={() => void run(async () => { const created = await api.codex.createProvider({ name: '自定义供应商', baseUrl: '', model: 'gpt-5.6-sol' }); setSelectedId(created.id) }, '已创建自定义供应商')}>新建自定义</button>
        </div>
      </div>
      {connection.providers.length ? <select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
        {connection.providers.map((provider: CodexProviderPublic) => <option key={provider.id} value={provider.id}>{provider.name}{provider.apiKeyConfigured ? '' : '（未配置 Key）'}{provider.id === connection.activeProviderId ? ' · 当前' : ''}</option>)}
      </select> : <p className="muted">还没有供应商。直连模式需要先从腾讯模板新建并填写 API Key。</p>}
      {selected ? <div className="codex-form-grid">
        <label>名称<input value={name} onChange={event => setName(event.target.value)} /></label>
        <label>Base URL<input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /></label>
        <label>API Key<input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={selected.apiKeyConfigured ? selected.apiKeyMasked || '已配置，留空不修改' : '粘贴 API Key'} /></label>
        <label>模型<input value={model} onChange={event => setModel(event.target.value)} /></label>
        <label>推理强度<select value={reasoningEffort} onChange={event => setReasoningEffort(event.target.value)}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
      </div> : null}
      {selected ? <div className="row">
        <button className="primary" disabled={busy} onClick={() => void run(() => api.codex.updateProvider(selected.id, { name, baseUrl, model, reasoningEffort, ...(apiKey ? { apiKey } : {}) }))}>保存供应商</button>
        <button disabled={busy} onClick={() => void run(() => api.codex.updateConnection({ mode: 'provider', activeProviderId: selected.id }))}>设为当前并直连</button>
        <button disabled={busy} onClick={() => void run(() => api.codex.deleteProvider(selected.id), '已删除供应商')}>删除</button>
      </div> : null}
    </div> : null}
    {message ? <p className={/失败|错误|需要|不可|未找到|尚未|超时/.test(message) ? 'error' : 'muted'}>{message}</p> : null}
  </div>
}

function HypitSettingsPanel({ config, refresh }: { config: HypitStatus | null; refresh: () => void }) {
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl || 'https://hypit.ai/v1')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { setBaseUrl(config?.baseUrl || 'https://hypit.ai/v1'); setApiKey('') }, [config])
  const save = async () => {
    setBusy(true); setMessage('')
    try {
      await api.hypit.updateConfig({ baseUrl, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })
      setApiKey('')
      setMessage('Hypit 配置已保存，将在后续新建任务中生效')
      refresh()
    } catch (error) { setMessage(errorText(error)) }
    finally { setBusy(false) }
  }
  const install = async () => {
    setBusy(true); setMessage('')
    try {
      const status = await api.hypit.install()
      setMessage(status.message)
      refresh()
    } catch (error) { setMessage(errorText(error)); refresh() }
    finally { setBusy(false) }
  }
  const installing = busy || Boolean(config?.busy)
  return <div className="hypit-settings">
    <div className="status-row"><span>Hypit CLI</span><span className={`pill ${config?.available ? 'ready' : 'failed'}`} title={config?.path || config?.packageName}>{config?.available ? shortVersion(config.version) || '已安装' : '未安装'}</span></div>
    <div className="status-row"><span>API Key</span><span className={`pill ${config?.apiKeyConfigured ? 'ready' : 'failed'}`}>{config?.apiKeyConfigured ? '已配置' : '未配置'}</span></div>
    <p>{config?.message || '正在检查 Hypit…'}</p>
    {!config?.available ? <p className="muted">将通过 npm 安装 <code>{config?.packageName || '@hypit/hypit'}</code>（与 Docker 镜像版本对齐）。</p> : null}
    <div className="row">
      <button disabled={installing} onClick={() => void install()}>{installing ? '处理中…' : config?.available ? '重新检查 Hypit' : '检查并安装 Hypit'}</button>
    </div>
    <div className="codex-form-grid">
      <label>HYPIT_BASE_URL<input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://hypit.ai/v1" /></label>
      <label>HYPIT_API_KEY<input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={config?.apiKeyConfigured ? config.apiKeyMasked || '已配置，留空不修改' : '粘贴 Hypit / HypiHub API Key'} /></label>
    </div>
    <p className="muted">保存后写入全局配置；新建 Hypit 任务时会自动写入工程 Runtime，并把变量注入任务进程。「生成成片」需要已配置 API Key。</p>
    <div className="row"><button className="primary" disabled={installing || !baseUrl.trim()} onClick={() => void save()}>{busy ? '保存中…' : '保存 Hypit 配置'}</button></div>
    {message ? <p className={/失败|错误|需要|不可|未找到|尚未|超时/.test(message) ? 'error' : 'muted'}>{message}</p> : null}
  </div>
}

function SettingsPage({ tools, codex, hypit, browser, refresh, logout }: { tools: ToolStatus | null; codex: CodexStatus | null; hypit: HypitStatus | null; browser: BrowserStatus | null; refresh: () => void; logout: () => void }) {
  const official = !codex || codex.mode === 'official'
  return <div className="settings-grid">
    <section className="panel settings-section">
      <h2>运行工具</h2>
      <p>下载与转码依赖的命令行工具。</p>
      {tools?.tools.map(tool => <div className="status-row" key={tool.name}><span>{tool.name}</span><span className={`pill ${tool.available ? 'ready' : 'failed'}`} title={tool.version || tool.error}>{tool.available ? shortVersion(tool.version) : '不可用'}</span></div>)}
      <button onClick={() => void api.tools.update().then(refresh)}>安装 / 更新工具</button>
    </section>
    <section className="panel settings-section codex-settings">
      <h2>Codex 视频分析</h2>
      <p>{codex?.message || '正在检查…'}</p>
      {codex ? <CodexRuntimeStatus status={codex} /> : null}
      {codex?.connection ? <CodexConnectionPanel connection={codex.connection} refresh={refresh} /> : null}
      {official && codex?.loginOutput ? <CodexLoginDetails status={codex} /> : null}
      <div className="row">
        <button className="primary" disabled={!codex?.available || !official || codex.busy || codex.authenticated} onClick={() => void api.codex.login().then(refresh)}>设备代码登录</button>
        {codex?.busy ? <button onClick={() => void api.codex.cancel().then(refresh)}>取消登录</button> : null}
        {official && codex?.authenticated ? <button onClick={() => void api.codex.logout().then(refresh)}>退出 Codex</button> : null}
      </div>
      {!official ? <p className="muted">当前为非官方模式，设备码登录已禁用。切换回「官方 ChatGPT」可恢复登录态（不会因切换丢失）。</p> : null}
    </section>
    <section className="panel settings-section">
      <h2>Hypit 生成服务</h2>
      <p>检查 Hypit CLI，并配置 HypiHub / Hypit 的 Base URL 与 API Key，供重新制作「生成成片」使用。</p>
      <HypitSettingsPanel config={hypit} refresh={refresh} />
    </section>
    <section className="panel settings-section">
      <h2>抖音浏览器</h2>
      <p>{browser?.message || '正在检查…'}</p>
      <div className="row"><a className="button" target="_blank" rel="noreferrer" href={browser?.remoteUrl || '/remote-browser/vnc.html?autoconnect=1&resize=scale'}>{browser?.mode === 'host' ? '打开本地浏览器' : '打开远程浏览器'}</a><button className="primary" disabled={!browser?.ready} onClick={() => void api.publisher.login().then(refresh)}>登录抖音</button></div>
    </section>
    <section className="panel settings-section">
      <h2>安全</h2>
      <p>媒体、任务与浏览器均受管理员会话保护。</p>
      <button onClick={logout}>退出工作台</button>
    </section>
  </div>
}

/* ------------------------------------------------------------------ app */

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null), [tab, setTab] = useState<Tab>(() => storedChoice(NAVIGATION_STORAGE_KEY, tabs, 'download')), [assets, setAssets] = useState<MediaAsset[]>([]), [analysisJobs, setAnalysisJobs] = useState<AnalysisJob[]>([]), [remakeJobs, setRemakeJobs] = useState<RemakeJob[]>([]), [batches, setBatches] = useState<PublishBatch[]>([]), [downloads, setDownloads] = useState<DownloadJob[]>([]), [tools, setTools] = useState<ToolStatus | null>(null), [codex, setCodex] = useState<CodexStatus | null>(null), [hypit, setHypit] = useState<HypitStatus | null>(null), [browser, setBrowser] = useState<BrowserStatus | null>(null)
  const loadLibrary = useCallback(() => { void api.library.list().then(setAssets) }, [])
  const loadTasks = useCallback(() => { void Promise.all([api.analysis.list(), api.remakes.list(), api.publisher.jobs()]).then(([a, r, p]) => { setAnalysisJobs(a); setRemakeJobs(r); setBatches(p) }) }, [])
  const loadSettings = useCallback(() => { void Promise.all([api.tools.status(), api.codex.status(), api.hypit.config(), api.publisher.status()]).then(([t, c, h, b]) => { setTools(t); setCodex(c); setHypit(h); setBrowser(b) }) }, [])
  useEffect(() => { void api.auth.session().then(value => setAuthenticated(value.authenticated)).catch(() => setAuthenticated(false)) }, [])
  useEffect(() => { try { window.localStorage.setItem(NAVIGATION_STORAGE_KEY, tab) } catch { /* storage unavailable */ } }, [tab])
  useEffect(() => { if (!authenticated) return; loadLibrary(); loadTasks(); loadSettings(); return onEvent(raw => { const event = raw as WorkbenchEvent; if (event.type === 'library') loadLibrary(); if (event.type === 'analysis' || event.type === 'remake' || event.type === 'publisher') { loadLibrary(); loadTasks() } if (event.type === 'codex') loadSettings() }) }, [authenticated, loadLibrary, loadSettings, loadTasks])
  useEffect(() => { if (!authenticated) return; void api.downloads.list().then(setDownloads); return onEvent(raw => { const event = raw as WorkbenchEvent; if (event.type === 'downloads') setDownloads(event.jobs) }) }, [authenticated])

  const activeDownloads = downloads.filter(job => ['queued', 'downloading'].includes(job.status)).length
  const unprocessed = useMemo(() => filterMediaAssets(assets, 'unprocessed', 'all', '').length, [assets])
  const awaiting = useMemo(() => assets.filter(asset => !asset.analysis).length, [assets])
  const runningTasks = analysisJobs.filter(job => ['queued', 'preparing', 'analyzing'].includes(job.status)).length + remakeJobs.filter(job => ['queued', 'preparing', 'directing', 'building'].includes(job.status)).length + batches.filter(batch => ['queued', 'waiting_local', 'running'].includes(batch.status)).length
  const attention = [...analysisJobs, ...remakeJobs, ...batches].some(item => ['failed', 'needs_attention', 'interrupted'].includes(item.status))
  const stages: Array<{ id: Tab; label: string; status: string; tone?: 'live' | 'alert' }> = [
    { id: 'download', label: '下载', status: activeDownloads ? `${activeDownloads} 下载中` : '空闲', tone: activeDownloads ? 'live' : undefined },
    { id: 'library', label: '媒体库', status: unprocessed ? `${unprocessed} 待审核` : awaiting ? `${awaiting} 待分析` : `${assets.length} 个视频` },
    { id: 'tasks', label: '任务', status: attention ? '需要检查' : runningTasks ? `${runningTasks} 运行中` : '空闲', tone: attention ? 'alert' : runningTasks ? 'live' : undefined },
  ]

  if (authenticated === null) return <div className="splash">正在启动工作台…</div>
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />
  return <div className="app">
    <header className="rail">
      <div className="brand"><div className="brand-mark">▶</div><div><h1>Social Video 工作台</h1><p>下载 → 分析 → 审核 → 发布</p></div></div>
      <nav className="stages" aria-label="工作流阶段">{stages.map(stage => <button className={`stage ${tab === stage.id ? 'active' : ''}`} key={stage.id} aria-current={tab === stage.id ? 'page' : undefined} onClick={() => setTab(stage.id)}><strong>{stage.label}</strong><span className={`stage-status ${stage.tone || ''}`}>{stage.status}</span></button>)}</nav>
      <button className={`utility ${tab === 'settings' ? 'active' : ''}`} aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}>设置</button>
    </header>
    <div className={tab === 'library' ? 'content library-content' : 'content'}>
      {tab === 'download' ? <DownloadPage jobs={downloads} setJobs={setDownloads} />
        : tab === 'library' ? <LibraryPage assets={assets} remakes={remakeJobs} reload={loadLibrary} openTasks={taskTab => { try { window.localStorage.setItem(TASK_TAB_STORAGE_KEY, taskTab) } catch { /* storage unavailable */ } setTab('tasks') }} />
        : tab === 'tasks' ? <TasksPage analysis={analysisJobs} remakes={remakeJobs} batches={batches} assets={assets} reload={loadTasks} />
        : <SettingsPage tools={tools} codex={codex} hypit={hypit} browser={browser} refresh={loadSettings} logout={() => void api.auth.logout().then(() => setAuthenticated(false))} />}
    </div>
    <Toaster />
  </div>
}

export default App
