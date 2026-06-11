let ws = null;
let wsReconnectTimer = null;

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected');
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
    };
  } catch {}
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
      updateAlerts(data.alerts);
      break;
    case 'activity':
      updateActivity(data.activity);
      break;
    case 'notification':
      showToast(data.title || data.message);
      updateNotifBadge(1);
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

connectWebSocket();
