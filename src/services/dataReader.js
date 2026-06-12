import Ticket from '../models/Ticket.js';
import VoiceChannel from '../models/VoiceChannel.js';
import TicketGuildConfig from '../models/TicketGuildConfig.js';

export async function getGuildTickets(guildId) {
  const all = await Ticket.find({ guildId }).lean();
  return {
    open: all.filter(t => t.status === 'open'),
    closed: all.filter(t => t.status === 'closed'),
    total: all.length,
  };
}

export async function getTotalTicketCount() {
  return Ticket.countDocuments();
}

export async function getGuildVoiceChannels(guildId) {
  return VoiceChannel.find({ guildId }).lean();
}

export async function getTicketGuildConfig(guildId) {
  return TicketGuildConfig.findOne({ guildId }).lean();
}

export async function saveTicketGuildConfig(guildId, updates) {
  await TicketGuildConfig.findOneAndUpdate(
    { guildId },
    updates,
    { upsert: true, setDefaultsOnInsert: true }
  );
}
