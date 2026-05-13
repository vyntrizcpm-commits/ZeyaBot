




import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getLevelingConfig, getUserLevelData } from '../services/leveling.js';
import { addXp } from '../services/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 12;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    try {

      if (message.author.bot || !message.guild) return;

      client.afkUsers ??= new Map();

      const formatDuration = (ms) => {
        const seconds = Math.floor(ms / 1000);

        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        const parts = [];

        if (days) parts.push(`${days}d`);
        if (hours) parts.push(`${hours}h`);
        if (minutes) parts.push(`${minutes}m`);
        if (secs) parts.push(`${secs}s`);

        return parts.join(' ') || '0s';
      };

      
      if (
        client.afkUsers.has(message.author.id) &&
        !message.content.startsWith('z!afk')
      ) {

        const afkData = client.afkUsers.get(message.author.id);
        const duration = formatDuration(Date.now() - afkData.time);

        client.afkUsers.delete(message.author.id);

        message.reply({
          embeds: [
            {
              color: 0xffffff,
              description: `✅ ${message.author} your AFK has been removed.\n⏰ AFK Duration: **${duration}**`
            }
          ]
        }).catch(() => {});
      }

      
      if (message.mentions.users.size > 0) {

        const mentionedUser = message.mentions.users.first();

        if (client.afkUsers.has(mentionedUser.id)) {

          const afkData = client.afkUsers.get(mentionedUser.id);
          const duration = formatDuration(Date.now() - afkData.time);

          message.reply({
            embeds: [
              {
                color: 0xffffff,
                description: `🌙 ${mentionedUser.tag} is AFK.\n📝 Status: **${afkData.reason}**\n⏰ Since: **${duration}**`
              }
            ]
          }).catch(() => {});
        }
      }

      const prefix = 'z!';

      if (message.content.startsWith(prefix)) {

        const args = message.content
          .slice(prefix.length)
          .trim()
          .split(/ +/);

        const command = args.shift().toLowerCase();

        
        if (command === 'afk') {

          const reason = args.join(' ') || 'AFK';

          client.afkUsers.set(message.author.id, {
            reason,
            time: Date.now()
          });

          
          message.delete().catch(() => {});

          return message.channel.send({
            embeds: [
              {
                color: 0xffffff,
                description: `💤 ${message.author} is now AFK.\n📝 Status: **${reason}**`
              }
            ]
          });
        }
      }

      await handleLeveling(message, client);

    } catch (error) {
      logger.error('Error in messageCreate event:', error);
    }
  }
};

async function handleLeveling(message, client) {

  try {

    const rateLimitKey = `xp-event:${message.guild.id}:${message.author.id}`;

    const canProcess = await checkRateLimit(
      rateLimitKey,
      MESSAGE_XP_RATE_LIMIT_ATTEMPTS,
      MESSAGE_XP_RATE_LIMIT_WINDOW_MS
    );

    if (!canProcess) {
      return;
    }

    const levelingConfig = await getLevelingConfig(
      client,
      message.guild.id
    );

    if (!levelingConfig?.enabled) {
      return;
    }

    if (levelingConfig.ignoredChannels?.includes(message.channel.id)) {
      return;
    }

    if (levelingConfig.ignoredRoles?.length > 0) {

      const member = await message.guild.members
        .fetch(message.author.id)
        .catch(() => null);

      if (
        member &&
        member.roles.cache.some(role =>
          levelingConfig.ignoredRoles.includes(role.id)
        )
      ) {
        return;
      }
    }

    if (levelingConfig.blacklistedUsers?.includes(message.author.id)) {
      return;
    }

    if (!message.content || message.content.trim().length === 0) {
      return;
    }

    const userData = await getUserLevelData(
      client,
      message.guild.id,
      message.author.id
    );

    const cooldownTime = levelingConfig.xpCooldown || 60;

    const now = Date.now();

    const timeSinceLastMessage =
      now - (userData.lastMessage || 0);

    if (timeSinceLastMessage < cooldownTime * 1000) {
      return;
    }

    const minXP =
      levelingConfig.xpRange?.min ||
      levelingConfig.xpPerMessage?.min ||
      15;

    const maxXP =
      levelingConfig.xpRange?.max ||
      levelingConfig.xpPerMessage?.max ||
      25;

    const safeMinXP = Math.max(1, minXP);
    const safeMaxXP = Math.max(safeMinXP, maxXP);

    const xpToGive =
      Math.floor(
        Math.random() * (safeMaxXP - safeMinXP + 1)
      ) + safeMinXP;

    let finalXP = xpToGive;

    if (
      levelingConfig.xpMultiplier &&
      levelingConfig.xpMultiplier > 1
    ) {
      finalXP = Math.floor(
        finalXP * levelingConfig.xpMultiplier
      );
    }

    const result = await addXp(
      client,
      message.guild,
      message.member,
      finalXP
    );

    if (result.success && result.leveledUp) {

      logger.info(
        `${message.author.tag} leveled up to level ${result.level} in ${message.guild.name}`
      );
    }

  } catch (error) {

    logger.error(
      'Error handling leveling for message:',
      error
    );
  }
}
