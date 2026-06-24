import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole, clearDashboardRoleCache } from '../middleware/auth.js';
import {
  getGuildAdmins, setAdminRole, removeAdmin, logActivity, logAudit,
  getGuildAdminRoles, setGuildAdminRole, removeGuildAdminRole, getGuildAdminRoleIds,
  getAdminsByGuildAndAddedBy, addAdminRaw, removeAdminByUserGuildAddedBy, getAdminRole,
} from '../database.js';
import { sanitizeInput } from '../middleware/security.js';
import { getGuildRoles, getGuildMember, getGuildMembersByRole, fetchBotMembersByRoles, fetchBotUser, fetchBotMembers, getAllGuildMembersPaginated } from '../auth/discord.js';
import config from '../config.js';

const router = Router();

async function autoSyncAdmins(guildId, callerUserId) {
  const adminRoles = await getGuildAdminRoleIds(guildId);
  if (adminRoles.length === 0) return { added: 0, removed: 0 };

  const roleIds = adminRoles.map(ar => ar.role_id);
  const hierarchy = { manager: 4, admin: 3, moderator: 2, support: 1 };

  // Fetch members — Multi-level with empty-check fallthrough
  const roleLevelMap = {};
  for (const ar of adminRoles) roleLevelMap[ar.role_id] = ar.level;

  const computeLevel = (memberRoles) => {
    let highestLevel = 'moderator';
    let maxP = 0;
    for (const rid of memberRoles) {
      if (roleLevelMap[rid] && hierarchy[roleLevelMap[rid]] > maxP) {
        maxP = hierarchy[roleLevelMap[rid]];
        highestLevel = roleLevelMap[rid];
      }
    }
    return highestLevel;
  };

  const buildMembers = (rawList) => rawList.map(m => ({
    id: m.id || m.user?.id,
    username: m.username || m.user?.username,
    avatar: m.avatar || m.user?.avatar,
    highestLevel: computeLevel(m.roles || []),
  }));

  let members = [];

  // 1) Bot members-by-roles endpoint (cache, fastest but may be incomplete)
  try {
    const raw = await fetchBotMembersByRoles(guildId, roleIds);
    if (raw && raw.length > 0) members = buildMembers(raw);
  } catch {}

  // 2) Bot all-members endpoint + client filter (cache, broader)
  if (members.length === 0) {
    try {
      const all = await fetchBotMembers(guildId);
      if (all && all.length > 0) {
        const filtered = all.filter(m => m.roles && m.roles.some(r => roleIds.includes(r)));
        if (filtered.length > 0) members = buildMembers(filtered);
      }
    } catch {}
  }

  // 3) Discord API with pagination (always accurate, handles >1000 members)
  if (members.length === 0) {
    try {
      const allMembers = await getAllGuildMembersPaginated(guildId, config.discord.botToken);
      const roleIdSet = new Set(roleIds);
      const filtered = [];
      for (const m of allMembers) {
        if (m.roles && m.roles.some(r => roleIdSet.has(r))) {
          filtered.push({
            id: m.user.id,
            username: m.user.username,
            avatar: m.user.avatar,
            roles: m.roles,
          });
        }
      }
      if (filtered.length > 0) members = buildMembers(filtered);
    } catch {
      console.error(`[AdminSync] All methods failed for guild ${guildId}`);
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
      clearDashboardRoleCache(row.userId);
      removed++;
    }
  }

  for (const userId of validUserIds) {
    const exists = await getAdminRole(userId, guildId);
    if (!exists) {
      await addAdminRaw(userId, guildId, userRoleMap[userId] || 'moderator', 'role_sync');
      clearDashboardRoleCache(userId);
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

router.get('/:guildId', isAuthenticated, hasGuildAccess, requireRole('manager'), async (req, res) => {
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
    const roleIds = adminRoles.map(ar => ar.role_id);
    const roleLevelMap = {};
    for (const ar of adminRoles) roleLevelMap[ar.role_id] = ar.level;
    const hierarchy = { manager: 4, admin: 3, moderator: 2, support: 1 };
    const computeLevel = (memberRoles) => {
      let highestLevel = 'moderator', maxP = 0;
      for (const rid of memberRoles) {
        if (roleLevelMap[rid] && hierarchy[roleLevelMap[rid]] > maxP) {
          maxP = hierarchy[roleLevelMap[rid]];
          highestLevel = roleLevelMap[rid];
        }
      }
      return highestLevel;
    };
    let rawMembers = [];
    try {
      rawMembers = await fetchBotMembersByRoles(guildId, roleIds);
    } catch {}
    if (!rawMembers || rawMembers.length === 0) {
      try {
        const all = await fetchBotMembers(guildId);
        rawMembers = all.filter(m => m.roles && m.roles.some(r => roleIds.includes(r)));
      } catch {}
    }
    adminRoleMembers = (rawMembers || []).map(m => ({ ...m, highestLevel: computeLevel(m.roles || []) }));
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

const mgrOnly = requireRole('manager');

router.post('/:guildId/set-role', isAuthenticated, hasGuildAccess, mgrOnly, sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { roleId, level } = req.body;
    if (!roleId || !level) return res.status(400).json({ error: 'Role ID and level required' });

    await setGuildAdminRole(guildId, roleId, level, req.session.user.id);
    await logActivity(req.session.user.id, guildId, 'set_admin_role', roleId, `تعيين رتبة ${level} للدور`, req.ip, req.sessionID);
    await logAudit(req.session.user.id, guildId, 'set_admin_role', 'admin_role', null, roleId, req.ip, req.sessionID);

    const result = await autoSyncAdmins(guildId, req.session.user.id);

    res.json({ success: true, memberCount: result.memberCount, added: result.added, message: `تم تعيين الدور. تمت مزامنة ${result.added} أعضاء.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/remove-role', isAuthenticated, hasGuildAccess, mgrOnly, sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { roleId } = req.body;
    if (!roleId) return res.status(400).json({ error: 'Role ID required' });

    await removeGuildAdminRole(guildId, roleId);
    await logActivity(req.session.user.id, guildId, 'remove_admin_role', roleId, 'إزالة دور إداري', req.ip, req.sessionID);
    await logAudit(req.session.user.id, guildId, 'remove_admin_role', 'admin_role', roleId, null, req.ip, req.sessionID);

    const result = await autoSyncAdmins(guildId, req.session.user.id);

    res.json({ success: true, memberCount: result.memberCount, removed: result.removed, message: `تم إزالة الدور. تمت مزامنة إزالة ${result.removed} أعضاء.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/unlink', isAuthenticated, hasGuildAccess, mgrOnly, sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { roleId } = req.body;
    if (!roleId) return res.status(400).json({ error: 'Role ID required' });
    await removeGuildAdminRole(guildId, roleId);
    await autoSyncAdmins(guildId, req.session.user.id);
    res.json({ success: true, message: 'تم إلغاء ربط الدور والمزامنة.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/add', isAuthenticated, hasGuildAccess, mgrOnly, sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId, role } = req.body;
    if (!userId || !role) return res.status(400).json({ error: 'User ID and role required' });

    await setAdminRole(userId, guildId, role, req.session.user.id);
    clearDashboardRoleCache(userId);
    await logActivity(req.session.user.id, guildId, 'add_admin', userId, `إضافة مدير ${role}`, req.ip, req.sessionID);
    await logAudit(req.session.user.id, guildId, 'add_admin', 'admin_role', null, role, req.ip, req.sessionID);

    res.json({ success: true, message: 'تمت إضافة المدير.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/remove', isAuthenticated, hasGuildAccess, mgrOnly, sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    await removeAdmin(userId, guildId);
    clearDashboardRoleCache(userId);
    await logActivity(req.session.user.id, guildId, 'remove_admin', userId, 'إزالة مدير', req.ip, req.sessionID);
    await logAudit(req.session.user.id, guildId, 'remove_admin', 'admin', null, userId, req.ip, req.sessionID);

    res.json({ success: true, message: 'تمت إزالة المدير.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:guildId/update-role', isAuthenticated, hasGuildAccess, mgrOnly, sanitizeInput, async (req, res) => {
  try {
    const { guildId } = req.params;
    const { userId, role } = req.body;
    if (!userId || !role) return res.status(400).json({ error: 'User ID and role required' });

    await setAdminRole(userId, guildId, role, req.session.user.id);
    clearDashboardRoleCache(userId);
    await logActivity(req.session.user.id, guildId, 'update_admin_role', userId, `تغيير رتبة إلى ${role}`, req.ip, req.sessionID);
    await logAudit(req.session.user.id, guildId, 'update_admin_role', 'admin_role', null, role, req.ip, req.sessionID);

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
      clearDashboardRoleCache(userId);
      res.json({ synced: true, action: 'added' });
    } else if (!hasAdminRole && existing && existing.addedBy === 'role_sync') {
      await removeAdminByUserGuildAddedBy(userId, guildId, 'role_sync');
      clearDashboardRoleCache(userId);
      res.json({ synced: true, action: 'removed' });
    } else {
      res.json({ synced: false, action: 'no_change' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Sync All ──────────────────────────────────────────────────────────────

router.post('/:guildId/sync', isAuthenticated, hasGuildAccess, mgrOnly, async (req, res) => {
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
