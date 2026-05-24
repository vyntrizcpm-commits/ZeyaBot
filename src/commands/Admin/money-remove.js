import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { BotConfig } from '../../config/bot.js';
import {
    ensureCurrencyTables,
    getUserCurrency,
    removeMoneyCurrency,
} from '../../utils/currencyHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('money-remove')
        .setDescription('(Owner only) Remove Money from a user\'s balance')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to remove Money from')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Amount of Money to remove')
                .setRequired(true)
                .setMinValue(1)
        )
        .addStringOption(option =>
            option
                .setName('reason')
                .setDescription('Reason for removing Money (optional)')
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
            logger.warn('[CURRENCY] Unauthorized /money-remove attempt', {
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
                'Cannot remove Money from bot',
                ErrorTypes.VALIDATION,
                "You cannot remove Money from a bot account.",
                { userId: targetUser.id }
            );
        }

        logger.debug('[CURRENCY] /money-remove invoked', {
            adminId: interaction.user.id,
            targetId: targetUser.id,
            amount,
            reason,
        });

        // Check current balance first for a friendly error message
        const userData = await getUserCurrency(targetUser.id);
        if (userData.money < amount) {
            throw createError(
                'Insufficient funds to remove',
                ErrorTypes.VALIDATION,
                `${targetUser.tag} only has **${userData.money.toLocaleString()} Money** — cannot remove **${amount.toLocaleString()} Money** (would go negative).`,
                { available: userData.money, requested: amount, targetId: targetUser.id }
            );
        }

        let newBalance;
        try {
            newBalance = await removeMoneyCurrency(targetUser.id, amount);
        } catch (err) {
            if (err.message === 'INSUFFICIENT_FUNDS') {
                throw createError(
                    'Insufficient funds to remove (race condition)',
                    ErrorTypes.VALIDATION,
                    `${targetUser.tag} does not have enough Money to cover this removal.`,
                    { targetId: targetUser.id, amount }
                );
            }
            throw err;
        }

        logger.info('[CURRENCY] Admin removed Money', {
            adminId: interaction.user.id,
            targetId: targetUser.id,
            amount,
            newBalance,
            reason,
        });

        const embed = successEmbed(
            `Successfully removed **${amount.toLocaleString()} Money** from ${targetUser}'s balance.`,
            '✅ Money Removed'
        )
            .addFields(
                { name: '👤 User', value: `${targetUser.tag}`, inline: true },
                { name: '➖ Amount Removed', value: `${amount.toLocaleString()} Money`, inline: true },
                { name: '💵 New Balance', value: `${newBalance.toLocaleString()} Money`, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setFooter({
                text: `Action by ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL(),
            });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'money-remove' }),
};
