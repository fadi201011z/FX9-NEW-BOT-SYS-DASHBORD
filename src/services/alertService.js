import { createAlert } from '../database.js';

export function sendAlert(guildId, type, severity, title, message) {
  createAlert(guildId, type, severity, title, message);
  console.log(`[Alert] [${severity}] ${title}: ${message}`);
}

export function notifySecurity(guildId, action, details) {
  sendAlert(guildId, 'security', 'high', `🔒 ${action}`, details);
}

export function notifyChange(guildId, action, details) {
  sendAlert(guildId, 'change', 'info', `📝 ${action}`, details);
}

export function notifyError(guildId, action, details) {
  sendAlert(guildId, 'error', 'critical', `❌ ${action}`, details);
}
