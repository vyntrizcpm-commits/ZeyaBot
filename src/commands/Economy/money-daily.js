import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { formatDuration } from '../../utils/helpers.js';
import {
    ensureCurrencyTables,
    getUserCurrency,
    addMoneyCurrency,
    setLastDaily,
} from '../../utils/currencyHelper.js';

const DAILY_AMOUNT = 100;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export default {
    data: new SlashCommandBuilder()
        .setName('money-daily')
        .setDescription('Claim your daily 100 Money reward'),

    execute: withErrorHandling(async (interaction) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        await ensureCurrencyTables();

        const userId = interaction.user.id;
        logger.debug('[CURRENCY] /money-daily invoked', { userId });

        const userData = await getUserCurrency(userId);

        const now = Date.now();
        const lastDaily = userData.last_daily ? new Date(userData.last_daily).getTime() : 0;
        const nextClaim = lastDaily + DAILY_COOLDOWN_MS;

        if (now < nextClaim) {
            const remaining = nextClaim - now;
            throw createError(
                'Daily cooldown active',
                ErrorTypes.RATE_LIMIT,
                `You already claimed your daily reward. Try again in **${formatDuration(remaining)}**.`,
                { remaining, cooldownType: 'money-daily' }
            );
        }

        // Award Money and record timestamp
        const newBalance = await addMoneyCurrency(userId, DAILY_AMOUNT);
        await setLastDaily(userId);

        logger.info('[CURRENCY] Daily claimed', {
            userId,
            amount: DAILY_AMOUNT,
            newBalance,
        });

        const embed = successEmbed(
            `You claimed your daily **${DAILY_AMOUNT.toLocaleString()} Money**!`,
            '💰 Daily Reward Claimed!'
        )
            .addFields(
                { name: '💵 Amount', value: `${DAILY_AMOUNT.toLocaleString()} Money`, inline: true },
                { name: '🏦 New Balance', value: `${newBalance.toLocaleString()} Money`, inline: true }
            )
            .setFooter({ text: 'Come back in 24 hours for your next reward!' });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'money-daily' }),
};
