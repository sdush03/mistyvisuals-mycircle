// Misty Visuals OS — Push Notification Service Worker
// Handles: push events, notification click, background PWA badge updates

self.addEventListener('push', function (event) {
  if (!event.data) return

  let data = {}
  try {
    data = event.data.json()
  } catch {
    data = { title: 'Misty Visuals', body: event.data.text(), url: '/' }
  }

  const title = data.title || 'Misty Visuals OS'
  const options = {
    body: data.body || data.message || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-96.png',
    data: { url: data.url || '/' },
    vibrate: [150, 50, 150],
    requireInteraction: false,
    // Use tag to avoid duplicate OS-level notifications for the same action
    tag: data.tag || 'mv-notification',
    renotify: true,
    // Show actions for action-required push
    actions: data.tag && data.tag.startsWith('mv-action')
      ? [{ action: 'open', title: 'Open' }]
      : [],
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  const url = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // If a window for the app is already open, focus it and navigate
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus()
          if ('navigate' in client) client.navigate(url)
          return
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})

// Handle message from app to update badge count
self.addEventListener('message', function (event) {
  if (event.data?.type === 'SET_BADGE' && typeof event.data.count === 'number') {
    if (event.data.count > 0) {
      try { self.navigator?.setAppBadge?.(event.data.count) } catch {}
    } else {
      try { self.navigator?.clearAppBadge?.() } catch {}
    }
  }
})
