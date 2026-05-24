import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { BotConfig } from '../../config/bot.js';
import {
    ensureCurrencyTables,
    addMoneyCurrency,
} from '../../utils/currencyHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('money-add')
        .setDescription('(Owner only) Add Money to a user\'s balance')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to add Money to')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Amount of Money to add')
                .setRequired(true)
                .setMinValue(1)
        )
        .addStringOption(option =>
            option
                .setName('reason')
                .setDescription('Reason for adding Money (optional)')
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction) => {
        // Owner-only check
        const ownerIds = BotConfig.commands.owners || [];
        if (!ownerIds.includes(interaction.user.id)) {
            await InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('This command is restricted to bot owners.')],
                flags: MessageFlags.Ephemeral,
            });
            logger.warn('[CURRENCY] Unauthorized /money-add attempt', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });
            return;
        }

        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        await ensureCurrencyTables();

        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (targetUser.bot) {
            throw createError(
                'Cannot add Money to bot',
                ErrorTypes.VALIDATION,
                "You cannot add Money to a bot account.",
                { userId: targetUser.id }
            );
        }

        logger.debug('[CURRENCY] /money-add invoked', {
            adminId: interaction.user.id,
            targetId: targetUser.id,
            amount,
            reason,
        });

        const newBalance = await addMoneyCurrency(targetUser.id, amount);

        logger.info('[CURRENCY] Admin added Money', {
            adminId: interaction.user.id,
            targetId: targetUser.id,
            amount,
            newBalance,
            reason,
        });

        const embed = successEmbed(
            `Successfully added **${amount.toLocaleString()} Money** to ${targetUser}'s balance.`,
            '✅ Money Added'
        )
            .addFields(
                { name: '👤 User', value: `${targetUser.tag}`, inline: true },
                { name: '➕ Amount Added', value: `${amount.toLocaleString()} Money`, inline: true },
                { name: '💵 New Balance', value: `${newBalance.toLocaleString()} Money`, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setFooter({
                text: `Action by ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL(),
            });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'money-add' }),
};
