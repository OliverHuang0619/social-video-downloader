export interface DouyinPublishPayload {
  title?: string
  topics?: unknown[]
  waitForCovers?: boolean
}

export function buildPublishDescription(job?: DouyinPublishPayload): string
export function shouldWaitForCovers(job?: DouyinPublishPayload): boolean
