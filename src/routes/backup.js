import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, isOwner, requireRole } from '../middleware/auth.js';
import { createBackupRecord, getBackupHistory, logActivity, logAudit, getAllGuildConfig } from '../database.js';
import { sanitizeInput } from '../middleware/security.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups');

const router = Router();
const mgrOnly = requireRole('manager');

router.get('/:guildId', isAuthenticated, hasGuildAccess, mgrOnly, async (req, res) => {
  const { guildId } = req.params;
  const guild = req.session.user.guilds?.find(g => g.id === guildId);
  const backups = await getBackupHistory(guildId);
  res.render('guild/backup', { user: req.session.user, guild, backups, title: 'النسخ الاحتياطي' });
});

router.post('/:guildId/create', isAuthenticated, hasGuildAccess, mgrOnly, async (req, res) => {
  try {
    const { guildId } = req.params;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const config = await getAllGuildConfig(guildId);
    const filename = `backup_${guildId}_${Date.now()}.json`;
    const filePath = path.join(BACKUP_DIR, filename);
    const content = JSON.stringify({ guildId, config, timestamp: Date.now() }, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');

    const stats = fs.statSync(filePath);
    createBackupRecord(guildId, filename, stats.size, { config: true });

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
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename required' });

    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup not found' });

    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    const { setGuildConfig } = await import('../database.js');
    if (data.config) {
      for (const [key, value] of Object.entries(data.config)) {
        setGuildConfig(guildId, key, value);
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
  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath);
});

export default router;
