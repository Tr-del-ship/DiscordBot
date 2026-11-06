import "dotenv/config";
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  REST,
  Routes,
} from "discord.js";
import { funCommands } from "./commands/fun.js";
import {
  configureMutedRoleForChannel,
  checkModerationTarget,
  handleAnnouncementInteraction,
  handleTicketInteraction,
  moderationCommands,
} from "./commands/moderation.js";
import {
  addAuditEvent,
  addModerationAction,
  getLogChannelId,
  getExpiredTicketTranscripts,
  initializeStorage,
  removeTicketTranscript,
  removeTemporaryBan,
  withBanLock,
} from "./storage.js";
import {
  getCommandCooldown,
  getGuildActionRateLimit,
} from "./cooldowns.js";
import { getGuildRateLimits, hasModeratorRole } from "./storage.js";
import { expireTemporaryBans } from "./temporary-bans.js";
import { handlePollInteraction } from "./polls.js";
import { getClankerReply, isDirectClankerCall } from "./clanker-replies.js";
import { loggedCommands } from "./moderation-logging.js";

const commands = [...funCommands, ...moderationCommands];
const commandMap = new Map(
  commands.map((command) => [command.data.name, command]),
);
const banLifecycleCommands = new Set(["ban", "softban", "tempban", "unban"]);
const rateLimitedCommands = new Set([
  "kick", "ban", "timeout", "untimeout", "warn", "mute", "unmute",
  "softban", "tempban", "unban", "clear", "cleanup", "lockdown",
]);
const clankerReplyCooldowns = new Map();
const clankerReplyCooldownMs = 30_000;

function readConfig() {
  const { DISCORD_TOKEN, CLIENT_ID, DISCORD_GUILD_ID } = process.env;
  const auditSetting = process.env.ENABLE_MESSAGE_AUDIT ?? "false";
  const clankerSetting = process.env.ENABLE_CLANKER_REPLIES ?? "false";
  const ticketTranscriptSetting =
    process.env.ENABLE_TICKET_TRANSCRIPTS ?? "false";
  if (!["true", "false"].includes(auditSetting.toLowerCase())) {
    throw new Error("ENABLE_MESSAGE_AUDIT must be set to true or false.");
  }
  if (!["true", "false"].includes(clankerSetting.toLowerCase())) {
    throw new Error("ENABLE_CLANKER_REPLIES must be set to true or false.");
  }
  if (!["true", "false"].includes(ticketTranscriptSetting.toLowerCase())) {
    throw new Error("ENABLE_TICKET_TRANSCRIPTS must be set to true or false.");
  }
  const missing = [
    !DISCORD_TOKEN && "DISCORD_TOKEN",
    !CLIENT_ID && "CLIENT_ID",
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(
      `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Copy .env.example to .env and fill it in.`,
    );
  }

  return {
    token: DISCORD_TOKEN,
    clientId: CLIENT_ID,
    guildId: DISCORD_GUILD_ID,
    messageAuditEnabled: auditSetting.toLowerCase() === "true",
    clankerRepliesEnabled: clankerSetting.toLowerCase() === "true",
    ticketTranscriptsEnabled: ticketTranscriptSetting.toLowerCase() === "true",
  };
}

async function registerCommands({ token, clientId, guildId }) {
  const rest = new REST({ version: "10" }).setToken(token);
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  await rest.put(route, { body: commands.map(({ data }) => data.toJSON()) });
  console.info(
    `Registered ${commands.length} slash commands ${guildId ? `in guild ${guildId}` : "globally"}.`,
  );
}

async function sendToLogChannel(client, guildId, payload) {
  const channelId = await getLogChannelId(guildId);
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    console.error(`Configured log channel ${channelId} is unavailable or not sendable.`);
    return;
  }
  await channel.send({ ...payload, allowedMentions: { parse: [] } });
}

async function logModerationCommand(interaction, client) {
  const target = interaction.options.getUser("user");
  const reason = interaction.commandName === "dm"
    ? "Private message sent by moderator; message content not retained."
    : interaction.commandName === "message"
      ? `Bot message sent in #${interaction.channel?.name ?? "unknown"}; message content not retained.`
      : interaction.options.getString("reason") ??
        interaction.options.getString("warning_id") ??
        "No reason provided";
  const action = {
    command: interaction.commandName,
    targetId: target?.id ?? null,
    targetTag: target?.tag ?? null,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason,
    timestamp: new Date().toISOString(),
  };
  await addModerationAction(interaction.guild.id, action);
  await sendToLogChannel(client, interaction.guild.id, {
    embeds: [
      new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle(`Moderation: /${action.command}`)
        .addFields(
          {
            name: "Moderator",
            value: `${action.moderatorTag} (${action.moderatorId})`,
            inline: true,
          },
          {
            name: "Target",
            value: target ? `${target.tag} (${target.id})` : "Not specified",
            inline: true,
          },
          {
            name: "Channel",
            value: interaction.channelId ? `<#${interaction.channelId}>` : "Unknown",
            inline: true,
          },
          { name: "Details", value: reason.slice(0, 1024) },
        )
        .setTimestamp(new Date(action.timestamp)),
    ],
  });
}

async function captureMessageAudit(
  client,
  type,
  message,
  oldContent,
  newContent,
  enabled,
) {
  if (!enabled) return;
  if (!message.guild || message.author?.bot) return;
  if (typeof oldContent !== "string" || typeof newContent !== "string") return;
  const event = {
    type,
    guildId: message.guild.id,
    channelId: message.channelId,
    messageId: message.id,
    userId: message.author.id,
    username: message.author.tag,
    oldContent: oldContent.slice(0, 2000),
    newContent: newContent.slice(0, 2000),
    timestamp: new Date().toISOString(),
  };
  if (!(await getLogChannelId(event.guildId))) return;

  await addAuditEvent(event.guildId, event);
  const displayedContent = type === "delete"
    ? `Deleted: ${event.oldContent || "[empty]"}`
    : `Before: ${event.oldContent || "[empty]"}\nAfter: ${event.newContent || "[empty]"}`;
  await sendToLogChannel(client, event.guildId, {
    embeds: [
      new EmbedBuilder()
        .setColor(type === "delete" ? 0xe74c3c : 0xf1c40f)
        .setTitle(`Message ${type}`)
        .setDescription(displayedContent.slice(0, 4000))
        .addFields(
          { name: "Author", value: `${event.username} (${event.userId})` },
          { name: "Channel", value: `<#${event.channelId}>` },
          { name: "Message ID", value: event.messageId },
        )
        .setTimestamp(new Date(event.timestamp)),
    ],
  });
}

async function expireTicketTranscripts(client) {
  const expired = await getExpiredTicketTranscripts();
  for (const transcript of expired) {
    try {
      const channel = await client.channels.fetch(transcript.channelId).catch((error) => {
        if (error.code === 10003) return null;
        throw error;
      });
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(transcript.messageId).catch((error) => {
          if (error.code === 10008) return null;
          throw error;
        });
        if (message) await message.delete();
      }
      await removeTicketTranscript(transcript.guildId, transcript.messageId);
    } catch (error) {
      console.error(
        `Unable to remove expired ticket transcript ${transcript.messageId}:`,
        error,
      );
    }
  }
}

async function main() {
  const config = readConfig();
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (
    config.messageAuditEnabled ||
    config.clankerRepliesEnabled ||
    config.ticketTranscriptsEnabled
  ) {
    intents.push(GatewayIntentBits.MessageContent);
  }
  const client = new Client({ intents });

  client.on("error", (error) => {
    console.error("Discord client error:", error);
  });

  client.on("channelCreate", (channel) => {
    configureMutedRoleForChannel(channel).catch((error) => {
      console.error(`Unable to apply muted-role permissions to channel ${channel.id}:`, error);
    });
  });

  client.on("guildBanRemove", (ban) => {
    withBanLock(ban.guild.id, ban.user.id, () =>
      removeTemporaryBan(ban.guild.id, ban.user.id),
    ).catch((error) => {
      console.error(
        `Unable to clear temporary-ban expiry for ${ban.user.id} in guild ${ban.guild.id}:`,
        error,
      );
    });
  });

  client.on("messageCreate", async (message) => {
    if (
      !config.clankerRepliesEnabled ||
      !message.guild ||
      message.author.bot ||
      !isDirectClankerCall(message.content, client.user?.id)
    ) {
      return;
    }
    const now = Date.now();
    for (const [key, expiresAt] of clankerReplyCooldowns) {
      if (expiresAt <= now) clankerReplyCooldowns.delete(key);
    }
    const key = `${message.guild.id}:${message.author.id}`;
    if ((clankerReplyCooldowns.get(key) ?? 0) > now) return;
    clankerReplyCooldowns.set(key, now + clankerReplyCooldownMs);
    try {
      await message.channel.send({
        content: getClankerReply(),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      clankerReplyCooldowns.delete(key);
      console.error("Unable to send clanker reply:", error);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      try {
        if (await handlePollInteraction(interaction)) return;
        if (await handleAnnouncementInteraction(interaction)) return;
        await handleTicketInteraction(interaction);
      } catch (error) {
        console.error("Component interaction failed:", error);
        const response = {
          content: "The ticket action failed. Please try again or contact a server administrator.",
          ephemeral: true,
        };
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(response);
        } else {
          await interaction.reply(response);
        }
      }
      return;
    }

    const command = commandMap.get(interaction.commandName);
    if (!command) {
      console.error(`Received unregistered command: ${interaction.commandName}`);
      await interaction.reply({
        content: "That command is not available right now.",
        ephemeral: true,
      });
      return;
    }

    try {
      const cooldownRemaining = getCommandCooldown(
        interaction.commandName,
        interaction.user.id,
        interaction.guildId,
      );
      if (cooldownRemaining) {
        await interaction.reply({
          content: `Please wait ${Math.ceil(cooldownRemaining / 1000)} second(s) before using this command again.`,
          ephemeral: true,
        });
        return;
      }

      if (interaction.guild && rateLimitedCommands.has(interaction.commandName)) {
        const requiredPermission = command.data.default_member_permissions;
        const hasCommandPermission =
          requiredPermission &&
          interaction.memberPermissions?.has(requiredPermission);
        const isConfiguredModerator = interaction.commandName === "warn" &&
          (interaction.memberPermissions?.has("MODERATE_MEMBERS") ||
            await hasModeratorRole(
              interaction.guild.id,
              [...(interaction.member?.roles?.cache?.keys?.() ?? [])],
            ));
        if (hasCommandPermission || isConfiguredModerator) {
          const limits = await getGuildRateLimits(interaction.guild.id);
          const rateLimit = getGuildActionRateLimit(
            interaction.user.id,
            interaction.guild.id,
            limits.user,
            limits.guild,
          );
          if (rateLimit.limited) {
            await interaction.reply({
              content: rateLimit.scope === "guild"
                ? "This server has reached its moderation action limit for this minute. Please wait before trying again."
                : "You have reached the moderation action limit for this minute. Please wait before trying again.",
              ephemeral: true,
            });
            return;
          }
        }
      }

      if (!(await checkModerationTarget(interaction))) return;

      const target = interaction.options.getUser("user");
      if (
        banLifecycleCommands.has(interaction.commandName) &&
        interaction.guild &&
        target
      ) {
        await withBanLock(interaction.guild.id, target.id, () =>
          command.execute(interaction),
        );
      } else {
        await command.execute(interaction);
      }
      if (loggedCommands.has(interaction.commandName) && interaction.guild) {
        try {
          await logModerationCommand(interaction, client);
        } catch (error) {
          console.error(
            `Unable to persist or deliver /${interaction.commandName} log:`,
            error,
          );
        }
      }
    } catch (error) {
      console.error(`Command /${interaction.commandName} failed:`, error);
      const response = {
        content: "The command failed. Check the bot's permissions and try again.",
        ephemeral: true,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  });

  client.on("messageDelete", (message) => {
    captureMessageAudit(
      client,
      "delete",
      message,
      message.content,
      "",
      config.messageAuditEnabled,
    ).catch(
      (error) => console.error("Unable to record deleted message:", error),
    );
  });

  client.on("messageUpdate", (before, after) => {
    captureMessageAudit(
      client,
      "edit",
      after,
      before.content,
      after.content,
      config.messageAuditEnabled,
    ).catch((error) => console.error("Unable to record edited message:", error));
  });

  client.once("ready", () => {
    console.info(`Logged in as ${client.user.tag}.`);
    let processingTemporaryBans = false;
    const expireBans = () => {
      if (processingTemporaryBans) return;
      processingTemporaryBans = true;
      expireTemporaryBans(client)
        .catch((error) => {
          console.error("Unable to process temporary bans:", error);
        })
        .finally(() => {
          processingTemporaryBans = false;
        });
    };
    expireBans();
    const timer = setInterval(expireBans, 60_000);
    timer.unref();
    const expireTranscripts = () => {
      expireTicketTranscripts(client).catch((error) => {
        console.error("Unable to process expired ticket transcripts:", error);
      });
    };
    expireTranscripts();
    const transcriptTimer = setInterval(expireTranscripts, 24 * 60 * 60 * 1000);
    transcriptTimer.unref();
  });

  try {
    await initializeStorage();
    await registerCommands(config);
    await client.login(config.token);
  } catch (error) {
    console.error("Unable to start the bot:", error);
    client.destroy();
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Unable to start the bot:", error);
  process.exitCode = 1;
});
