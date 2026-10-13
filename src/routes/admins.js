import { Router } from 'express';
import { isAuthenticated, hasGuildAccess, requireRole, clearDashboardRoleCache } from '../middleware/auth.js';
import {
  getGuildAdmins, setAdminRole, removeAdmin, logActivity, logAudit,
  getGuildAdminRoles, setGuildAdminRole, removeGuildAdminRole, getGuildAdminRoleIds,
  getAdminsByGuildAndAddedBy, addAdminRaw, removeAdminByUserGuildAddedBy, getAdminRole,
} from '../database.js';
import { botFetch, botPost } from '../services/botApi.js';
import { sanitizeInput } from '../middleware/security.js';
import { getGuildRoles, getGuildMember, getGuildMembersByRole, fetchBotMembersByRoles, fetchBotUser, fetchBotMembers, getAllGuildMembersPaginated } from '../auth/discord.js';
import config from '../config.js';
import { resolveGuild } from '../services/guildResolver.js';
import {
  ROLE_CATALOG, ROLE_LEVEL, CAPABILITIES, CAPABILITY_LABELS,
  ADMIN_ROLES, capabilitiesForLevel, isValidAdminRole,
} from '../services/capabilities.js';

const router = Router();

// أدنى رتبة إدارية — تُستخدم كافتراضي عندما لا تُطابق أي رتبة معيّنة.
const LOWEST_ADMIN_ROLE = ADMIN_ROLES[0];
const rankOf = (role) => ROLE_LEVEL[role] ?? -1;

async function autoSyncAdmins(guildId, callerUserId) {
  const adminRoles = await getGuildAdminRoleIds(guildId);
  if (adminRoles.length === 0) return { added: 0, removed: 0 };

  const roleIds = adminRoles.map(ar => ar.roleId);

  // Fetch members — Multi-level with empty-check fallthrough
  const roleLevelMap = {};
  for (const ar of adminRoles) roleLevelMap[ar.roleId] = ar.level;

  const computeLevel = (memberRoles) => {
    let highestLevel = LOWEST_ADMIN_ROLE;
    let maxP = -1;
    for (const rid of memberRoles) {
      const lvl = roleLevelMap[rid];
      if (lvl && rankOf(lvl) > maxP) {
        maxP = rankOf(lvl);
        highestLevel = lvl;
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
    if (!userRoleMap[m.id] || rankOf(m.highestLevel) > rankOf(userRoleMap[m.id])) {
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
      await addAdminRaw(userId, guildId, userRoleMap[userId] || LOWEST_ADMIN_ROLE, 'role_sync');
      clearDashboardRoleCache(userId);
      added++;
    }
  }

  if (added > 0 || removed > 0) {
    logActivity(callerUserId || 'role_sync', guildId, 'auto_sync_admin_roles', null,
      `مزامنة تلقائية: +${added} / -${removed}`, 'auto', 'auto');
  }

  const warning = members.length === 0
    ? 'لم يُعثر على أعضاء يحملون الرتبة (0 عضو). إذا كان للرتبة أعضاء فعلاً، فتأكد من وصول الداشبورد إلى API البوت وأن رتبة الاختبار غير فارغة.'
    : undefined;

  return { added, removed, memberCount: members.length, warning };
}

// Fetch user info (username, avatar) from bot API and store in User collection
async function enrichAdminUsers(admins, fallbackMembers = []) {
  const { default: User } = await import('../models/User.js');
  const fallbackMap = {};
  for (const m of fallbackMembers) {
    if (m.id) fallbackMap[m.id] = m;
  }
  const enriched = [];
  for (const a of admins) {
    const fb = fallbackMap[a.userId];
    if (fb && !a.username) {
      a.username = fb.username;
      a.globalName = fb.globalName;
      a.avatar = fb.avatar;
      await User.findOneAndUpdate(
        { userId: a.userId },
        { username: a.username, avatar: a.avatar },
        { upsert: true }
      ).catch(() => {});
      enriched.push(a);
      continue;
    }
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
          enriched.push({ ...a, username: userData.username, globalName: userData.globalName, avatar: userData.avatar });
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
  const guild = await resolveGuild(req.session.user.guilds, guildId);
  if (!guild) return res.status(404).render('error', { layout: false, message: 'السيرفر غير موجود.', user: req.session.user });
  const adminRoles = await getGuildAdminRoles(guildId);

  let guildRoles = [];
  try {
    const botRes = await botFetch(`${config.botApiUrl}/api/guilds/${guildId}/roles`);
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

  // Normalize: exclude @everyone + managed integration roles, sort highest position first
  guildRoles = (Array.isArray(guildRoles) ? guildRoles : [])
    .filter(r => r.id && r.name && r.name !== '@everyone' && !r.managed)
    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

  // Auto-sync in background (non-blocking)
  autoSyncAdmins(guildId, req.session.user.id).catch(() => {});

  // Fetch admin role member info for the linked members card (also used as name fallback)
  let adminRoleMembers = [];
  if (adminRoles.length > 0) {
    const roleIds = adminRoles.map(ar => ar.roleId);
    const roleLevelMap = {};
    for (const ar of adminRoles) roleLevelMap[ar.roleId] = ar.level;
    const computeLevel = (memberRoles) => {
      let highestLevel = LOWEST_ADMIN_ROLE, maxP = -1;
      for (const rid of memberRoles) {
        const lvl = roleLevelMap[rid];
        if (lvl && rankOf(lvl) > maxP) {
          maxP = rankOf(lvl);
          highestLevel = lvl;
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

  const admins = await enrichAdminUsers(await getGuildAdmins(guildId), adminRoleMembers);

  // بطاقة الرتب + جدول الصلاحيات يُبنيان من نفس المصدر الذي تقرأ منه الحرّاس،
  // فلا يمكن للصفحة أن تعرض صلاحية لا يمنحها الحارس فعلاً.
  const roleCatalog = ROLE_CATALOG.map(r => ({
    ...r,
    permissions: capabilitiesForLevel(r.level).map(k => CAPABILITY_LABELS[k]).filter(Boolean),
    linkedRoles: adminRoles.filter(ar => ar.level === r.id).length,
  }));

  const roleMatrix = {
    roles: ROLE_CATALOG.map(r => ({ id: r.id, label: r.label, color: r.color, icon: r.icon })),
    rows: Object.keys(CAPABILITIES).map(key => ({
      key,
      label: CAPABILITY_LABELS[key] || key,
      has: ROLE_CATALOG.reduce((acc, r) => { acc[r.id] = r.level >= CAPABILITIES[key]; return acc; }, {}),
    })),
  };

  res.render('guild/admins', {
    user: req.session.user,
    guild,
    admins,
    adminRoles,
    guildRoles,
    adminRoleMembers,
    roleCatalog,
    roleMatrix,
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
    if (!isValidAdminRole(level)) return res.status(400).json({ error: 'رتبة غير صالحة' });

    await setGuildAdminRole(guildId, roleId, level, req.session.user.id);
    await logActivity(req.session.user.id, guildId, 'set_admin_role', roleId, `تعيين رتبة ${level} للدور`, req.ip, req.sessionID);
    await logAudit(req.session.user.id, guildId, 'set_admin_role', 'admin_role', null, roleId, req.ip, req.sessionID);

    const result = await autoSyncAdmins(guildId, req.session.user.id);

    res.json({ success: true, memberCount: result.memberCount, added: result.added, warning: result.warning, message: `تم تعيين الدور. تمت مزامنة ${result.added} أعضاء.` });
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

    res.json({ success: true, memberCount: result.memberCount, removed: result.removed, warning: result.warning, message: `تم إزالة الدور. تمت مزامنة إزالة ${result.removed} أعضاء.` });
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
    if (!isValidAdminRole(role)) return res.status(400).json({ error: 'رتبة غير صالحة' });

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
    if (!isValidAdminRole(role)) return res.status(400).json({ error: 'رتبة غير صالحة' });

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
    // ─── حارس الوارد: البوت وحده هو من يستدعي هذا المسار ──────────────────
    // بدون هذا التحقق يستطيع أي شخص إعادة مزامنة أدوار أي سيرفر
    // عبر تخمين guildId/userId فقط.
    const provided = req.get('x-api-key') || '';
    if (!config.apiSecret || provided !== config.apiSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { guildId, userId } = req.body;
    if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId required' });

    const adminRoles = await getGuildAdminRoleIds(guildId);
    if (adminRoles.length === 0) return res.json({ synced: false, reason: 'no admin roles configured' });

    // Fetch member's roles
    const member = await getGuildMember(guildId, userId, config.discord.botToken);
    if (!member) return res.json({ synced: false, reason: 'member not found' });

    const memberRoleIds = member.roles || [];
    let hasAdminRole = false;
    let matchedLevel = LOWEST_ADMIN_ROLE;

    for (const ar of adminRoles) {
      if (memberRoleIds.includes(ar.roleId)) {
        hasAdminRole = true;
        if (rankOf(ar.level) > rankOf(matchedLevel)) matchedLevel = ar.level;
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
