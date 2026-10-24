let ws = null;
let wsReconnectTimer = null;
let pollingInterval = null;

function startPolling() {
  // Fallback polling for serverless environments (Vercel)
  async function pollStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (document.getElementById('botStatus')) {
        if (data.botOnline) {
          document.getElementById('botStatus').innerHTML = '<span class="status-dot online"></span><span>البوت متصل</span>';
        } else {
          document.getElementById('botStatus').innerHTML = '<span class="status-dot offline"></span><span>غير متصل</span>';
        }
      }
    } catch {}
  }
  
  pollStatus();
  pollingInterval = setInterval(pollStatus, 30000);
}

function connectWebSocket() {
  // Try WebSocket first, fall back to polling
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected');
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      if (document.getElementById('botStatus')) {
        document.getElementById('botStatus').innerHTML = '<span class="status-dot online"></span><span>البوت متصل</span>';
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWSMessage(data);
      } catch {}
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      if (document.getElementById('botStatus')) {
        document.getElementById('botStatus').innerHTML = '<span class="status-dot offline"></span><span>غير متصل</span>';
      }
      wsReconnectTimer = setTimeout(connectWebSocket, 5000);
    };

    ws.onerror = () => {
      ws?.close();
      // Fall back to polling if WebSocket fails
      if (!pollingInterval) startPolling();
    };
  } catch {
    startPolling();
  }
}

function handleWSMessage(data) {
  switch (data.type) {
    case 'connected':
      console.log('[WS] Client ID:', data.clientId);
      break;
    case 'pong':
      break;
    case 'subscribed':
      console.log('[WS] Subscribed to guild:', data.guildId);
      break;
    case 'alerts':
      if (typeof updateAlerts === 'function') updateAlerts(data.alerts);
      break;
    case 'activity':
      if (typeof updateActivity === 'function') updateActivity(data.activity);
      break;
    case 'notification':
      if (typeof showToast === 'function') showToast(data.title || data.message);
      if (typeof updateNotifBadge === 'function') updateNotifBadge(1);
      break;
  }
}

function subscribeGuild(guildId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', guildId }));
  }
}

function fetchAlerts(guildId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'fetch_alerts', guildId }));
  }
}

function updateAlerts(alerts) {
  const container = document.getElementById('dashboardAlerts');
  if (!container) return;

  const badge = document.getElementById('notifBadge');
  if (badge) {
    const unread = alerts.filter(a => !a.read).length;
    badge.textContent = unread;
  }

  if (alerts.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle" style="color:var(--success)"></i><p>لا توجد تنبيهات</p></div>';
    return;
  }

  container.innerHTML = alerts.slice(0, 5).map(a => `
    <div class="alert-item severity-${a.severity}">
      <i class="fas fa-${a.severity === 'critical' ? 'exclamation-circle' : a.severity === 'high' ? 'exclamation-triangle' : 'info-circle'}"></i>
      <div class="alert-content">
        <strong>${a.title}</strong>
        <span>${a.message}</span>
      </div>
      <span class="alert-time">${new Date(a.timestamp).toLocaleTimeString('ar-SA')}</span>
    </div>
  `).join('');
}

function updateActivity(activity) {
}

function updateNotifBadge(count) {
  const badge = document.getElementById('notifBadge');
  if (badge) {
    const current = parseInt(badge.textContent) || 0;
    badge.textContent = current + count;
  }
}

// Try WebSocket, fall back to polling
connectWebSocket();
setTimeout(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (!pollingInterval) startPolling();
  }
}, 3000);

