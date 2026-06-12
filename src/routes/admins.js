import { Router } from 'express';
import { isAuthenticated, hasGuildAccess } from '../middleware/auth.js';
import {
  getGuildAdmins, setAdminRole, removeAdmin, logActivity, logAudit,
  getGuildAdminRoles, setGuildAdminRole, removeGuildAdminRole, getGuildAdminRoleIds,
  getAdminsByGuildAndAddedBy, addAdminRaw, removeAdminByUserGuildAddedBy, getAdminRole,
} from '../database.js';
import { sanitizeInput } from '../middleware/security.js';
import { getGuildRoles, getGuildMember, getGuildMembersByRole, fetchBotMembersByRoles, fetchBotUser, fetchBotMembers } from '../auth/discord.js';
import config from '../config.js';

const router = Router();

async function autoSyncAdmins(guildId, callerUserId) {
  const adminRoles = await getGuildAdminRoleIds(guildId);
  if (adminRoles.length === 0) return { added: 0, removed: 0 };

  const roleIds = adminRoles.map(ar => ar.role_id);
  const hierarchy = { manager: 4, admin: 3, moderator: 2, support: 1 };

  // Fetch members from bot API (uses cache)
  let members = [];
  try {
    const raw = await fetchBotMembersByRoles(guildId, roleIds);
    // Compute highestLevel for each member based on which admin roles they have
    const roleLevelMap = {};
    for (const ar of adminRoles) roleLevelMap[ar.role_id] = ar.level;
    members = raw.map(m => {
      let highestLevel = 'moderator';
      let maxP = 0;
      for (const rid of m.roles) {
        if (roleLevelMap[rid] && hierarchy[roleLevelMap[rid]] > maxP) {
          maxP = hierarchy[roleLevelMap[rid]];
          highestLevel = roleLevelMap[rid];
        }
      }
      return { id: m.id, username: m.username, avatar: m.avatar, highestLevel };
    });
  } catch {
    // Fallback to Discord API
    for (const ar of adminRoles) {
      try {
        const apiMembers = await getGuildMembersByRole(guildId, ar.role_id, config.discord.botToken);
        for (const apiM of apiMembers) {
          const existing = members.find(x => x.id === apiM.user.id);
          if (existing) {
            if (hierarchy[ar.level] > hierarchy[existing.highestLevel]) {
              existing.highestLevel = ar.level;
            }
          } else {
            members.push({ id: apiM.user.id, username: apiM.user.username, avatar: apiM.user.avatar, highestLevel: ar.level });
          }
        }
      } catch {}
    }
  }

  const validUserIds = new Set(members.map(m => m.id));
  const userRoleMap = {};
  for (const m of members) {
    if (!userRoleMap[m.id] || hierarchy[m.highestLevel] > hierarchy[userRoleMap[m.id]]) {
      userRoleMap[m.id] = m.highestLevel;
    }
  }

  let added = 0, removed = 0;
  const existing = await getAdminsByGuildAndAddedBy(guildId, 'role_sync');

  for (const row of existing) {
    if (!validUserIds.has(row.userId)) {
      await removeAdminByUserGuildAddedBy(row.userId, guildId, 'role_sync');
      removed++;
    }
  }

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

  return { added, removed, memberCount: members.length };
}

// Fetch user info (username, avatar) from bot API and store in User collection
async function enrichAdminUsers(admins) {
  const { default: User } = await import('../models/User.js');
  const enriched = [];
  for (const a of admins) {
    if (a.username && a.avatar) {
      enriched.push(a);
    } else {
      try {
        const userData = await fetchBotUser(a.userId);
        if (userData) {
          await User.findOneAndUpdate(
            { userId: a.userId },
            { username: userData.username, avatar: userData.avatar },
            { upsert: true }
          );
          enriched.push({ ...a, username: userData.username, avatar: userData.avatar });
        } else {
          enriched.push(a);
        }
      } catch {
        enriched.push(a);
      }
    }
  }
  return enriched;
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
  const admins = await enrichAdminUsers(await getGuildAdmins(guildId));

  // Fetch admin role member info for the linked members card
  let adminRoleMembers = [];
  if (adminRoles.length > 0) {
    try {
      const roleIds = adminRoles.map(ar => ar.role_id);
      const raw = await fetchBotMembersByRoles(guildId, roleIds);
      const roleLevelMap = {};
      for (const ar of adminRoles) roleLevelMap[ar.role_id] = ar.level;
      const hierarchy = { manager: 4, admin: 3, moderator: 2, support: 1 };
      adminRoleMembers = raw.map(m => {
        let highestLevel = 'moderator';
        let maxP = 0;
        for (const rid of m.roles) {
          if (roleLevelMap[rid] && hierarchy[roleLevelMap[rid]] > maxP) {
            maxP = hierarchy[roleLevelMap[rid]];
            highestLevel = roleLevelMap[rid];
          }
        }
        return { ...m, highestLevel };
      });
    } catch {}
  }

  res.render('guild/admins', {
    user: req.session.user,
    guild,
    admins,
    adminRoles,
    guildRoles,
    adminRoleMembers,
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

    res.json({ success: true, memberCount: result.memberCount, added: result.added, message: `تم تعيين الدور. تمت مزامنة ${result.added} أعضاء.` });
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

    res.json({ success: true, memberCount: result.memberCount, removed: result.removed, message: `تم إزالة الدور. تمت مزامنة إزالة ${result.removed} أعضاء.` });
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

export { autoSyncAdmins };
export default router;
