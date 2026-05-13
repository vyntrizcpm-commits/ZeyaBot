




import { Events, EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getLevelingConfig, getUserLevelData } from '../services/leveling.js';
import { addXp } from '../services/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { getFromDb, getAFKKey } from '../utils/database.js';
import { getColor } from '../config/bot.js';

const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 12;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    try {
      
      if (message.author.bot || !message.guild) return;

      await handleAFKMentions(message, client);
      await handleLeveling(message, client);
    } catch (error) {
      logger.error('Error in messageCreate event:', error);
    }
  }
};








async function handleAFKMentions(message, client) {
  try {
    // Only process messages that mention at least one user
    if (!message.mentions.users.size) return;

    const afkEmbeds = [];

    for (const [userId, user] of message.mentions.users) {
      // Don't notify if the author pinged themselves
      if (userId === message.author.id) continue;

      const afkKey = getAFKKey(message.guild.id, userId);
      const afkData = await getFromDb(afkKey, null);

      if (!afkData) continue;

      const afkTimestamp = Math.floor(afkData.timestamp / 1000);

      const embed = new EmbedBuilder()
        .setColor(getColor('info'))
        .setTitle('💤 User is AFK')
        .setDescription(`${user} is currently AFK and may not respond.`)
        .addFields(
          { name: '📝 Reason', value: afkData.reason, inline: false },
          { name: '🕐 Since', value: `<t:${afkTimestamp}:R>`, inline: true }
        )
        .setThumbnail(user.displayAvatarURL({ size: 64 }))
        .setTimestamp();

      afkEmbeds.push(embed);
    }

    if (afkEmbeds.length > 0) {
      await message.reply({ embeds: afkEmbeds });
    }
  } catch (error) {
    logger.error('Error handling AFK mentions:', error);
  }
}

async function handleLeveling(message, client) {
  try {
    const rateLimitKey = `xp-event:${message.guild.id}:${message.author.id}`;
    const canProcess = await checkRateLimit(rateLimitKey, MESSAGE_XP_RATE_LIMIT_ATTEMPTS, MESSAGE_XP_RATE_LIMIT_WINDOW_MS);
    if (!canProcess) {
      return;
    }

    const levelingConfig = await getLevelingConfig(client, message.guild.id);
    
    if (!levelingConfig?.enabled) {
      return;
    }

    
    if (levelingConfig.ignoredChannels?.includes(message.channel.id)) {
      return;
    }

    
    if (levelingConfig.ignoredRoles?.length > 0) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => {
        return null;
      });
      if (member && member.roles.cache.some(role => levelingConfig.ignoredRoles.includes(role.id))) {
        return;
      }
    }

    
    if (levelingConfig.blacklistedUsers?.includes(message.author.id)) {
      return;
    }

    
    if (!message.content || message.content.trim().length === 0) {
      return;
    }

    const userData = await getUserLevelData(client, message.guild.id, message.author.id);
    
    
    const cooldownTime = levelingConfig.xpCooldown || 60;
    const now = Date.now();
    const timeSinceLastMessage = now - (userData.lastMessage || 0);
    
    
    if (timeSinceLastMessage < cooldownTime * 1000) {
      return;
    }

    
    const minXP = levelingConfig.xpRange?.min || levelingConfig.xpPerMessage?.min || 15;
    const maxXP = levelingConfig.xpRange?.max || levelingConfig.xpPerMessage?.max || 25;

    
    const safeMinXP = Math.max(1, minXP);
    const safeMaxXP = Math.max(safeMinXP, maxXP);

    
    const xpToGive = Math.floor(Math.random() * (safeMaxXP - safeMinXP + 1)) + safeMinXP;

    
    let finalXP = xpToGive;
    if (levelingConfig.xpMultiplier && levelingConfig.xpMultiplier > 1) {
      finalXP = Math.floor(finalXP * levelingConfig.xpMultiplier);
    }

    
    const result = await addXp(client, message.guild, message.member, finalXP);
    
    if (result.success && result.leveledUp) {
      logger.info(
        `${message.author.tag} leveled up to level ${result.level} in ${message.guild.name}`
      );
    }
  } catch (error) {
    logger.error('Error handling leveling for message:', error);
  }
}


