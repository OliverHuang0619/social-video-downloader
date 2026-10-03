import { describe, expect, it } from 'vitest'
import { buildPublishDescription, shouldWaitForCovers } from '../skills/english-video-catalog/scripts/douyin_publish_payload.mjs'

describe('抖音发布载荷', () => {
  it('作品简介只包含去重后的话题，不重复标题', () => {
    expect(buildPublishDescription({ title: 'Asking for Directions', topics: ['English', '#Directions', 'English'] })).toBe('#English #Directions')
  })

  it('仅在显式选择时等待封面完成', () => {
    expect(shouldWaitForCovers({})).toBe(false)
    expect(shouldWaitForCovers({ waitForCovers: false })).toBe(false)
    expect(shouldWaitForCovers({ waitForCovers: true })).toBe(true)
  })
})
