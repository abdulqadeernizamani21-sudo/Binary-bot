const express = require('express');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const config = require('./config');
const logger = require('./utils/logger');
const { handleBinaryCommand } = require('./commands/binary');
const { splitForDiscord } = require('./utils/formatting');

let clientInstance = null;

async function routeCommand(text) {
  const trimmed = String(text || '').trim();
  if (/^!?binaryaccuracy\b/i.test(trimmed)) return handleBinaryAccuracyCommand();
  if (/^!?binary\b/i.test(trimmed)) {
    return handleBinaryCommand(trimmed.replace(/^!?binary\s*/i, ''));
  }
  return null;
}

async function deliverReply(message, text) {
  const chunks = splitForDiscord(text);
  const [first, ...rest] = chunks;
  await message.reply(first);
  for (const chunk of rest) {
    // eslint-disable-next-line no-await-in-loop
    await message.channel.send(chunk);
  }
}

async function handleMessage(message, deps = {}) {
  if (!message || message.author?.bot) return;
  const text = message.content || '';
  if (!text.trim().startsWith('!') && !/^(binary|binaryaccuracy)\b/i.test(text.trim())) return;
  logger.info(`Command from ${message.author?.tag || 'unknown'}: ${text}`);
  try {
    const reply = await (deps.routeCommand || routeCommand)(text);
    if (reply) await deliverReply(message, reply);
  } catch (err) {
    logger.error('Binary command handling error:', err.message);
    await deliverReply(message, `Error: ${err.message}`).catch(() => {});
  }
}

function startDiscordBot() {
  if (!config.discord.token) throw new Error('DISCORD_BOT_TOKEN is missing');
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel, Partials.User],
  });
  clientInstance = client;
  client.once('ready', () => logger.info(`Discord bot logged in as ${client.user.tag}`));
  client.on('messageCreate', (message) => handleMessage(message).catch((err) => logger.error('Unhandled message error:', err.message)));
  client.on('error', (err) => logger.error('Discord client error:', err.message));
  client.login(config.discord.token);
  return client;
}

function startHealthServer() {
  const app = express();
  app.get('/', (_req, res) => res.send('Binary Signal Bot is running.'));
  app.get('/health', (_req, res) => res.json({ ok: true, connected: !!clientInstance?.isReady() }));
  const server = app.listen(config.server.port, () => logger.info(`Health server listening on port ${config.server.port}`));
  return server;
}


function main() {
  try {
    logger.info('Starting Binary Signal Bot (Simplified - No Redis)...');
    logger.info('Environment check:');
    logger.info('- DISCORD_BOT_TOKEN:', config.discord.token ? 'Set ✓' : 'MISSING ✗');
    logger.info('- DISCORD_CHANNEL_ID:', process.env.DISCORD_CHANNEL_ID ? 'Set ✓' : 'MISSING ✗');
    logger.info('- TWELVEDATA_API_KEY:', config.twelvedata.apiKey ? 'Set ✓' : 'MISSING ✗');

    startHealthServer();
    startDiscordBot();
    logger.info('Binary Signal Bot fully initialized ✓');
  } catch (err) {
    logger.error('Fatal error during startup:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully...');
    process.exit(0);
  });
  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully...');
    process.exit(0);
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
    process.exit(1);
  });
}

module.exports = { routeCommand, handleMessage };
