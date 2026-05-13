import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed, successEmbed, errorEmbed } from '../../utils/embeds.js';
import { getFromDb, setInDb, deleteFromDb, getAFKKey } from '../../utils/database.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const MAX_REASON_LENGTH = 200;

export default {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set or remove your AFK status')
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Your AFK reason (omit or use "remove" to clear your AFK status)')
        .setRequired(false)
        .setMaxLength(MAX_REASON_LENGTH)
    )
    .setDMPermission(false),
  category: 'Utility',

  async execute(interaction, config, client) {
    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction, {
        flags: MessageFlags.Ephemeral
      });
      if (!deferSuccess) {
        logger.warn('AFK interaction defer failed', {
          userId: interaction.user.id,
          guildId: interaction.guildId,
          commandName: 'afk'
        });
        return;
      }

      const reason = interaction.options.getString('reason');
      const afkKey = getAFKKey(interaction.guildId, interaction.user.id);

      // Remove AFK if no reason given or reason is "remove"
      if (!reason || reason.trim().toLowerCase() === 'remove') {
        const existing = await getFromDb(afkKey, null);

        if (!existing) {
          return await InteractionHelper.safeEditReply(interaction, {
            embeds: [
              errorEmbed("You don't currently have an AFK status set.")
            ]
          });
        }

        await deleteFromDb(afkKey);

        logger.info('AFK status removed', {
          userId: interaction.user.id,
          guildId: interaction.guildId
        });

        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            successEmbed(
              `Welcome back, ${interaction.user.displayName}! Your AFK status has been removed.`,
              '👋 AFK Removed'
            )
          ]
        });
      }

      // Set AFK status
      const afkData = {
        reason: reason.trim(),
        timestamp: Date.now(),
        userId: interaction.user.id,
        guildId: interaction.guildId
      };

      await setInDb(afkKey, afkData);

      logger.info('AFK status set', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        reason: afkData.reason
      });

      const embed = createEmbed({
        title: '💤 AFK Status Set',
        description: `You are now AFK. People who ping you will be notified.`,
        color: 'info',
        fields: [
          {
            name: '📝 Reason',
            value: afkData.reason,
            inline: false
          }
        ],
        footer: { text: 'Your AFK status will remain until you run /afk again.' },
        timestamp: true
      });

      return await InteractionHelper.safeEditReply(interaction, {
        embeds: [embed]
      });
    } catch (error) {
      logger.error('AFK command execution failed', {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        commandName: 'afk'
      });
      await handleInteractionError(interaction, error, {
        commandName: 'afk',
        source: 'afk_command'
      });
    }
  }
};
