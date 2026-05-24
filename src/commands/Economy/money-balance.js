import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ensureCurrencyTables, getUserCurrency } from '../../utils/currencyHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('money-balance')
        .setDescription("Check your or another user's Money balance")
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to check (defaults to you)')
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        await ensureCurrencyTables();

        const targetUser = interaction.options.getUser('user') || interaction.user;

        if (targetUser.bot) {
            throw createError(
                'Bot queried for currency balance',
                ErrorTypes.VALIDATION,
                "Bots don't have a Money balance.",
                { userId: targetUser.id }
            );
        }

        logger.debug('[CURRENCY] /money-balance invoked', {
            requesterId: interaction.user.id,
            targetId: targetUser.id,
        });

        const userData = await getUserCurrency(targetUser.id);

        const embed = createEmbed({
            title: `💰 ${targetUser.username}'s Balance`,
            description: `Here is the current Money balance for ${targetUser}.`,
            color: 'economy',
        })
            .addFields({
                name: '💵 Money',
                value: `${userData.money.toLocaleString()} Money`,
                inline: true,
            })
            .setThumbnail(targetUser.displayAvatarURL())
            .setFooter({
                text: `Requested by ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL(),
            });

        logger.info('[CURRENCY] Balance retrieved', {
            userId: targetUser.id,
            money: userData.money,
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'money-balance' }),
};
