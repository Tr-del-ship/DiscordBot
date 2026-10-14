import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

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

async function ensureMutedRole(guild) {
  const existing = guild.roles.cache.find(
    (role) => role.name.toLowerCase() === "muted",
  );
  if (existing) return existing;

  const created = await guild.roles.create({
    name: "Muted",
    color: 0x808080,
    reason: "Create a moderation role for muting members.",
  });

  for (const channel of guild.channels.cache.values()) {
    if (!channel.isTextBased() && !channel.isVoiceBased()) continue;

    await channel.permissionOverwrites
      .edit(created, {
        SendMessages: false,
        SendMessagesInThreads: false,
        AddReactions: false,
        Speak: false,
        Stream: false,
        ViewChannel: true,
      })
      .catch(() => {});
  }

  return created;
}

function formatDuration(totalMinutes) {
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

const warningStore = new Map();

function getWarningKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getWarningsForMember(guild, user) {
  return warningStore.get(getWarningKey(guild.id, user.id)) ?? [];
}

function addWarning(guild, user, moderator, reason) {
  const key = getWarningKey(guild.id, user.id);
  const warnings = warningStore.get(key) ?? [];
  warnings.push({
    reason,
    moderatorId: moderator.id,
    moderatorTag: moderator.tag,
    timestamp: new Date().toISOString(),
  });
  warningStore.set(key, warnings);
  return warnings;
}

function clearWarningsForMember(guild, user) {
  warningStore.delete(getWarningKey(guild.id, user.id));
}

export const moderationCommands = [
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
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
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
      const warnings = addWarning(
        interaction.guild,
        user,
        interaction.user,
        reason,
      );

      await user.send(`You were warned in **${interaction.guild.name}**: ${reason}`).catch(() => {});
      await interaction.reply({
        content: `⚠️ Warned **${user.tag}** for: ${reason} (${warnings.length} total warning${warnings.length === 1 ? "" : "s"}).`,
        ephemeral: false,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("warnings")
      .setDescription("Check the warnings for a member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
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
      const warnings = getWarningsForMember(interaction.guild, user);

      if (!warnings.length) {
        await interaction.reply({
          content: `**${user.tag}** currently has no logged warnings in this bot yet. Use /warn to create them.`,
          ephemeral: true,
        });
        return;
      }

      const lines = warnings
        .map((warning, index) => {
          const date = new Date(warning.timestamp).toLocaleString();
          return `${index + 1}. ${date} — ${warning.reason} (mod: ${warning.moderatorTag})`;
        })
        .join("\n");

      await interaction.reply({
        content: `**Warn log for ${user.tag}**\n${lines}`,
        ephemeral: true,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("clearwarnings")
      .setDescription("Clear all warnings for a member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to clear warnings from")
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
      clearWarningsForMember(interaction.guild, user);
      await interaction.reply({
        content: `Cleared warnings for **${user.tag}**.`,
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
        }).catch(() => {});
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
        }).catch(() => {});
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
      await interaction.guild.members.ban(user, {
        deleteMessageSeconds: 60 * 60 * 24,
        reason,
      });
      setTimeout(() => {
        interaction.guild.members.unban(user).catch(() => {});
      }, minutes * 60_000);
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
        ? [...bans.values()].slice(0, 10).map((ban) => `${ban.user.tag} — ${ban.reason ?? "No reason provided"}`).join("\n")
        : "No users are currently banned.";
      await interaction.reply({
        content: `**Ban list**\n${entries}`,
        ephemeral: false,
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
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(user.tag)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "ID", value: user.id, inline: true },
          { name: "Bot", value: user.bot ? "Yes" : "No", inline: true },
          { name: "Nickname", value: member?.nickname ?? "None", inline: true },
          { name: "Joined", value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : "Not a member", inline: false },
          { name: "Roles", value: member ? String(member.roles.cache.size - 1) : "0", inline: true },
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
      if (!matching.size) {
        await interaction.reply({
          content: `No recent messages from **${user.tag}** were found in this channel.`,
          ephemeral: true,
        });
        return;
      }

      await channel.bulkDelete(matching, true);
      await interaction.reply({
        content: `🧹 Deleted ${matching.size} message${matching.size === 1 ? "" : "s"} from **${user.tag}**.`,
        ephemeral: false,
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
      if (!botMessages.size) {
        await interaction.reply({
          content: "No bot messages were found in this channel.",
          ephemeral: true,
        });
        return;
      }

      await channel.bulkDelete(botMessages, true);
      await interaction.reply({
        content: `🤖 Deleted ${botMessages.size} bot message${botMessages.size === 1 ? "" : "s"}.`,
        ephemeral: false,
      });
    },
  },
];
