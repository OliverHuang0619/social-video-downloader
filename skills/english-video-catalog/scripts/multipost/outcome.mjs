const CHALLENGES = ['请完成安全验证', '请完成验证', '滑块验证', '验证码', '访问过于频繁', '操作过于频繁', '账号存在风险']
const SUBMITTED = ['已提交审核', '提交审核成功', '稿件投递成功', '稿件提交成功', '投稿成功', '等待审核', '审核中', 'submitted for review', 'under review', 'review in progress']
const SUCCESS = ['发布成功', '发表成功', '提交成功', '审核通过', '发布完成', '作品已发布', '已成功发布', '定时发布成功', 'published successfully', 'successfully published', 'video published']
const FAILURE = ['发布失败', '发表失败', '提交失败', '上传失败', '投稿失败', '请先上传封面', '请上传封面', '封面不能为空', '封面必传', '未能选择系统推荐封面', '未能点击发布按钮', '必填信息未完成', '未能打开创作声明', '未能确认创作声明', '未能打开分区下拉框', '未找到“动画”', '未能确认分区', '审核未通过', '审核不通过', '发布未通过', '视频上传失败', '内容违规', '作品发布失败', 'failed to publish', 'publishing failed', 'upload failed', 'submission failed', 'rejected']
const INJECTOR_FAILURE = /发布过程中出错|发布失败|自动发布失败|未找到.?发布按钮/

export function detectChallenge(body = '') {
  return CHALLENGES.find(text => body.includes(text)) || ''
}

export function detectLogin({ url = '', body = '', hasFileInput = false } = {}) {
  if (hasFileInput) return false
  const loginUrl = /\/(login|signin|sign-in|passport)(\/|$|\?)/i.test(url)
  const loginText = /扫码登录|请先登录|登录后继续|登录视频号助手|请使用微信扫|微信扫一扫|Sign in|Log in/.test(body)
  return loginUrl || loginText
}

/** Resolve explicit platform feedback first; ambiguous pages require manual review. */
export function classifyPublishOutcome({ url = '', body = '', notices = [], logs = [], scheduled = false, hasFileInput = false, expectedMarker = '' } = {}) {
  const challenge = detectChallenge(body)
  if (challenge) return { event: 'error', message: `MANUAL_REVIEW_REQUIRED：页面提示“${challenge}”，自动发布已暂停，请在可见浏览器中人工处理` }
  if (detectLogin({ url, body, hasFileInput })) return { event: 'error', message: 'LOGIN_REQUIRED：请先在发布浏览器中登录该平台' }
  const noticeText = notices.join('\n').toLowerCase()
  const pageText = body.toLowerCase()
  if (FAILURE.some(text => noticeText.includes(text.toLowerCase()))) return { event: 'error', message: `PUBLISH_FAILED：${notices.find(notice => FAILURE.some(text => notice.toLowerCase().includes(text.toLowerCase()))) || '平台明确提示发布失败'}` }
  if (FAILURE.some(text => pageText.includes(text.toLowerCase()))) return { event: 'error', message: `PUBLISH_FAILED：${FAILURE.find(text => pageText.includes(text.toLowerCase()))}` }
  const logFailure = logs.find(line => FAILURE.some(text => String(line).toLowerCase().includes(text.toLowerCase())))
  if (logFailure) return { event: 'error', message: `PUBLISH_FAILED：${String(logFailure).replace(/^PUBLISH_FAILED[：:]\s*/i, '')}` }
  if (SUBMITTED.some(text => noticeText.includes(text.toLowerCase()))) return { event: 'submitted' }
  if (SUCCESS.some(text => noticeText.includes(text.toLowerCase()))) return { event: scheduled ? 'scheduled' : 'published' }
  const marker = [...String(expectedMarker).replace(/\s+/g, ' ').trim()].slice(0, 20).join('').toLowerCase()
  if (marker.length >= 8 && pageText.includes(marker) && /视频管理/.test(body) && !/发布视频/.test(body)) return { event: 'submitted' }
  if (logs.some(line => INJECTOR_FAILURE.test(String(line)))) return { event: 'error', message: 'MANUAL_REVIEW_REQUIRED：发布脚本未完成，请在平台页面检查' }
  // Only use broad page text as a fallback: upload history and help content can
  // contain stale success/failure words unrelated to the current submission.
  if (SUBMITTED.some(text => pageText.includes(text.toLowerCase()))) return { event: 'submitted' }
  if (SUCCESS.some(text => pageText.includes(text.toLowerCase()))) return { event: scheduled ? 'scheduled' : 'published' }
  return { event: 'error', message: 'MANUAL_REVIEW_REQUIRED：未确认发布成功，请在平台页面检查' }
}

/** Keep observing the page briefly because many injectors return before their confirmation UI appears. */
export async function waitForPublishOutcome({ getState, wait, isClosed = () => false, logs = [], scheduled = false, expectedMarker = '', timeoutMs = 60_000 } = {}) {
  if (typeof getState !== 'function' || typeof wait !== 'function') throw new Error('缺少发布结果观察器')
  const deadline = Date.now() + timeoutMs
  let outcome
  do {
    const state = await getState()
    outcome = classifyPublishOutcome({ ...state, logs, scheduled, expectedMarker })
    if (outcome.event !== 'error' || !outcome.message.includes('未确认发布成功')) return outcome
    if (Date.now() >= deadline || isClosed()) break
    await wait(Math.min(1000, deadline - Date.now()))
  } while (Date.now() < deadline)
  return outcome
}
