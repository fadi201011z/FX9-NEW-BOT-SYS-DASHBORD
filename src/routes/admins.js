import { Router } from 'express';
import { isAuthenticated, hasGuildAccess } from '../middleware/auth.js';
import { getGuildAdmins, setAdminRole, removeAdmin, logActivity, logAudit, getGuildAdminRoles, setGuildAdminRole, removeGuildAdminRole, getGuildAdminRoleIds, getAdminsByGuildAndAddedBy, addAdminRaw, removeAdminByUserGuildAddedBy, getAdminRole } from '../database.js';
import { sanitizeInput } from '../middleware/security.js';
import { getGuildRoles, getGuildMember, getGuildMembersByRole } from '../auth/discord.js';
import config from '../config.js';

const router = Router();

async function autoSyncAdmins(guildId, callerUserId) {
  const adminRoles = getGuildAdminRoleIds(guildId);
  if (adminRoles.length === 0) return { added: 0, removed: 0 };

  const validUserIds = new Set();
  const userRoleMap = {}; // userId -> admin dashboard role (from configured roles)

  for (const ar of adminRoles) {
    try {
      const members = await getGuildMembersByRole(guildId, ar.role_id, config.discord.botToken);
      for (const m of members) {
        validUserIds.add(m.user.id);
        // Highest role level wins
        const hierarchy = { manager: 4, admin: 3, moderator: 2, support: 1 };
        if (!userRoleMap[m.user.id] || hierarchy[ar.level] > hierarchy[userRoleMap[m.user.id]]) {
          userRoleMap[m.user.id] = ar.level;
        }
      }
    } catch {}
  }

  let added = 0, removed = 0;
  const existing = await getAdminsByGuildAndAddedBy(guildId, 'role_sync');

  // Remove admins who no longer have the role
  for (const row of existing) {
    if (!validUserIds.has(row.userId)) {
      await removeAdminByUserGuildAddedBy(row.userId, guildId, 'role_sync');
      removed++;
    }
  }

  // Add new admins
  for (const userId of validUserIds) {
    const exists = await getAdminRole(userId, guildId);
    if (!exists) {
      await addAdminRaw(userId, guildId, userRoleMap[userId] || 'moderator', 'role_sync');
      added++;
    }
  }

  if (added > 0 || removed > 0) {
    logActivity(callerUserId || 'role_sync', guildId, 'auto_sync_admin_roles', null,
      `مزامنة تلقائية: +${added} / -${removed}`, 'auto', 'auto');
  }

  return { added, removed };
}

router.get('/:guildId', isAuthenticated, hasGuildAccess, async (req, res) => {
  const { guildId } = req.params;
  const guild = req.session.user.guilds?.find(g => g.id === guildId);
  const adminRoles = await getGuildAdminRoles(guildId);

  let guildRoles = [];
  try {
    const botRes = await fetch(`${config.botApiUrl}/api/guilds/${guildId}/roles`);
    if (botRes.ok) {
      guildRoles = await botRes.json();
    } else {
      throw new Error('bot api failed');
    }
  } catch {
    try {
      guildRoles = await getGuildRoles(guildId, config.discord.botToken);
    } catch {}
  }

  // Auto-sync in background (non-blocking)
  autoSyncAdmins(guildId, req.session.user.id).catch(() => {});
  const admins = await getGuildAdmins(guildId);

  res.render('guild/admins', {
    user: req.session.user,
    guild,
    admins,
    adminRoles,
    guildRoles,
    title: 'إدارة المدراء',
  });
});

// ─── Role-based admin management ───────────────────────────────────────────

router.post('/:guildId/set-role', isAuthenticated, hasGuildAccess, sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { roleId, level } = req.body;
    if (!roleId || !level) return res.status(400).json({ error: 'Role ID and level required' });

    setGuildAdminRole(guildId, roleId, level, req.session.user.id);
    logActivity(req.session.user.id, guildId, 'set_admin_role', roleId, `تعيين رتبة ${level} للدور`, req.ip, req.sessionID);
    logAudit(req.session.user.id, guildId, 'set_admin_role', 'admin_role', null, roleId, req.ip, req.sessionID);

    // Auto-sync after adding a role
    const result = await autoSyncAdmins(guildId, req.session.user.id);

    res.json({ success: true, message: `تم تعيين الدور. تمت مزامنة ${result.added} أعضاء.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/remove-role', isAuthenticated, hasGuildAccess, sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { roleId } = req.body;
    if (!roleId) return res.status(400).json({ error: 'Role ID required' });

    removeGuildAdminRole(guildId, roleId);
    logActivity(req.session.user.id, guildId, 'remove_admin_role', roleId, 'إزالة دور إداري', req.ip, req.sessionID);
    logAudit(req.session.user.id, guildId, 'remove_admin_role', 'admin_role', roleId, null, req.ip, req.sessionID);

    // Auto-sync after removing a role
    const result = await autoSyncAdmins(guildId, req.session.user.id);

    res.json({ success: true, message: `تم إزالة الدور. تمت مزامنة إزالة ${result.removed} أعضاء.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/unlink', isAuthenticated, hasGuildAccess, sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { roleId } = req.body;
    if (!roleId) return res.status(400).json({ error: 'Role ID required' });
    removeGuildAdminRole(guildId, roleId);
    await autoSyncAdmins(guildId, req.session.user.id);
    res.json({ success: true, message: 'تم إلغاء ربط الدور والمزامنة.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Individual User Admin Management ──────────────────────────────────────

router.post('/:guildId/add', isAuthenticated, hasGuildAccess, sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId, role } = req.body;
    if (!userId || !role) return res.status(400).json({ error: 'User ID and role required' });

    setAdminRole(userId, guildId, role, req.session.user.id);
    logActivity(req.session.user.id, guildId, 'add_admin', userId, `إضافة مدير ${role}`, req.ip, req.sessionID);
    logAudit(req.session.user.id, guildId, 'add_admin', 'admin_role', null, role, req.ip, req.sessionID);

    res.json({ success: true, message: 'تمت إضافة المدير.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/remove', isAuthenticated, hasGuildAccess, sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    removeAdmin(userId, guildId);
    logActivity(req.session.user.id, guildId, 'remove_admin', userId, 'إزالة مدير', req.ip, req.sessionID);
    logAudit(req.session.user.id, guildId, 'remove_admin', 'admin', null, userId, req.ip, req.sessionID);

    res.json({ success: true, message: 'تمت إزالة المدير.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/update-role', isAuthenticated, hasGuildAccess, sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId, role } = req.body;
    if (!userId || !role) return res.status(400).json({ error: 'User ID and role required' });

    setAdminRole(userId, guildId, role, req.session.user.id);
    logActivity(req.session.user.id, guildId, 'update_admin_role', userId, `تغيير رتبة إلى ${role}`, req.ip, req.sessionID);
    logAudit(req.session.user.id, guildId, 'update_admin_role', 'admin_role', null, role, req.ip, req.sessionID);

    res.json({ success: true, message: 'تم تحديث الرتبة.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Webhook: Bot calls this when member roles change ─────────────────────

router.post('/webhook/sync-member', async (req, res) => {
  try {
    const { guildId, userId } = req.body;
    if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId required' });

  const adminRoles = await getGuildAdminRoleIds(guildId);
    if (adminRoles.length === 0) return res.json({ synced: false, reason: 'no admin roles configured' });

    // Fetch member's roles
    const member = await getGuildMember(guildId, userId, config.discord.botToken);
    if (!member) return res.json({ synced: false, reason: 'member not found' });

    const memberRoleIds = member.roles || [];
    let hasAdminRole = false;
    let matchedLevel = 'moderator';
    const hierarchy = { manager: 4, admin: 3, moderator: 2, support: 1 };

    for (const ar of adminRoles) {
      if (memberRoleIds.includes(ar.role_id)) {
        hasAdminRole = true;
        if (hierarchy[ar.level] > hierarchy[matchedLevel]) matchedLevel = ar.level;
      }
    }

    const existing = await getAdminRole(userId, guildId);

    if (hasAdminRole && !existing) {
      await addAdminRaw(userId, guildId, matchedLevel, 'role_sync');
      res.json({ synced: true, action: 'added' });
    } else if (!hasAdminRole && existing && existing.addedBy === 'role_sync') {
      await removeAdminByUserGuildAddedBy(userId, guildId, 'role_sync');
      res.json({ synced: true, action: 'removed' });
    } else {
      res.json({ synced: false, action: 'no_change' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Sync All ──────────────────────────────────────────────────────────────

router.post('/:guildId/sync', isAuthenticated, hasGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    const result = await autoSyncAdmins(guildId, req.session.user.id);
    res.json({ success: true, ...result, message: `تمت المزامنة: +${result.added} / -${result.removed}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
