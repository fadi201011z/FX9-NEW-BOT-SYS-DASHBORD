import { Router } from 'express';
import { isAuthenticated, hasGuildAccess } from '../middleware/auth.js';
import { getGuildConfig, getActivity, getAlerts, getUserActivity, getAllGuildConfig } from '../database.js';
import config from '../config.js';
import { readJsonFile } from '../services/dataReader.js';

const router = Router();

router.get('/tickets/stats', async (req, res) => {
  const all = readJsonFile('fx9_data.json');
  const tickets = all.tickets || {};
  const list = Object.values(tickets);
  const open = list.filter(t => t.status === 'open').length;
  const closed = list.filter(t => t.status === 'closed').length;
  res.json({ total: list.length, open, closed });
});

router.get('/status', async (req, res) => {
  const start = Date.now();
  res.json({
    status: 'online',
    timestamp: Date.now(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nodeVersion: process.version,
    platform: process.platform,
    responseTime: Date.now() - start,
  });
});

router.get('/guild/:guildId/stats', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const config_data = getAllGuildConfig(guildId);
  const activity = getActivity(guildId, 500);
  const alerts = getAlerts(guildId, 50);

  const actionCounts = {};
  for (const a of activity) {
    actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;
  }

  res.json({
    guildId,
    configKeys: Object.keys(config_data).length,
    activityCount: activity.length,
    alertCount: alerts.length,
    actions: actionCounts,
  });
});

router.get('/user/activity', isAuthenticated, async (req, res) => {
  const activity = getUserActivity(req.session.user.id, 50);
  res.json({ activity });
});

router.get('/bot/info', async (req, res) => {
  res.json({
    name: 'FX9 Merged Bot',
    version: '5.0.0',
    description: 'FX9 Merged Bot — System + Tickets + Voice/Music',
    dashboard: 'FX9 Dashboard v1.0.0',
    owner: config.discord.ownerId,
    uptime: process.uptime(),
    nodeVersion: process.version,
  });
});

export default router;
