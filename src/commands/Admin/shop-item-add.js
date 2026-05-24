import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { BotConfig } from '../../config/bot.js';
import {
    ensureCurrencyTables,
    createShopItem,
    getShopItemByName,
} from '../../utils/currencyHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('shop-item-add')
        .setDescription('(Owner only) Add a new item to the Money shop')
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('Item name (must be unique)')
                .setRequired(true)
                .setMaxLength(100)
        )
        .addIntegerOption(option =>
            option
                .setName('price')
                .setDescription('Price in Money')
                .setRequired(true)
                .setMinValue(1)
        )
        .addStringOption(option =>
            option
                .setName('description')
                .setDescription('Item description')
                .setRequired(true)
                .setMaxLength(500)
        )
        .addStringOption(option =>
            option
                .setName('emoji')
                .setDescription('Optional emoji for the item (e.g. 🎁)')
                .setRequired(false)
                .setMaxLength(10)
        ),

    execute: withErrorHandling(async (interaction) => {
        // Owner-only check
        const ownerIds = BotConfig.commands.owners || [];
        if (!ownerIds.includes(interaction.user.id)) {
            await InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('This command is restricted to bot owners.')],
                flags: MessageFlags.Ephemeral,
            });
            logger.warn('[CURRENCY] Unauthorized /shop-item-add attempt', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });
            return;
        }

        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        await ensureCurrencyTables();

        const name = interaction.options.getString('name').trim();
        const price = interaction.options.getInteger('price');
        const description = interaction.options.getString('description').trim();
        const emoji = interaction.options.getString('emoji')?.trim() || null;

        logger.debug('[CURRENCY] /shop-item-add invoked', {
            adminId: interaction.user.id,
            name,
            price,
            emoji,
        });

        // Check for duplicate name
        const existing = await getShopItemByName(name);
        if (existing) {
            throw createError(
                `Duplicate shop item name: ${name}`,
                ErrorTypes.VALIDATION,
                `An item named **${name}** already exists in the shop. Choose a different name.`,
                { name }
            );
        }

        const item = await createShopItem(name, description, price, emoji);

        logger.info('[CURRENCY] Shop item created', {
            adminId: interaction.user.id,
            itemId: item.id,
            name: item.name,
            price: item.price,
        });

        const icon = emoji ? `${emoji} ` : '🛒 ';
        const embed = successEmbed(
            `${icon}**${item.name}** has been added to the shop for **${item.price.toLocaleString()} Money**.`,
            '✅ Shop Item Added'
        )
            .addFields(
                { name: '🏷️ Name', value: item.name, inline: true },
                { name: '💰 Price', value: `${item.price.toLocaleString()} Money`, inline: true },
                { name: '🆔 Item ID', value: String(item.id), inline: true },
                { name: '📄 Description', value: item.description, inline: false }
            )
            .setFooter({
                text: `Added by ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL(),
            });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'shop-item-add' }),
};
