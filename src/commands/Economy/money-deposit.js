import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    ensureCurrencyTables,
    getUserCurrency,
    transferMoneyCurrency,
} from '../../utils/currencyHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('money-deposit')
        .setDescription('Transfer Money to another user')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to send Money to')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Amount of Money to transfer')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        await ensureCurrencyTables();

        const senderId = interaction.user.id;
        const receiver = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        if (receiver.bot) {
            throw createError(
                'Cannot transfer to bot',
                ErrorTypes.VALIDATION,
                'You cannot send Money to a bot.',
                { receiverId: receiver.id }
            );
        }

        if (receiver.id === senderId) {
            throw createError(
                'Cannot transfer to self',
                ErrorTypes.VALIDATION,
                'You cannot send Money to yourself.',
                { senderId }
            );
        }

        logger.debug('[CURRENCY] /money-deposit invoked', {
            senderId,
            receiverId: receiver.id,
            amount,
        });

        // Verify sender has enough before attempting transfer
        const senderData = await getUserCurrency(senderId);
        if (senderData.money < amount) {
            throw createError(
                'Insufficient funds for transfer',
                ErrorTypes.VALIDATION,
                `You only have **${senderData.money.toLocaleString()} Money** but tried to send **${amount.toLocaleString()} Money**.`,
                { available: senderData.money, required: amount }
            );
        }

        let result;
        try {
            result = await transferMoneyCurrency(senderId, receiver.id, amount);
        } catch (err) {
            if (err.message === 'INSUFFICIENT_FUNDS') {
                throw createError(
                    'Insufficient funds (race condition)',
                    ErrorTypes.VALIDATION,
                    `You don't have enough Money to complete this transfer.`,
                    { senderId, amount }
                );
            }
            throw err;
        }

        logger.info('[CURRENCY] Money transferred', {
            senderId,
            receiverId: receiver.id,
            amount,
            senderNewBalance: result.fromBalance,
            receiverNewBalance: result.toBalance,
        });

        const embed = successEmbed(
            `You successfully sent **${amount.toLocaleString()} Money** to ${receiver}!`,
            '💸 Transfer Complete'
        )
            .addFields(
                { name: '💳 Amount Sent', value: `${amount.toLocaleString()} Money`, inline: true },
                { name: '💵 Your New Balance', value: `${result.fromBalance.toLocaleString()} Money`, inline: true }
            )
            .setFooter({
                text: `Sent to ${receiver.tag}`,
                iconURL: receiver.displayAvatarURL(),
            });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'money-deposit' }),
};
