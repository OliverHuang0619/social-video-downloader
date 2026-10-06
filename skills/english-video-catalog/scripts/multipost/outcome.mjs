const CHALLENGES = ['请完成安全验证', '请完成验证', '滑块验证', '验证码', '访问过于频繁', '操作过于频繁', '账号存在风险']
const SUCCESS = ['发布成功', '发表成功', '提交成功', '上传成功', '已成功发布', '定时发布成功', 'published successfully', 'successfully published', 'video published']
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

/** Only a recognizable success result becomes published or scheduled. */
export function classifyPublishOutcome({ url = '', body = '', logs = [], scheduled = false, hasFileInput = false } = {}) {
  const challenge = detectChallenge(body)
  if (challenge) return { event: 'error', message: `MANUAL_REVIEW_REQUIRED：页面提示“${challenge}”，自动发布已暂停，请在可见浏览器中人工处理` }
  if (detectLogin({ url, body, hasFileInput })) return { event: 'error', message: 'LOGIN_REQUIRED：请先在发布浏览器中登录该平台' }
  if (logs.some(line => INJECTOR_FAILURE.test(String(line)))) return { event: 'error', message: 'MANUAL_REVIEW_REQUIRED：发布脚本未完成，请在平台页面检查' }
  const haystack = body.toLowerCase()
  if (SUCCESS.some(text => haystack.includes(text.toLowerCase()))) return { event: scheduled ? 'scheduled' : 'published' }
  return { event: 'error', message: 'MANUAL_REVIEW_REQUIRED：未确认发布成功，请在平台页面检查' }
}
