import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    ensureCurrencyTables,
    getLeaderboard,
    getTotalUsers,
} from '../../utils/currencyHelper.js';

const PAGE_SIZE = 10;
const RANK_EMOJI = ['🥇', '🥈', '🥉'];

export default {
    data: new SlashCommandBuilder()
        .setName('money-leaderboard')
        .setDescription('View the top Money earners')
        .addIntegerOption(option =>
            option
                .setName('page')
                .setDescription('Page number (default: 1)')
                .setRequired(false)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        await ensureCurrencyTables();

        const page = interaction.options.getInteger('page') || 1;
        const offset = (page - 1) * PAGE_SIZE;

        logger.debug('[CURRENCY] /money-leaderboard invoked', {
            userId: interaction.user.id,
            page,
        });

        const [entries, totalUsers] = await Promise.all([
            getLeaderboard(PAGE_SIZE, offset),
            getTotalUsers(),
        ]);

        if (entries.length === 0) {
            throw createError(
                'No currency data found',
                ErrorTypes.VALIDATION,
                page > 1
                    ? `There are no users on page **${page}**. Try a lower page number.`
                    : 'No one has any Money yet. Use `/money-daily` to get started!',
                { page }
            );
        }

        const totalPages = Math.ceil(totalUsers / PAGE_SIZE);

        const lines = entries.map((entry, i) => {
            const rank = offset + i + 1;
            const emoji = RANK_EMOJI[rank - 1] || `**#${rank}**`;
            return `${emoji} <@${entry.user_id}> — **${entry.money.toLocaleString()} Money**`;
        });

        const embed = createEmbed({
            title: '🏆 Money Leaderboard',
            description: lines.join('\n'),
            color: 'economy',
            footer: `Page ${page} of ${totalPages} • ${totalUsers.toLocaleString()} total users`,
        });

        logger.info('[CURRENCY] Leaderboard generated', {
            page,
            totalUsers,
            entriesReturned: entries.length,
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'money-leaderboard' }),
};
