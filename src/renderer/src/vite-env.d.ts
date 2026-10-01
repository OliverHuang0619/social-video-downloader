/// <reference types="vite/client" />
import type { DownloaderApi } from '../../shared/types'
declare global { interface Window { downloader: DownloaderApi } }
export {}
