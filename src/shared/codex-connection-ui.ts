import type { CodexConnectionMode } from './types'

/** 供应商管理区始终可见，避免 CC Switch 下无法新建直连供应商。 */
export function shouldShowCodexProvidersManager(_mode: CodexConnectionMode) {
  return true
}

/** 允许选中直连模式；无供应商时由空状态引导新建，应用时由后端校验。 */
export function isCodexProviderModeSelectable(_providersCount: number) {
  return true
}
