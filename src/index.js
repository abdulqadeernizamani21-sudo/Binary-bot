const express = require('express');
const cron = require('node-cron');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const config = require('./config');
const logger = require('./utils/logger');
const { handleBinaryCommand } = require('./commands/binary');
const { handleBinaryAccuracyCommand } = require('./commands/binaryAccuracy');
const { runBinaryTrackerCycle } = require('./services/binaryTracker');
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
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
  });
  clientInstance = client;
  client.once('ready', () => logger.info(`Discord bot logged in as ${client.user.tag}`));
  client.on('messageCreate', (message) => handleMessage(message).catch((err) => logger.error('Unhandled message error:', err.message)));
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

function startTrackerCron() {
  cron.schedule('* * * * *', () => {
    runBinaryTrackerCycle().catch((err) => logger.error('Binary tracker cycle failed:', err.message));
  });
  logger.info('Binary signal tracker cron scheduled (every minute).');
}

function main() {
  startHealthServer();
  startDiscordBot();
  startTrackerCron();
}

if (require.main === module) {
  main();
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

module.exports = { routeCommand, handleMessage };
