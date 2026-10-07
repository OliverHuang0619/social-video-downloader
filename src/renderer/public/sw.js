self.addEventListener('push', event => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = { body: event.data?.text() || '' } }
  event.waitUntil(self.registration.showNotification(payload.title || '订阅更新', {
    body: payload.body || '发现新视频',
    tag: payload.tag || undefined,
    data: { url: payload.url || '/' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin)
  if (!['http:', 'https:'].includes(target.protocol)) return
  event.waitUntil(clients.openWindow(target.href))
})
