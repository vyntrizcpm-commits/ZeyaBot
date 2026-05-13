import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, REST, Routes } from 'discord.js';
import express from 'express';
import cron from 'node-cron';

import config from './config/application.js';
import { initializeDatabase } from './utils/database.js';
import { getGuildConfig } from './services/guildConfig.js';
import { getServerCounters, saveServerCounters, updateCounter } from './services/serverstatsService.js';
import { logger, startupLog, shutdownLog } from './utils/logger.js';
import { checkBirthdays } from './services/birthdayService.js';
import { checkGiveaways } from './services/giveawayService.js';
import { loadCommands } from './handlers/commandLoader.js';

class TitanBot extends Client {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildBans,
      ],
    });

    this.config = config;
    this.commands = new Collection();
    this.events = new Collection();
    this.buttons = new Collection();
    this.selectMenus = new Collection();
    this.modals = new Collection();
    this.cooldowns = new Collection();
    this.db = null;

    this.rest = new REST({ version: '10' }).setToken(config.bot.token);
  }

  async start() {
    try {
      startupLog('Starting TitanBot...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      startupLog('Initializing database...');
      const dbInstance = await initializeDatabase();
      this.db = dbInstance.db;

      const dbStatus = this.db.getStatus();
      if (dbStatus.isDegraded) {
        logger.warn('⚠️ DATABASE RUNNING IN DEGRADED MODE');
      } else {
        startupLog(`✅ Database Status: ${dbStatus.connectionType}`);
      }

      startupLog('Starting web server...');
      this.startWebServer();

      startupLog('Loading commands...');
      await loadCommands(this);
      startupLog(`Commands loaded: ${this.commands.size}`);

      startupLog('Loading handlers...');
      await this.loadHandlers();

      startupLog('Logging into Discord...');
      await this.login(this.config.bot.token);

      startupLog('Registering GLOBAL slash commands...');
      await this.registerCommands();

      startupLog('Discord login successful');

      const handlerSummary =
        `${this.buttons.size} buttons, ${this.selectMenus.size} menus, ${this.modals.size} modals`;

      startupLog(
        `ONLINE ✅ | ${this.commands.size} commands loaded | ${handlerSummary}`
      );

      this.setupCronJobs();

    } catch (error) {
      logger.error('Failed to start bot:', error);
      process.exit(1);
    }
  }

  startWebServer() {
    const app = express();
    const configuredPort = Number(this.config.api?.port || process.env.PORT || 3000);
    const host = process.env.WEB_HOST || '0.0.0.0';

    app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    app.listen(configuredPort, host, () => {
      startupLog(`Web server running on ${host}:${configuredPort}`);
    });
  }

  setupCronJobs() {
    cron.schedule('0 6 * * *', () => checkBirthdays(this));
    cron.schedule('* * * * *', () => checkGiveaways(this));
  }

  async loadHandlers() {
    const handlers = [
      { path: 'events', type: 'default', required: true },
      { path: 'interactions', type: 'default', required: true }
    ];

    for (const handler of handlers) {
      const module = await import(`./handlers/${handler.path}.js`);
      const loaderFn = module.default;

      if (typeof loaderFn === 'function') {
        await loaderFn(this);
        logger.info(`Loaded ${handler.path}`);
      }
    }
  }

  // ✅ FIXED GLOBAL COMMAND REGISTRATION
  async registerCommands() {
    try {
      const commands = [];

      for (const command of this.commands.values()) {
        if (command?.data?.toJSON) {
          commands.push(command.data.toJSON());
        }
      }

      const clientId = this.config.bot.clientId;

      logger.info(`Registering ${commands.length} GLOBAL slash commands...`);

      await this.rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );

      logger.info(`✅ GLOBAL slash commands registered`);

    } catch (error) {
      logger.error('Error registering commands:', error);
    }
  }

  async shutdown(reason = 'UNKNOWN') {
    logger.info(`Shutting down: ${reason}`);
    process.exit(0);
  }
}

const bot = new TitanBot();
bot.start();

export default TitanBot;
