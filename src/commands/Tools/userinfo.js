import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

export default {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Display detailed information about a Discord user')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to look up (defaults to yourself)')
                .setRequired(false)
        )
        .setDMPermission(false),
    category: 'Tools',

    async execute(interaction) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn('UserInfo interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'userinfo',
            });
            return;
        }

        try {
            const targetUser = interaction.options.getUser('user') || interaction.user;

            // Fetch the full user object from the API to get banner and accent colour
            let fullUser;
            try {
                fullUser = await interaction.client.users.fetch(targetUser.id, { force: true });
            } catch {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('User Not Found', 'Could not retrieve information for that user.')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            // Attempt to fetch the guild member for server-specific data
            const member = interaction.guild
                ? await interaction.guild.members.fetch(targetUser.id).catch(() => null)
                : null;

            // ── Timestamps ────────────────────────────────────────────────────
            const createdAt = fullUser.createdAt;
            const createdTimestamp = Math.floor(createdAt.getTime() / 1000);

            // ── Username display ──────────────────────────────────────────────
            // New Discord usernames have discriminator "0"; show tag only for legacy accounts
            const usernameDisplay =
                fullUser.discriminator === '0'
                    ? fullUser.username
                    : `${fullUser.username}#${fullUser.discriminator}`;

            // ── Avatar ────────────────────────────────────────────────────────
            const avatarURL = fullUser.displayAvatarURL({ size: 256, extension: 'png', forceStatic: false });

            // ── Flags / badges ────────────────────────────────────────────────
            const badges = resolveUserBadges(fullUser.flags?.toArray() ?? []);

            // ── Build embed ───────────────────────────────────────────────────
            const embed = new EmbedBuilder()
                .setTitle(`👤 ${usernameDisplay}`)
                .setThumbnail(avatarURL)
                .setColor(member?.displayHexColor && member.displayHexColor !== '#000000'
                    ? member.displayHexColor
                    : getColor('primary'))
                .addFields(
                    {
                        name: '🪪 User ID',
                        value: `\`${fullUser.id}\``,
                        inline: true,
                    },
                    {
                        name: '🤖 Bot Account',
                        value: fullUser.bot ? 'Yes' : 'No',
                        inline: true,
                    },
                    {
                        name: '📅 Account Created',
                        value: `<t:${createdTimestamp}:F>\n<t:${createdTimestamp}:R>`,
                        inline: false,
                    },
                )
                .setTimestamp();

            // ── Server-specific fields (only when in a guild) ─────────────────
            if (member) {
                const joinedTimestamp = member.joinedAt
                    ? Math.floor(member.joinedAt.getTime() / 1000)
                    : null;

                if (joinedTimestamp) {
                    embed.addFields({
                        name: '📥 Joined Server',
                        value: `<t:${joinedTimestamp}:F>\n<t:${joinedTimestamp}:R>`,
                        inline: false,
                    });
                }

                // Display name (nickname) if different from username
                if (member.nickname) {
                    embed.addFields({
                        name: '🏷️ Server Nickname',
                        value: member.nickname,
                        inline: true,
                    });
                }

                // Top roles (excluding @everyone), capped at 10 to stay within embed limits
                const roles = member.roles.cache
                    .filter(r => r.id !== interaction.guild.id)
                    .sort((a, b) => b.position - a.position)
                    .map(r => r.toString());

                embed.addFields({
                    name: `🎭 Roles (${roles.length})`,
                    value: roles.length > 0
                        ? roles.slice(0, 10).join(' ') + (roles.length > 10 ? ` +${roles.length - 10} more` : '')
                        : 'No roles',
                    inline: false,
                });
            }

            // ── Badges ────────────────────────────────────────────────────────
            if (badges.length > 0) {
                embed.addFields({
                    name: '🏅 Badges',
                    value: badges.join(' '),
                    inline: false,
                });
            }

            // ── Avatar URL as a clickable link ────────────────────────────────
            embed.addFields({
                name: '🖼️ Avatar',
                value: `[Open full size](${avatarURL})`,
                inline: true,
            });

            // ── Banner (if the user has one) ──────────────────────────────────
            const bannerURL = fullUser.bannerURL({ size: 512, extension: 'png', forceStatic: false });
            if (bannerURL) {
                embed.setImage(bannerURL);
                embed.addFields({
                    name: '🎨 Banner',
                    value: `[Open full size](${bannerURL})`,
                    inline: true,
                });
            }

            embed.setFooter({ text: `Requested by ${interaction.user.username}` });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

            logger.debug('UserInfo command executed', {
                requesterId: interaction.user.id,
                targetId: fullUser.id,
                guildId: interaction.guildId,
            });
        } catch (error) {
            logger.error('UserInfo command error:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'userinfo',
            });
        }
    },
};

/**
 * Maps discord.js UserFlags array entries to human-readable badge strings.
 * @param {string[]} flags - Array of UserFlags key strings
 * @returns {string[]}
 */
function resolveUserBadges(flags) {
    const badgeMap = {
        Staff:                      '👨‍💼 Discord Staff',
        Partner:                    '🤝 Partnered Server Owner',
        Hypesquad:                  '🏠 HypeSquad Events',
        BugHunterLevel1:            '🐛 Bug Hunter (Level 1)',
        BugHunterLevel2:            '🐛 Bug Hunter (Level 2)',
        HypeSquadOnlineHouse1:      '🏠 HypeSquad Bravery',
        HypeSquadOnlineHouse2:      '🏠 HypeSquad Brilliance',
        HypeSquadOnlineHouse3:      '🏠 HypeSquad Balance',
        PremiumEarlySupporter:      '⭐ Early Supporter',
        VerifiedDeveloper:          '🔧 Verified Bot Developer',
        CertifiedModerator:         '🛡️ Discord Certified Moderator',
        ActiveDeveloper:            '💻 Active Developer',
        VerifiedBot:                '✅ Verified Bot',
    };

    return flags
        .filter(flag => badgeMap[flag])
        .map(flag => badgeMap[flag]);
}
