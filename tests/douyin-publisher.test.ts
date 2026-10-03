import { describe, expect, it } from 'vitest'
import { buildPublishDescription, shouldWaitForCovers } from '../skills/english-video-catalog/scripts/douyin_publish_payload.mjs'

describe('抖音发布载荷', () => {
  it('作品简介只包含去重后的话题，不重复标题', () => {
    expect(buildPublishDescription({ title: 'Asking for Directions', topics: ['English', '#Directions', 'Asking for Directions', 'English'] })).toBe('#英语启蒙 #English #Directions')
  })

  it('过滤因标题长度限制形成的近似重复话题', () => {
    expect(buildPublishDescription({ title: 'The Cost of Using the Wrong Na', topics: ['叫错名字的代价', 'The Cost of Using the Wrong Name', '基础问答'] })).toBe('#英语启蒙 #叫错名字的代价 #基础问答')
  })

  it('仅在显式选择时等待封面完成', () => {
    expect(shouldWaitForCovers({})).toBe(false)
    expect(shouldWaitForCovers({ waitForCovers: false })).toBe(false)
    expect(shouldWaitForCovers({ waitForCovers: true })).toBe(true)
  })
})
