import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { sanitizeInput } from '../../utils/sanitization.js';

export default {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send an announcement message to the current channel.')
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('The announcement message to send.')
                .setRequired(true)
                .setMaxLength(2000),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false),
    category: 'Utility',

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction, {
                flags: MessageFlags.Ephemeral,
            });
            if (!deferSuccess) {
                logger.warn('Announce interaction defer failed', {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'announce',
                });
                return;
            }

            const rawMessage = interaction.options.getString('message');
            const message = sanitizeInput(rawMessage, 2000);

            if (!message || message.length === 0) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            'Invalid Message',
                            'The announcement message cannot be empty.',
                        ),
                    ],
                });
            }

            await interaction.channel.send({ content: message });

            logger.info('Announce command executed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                messageLength: message.length,
                commandName: 'announce',
            });

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        `Your announcement has been sent to ${interaction.channel}.`,
                        '📢 Announcement Sent',
                    ),
                ],
            });
        } catch (error) {
            logger.error('Announce command error:', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'announce',
            });
            await handleInteractionError(interaction, error, {
                commandName: 'announce',
                source: 'announce_command',
            });
        }
    },
};
