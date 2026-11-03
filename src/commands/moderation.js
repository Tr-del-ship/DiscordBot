import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { getCommandCooldown } from "../cooldowns.js";
import {
  addWarning,
  addModeratorNote,
  getTicketPanel,
  getModerationActions,
  getWarnings,
  getModeratorNotes,
  hasModeratorRole,
  pruneAudit,
  removeWarning,
  removeModeratorNote,
  removeTemporaryBan,
  searchAudit,
  setLogChannel,
  setModeratorRole,
  setGuildRateLimits,
  setTicketPanel,
  removeTicketPanel,
  setTemporaryBan,
} from "../storage.js";

const messageAuditEnabled =
  process.env.ENABLE_MESSAGE_AUDIT?.toLowerCase() === "true";
const moderatorRoleCommands = new Set([
  "warn", "warnings", "clearwarnings", "modnote", "modnotes",
  "deletemodnote", "case",
]);
const ticketPanelWizardPrefix = "ticket-panel:";
const ticketPanelOpenPrefix = "ticket-open:";
const ticketPanelWizardLifetime = 10 * 60 * 1000;
const ticketPanelWizards = new Map();
const ticketCreationLocks = new Set();
const ticketPanelButtonStyles = {
  Primary: ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success: ButtonStyle.Success,
};
const announcementPreviewPrefix = "announcement-preview:";
const announcementPreviewLifetime = 10 * 60 * 1000;
const maxAnnouncementPreviews = 500;
const announcementPreviews = new Map();
const announcementColors = {
  Blue: 0x5865f2,
  Green: 0x57f287,
  Gold: 0xfee75c,
  Red: 0xed4245,
  Purple: 0x9b59b6,
};

function getTicketWizardKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getActiveTicketWizard(interaction) {
  if (!interaction.guildId) return null;
  const key = getTicketWizardKey(interaction.guildId, interaction.user.id);
  const wizard = ticketPanelWizards.get(key);
  if (!wizard) return null;
  if (Date.now() - wizard.createdAt > ticketPanelWizardLifetime) {
    ticketPanelWizards.delete(key);
    return null;
  }
  return wizard;
}

function createPanelIntroModal() {
  const title = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("Panel title")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(256)
    .setRequired(true);
  const description = new TextInputBuilder()
    .setCustomId("description")
    .setLabel("Panel description")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(`${ticketPanelWizardPrefix}intro`)
    .setTitle("Create a ticket panel")
    .addComponents(
      new ActionRowBuilder().addComponents(title),
      new ActionRowBuilder().addComponents(description),
    );
}

function createPanelButtonLabelModal() {
  const label = new TextInputBuilder()
    .setCustomId("button-label")
    .setLabel("Button label")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(80)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(`${ticketPanelWizardPrefix}button-label`)
    .setTitle("Customize the ticket button")
    .addComponents(new ActionRowBuilder().addComponents(label));
}

function ticketPanelStepContent(step) {
  return `**Ticket panel setup — ${step}/5**`;
}

function createAnnouncementEmbed(announcement) {
  return new EmbedBuilder()
    .setColor(announcementColors[announcement.color])
    .setTitle(announcement.title)
    .setDescription(announcement.message);
}

function pruneAnnouncementPreviews(now = Date.now()) {
  for (const [id, preview] of announcementPreviews) {
    if (preview.expiresAt <= now) announcementPreviews.delete(id);
  }
}

function createTicketOpenButton(panelId, label, style, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(`${ticketPanelOpenPrefix}${panelId}`)
    .setLabel(label)
    .setStyle(ticketPanelButtonStyles[style])
    .setDisabled(disabled);
}

export async function handleAnnouncementInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith(announcementPreviewPrefix)) {
    return false;
  }

  const [action, previewId] = interaction.customId
    .slice(announcementPreviewPrefix.length)
    .split(":");
  const preview = announcementPreviews.get(previewId);
  if (!preview || preview.expiresAt <= Date.now()) {
    announcementPreviews.delete(previewId);
    await interaction.reply({
      content: "This announcement preview has expired. Run /announce to create a new one.",
      ephemeral: true,
    });
    return true;
  }
  if (
    interaction.user.id !== preview.userId ||
    interaction.guildId !== preview.guildId ||
    !interaction.guild
  ) {
    await interaction.reply({
      content: "Only the moderator who created this preview can use these buttons.",
      ephemeral: true,
    });
    return true;
  }
  if (preview.processing) {
    await interaction.reply({
      content: "This announcement is already being posted.",
      ephemeral: true,
    });
    return true;
  }
  if (action === "cancel") {
    announcementPreviews.delete(previewId);
    await interaction.update({
      content: "Announcement canceled.",
      embeds: [],
      components: [],
    });
    return true;
  }
  if (action !== "post") {
    await interaction.reply({
      content: "That announcement action is not valid.",
      ephemeral: true,
    });
    return true;
  }
  preview.processing = true;
  try {
    await interaction.deferUpdate();
    const [member, channel] = await Promise.all([
      interaction.guild.members.fetch(interaction.user.id),
      interaction.guild.channels.fetch(preview.channelId),
    ]);
    if (
      !channel ||
      ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)
    ) {
      throw new Error("The announcement channel is no longer available.");
    }
    if (!channel.permissionsFor(member)?.has(PermissionFlagsBits.ManageMessages)) {
      throw new Error(
        "You need Manage Messages in the selected channel to post this announcement.",
      );
    }
    const botMember =
      interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
    if (
      !channel.permissionsFor(botMember)?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ])
    ) {
      throw new Error(
        "The bot needs View Channel, Send Messages, and Embed Links in the selected channel.",
      );
    }

    await channel.send({
      embeds: [createAnnouncementEmbed(preview.announcement)],
      allowedMentions: { parse: [] },
    });
    announcementPreviews.delete(previewId);
    await interaction.editReply({
      content: `Announcement posted in <#${channel.id}>.`,
      embeds: [],
      components: [],
      allowedMentions: { parse: [] },
    });
  } finally {
    if (announcementPreviews.has(previewId)) {
      preview.processing = false;
    }
  }
  return true;
}

async function createTicketForUser(interaction, panel = {}) {
  const guild = interaction.guild;
  const lockKey = getTicketWizardKey(guild.id, interaction.user.id);
  if (ticketCreationLocks.has(lockKey)) {
    await interaction.reply({
      content: "Your ticket is already being created. Please wait a moment.",
      ephemeral: true,
    });
    return;
  }

  ticketCreationLocks.add(lockKey);
  try {
    const existingTicket = guild.channels.cache.find(
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

    await interaction.deferReply({ ephemeral: true });
    const safeName = interaction.user.username
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 70);
    const permissionOverwrites = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
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
      ...(panel.staffRoleIds ?? []).map((roleId) => ({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      })),
    ];
    const channel = await guild.channels.create({
      name: `ticket-${safeName || interaction.user.id.slice(-6)}`,
      type: ChannelType.GuildText,
      topic: `Support ticket opened by ${interaction.user.id}`,
      ...(panel.categoryId ? { parent: panel.categoryId } : {}),
      permissionOverwrites,
    });
    const staffMentions = (panel.staffRoleIds ?? [])
      .map((roleId) => `<@&${roleId}>`)
      .join(" ");
    await channel.send({
      content: [
        `<@${interaction.user.id}> Your ticket is open. Use /closeticket when you are finished.`,
        staffMentions,
      ].filter(Boolean).join("\n"),
      allowedMentions: {
        users: [interaction.user.id],
        roles: panel.staffRoleIds ?? [],
      },
    });
    await interaction.editReply(
      `Created your private ticket: <#${channel.id}>.`,
    );
  } finally {
    ticketCreationLocks.delete(lockKey);
  }
}

async function publishTicketPanel(interaction, wizard, buttonLabel) {
  const guild = interaction.guild;
  const panelChannel = await guild.channels.fetch(wizard.channelId);
  if (
    !panelChannel ||
    ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(
      panelChannel.type,
    )
  ) {
    throw new Error("The selected ticket panel channel is no longer available.");
  }
  const botPermissions = panelChannel.permissionsFor(interaction.client.user);
  if (
    !botPermissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ])
  ) {
    throw new Error(
      "The bot needs View Channel, Send Messages, and Embed Links in the selected panel channel.",
    );
  }
  const category = await guild.channels.fetch(wizard.categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error("The selected ticket category is no longer available.");
  }
  if (
    !category.permissionsFor(interaction.client.user)?.has(
      PermissionFlagsBits.ManageChannels,
    )
  ) {
    throw new Error(
      "The bot needs Manage Channels permission in the selected ticket category.",
    );
  }
  const staffRoles = await Promise.all(
    wizard.staffRoleIds.map((roleId) => guild.roles.fetch(roleId)),
  );
  if (staffRoles.some((role) => !role || role.managed)) {
    throw new Error("One or more selected staff roles are no longer available.");
  }

  const initialRow = new ActionRowBuilder().addComponents(
    createTicketOpenButton("pending", buttonLabel, wizard.buttonStyle, true),
  );
  const panelMessage = await panelChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(wizard.title)
        .setDescription(wizard.description),
    ],
    components: [initialRow],
    allowedMentions: { parse: [] },
  });
  let settingsStored = false;
  try {
    await setTicketPanel(guild.id, panelMessage.id, {
      channelId: panelChannel.id,
      categoryId: category.id,
      staffRoleIds: wizard.staffRoleIds,
      title: wizard.title,
      description: wizard.description,
      buttonLabel,
      buttonStyle: wizard.buttonStyle,
    });
    settingsStored = true;
    await panelMessage.edit({
      components: [
        new ActionRowBuilder().addComponents(
          createTicketOpenButton(
            panelMessage.id,
            buttonLabel,
            wizard.buttonStyle,
          ),
        ),
      ],
    });
  } catch (error) {
    if (settingsStored) {
      await removeTicketPanel(guild.id, panelMessage.id).catch((cleanupError) => {
        console.error(
          `Unable to remove incomplete ticket panel settings for ${panelMessage.id}:`,
          cleanupError,
        );
      });
    }
    await panelMessage.delete().catch((cleanupError) => {
      console.error(`Unable to remove incomplete ticket panel ${panelMessage.id}:`, cleanupError);
    });
    throw error;
  }
}

export async function handleTicketInteraction(interaction) {
  if (interaction.isButton() && interaction.customId.startsWith(ticketPanelOpenPrefix)) {
    const panelId = interaction.customId.slice(ticketPanelOpenPrefix.length);
    if (!interaction.guild) {
      await interaction.reply({
        content: "Ticket panels can only be used in a server.",
        ephemeral: true,
      });
      return true;
    }
    const panel = await getTicketPanel(interaction.guild.id, panelId);
    if (!panel) {
      await interaction.reply({
        content: "This ticket panel is no longer configured.",
        ephemeral: true,
      });
      return true;
    }
    const cooldownRemaining = getCommandCooldown(
      "ticket",
      interaction.user.id,
      interaction.guild.id,
    );
    if (cooldownRemaining) {
      await interaction.reply({
        content: `Please wait ${Math.ceil(cooldownRemaining / 1000)} second(s) before opening another ticket.`,
        ephemeral: true,
      });
      return true;
    }
    await createTicketForUser(interaction, panel);
    return true;
  }

  if (!interaction.customId?.startsWith(ticketPanelWizardPrefix)) return false;
  const wizard = getActiveTicketWizard(interaction);
  if (!wizard) {
    await interaction.reply({
      content: "This setup has expired. Run /createticketpanel to start again.",
      ephemeral: true,
    });
    return true;
  }
  const key = getTicketWizardKey(interaction.guildId, interaction.user.id);

  if (
    interaction.isModalSubmit() &&
    interaction.customId === `${ticketPanelWizardPrefix}intro`
  ) {
    const title = interaction.fields.getTextInputValue("title").trim();
    const description = interaction.fields.getTextInputValue("description").trim();
    if (!title || !description) {
      await interaction.reply({
        content: "Panel title and description cannot be blank. Run /createticketpanel to try again.",
        ephemeral: true,
      });
      ticketPanelWizards.delete(key);
      return true;
    }
    wizard.title = title;
    wizard.description = description;
    wizard.lastInteraction = interaction;
    await interaction.reply({
      content: `${ticketPanelStepContent(2)}\nChoose where the public panel should be posted.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`${ticketPanelWizardPrefix}channel`)
            .setPlaceholder("Select a text channel")
            .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setMinValues(1)
            .setMaxValues(1),
        ),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (
    interaction.isChannelSelectMenu() &&
    interaction.customId === `${ticketPanelWizardPrefix}channel`
  ) {
    wizard.channelId = interaction.values[0];
    wizard.lastInteraction = interaction;
    await interaction.update({
      content: `${ticketPanelStepContent(3)}\nSelect the staff roles that should be able to view and reply in tickets.`,
      components: [
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId(`${ticketPanelWizardPrefix}roles`)
            .setPlaceholder("Select support staff roles")
            .setMinValues(1)
            .setMaxValues(10),
        ),
      ],
    });
    return true;
  }

  if (
    interaction.isRoleSelectMenu() &&
    interaction.customId === `${ticketPanelWizardPrefix}roles`
  ) {
    wizard.staffRoleIds = [...new Set(interaction.values)];
    wizard.lastInteraction = interaction;
    await interaction.update({
      content: `${ticketPanelStepContent(4)}\nChoose the category where new ticket channels should be created.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`${ticketPanelWizardPrefix}category`)
            .setPlaceholder("Select a ticket category")
            .setChannelTypes(ChannelType.GuildCategory)
            .setMinValues(1)
            .setMaxValues(1),
        ),
      ],
    });
    return true;
  }

  if (
    interaction.isChannelSelectMenu() &&
    interaction.customId === `${ticketPanelWizardPrefix}category`
  ) {
    wizard.categoryId = interaction.values[0];
    wizard.lastInteraction = interaction;
    await interaction.update({
      content: `${ticketPanelStepContent(5)}\nChoose the button color.`,
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ticketPanelWizardPrefix}style`)
            .setPlaceholder("Select a button style")
            .addOptions(
              { label: "Blue", value: "Primary" },
              { label: "Grey", value: "Secondary" },
              { label: "Green", value: "Success" },
            ),
        ),
      ],
    });
    return true;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === `${ticketPanelWizardPrefix}style`
  ) {
    wizard.buttonStyle = interaction.values[0];
    wizard.lastInteraction = interaction;
    await interaction.showModal(createPanelButtonLabelModal());
    return true;
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId === `${ticketPanelWizardPrefix}button-label`
  ) {
    const buttonLabel = interaction.fields.getTextInputValue("button-label").trim();
    if (!buttonLabel) {
      await interaction.reply({
        content: "The button label cannot be blank. Run /createticketpanel to try again.",
        ephemeral: true,
      });
      ticketPanelWizards.delete(key);
      return true;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      await publishTicketPanel(interaction, wizard, buttonLabel);
      ticketPanelWizards.delete(key);
      await wizard.lastInteraction.deleteReply().catch((error) => {
        console.error("Unable to remove completed ticket panel setup:", error);
      });
      await interaction.editReply("Ticket panel created and published.");
    } catch (error) {
      console.error("Unable to publish ticket panel:", error);
      await interaction.editReply(
        "The panel could not be published. Check the bot's channel permissions and try again.",
      );
    }
    return true;
  }

  await interaction.reply({
    content: "That ticket panel setup step is no longer valid. Run /createticketpanel to start again.",
    ephemeral: true,
  });
  return true;
}

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
            ? "No matching audit records were found. Message auditing starts after /createlogchannel is configured. Are you sure you have set it up correctly?"
            : "No records were found. Enable ENABLE_MESSAGE_AUDIT=true, enable Message Content Intent in the Developer Portal, and configure /createlogchannel to collect message audits. Are you sure you have set it up correctly?",
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
      .setName("moderationlimits")
      .setDescription("Configure per-minute limits for moderation actions")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addIntegerOption((option) => option.setName("user_limit").setDescription("Actions per moderator per minute (1-100)").setMinValue(1).setMaxValue(100).setRequired(true))
      .addIntegerOption((option) => option.setName("server_limit").setDescription("Actions for the whole server per minute (1-1000)").setMinValue(10).setMaxValue(1000).setRequired(true)),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild, "Manage Server"))) return;
      const userLimit = interaction.options.getInteger("user_limit", true);
      const guildLimit = interaction.options.getInteger("server_limit", true);
      if (guildLimit < userLimit) {
        await interaction.reply({ content: "The server limit must be at least the per-moderator limit.", ephemeral: true });
        return;
      }
      await setGuildRateLimits(interaction.guild.id, userLimit, guildLimit);
      await interaction.reply({ content: `Moderation limits set to ${userLimit} per moderator and ${guildLimit} per server per minute.`, ephemeral: true });
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
      .setName("modnote")
      .setDescription("Add a private staff note about a member")
      .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(true))
      .addStringOption((option) => option.setName("note").setDescription("Staff-only note").setRequired(true).setMaxLength(1000)),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers, "Moderate Members"))) return;
      const user = interaction.options.getUser("user", true);
      const note = interaction.options.getString("note", true).trim();
      if (!note) {
        await interaction.reply({ content: "Note cannot be blank.", ephemeral: true });
        return;
      }
      const saved = await addModeratorNote(interaction.guild.id, user.id, interaction.user, note);
      await interaction.reply({ content: `Saved private note \`${saved.id.slice(0, 8)}\` for **${user.tag}**.`, ephemeral: true, allowedMentions: { parse: [] } });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("modnotes")
      .setDescription("View private staff notes about a member")
      .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(true)),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers, "Moderate Members"))) return;
      const user = interaction.options.getUser("user", true);
      const notes = await getModeratorNotes(interaction.guild.id, user.id);
      const text = notes.slice(-10).reverse().map((note) => `\`${note.id.slice(0, 8)}\` <t:${Math.floor(new Date(note.timestamp).getTime() / 1000)}:d> — ${note.text}`).join("\n");
      await interaction.reply({ content: text ? `Private staff notes for **${user.tag}**:\n${text}`.slice(0, 1900) : "No private notes are recorded for this member.", ephemeral: true, allowedMentions: { parse: [] } });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("deletemodnote")
      .setDescription("Delete a private staff note")
      .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(true))
      .addStringOption((option) => option.setName("note_id").setDescription("First 8 characters or full note ID").setRequired(true).setMinLength(8).setMaxLength(32)),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers, "Moderate Members"))) return;
      const user = interaction.options.getUser("user", true);
      const id = interaction.options.getString("note_id", true).toLowerCase();
      const notes = await getModeratorNotes(interaction.guild.id, user.id);
      const note = notes.find((item) => item.id.startsWith(id));
      const removed = note && await removeModeratorNote(interaction.guild.id, user.id, note.id);
      await interaction.reply({ content: removed ? "Private note deleted." : "No matching note was found.", ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("case")
      .setDescription("View a member's warnings, actions, and private staff notes")
      .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(true)),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      if (!(await requirePermission(interaction, PermissionFlagsBits.ModerateMembers, "Moderate Members"))) return;
      const user = interaction.options.getUser("user", true);
      const [warnings, actions, notes] = await Promise.all([
        getWarnings(interaction.guild.id, user.id),
        getModerationActions(interaction.guild.id, user.id),
        getModeratorNotes(interaction.guild.id, user.id),
      ]);
      const details = [
        `Warnings: ${warnings.length}`,
        ...warnings.slice(-5).reverse().map((item) => `• ${item.reason} (<t:${Math.floor(new Date(item.timestamp).getTime() / 1000)}:d>)`),
        `Moderation actions: ${actions.length}`,
        ...actions.slice(-5).reverse().map((item) => `• /${item.command}: ${item.reason} (<t:${Math.floor(new Date(item.timestamp).getTime() / 1000)}:d>)`),
        `Private notes: ${notes.length}`,
        ...notes.slice(-5).reverse().map((item) => `• ${item.text} (<t:${Math.floor(new Date(item.timestamp).getTime() / 1000)}:d>)`),
      ];
      await interaction.reply({ content: `**Case history for ${user.tag}**\n${details.join("\n")}`.slice(0, 1900), ephemeral: true, allowedMentions: { parse: [] } });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("createticketpanel")
      .setDescription("Set up and publish a support ticket panel")
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

      const now = Date.now();
      for (const [key, wizard] of ticketPanelWizards) {
        if (now - wizard.createdAt > ticketPanelWizardLifetime) {
          ticketPanelWizards.delete(key);
        }
      }
      const key = getTicketWizardKey(interaction.guild.id, interaction.user.id);
      ticketPanelWizards.set(key, { createdAt: now });
      await interaction.showModal(createPanelIntroModal());
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("ticket")
      .setDescription("Open a private support ticket"),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      await createTicketForUser(interaction);
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
      .setName("announce")
      .setDescription("Preview and post an announcement in a server channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Where to post the announcement")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("title")
          .setDescription("Announcement title")
          .setRequired(true)
          .setMaxLength(256),
      )
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("Announcement text")
          .setRequired(true)
          .setMaxLength(4000),
      )
      .addStringOption((option) =>
        option
          .setName("color")
          .setDescription("Embed color")
          .addChoices(
            { name: "Blue", value: "Blue" },
            { name: "Green", value: "Green" },
            { name: "Gold", value: "Gold" },
            { name: "Red", value: "Red" },
            { name: "Purple", value: "Purple" },
          ),
      ),
    async execute(interaction) {
      if (!(await requireGuild(interaction))) return;
      await interaction.deferReply({ ephemeral: true });
      const channel = interaction.options.getChannel("channel", true);
      if (
        channel.guildId !== interaction.guild.id ||
        ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(
          channel.type,
        )
      ) {
        await interaction.editReply({
          content: "Choose a server text or announcement channel.",
        });
        return;
      }
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!channel.permissionsFor(member)?.has(PermissionFlagsBits.ManageMessages)) {
        await interaction.editReply({
          content: "You need Manage Messages in the selected channel to post there.",
        });
        return;
      }
      const botMember =
        interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
      if (
        !channel.permissionsFor(botMember)?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
        ])
      ) {
        await interaction.editReply({
          content: "The bot needs View Channel, Send Messages, and Embed Links in the selected channel.",
        });
        return;
      }

      pruneAnnouncementPreviews();
      if (announcementPreviews.size >= maxAnnouncementPreviews) {
        await interaction.editReply({
          content: "There are too many pending announcement previews. Please try again shortly.",
        });
        return;
      }

      const previewId = randomUUID();
      const announcement = {
        title: interaction.options.getString("title", true).trim(),
        message: interaction.options.getString("message", true).trim(),
        color: interaction.options.getString("color") ?? "Blue",
      };
      if (!announcement.title || !announcement.message) {
        await interaction.editReply({
          content: "Announcement title and message cannot be blank.",
        });
        return;
      }
      const expiresAt = Date.now() + announcementPreviewLifetime;
      announcementPreviews.set(previewId, {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        channelId: channel.id,
        announcement,
        expiresAt,
        processing: false,
      });

      await interaction.editReply({
        content: `Preview for <#${channel.id}>. Only you can approve or cancel it; this preview expires in 10 minutes.`,
        embeds: [createAnnouncementEmbed(announcement)],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${announcementPreviewPrefix}post:${previewId}`)
              .setLabel("Post announcement")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`${announcementPreviewPrefix}cancel:${previewId}`)
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
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
          content: "The bot needs View Channel and Send Messages permissions here. Check the channel's permissions and try again.",
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
      await removeTemporaryBan(interaction.guild.id, user.id);
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
          content: "That user is not a member of this server. Are you sure they are not banned or have left?",
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
      .setDescription("Check the warnings for a member(s)")
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
          content: `**${user.tag}** currently has no logged warnings in this bot. Use /warn to issue a warning to this member.`,
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
          content: "That warning ID was not found for this member. Are you sure it exists?",
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
          content: "That user is not a member of this server. Are you sure they are not banned or have left?",
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
          content: "That user is not a member of this server. Are you sure they are not banned or have left?",
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
          content: "That user is not a member of this server. Are they banned or have left?",
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
          content: "That user is not a member of this server. Are they banned or have left?",
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
          content: "That user is not a member of this server. Are they banned or have left?",
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
      await removeTemporaryBan(interaction.guild.id, user.id);
      await interaction.guild.members.unban(user, `Softban cleanup for ${reason}`);
      await interaction.reply({
        content: `🧼 Be gone! Softbanned **${user.tag}**.`,
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
        content: `⏲️ Be gone! Temporarily banned **${user.tag}** for ${formatDuration(minutes)}.`,
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
      await removeTemporaryBan(interaction.guild.id, user.id);
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
          content: "That user is not a member of this server. Are you sure they are still in the server or exist?",
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
        content: `🗑️ Be gone! Deleted: **${channel.name}**.`,
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
        content: `🧹 Be gone! Deleted ${matching.length} message${matching.length === 1 ? "" : "s"} from **${user.tag}**.`,
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
