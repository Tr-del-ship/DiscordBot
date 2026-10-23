import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import {
  addWarning,
  getModerationActions,
  getWarnings,
  hasModeratorRole,
  pruneAudit,
  removeWarning,
  removeTemporaryBan,
  searchAudit,
  setLogChannel,
  setModeratorRole,
  setTemporaryBan,
} from "../storage.js";

const messageAuditEnabled =
  process.env.ENABLE_MESSAGE_AUDIT?.toLowerCase() === "true";
const moderatorRoleCommands = new Set(["warn", "warnings", "clearwarnings"]);

async function requireGuild(interaction) {
  if (interaction.guild) return true;

  await interaction.reply({
    content: "This moderation command can only be used in a server.",
    ephemeral: true,
  });
  return false;
}

async function requirePermission(interaction, permission, label) {
  if (interaction.memberPermissions?.has(permission)) return true;
  if (
    moderatorRoleCommands.has(interaction.commandName) &&
    permission === PermissionFlagsBits.ModerateMembers &&
    interaction.guild
  ) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (
      await hasModeratorRole(
        interaction.guild.id,
        [...member.roles.cache.keys()],
      )
    ) {
      return true;
    }
  }

  await interaction.reply({
    content: `You need the **${label}** permission to use this command.`,
    ephemeral: true,
  });
  return false;
}

async function fetchMember(interaction, user) {
  try {
    return await interaction.guild.members.fetch(user.id);
  } catch (error) {
    if (error.code === 10007) return null;
    throw error;
  }
}

async function configureMutedRoleChannel(channel, role) {
  if (
    (!channel.isTextBased() && !channel.isVoiceBased()) ||
    !channel.permissionOverwrites
  ) {
    return;
  }

  const overwrite = channel.permissionOverwrites.cache.get(role.id);
  const permissions = {
    SendMessages: false,
    SendMessagesInThreads: false,
    AddReactions: false,
    Speak: false,
    Stream: false,
  };
  if (overwrite?.allow.has(PermissionFlagsBits.ViewChannel)) {
    permissions.ViewChannel = null;
  }
  await channel.permissionOverwrites.edit(role, permissions);
}

export async function configureMutedRoleForChannel(channel) {
  if (!channel.guild) return;
  const role = channel.guild.roles.cache.find(
    (candidate) => candidate.name.toLowerCase() === "muted",
  );
  if (role) await configureMutedRoleChannel(channel, role);
}

async function ensureMutedRole(guild) {
  const existing = guild.roles.cache.find(
    (role) => role.name.toLowerCase() === "muted",
  );
  const mutedRole = existing ?? await guild.roles.create({
    name: "Muted",
    color: 0x808080,
    reason: "Create a moderation role for muting members.",
  });

  for (const channel of guild.channels.cache.values()) {
    await configureMutedRoleChannel(channel, mutedRole);
  }

  return mutedRole;
}

function formatDuration(totalMinutes) {
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

const actionCommands = new Set([
  "kick",
  "ban",
  "timeout",
  "untimeout",
  "warn",
  "clearwarnings",
  "dm",
  "mute",
  "unmute",
  "deafen",
  "undeafen",
  "addrole",
  "removerole",
  "setnickname",
  "resetnickname",
  "softban",
  "tempban",
  "unban",
  "move",
  "disconnect",
  "cleanup",
]);

const botHierarchyCommands = new Set([
  "kick",
  "ban",
  "timeout",
  "untimeout",
  "mute",
  "unmute",
  "deafen",
  "undeafen",
  "addrole",
  "removerole",
  "setnickname",
  "resetnickname",
  "softban",
  "tempban",
]);

export async function checkModerationTarget(interaction) {
  if (!actionCommands.has(interaction.commandName)) return true;

  const user = interaction.options.getUser("user");
  if (!user) return true;
  if (user.id === interaction.user.id) {
    await interaction.reply({
      content: "You cannot use moderation commands on yourself.",
      ephemeral: true,
    });
    return false;
  }

  const guild = interaction.guild;
  if (!guild) return true;
  const [actor, target, botMember] = await Promise.all([
    guild.members.fetch(interaction.user.id),
    fetchMember(interaction, user),
    guild.members.fetchMe(),
  ]);
  if (!target) return true;

  const botMustOutrankTarget = botHierarchyCommands.has(interaction.commandName);
  const isOwner = interaction.user.id === guild.ownerId;
  if (
    !isOwner &&
    (target.id === guild.ownerId ||
      actor.roles.highest.comparePositionTo(target.roles.highest) <= 0)
  ) {
    await interaction.reply({
      content: "You can only moderate members with a lower top role than yours.",
      ephemeral: true,
    });
    return false;
  }
  const role = interaction.options.getRole("role");
  if (
    role &&
    (role.managed ||
      (!isOwner && actor.roles.highest.comparePositionTo(role) <= 0) ||
      botMember.roles.highest.comparePositionTo(role) <= 0)
  ) {
    await interaction.reply({
      content: "The role must be manageable and below both your highest role and the bot's highest role.",
      ephemeral: true,
    });
    return false;
  }
  if (
    botMustOutrankTarget &&
    (target.id === botMember.id ||
      botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0)
  ) {
    await interaction.reply({
      content: "The bot's highest role must be above the target's highest role.",
      ephemeral: true,
    });
    return false;
  }

  return true;
}

export const moderationCommands = [
  {
    data: new SlashCommandBuilder()
      .setName("createlogchannel")
      .setDescription("Choose where moderation and message audit logs are posted")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("An existing text channel")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageGuild,
          "Manage Server",
        ))
      ) {
        return;
      }

      const channel = interaction.options.getChannel("channel", true);
      const botMember =
        interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
      const botPermissions = channel.permissionsFor(botMember);
      if (
        !botPermissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
        ])
      ) {
        await interaction.reply({
          content: "The bot needs View Channel, Send Messages, and Embed Links in that channel before it can log there.",
          ephemeral: true,
        });
        return;
      }
      await setLogChannel(interaction.guild.id, channel.id);
      await interaction.reply({
        content: messageAuditEnabled
          ? `Moderation actions and message edits/deletions will be logged in <#${channel.id}> from now on.`
          : `Moderation actions will be logged in <#${channel.id}>. To also audit message edits and deletions, set ENABLE_MESSAGE_AUDIT=true and enable Message Content Intent in the Developer Portal, then restart the bot.`,
        ephemeral: true,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("removelogchannel")
      .setDescription("Disable moderation and message audit logging")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageGuild,
          "Manage Server",
        ))
      ) {
        return;
      }
      await setLogChannel(interaction.guild.id, null);
      await interaction.reply({
        content: "Message auditing and moderation log delivery are disabled for this server.",
        ephemeral: true,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("audit")
      .setDescription("Search recorded message edits and deletions")
      .setDefaultMemberPermissions(PermissionFlagsBits.ViewAuditLog)
      .addStringOption((option) =>
        option
          .setName("phrase")
          .setDescription("Text to find in the original or edited message")
          .setMaxLength(100),
      )
      .addStringOption((option) =>
        option
          .setName("user_id")
          .setDescription("Discord user ID to search for")
          .setMaxLength(20),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ViewAuditLog,
          "View Audit Log",
        ))
      ) {
        return;
      }

      const phrase = interaction.options.getString("phrase");
      const userId = interaction.options.getString("user_id");
      if (!phrase && !userId) {
        await interaction.reply({
          content: "Provide a phrase, a user ID, or both to search.",
          ephemeral: true,
        });
        return;
      }
      if (userId && !/^\d{17,20}$/.test(userId)) {
        await interaction.reply({
          content: "Enter a valid Discord user ID.",
          ephemeral: true,
        });
        return;
      }

      const matches = await searchAudit(interaction.guild.id, { phrase, userId });
      const lines = matches.slice(-10).reverse().map((event) => {
        const content = event.type === "delete"
          ? event.oldContent
          : `${event.oldContent} -> ${event.newContent}`;
        return `**${event.type}** <#${event.channelId}> <@${event.userId}> — ${new Date(event.timestamp).toLocaleString()}\n${(content || "[empty]").replace(/\s+/g, " ").slice(0, 150)}`;
      });
      await interaction.reply({
        content: matches.length
          ? `Found ${matches.length} record(s); showing the latest ${lines.length}:\n${lines.join("\n\n")}`.slice(0, 1900)
          : messageAuditEnabled
            ? "No matching audit records were found. Message auditing starts after /createlogchannel is configured."
            : "No records were found. Enable ENABLE_MESSAGE_AUDIT=true, enable Message Content Intent in the Developer Portal, and configure /createlogchannel to collect message audits.",
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("cleanuplogs")
      .setDescription("Delete message audit records older than a number of days")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addIntegerOption((option) =>
        option
          .setName("days")
          .setDescription("Retain audit records newer than this many days")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(3650),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageGuild,
          "Manage Server",
        ))
      ) {
        return;
      }

      const days = interaction.options.getInteger("days", true);
      const removed = await pruneAudit(
        interaction.guild.id,
        Date.now() - days * 24 * 60 * 60 * 1000,
      );
      await interaction.reply({
        content: `Removed ${removed} message audit record(s) older than ${days} day(s). Warning and moderation-action records were retained.`,
        ephemeral: true,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("moderatorperm")
      .setDescription("Grant or revoke warning-command access for a role")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addRoleOption((option) =>
        option.setName("role").setDescription("The moderator role").setRequired(true),
      )
      .addBooleanOption((option) =>
        option
          .setName("enabled")
          .setDescription("Whether the role can use warning commands")
          .setRequired(true),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageGuild,
          "Manage Server",
        ))
      ) {
        return;
      }

      const role = interaction.options.getRole("role", true);
      const enabled = interaction.options.getBoolean("enabled", true);
      if (role.managed || role.id === interaction.guild.id) {
        await interaction.reply({
          content: "That role cannot be used as a moderator role.",
          ephemeral: true,
        });
        return;
      }
      await setModeratorRole(interaction.guild.id, role.id, enabled);
      await interaction.reply({
        content: `${enabled ? "Granted" : "Revoked"} /warn, /warnings, and /clearwarnings access for **${role.name}**.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("ticket")
      .setDescription("Open a private support ticket"),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      const existingTicket = interaction.guild.channels.cache.find(
        (channel) =>
          channel.topic === `Support ticket opened by ${interaction.user.id}`,
      );
      if (existingTicket) {
        await interaction.reply({
          content: `You already have an open ticket: <#${existingTicket.id}>.`,
          ephemeral: true,
        });
        return;
      }

      const safeName = interaction.user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 70);
      await interaction.deferReply({ ephemeral: true });
      const channel = await interaction.guild.channels.create({
        name: `ticket-${safeName || interaction.user.id.slice(-6)}`,
        type: ChannelType.GuildText,
        topic: `Support ticket opened by ${interaction.user.id}`,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          {
            id: interaction.client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      });
      await channel.send({
        content: `<@${interaction.user.id}> Your ticket is open. Use /closeticket when you are finished.`,
        allowedMentions: { users: [interaction.user.id] },
      });
      await interaction.editReply(`Created your private ticket: <#${channel.id}>.`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("closeticket")
      .setDescription("Close the private ticket in this channel"),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      const channel = interaction.channel;
      const isTicket = channel?.name.startsWith("ticket-") &&
        channel.topic?.startsWith("Support ticket opened by ");
      const isOwner = channel?.topic === `Support ticket opened by ${interaction.user.id}`;
      const canManage = interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageChannels,
      );
      if (!isTicket || (!isOwner && !canManage)) {
        await interaction.reply({
          content: "Only the ticket opener or a channel manager can close this ticket.",
          ephemeral: true,
        });
        return;
      }
      await interaction.deferReply();
      await interaction.editReply("Closing this ticket in 5 seconds.");
      setTimeout(() => {
        channel.delete("Ticket closed").catch((error) => {
          console.error(`Unable to delete ticket channel ${channel.id}:`, error);
        });
      }, 5000);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("dm")
      .setDescription("Send a private message to a server member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The server member to message")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("The message to send")
          .setRequired(true)
          .setMaxLength(2000),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ModerateMembers,
          "Moderate Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.reply({
          content: "You can only use this command to message a member of this server.",
          ephemeral: true,
        });
        return;
      }

      const message = interaction.options.getString("message", true);
      await interaction.deferReply({ ephemeral: true });
      try {
        await user.send({
          content: message,
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        if (error.code === 50007) {
          await interaction.editReply({
            content: "That member's privacy settings prevent the bot from sending them a direct message.",
          });
          return;
        }
        throw error;
      }

      await interaction.editReply({
        content: `Sent a private message to **${user.tag}**.`,
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("message")
      .setDescription("Send a message as the bot in this channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("The message to send")
          .setRequired(true)
          .setMaxLength(2000),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageMessages,
          "Manage Messages",
        ))
      ) {
        return;
      }

      const channel = interaction.channel;
      if (!channel?.isTextBased() || !channel.isSendable()) {
        await interaction.reply({
          content: "The bot cannot send messages in this channel.",
          ephemeral: true,
        });
        return;
      }

      const botMember =
        interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
      if (!channel.permissionsFor(botMember)?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
      ])) {
        await interaction.reply({
          content: "The bot needs View Channel and Send Messages permissions here.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      await channel.send({
        content: interaction.options.getString("message", true),
        allowedMentions: { parse: [] },
      });
      await interaction.editReply({
        content: "Message sent.",
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("clear")
      .setDescription("Delete recent messages from this channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((option) =>
        option
          .setName("amount")
          .setDescription("Number of messages to delete (1–100)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageMessages,
          "Manage Messages",
        ))
      ) {
        return;
      }

      const channel = interaction.channel;
      if (!channel || typeof channel.bulkDelete !== "function") {
        await interaction.reply({
          content: "Messages cannot be bulk-deleted in this channel.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const deleted = await channel.bulkDelete(
        interaction.options.getInteger("amount", true),
        true,
      );
      await interaction.editReply(
        deleted.size
          ? `Deleted ${deleted.size} message${deleted.size === 1 ? "" : "s"}. Messages older than 14 days are skipped by Discord.`
          : "No messages were deleted. They may all be older than 14 days.",
      );
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Remove a member from this server")
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to kick")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Why the member is being kicked")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.KickMembers,
          "Kick Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      await interaction.deferReply({ ephemeral: true });
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.editReply("That user is not a member of this server.");
        return;
      }

      await member.kick(interaction.options.getString("reason") ?? undefined);
      await interaction.editReply(`Kicked **${user.tag}**.`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban a user from this server")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The user to ban")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Why the user is being banned")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.BanMembers,
          "Ban Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      await interaction.deferReply({ ephemeral: true });
      await interaction.guild.members.ban(user, {
        reason: interaction.options.getString("reason") ?? undefined,
      });
      await interaction.editReply(`Banned **${user.tag}**.`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Time out a member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to time out")
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName("minutes")
          .setDescription("Timeout length (1–40,320 minutes)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(40_320),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Why the member is being timed out")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ModerateMembers,
          "Moderate Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      await interaction.deferReply({ ephemeral: true });
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.editReply("That user is not a member of this server.");
        return;
      }

      const minutes = interaction.options.getInteger("minutes", true);
      await member.timeout(
        minutes * 60_000,
        interaction.options.getString("reason") ?? undefined,
      );
      await interaction.editReply(
        `Timed out **${user.tag}** for ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("untimeout")
      .setDescription("Remove a member's timeout")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to remove the timeout from")
          .setRequired(true),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ModerateMembers,
          "Moderate Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      await interaction.deferReply({ ephemeral: true });
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.editReply("That user is not a member of this server.");
        return;
      }

      await member.timeout(null);
      await interaction.editReply(`Removed **${user.tag}**'s timeout.`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Issue a warning to a member")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to warn")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The warning reason")
          .setRequired(true)
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ModerateMembers,
          "Moderate Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason", true);
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.reply({
          content: "That user is not a member of this server.",
          ephemeral: true,
        });
        return;
      }

      const warning = await addWarning(
        interaction.guild.id,
        user.id,
        interaction.user,
        reason,
      );

      try {
        await user.send({
          content: `You were warned in **${interaction.guild.name}**: ${reason}`,
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        if (error.code !== 50007) {
          console.error(`Unable to send warning DM to ${user.id}:`, error);
        }
      }
      await interaction.reply({
        content: `⚠️ Warned **${user.tag}** for: ${reason} (warning ID: \`${warning.id}\`).`,
        ephemeral: false,
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("warnings")
      .setDescription("Check the warnings for a member")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to inspect")
          .setRequired(true),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ModerateMembers,
          "Moderate Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const warnings = await getWarnings(interaction.guild.id, user.id);

      if (!warnings.length) {
        await interaction.reply({
          content: `**${user.tag}** currently has no logged warnings in this bot.`,
          ephemeral: true,
        });
        return;
      }

      const pages = [];
      let page = "";
      for (const warning of warnings) {
        const line = `\`${warning.id}\` ${new Date(warning.timestamp).toLocaleString()} — ${warning.reason} (mod: ${warning.moderatorTag})`;
        if (page && page.length + line.length + 1 > 1700) {
          pages.push(page);
          page = "";
        }
        page += `${page ? "\n" : ""}${line}`;
      }
      pages.push(page);

      await interaction.reply({
        content: `**Warn log for ${user.tag}** (${warnings.length} total)\n${pages[0]}`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      for (const nextPage of pages.slice(1)) {
        await interaction.followUp({
          content: nextPage,
          ephemeral: true,
          allowedMentions: { parse: [] },
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("clearwarnings")
      .setDescription("Clear one specific warning from a member")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to clear warnings from")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("warning_id")
          .setDescription("The warning ID shown by /warnings")
          .setRequired(true)
          .setMaxLength(32),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ModerateMembers,
          "Moderate Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const warningId = interaction.options.getString("warning_id", true);
      if (!(await removeWarning(interaction.guild.id, user.id, warningId))) {
        await interaction.reply({
          content: "That warning ID was not found for this member.",
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        content: `Cleared warning \`${warningId}\` for **${user.tag}**.`,
        ephemeral: true,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("mute")
      .setDescription("Mute a member by granting the Muted role")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to mute")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The mute reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageRoles,
          "Manage Roles",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.reply({
          content: "That user is not a member of this server.",
          ephemeral: true,
        });
        return;
      }

      const role = await ensureMutedRole(interaction.guild);
      await member.roles.add(role, interaction.options.getString("reason") ?? undefined);
      await interaction.reply({
        content: `🔇 Muted **${user.tag}**.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("unmute")
      .setDescription("Remove the muted role from a member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to unmute")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The unmute reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageRoles,
          "Manage Roles",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.reply({
          content: "That user is not a member of this server.",
          ephemeral: true,
        });
        return;
      }

      const role = interaction.guild.roles.cache.find(
        (candidate) => candidate.name.toLowerCase() === "muted",
      );
      if (role) {
        await member.roles.remove(role, interaction.options.getString("reason") ?? undefined);
      }
      await interaction.reply({
        content: `🔊 Unmuted **${user.tag}**.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("deafen")
      .setDescription("Deafen a member in voice chat")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to deafen")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The deafen reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ModerateMembers,
          "Moderate Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.reply({
          content: "That user is not a member of this server.",
          ephemeral: true,
        });
        return;
      }

      if (!member.voice.channel) {
        await interaction.reply({
          content: `**${user.tag}** is not in a voice channel.`,
          ephemeral: true,
        });
        return;
      }

      await member.voice.setDeaf(true, interaction.options.getString("reason") ?? undefined);
      await interaction.reply({
        content: `🔇 Deafened **${user.tag}**.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("undeafen")
      .setDescription("Undeafen a member in voice chat")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to undeafen")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The undeafen reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ModerateMembers,
          "Moderate Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.reply({
          content: "That user is not a member of this server.",
          ephemeral: true,
        });
        return;
      }

      if (!member.voice.channel) {
        await interaction.reply({
          content: `**${user.tag}** is not in a voice channel.`,
          ephemeral: true,
        });
        return;
      }

      await member.voice.setDeaf(false, interaction.options.getString("reason") ?? undefined);
      await interaction.reply({
        content: `🔊 Undeafened **${user.tag}**.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("addrole")
      .setDescription("Add a role to a member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to update")
          .setRequired(true),
      )
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("The role to add")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageRoles,
          "Manage Roles",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const role = interaction.options.getRole("role", true);
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.reply({
          content: "That user is not a member of this server.",
          ephemeral: true,
        });
        return;
      }

      await member.roles.add(role, interaction.options.getString("reason") ?? undefined);
      await interaction.reply({
        content: `Added **${role.name}** to **${user.tag}**.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("removerole")
      .setDescription("Remove a role from a member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to update")
          .setRequired(true),
      )
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("The role to remove")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageRoles,
          "Manage Roles",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const role = interaction.options.getRole("role", true);
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.reply({
          content: "That user is not a member of this server.",
          ephemeral: true,
        });
        return;
      }

      await member.roles.remove(role, interaction.options.getString("reason") ?? undefined);
      await interaction.reply({
        content: `Removed **${role.name}** from **${user.tag}**.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setnickname")
      .setDescription("Set a member's nickname")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to rename")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("nickname")
          .setDescription("Their new nickname")
          .setRequired(true)
          .setMaxLength(32),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageNicknames,
          "Manage Nicknames",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.reply({
          content: "That user is not a member of this server.",
          ephemeral: true,
        });
        return;
      }

      const nickname = interaction.options.getString("nickname", true);
      await member.setNickname(nickname, interaction.options.getString("reason") ?? undefined);
      await interaction.reply({
        content: `Set **${user.tag}**'s nickname to **${nickname}**.`,
        ephemeral: false,
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("resetnickname")
      .setDescription("Reset a member's nickname")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to reset")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageNicknames,
          "Manage Nicknames",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.reply({
          content: "That user is not a member of this server.",
          ephemeral: true,
        });
        return;
      }

      await member.setNickname(null, interaction.options.getString("reason") ?? undefined);
      await interaction.reply({
        content: `Reset **${user.tag}**'s nickname.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("slowmode")
      .setDescription("Set the slowmode for this channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addIntegerOption((option) =>
        option
          .setName("seconds")
          .setDescription("Slowmode length in seconds (0–21600)")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(21_600),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageChannels,
          "Manage Channels",
        ))
      ) {
        return;
      }

      const channel = interaction.channel;
      if (!channel || typeof channel.setRateLimitPerUser !== "function") {
        await interaction.reply({
          content: "This channel cannot use slowmode.",
          ephemeral: true,
        });
        return;
      }

      const seconds = interaction.options.getInteger("seconds", true);
      await channel.setRateLimitPerUser(seconds, "Slowmode set by moderation command");
      await interaction.reply({
        content: `Set slowmode to **${seconds}** second${seconds === 1 ? "" : "s"} in this channel.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("lock")
      .setDescription("Lock this channel so only admins can talk")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The lock reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageChannels,
          "Manage Channels",
        ))
      ) {
        return;
      }

      const channel = interaction.channel;
      if (!channel || !channel.isTextBased()) {
        await interaction.reply({
          content: "This command is only available in a text or voice channel.",
          ephemeral: true,
        });
        return;
      }

      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: false,
        AddReactions: false,
      });
      await interaction.reply({
        content: `🔒 Locked **${channel.name}**.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("unlock")
      .setDescription("Unlock this channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The unlock reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageChannels,
          "Manage Channels",
        ))
      ) {
        return;
      }

      const channel = interaction.channel;
      if (!channel || !channel.isTextBased()) {
        await interaction.reply({
          content: "This command is only available in a text or voice channel.",
          ephemeral: true,
        });
        return;
      }

      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: null,
        AddReactions: null,
      });
      await interaction.reply({
        content: `🔓 Unlocked **${channel.name}**.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("lockdown")
      .setDescription("Lock down all text channels in the server")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageChannels,
          "Manage Channels",
        ))
      ) {
        return;
      }

      const locked = [];
      for (const channel of interaction.guild.channels.cache.values()) {
        if (!channel.isTextBased()) continue;
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
          SendMessages: false,
          AddReactions: false,
        });
        locked.push(channel.name);
      }

      await interaction.reply({
        content: `🔒 Locked down ${locked.length} text channel${locked.length === 1 ? "" : "s"}.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("unlockdown")
      .setDescription("Unlock all text channels in the server")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageChannels,
          "Manage Channels",
        ))
      ) {
        return;
      }

      const unlocked = [];
      for (const channel of interaction.guild.channels.cache.values()) {
        if (!channel.isTextBased()) continue;
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
          SendMessages: null,
          AddReactions: null,
        });
        unlocked.push(channel.name);
      }

      await interaction.reply({
        content: `🔓 Unlocked ${unlocked.length} text channel${unlocked.length === 1 ? "" : "s"}.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("softban")
      .setDescription("Ban and immediately unban a user to clear recent messages")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The user to softban")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.BanMembers,
          "Ban Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") ?? "Softban";
      await interaction.guild.members.ban(user, { deleteMessageSeconds: 60 * 60 * 24, reason });
      await interaction.guild.members.unban(user, `Softban cleanup for ${reason}`);
      await interaction.reply({
        content: `🧼 Softbanned **${user.tag}**.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("tempban")
      .setDescription("Ban a user temporarily")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The user to temporarily ban")
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName("minutes")
          .setDescription("Ban length in minutes")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(10080),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.BanMembers,
          "Ban Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const minutes = interaction.options.getInteger("minutes", true);
      const reason = interaction.options.getString("reason") ?? "Temporary ban";
      const alreadyBanned = await interaction.guild.bans.fetch({ user: user.id })
        .catch((error) => {
          if (error.code === 10026) return null;
          throw error;
        });
      if (alreadyBanned) {
        await interaction.reply({
          content: "That user is already banned from this server.",
          ephemeral: true,
        });
        return;
      }

      const expiresAt = Date.now() + minutes * 60_000;
      await setTemporaryBan(interaction.guild.id, user.id, expiresAt);
      try {
        await interaction.guild.members.ban(user, {
          deleteMessageSeconds: 60 * 60 * 24,
          reason,
        });
      } catch (error) {
        await removeTemporaryBan(interaction.guild.id, user.id);
        throw error;
      }
      await interaction.reply({
        content: `⏲️ Temporarily banned **${user.tag}** for ${formatDuration(minutes)}.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("unban")
      .setDescription("Unban a user from the server")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The user to unban")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The unban reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.BanMembers,
          "Ban Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      await interaction.guild.members.unban(user, interaction.options.getString("reason") ?? undefined);
      await interaction.reply({
        content: `✅ Unbanned **${user.tag}**.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("banlist")
      .setDescription("List users currently banned from the server")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.BanMembers,
          "Ban Members",
        ))
      ) {
        return;
      }

      const bans = await interaction.guild.bans.fetch();
      const entries = bans.size
        ? [...bans.values()]
            .slice(0, 10)
            .map((ban) => `${ban.user.tag} — ${(ban.reason ?? "No reason provided").slice(0, 120)}`)
            .join("\n")
        : "No users are currently banned.";
      await interaction.reply({
        content: `**Ban list**\n${entries}`,
        ephemeral: false,
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("createinvite")
      .setDescription("Create an invite for this channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.CreateInstantInvite)
      .addIntegerOption((option) =>
        option
          .setName("minutes")
          .setDescription("Invite duration in minutes")
          .setMinValue(5)
          .setMaxValue(10080)
          .setRequired(false),
      )
      .addIntegerOption((option) =>
        option
          .setName("uses")
          .setDescription("Maximum uses")
          .setMinValue(1)
          .setMaxValue(100)
          .setRequired(false),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.CreateInstantInvite,
          "Create Instant Invite",
        ))
      ) {
        return;
      }

      const invite = await interaction.channel.createInvite({
        maxAge: (interaction.options.getInteger("minutes") ?? 60) * 60,
        maxUses: interaction.options.getInteger("uses") ?? 0,
      });
      await interaction.reply({
        content: `✅ Invite created: ${invite.url}`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("move")
      .setDescription("Move a member to a different voice channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to move")
          .setRequired(true),
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("The destination voice channel")
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The move reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.MoveMembers,
          "Move Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const targetChannel = interaction.options.getChannel("channel", true);
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.reply({
          content: "That user is not a member of this server.",
          ephemeral: true,
        });
        return;
      }

      await member.voice.setChannel(targetChannel, interaction.options.getString("reason") ?? undefined);
      await interaction.reply({
        content: `📍 Moved **${user.tag}** to **${targetChannel.name}**.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("disconnect")
      .setDescription("Disconnect a member from voice chat")
      .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to disconnect")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.MoveMembers,
          "Move Members",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const member = await fetchMember(interaction, user);
      if (!member) {
        await interaction.reply({
          content: "That user is not a member of this server.",
          ephemeral: true,
        });
        return;
      }

      await member.voice.disconnect(interaction.options.getString("reason") ?? undefined);
      await interaction.reply({
        content: `📞 Disconnected **${user.tag}** from voice.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("createchannel")
      .setDescription("Create a text channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("The channel name")
          .setRequired(true)
          .setMaxLength(100),
      )
      .addStringOption((option) =>
        option
          .setName("topic")
          .setDescription("The channel topic")
          .setMaxLength(1024),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageChannels,
          "Manage Channels",
        ))
      ) {
        return;
      }

      const channel = await interaction.guild.channels.create({
        name: interaction.options.getString("name", true),
        type: ChannelType.GuildText,
        topic: interaction.options.getString("topic") ?? undefined,
      });
      await interaction.reply({
        content: `✅ Created **#${channel.name}**.`,
        ephemeral: false,
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("deletechannel")
      .setDescription("Delete a channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("The channel to delete")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("The reason")
          .setMaxLength(512),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageChannels,
          "Manage Channels",
        ))
      ) {
        return;
      }

      const channel = interaction.options.getChannel("channel", true);
      await channel.delete(interaction.options.getString("reason") ?? "Deleted by moderator");
      await interaction.reply({
        content: `🗑️ Deleted **${channel.name}**.`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("roleinfo")
      .setDescription("Show details for a role")
      .setDefaultMemberPermissions(PermissionFlagsBits.ViewAuditLog)
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("The role to inspect")
          .setRequired(true),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ViewAuditLog,
          "View Audit Log",
        ))
      ) {
        return;
      }

      const role = interaction.options.getRole("role", true);
      const embed = new EmbedBuilder()
        .setColor(role.color || 0x5865f2)
        .setTitle(role.name)
        .addFields(
          { name: "ID", value: role.id, inline: true },
          { name: "Members", value: String(role.members.size), inline: true },
          { name: "Hoisted", value: role.hoist ? "Yes" : "No", inline: true },
          { name: "Mentionable", value: role.mentionable ? "Yes" : "No", inline: true },
          { name: "Position", value: String(role.position), inline: true },
        );
      await interaction.reply({ embeds: [embed], ephemeral: false });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("userinfo")
      .setDescription("Show details for a member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ViewAuditLog)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to inspect")
          .setRequired(true),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ViewAuditLog,
          "View Audit Log",
        ))
      ) {
        return;
      }

      const user = interaction.options.getUser("user", true);
      const member = await fetchMember(interaction, user);
      const [warnings, actions] = await Promise.all([
        getWarnings(interaction.guild.id, user.id),
        getModerationActions(interaction.guild.id, user.id),
      ]);
      const roles = member
        ? member.roles.cache
            .filter((role) => role.id !== interaction.guild.id)
            .map((role) => `<@&${role.id}>`)
            .join(", ")
        : "";
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(user.tag)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "ID", value: user.id, inline: true },
          { name: "Bot", value: user.bot ? "Yes" : "No", inline: true },
          { name: "Nickname", value: member?.nickname ?? "None", inline: true },
          { name: "Account created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`, inline: false },
          { name: "Joined", value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : "Not a member", inline: false },
          { name: "Roles", value: roles.slice(0, 1024) || "None", inline: false },
          { name: "Logged infractions", value: `Warnings: ${warnings.length}\nModeration actions: ${actions.length}`, inline: true },
        );
      await interaction.reply({ embeds: [embed], ephemeral: false });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("cleanup")
      .setDescription("Delete a user's recent messages in this channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The user whose messages should be removed")
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName("amount")
          .setDescription("Number of messages to remove")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageMessages,
          "Manage Messages",
        ))
      ) {
        return;
      }

      const channel = interaction.channel;
      if (!channel || typeof channel.messages?.fetch !== "function") {
        await interaction.reply({
          content: "This channel cannot remove messages right now.",
          ephemeral: true,
        });
        return;
      }

      const user = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      const messages = await channel.messages.fetch({ limit: 100 });
      const matching = messages.filter((message) => message.author.id === user.id).first(amount);
      if (!matching.length) {
        await interaction.reply({
          content: `No recent messages from **${user.tag}** were found in this channel.`,
          ephemeral: true,
        });
        return;
      }

      await channel.bulkDelete(matching, true);
      await interaction.reply({
        content: `🧹 Deleted ${matching.length} message${matching.length === 1 ? "" : "s"} from **${user.tag}**.`,
        ephemeral: false,
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("purgebots")
      .setDescription("Delete recent bot messages from this channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((option) =>
        option
          .setName("amount")
          .setDescription("Maximum bot messages to remove")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (
        !(await requirePermission(
          interaction,
          PermissionFlagsBits.ManageMessages,
          "Manage Messages",
        ))
      ) {
        return;
      }

      const channel = interaction.channel;
      if (!channel || typeof channel.messages?.fetch !== "function") {
        await interaction.reply({
          content: "This channel cannot remove messages right now.",
          ephemeral: true,
        });
        return;
      }

      const messages = await channel.messages.fetch({ limit: 100 });
      const botMessages = messages.filter((message) => message.author.bot).first(interaction.options.getInteger("amount", true));
      if (!botMessages.length) {
        await interaction.reply({
          content: "No bot messages were found in this channel.",
          ephemeral: true,
        });
        return;
      }

      await channel.bulkDelete(botMessages, true);
      await interaction.reply({
        content: `🤖 Deleted ${botMessages.length} bot message${botMessages.length === 1 ? "" : "s"}.`,
        ephemeral: false,
      });
    },
  },
];
