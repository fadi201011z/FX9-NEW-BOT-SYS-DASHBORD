import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, isOwner, requireRole, getGuildPremium } from '../middleware/auth.js';
import { createBackupRecord, getBackupHistory, logActivity, logAudit, getAllGuildConfig } from '../database.js';
import { sanitizeInput } from '../middleware/security.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { resolveGuild } from '../services/guildResolver.js';
import Backup from '../models/Backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups');

const router = Router();
const mgrOnly = requireRole('manager');

// ── بوابة البريميوم: النسخ الاحتياطي ميزة مدفوعة ─────────────────────────
async function premiumActive(guildId) {
  try {
    const status = await getGuildPremium(guildId);
    return !!(status && status.active);
  } catch {
    return false;
  }
}

const PREMIUM_DENIED = {
  error: 'النسخ الاحتياطي ميزة بريميوم — فعّل اشتراكك للاستفادة منها.',
  premiumRequired: true,
};

router.get('/:guildId', isAuthenticated, hasGuildAccess, mgrOnly, async (req, res) => {
  const { guildId } = req.params;
  const guild = await resolveGuild(req.session.user.guilds, guildId);
  if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });
  const premium = await getGuildPremium(guildId);
  const backups = premium.active ? await getBackupHistory(guildId) : [];
  res.render('guild/backup', { user: req.session.user, guild, backups, premium, title: 'النسخ الاحتياطي' });
});

router.post('/:guildId/create', isAuthenticated, hasGuildAccess, mgrOnly, async (req, res) => {
  try {
    const { guildId } = req.params;
    if (!(await premiumActive(guildId))) return res.status(402).json(PREMIUM_DENIED);

    const config = await getAllGuildConfig(guildId);
    const backupData = { guildId, config, timestamp: Date.now() };
    const content = JSON.stringify(backupData, null, 2);
    const filename = `backup_${guildId}_${Date.now()}.json`;
    const size = Buffer.byteLength(content, 'utf-8');

    // Try to save to file (for local/dev) but don't fail if not possible (Vercel)
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const filePath = path.join(BACKUP_DIR, filename);
      fs.writeFileSync(filePath, content, 'utf-8');
    } catch {}

    await Backup.create({
      guildId,
      filename,
      size,
      createdAt: Date.now(),
      includes: { config: true },
      data: backupData
    });

    logActivity(req.session.user.id, guildId, 'create_backup', filename, 'إنشاء نسخة احتياطية', req.ip, req.sessionID);
    logAudit(req.session.user.id, guildId, 'create_backup', 'backup', null, filename, req.ip, req.sessionID);

    res.json({ success: true, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/restore', isAuthenticated, hasGuildAccess, mgrOnly, async (req, res) => {
  try {
    const { guildId } = req.params;
    if (!(await premiumActive(guildId))) return res.status(402).json(PREMIUM_DENIED);
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename required' });

    let data = null;
    // Try DB first (for Vercel)
    const backup = await Backup.findOne({ guildId, filename }).lean();
    if (backup?.data) {
      data = backup.data;
    } else {
      // Fallback to file (for local)
      const filePath = path.join(BACKUP_DIR, filename);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        data = JSON.parse(raw);
      }
    }

    if (!data) return res.status(404).json({ error: 'Backup not found' });

    const { setGuildConfig } = await import('../database.js');
    if (data.config) {
      for (const [key, value] of Object.entries(data.config)) {
        await setGuildConfig(guildId, key, value);
      }
    }

    logActivity(req.session.user.id, guildId, 'restore_backup', filename, 'استعادة نسخة احتياطية', req.ip, req.sessionID);
    logAudit(req.session.user.id, guildId, 'restore_backup', 'backup', null, filename, req.ip, req.sessionID);

    res.json({ success: true, message: 'تمت استعادة النسخة.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:guildId/download/:filename', isAuthenticated, hasGuildAccess, mgrOnly, async (req, res) => {
  const { guildId, filename } = req.params;
  if (!(await premiumActive(guildId))) return res.status(402).json(PREMIUM_DENIED);
  
  // Try DB first
  const backup = await Backup.findOne({ guildId, filename }).lean();
  if (backup?.data) {
    const content = JSON.stringify(backup.data, null, 2);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(content);
  }
  
  // Fallback to file
  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath);
});

export default router;
