import 'dotenv/config';
import path from 'path';

export default {
  port: parseInt(process.env.PORT) || 10000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  discord: {
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackUrl: process.env.CALLBACK_URL,
    botToken: process.env.BOT_TOKEN,
    ownerId: process.env.OWNER_ID,
    scopes: ['identify', 'guilds'],
  },

  session: {
    secret: process.env.SESSION_SECRET || 'fx9-dashboard-secret',
    maxAge: 24 * 60 * 60 * 1000,
  },

  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/fx9_dashboard',
  },

  db: {
    path: process.env.BOT_DB_PATH || './data/bot.db',
  },

  dataPath: process.env.BOT_DATA_PATH || (process.env.BOT_DB_PATH ? path.dirname(process.env.BOT_DB_PATH) : './data'),

  security: {
    rateLimitWindow: 15 * 60 * 1000,
    rateLimitMax: 100,
    csrf: true,
  },
};
