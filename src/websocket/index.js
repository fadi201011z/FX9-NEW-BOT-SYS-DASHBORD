import { WebSocketServer } from 'ws';
import { getAlerts, getActivity } from '../database.js';

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  const clients = new Map();

  wss.on('connection', (ws, req) => {
    const clientId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    clients.set(clientId, ws);

    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
      timestamp: Date.now(),
    }));

    ws.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (data.type === 'subscribe') {
          const { guildId } = data;
          ws.guildId = guildId;
          ws.send(JSON.stringify({
            type: 'subscribed',
            guildId,
          }));
        }

        if (data.type === 'fetch_alerts') {
          const guildId = data.guildId || ws.guildId;
          if (guildId) {
            const alerts = await getAlerts(guildId, 20);
            ws.send(JSON.stringify({ type: 'alerts', alerts }));
          }
        }

        if (data.type === 'fetch_activity') {
          const guildId = data.guildId || ws.guildId;
          if (guildId) {
            const activity = await getActivity(guildId, 20);
            ws.send(JSON.stringify({ type: 'activity', activity }));
          }
        }
      } catch {}
    });

    ws.on('close', () => {
      clients.delete(clientId);
    });

    ws.on('error', () => {
      clients.delete(clientId);
    });
  });

  function broadcast(data, guildId) {
    const msg = JSON.stringify(data);
    for (const [, client] of clients) {
      if (!guildId || client.guildId === guildId) {
        if (client.readyState === 1) {
          client.send(msg);
        }
      }
    }
  }

  function notify(guildId, type, data) {
    broadcast({ type, ...data, timestamp: Date.now() }, guildId);
  }

  function broadcastAll(data) {
    broadcast(data, null);
  }

  return { wss, broadcast, notify, broadcastAll };
}
