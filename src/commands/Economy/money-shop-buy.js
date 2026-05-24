import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    ensureCurrencyTables,
    getUserCurrency,
    removeMoneyCurrency,
    getShopItemByName,
    addToInventory,
} from '../../utils/currencyHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('money-shop-buy')
        .setDescription('Purchase an item from the Money shop')
        .addStringOption(option =>
            option
                .setName('item_name')
                .setDescription('Name of the item to buy')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        await ensureCurrencyTables();

        const userId = interaction.user.id;
        const itemName = interaction.options.getString('item_name');

        logger.debug('[CURRENCY] /money-shop-buy invoked', { userId, itemName });

        const item = await getShopItemByName(itemName);
        if (!item) {
            throw createError(
                `Shop item not found: ${itemName}`,
                ErrorTypes.VALIDATION,
                `No item named **${itemName}** exists in the shop. Use \`/money-shop\` to browse available items.`,
                { itemName }
            );
        }

        // Check balance before attempting deduction
        const userData = await getUserCurrency(userId);
        if (userData.money < item.price) {
            throw createError(
                'Insufficient funds for shop purchase',
                ErrorTypes.VALIDATION,
                `You need **${item.price.toLocaleString()} Money** to buy **${item.name}**, but you only have **${userData.money.toLocaleString()} Money**.`,
                { required: item.price, available: userData.money, itemName: item.name }
            );
        }

        // Deduct Money atomically
        let newBalance;
        try {
            newBalance = await removeMoneyCurrency(userId, item.price);
        } catch (err) {
            if (err.message === 'INSUFFICIENT_FUNDS') {
                throw createError(
                    'Insufficient funds (race condition)',
                    ErrorTypes.VALIDATION,
                    `You don't have enough Money to purchase **${item.name}**.`,
                    { userId, itemName: item.name }
                );
            }
            throw err;
        }

        // Add to inventory
        await addToInventory(userId, item.id);

        logger.info('[CURRENCY] Item purchased', {
            userId,
            itemId: item.id,
            itemName: item.name,
            price: item.price,
            newBalance,
        });

        const icon = item.emoji ? `${item.emoji} ` : '🛒 ';
        const embed = successEmbed(
            `You purchased ${icon}**${item.name}** for **${item.price.toLocaleString()} Money**!`,
            '🛍️ Purchase Successful'
        )
            .addFields(
                { name: '🛒 Item', value: `${icon}${item.name}`, inline: true },
                { name: '💸 Cost', value: `${item.price.toLocaleString()} Money`, inline: true },
                { name: '💵 New Balance', value: `${newBalance.toLocaleString()} Money`, inline: true }
            );

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'money-shop-buy' }),
};
