import { Router } from 'express';
import { getAllGuildIdsWithAdminRoles, pruneLogs } from '../database.js';
import { autoSyncAdmins } from './admins.js';
import config from '../config.js';

const router = Router();

router.get('/admin-sync', async (req, res) => {
  // Verify cron secret for Vercel Cron
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const guildIds = await getAllGuildIdsWithAdminRoles();
    if (guildIds.length === 0) return res.json({ synced: 0 });
    
    let synced = 0;
    for (const guildId of guildIds) {
      try {
        const result = await autoSyncAdmins(guildId, 'system');
        if (result.added > 0 || result.removed > 0) {
          synced++;
        }
      } catch {}
    }
    
    res.json({ success: true, synced });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/log-retention', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const removed = await pruneLogs(config.logRetentionHours);
    const total = removed.server + removed.activity + removed.audit;
    res.json({ success: true, removed: total, details: removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
