import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ensureCurrencyTables, getAllShopItems } from '../../utils/currencyHelper.js';

const PAGE_SIZE = 8;

export default {
    data: new SlashCommandBuilder()
        .setName('money-shop')
        .setDescription('Browse the Money shop')
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

        logger.debug('[CURRENCY] /money-shop invoked', {
            userId: interaction.user.id,
            page,
        });

        const allItems = await getAllShopItems();

        if (allItems.length === 0) {
            throw createError(
                'Shop is empty',
                ErrorTypes.VALIDATION,
                'The shop has no items yet. An admin can add items with `/shop-item-add`.',
                {}
            );
        }

        const totalPages = Math.ceil(allItems.length / PAGE_SIZE);

        if (page > totalPages) {
            throw createError(
                'Shop page out of range',
                ErrorTypes.VALIDATION,
                `There are only **${totalPages}** page(s) in the shop.`,
                { page, totalPages }
            );
        }

        const pageItems = allItems.slice(offset, offset + PAGE_SIZE);

        const lines = pageItems.map(item => {
            const icon = item.emoji ? `${item.emoji} ` : '🛒 ';
            return `${icon}**${item.name}** — ${item.price.toLocaleString()} Money\n> ${item.description}`;
        });

        const embed = createEmbed({
            title: '🛍️ Money Shop',
            description: lines.join('\n\n'),
            color: 'economy',
            footer: `Page ${page} of ${totalPages} • Use /money-shop-buy <item_name> to purchase`,
        });

        logger.info('[CURRENCY] Shop browsed', {
            userId: interaction.user.id,
            page,
            itemsShown: pageItems.length,
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'money-shop' }),
};
