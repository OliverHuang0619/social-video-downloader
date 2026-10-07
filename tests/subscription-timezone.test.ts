import { describe, expect, it } from 'vitest'
import { nextSubscriptionPollDate } from '../src/server/subscriptions'

describe('订阅巡检时区', () => {
  it('按配置时区计算当日下一次巡检', () => {
    const now = new Date('2026-10-07T00:00:00.000Z')
    expect(nextSubscriptionPollDate(9, 30, 'Asia/Shanghai', now).toISOString()).toBe('2026-10-07T01:30:00.000Z')
  })

  it('目标时刻已过时按本地日历推进到次日', () => {
    const now = new Date('2026-10-07T03:00:00.000Z')
    expect(nextSubscriptionPollDate(9, 30, 'Asia/Shanghai', now).toISOString()).toBe('2026-10-08T01:30:00.000Z')
  })

  it('DST 切换后仍按 IANA 时区的墙上时间计算', () => {
    const now = new Date('2026-03-08T05:00:00.000Z')
    expect(nextSubscriptionPollDate(9, 30, 'America/New_York', now).toISOString()).toBe('2026-03-08T13:30:00.000Z')
  })

  it('拒绝无效时区名称', () => {
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: 'Invalid/Zone' })).toThrow()
  })
})
