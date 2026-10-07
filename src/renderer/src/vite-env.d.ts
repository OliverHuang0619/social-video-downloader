/// <reference types="vite/client" />
import type { DownloaderApi } from '../../shared/types'
declare global { const __APP_VERSION__: string; const __APP_BUILD_TIME__: string }
declare global { interface Window { downloader: DownloaderApi } }
export {}
