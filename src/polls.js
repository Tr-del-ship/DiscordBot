import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { getPoll, recordPollVote, savePoll } from "./storage.js";

function renderPoll(poll) {
  const counts = Array(poll.options.length).fill(0);
  for (const choices of Object.values(poll.votes ?? {})) {
    for (const index of choices) {
      if (Number.isInteger(index) && index >= 0 && index < counts.length) {
        counts[index] += 1;
      }
    }
  }
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(poll.question)
    .setDescription(poll.options.map((option, index) =>
      `**${index + 1}. ${option}** — ${counts[index]} vote(s)`,
    ).join("\n"))
    .setFooter({ text: `Closes <t:${Math.floor(poll.closesAt / 1000)}:R> • Multi-select allowed` });
}

function pollRow(messageId, poll, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`poll:${messageId}`)
      .setPlaceholder("Select one or more options")
      .setMinValues(1)
      .setMaxValues(poll.options.length)
      .setDisabled(disabled)
      .addOptions(poll.options.map((label, value) => ({ label, value: String(value) }))),
  );
}

export const pollCommands = [{
  data: new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Create a multi-choice poll")
    .addStringOption((option) => option.setName("question").setDescription("Poll question").setRequired(true).setMaxLength(256))
    .addStringOption((option) => option.setName("choices").setDescription("2-5 choices separated by |").setRequired(true).setMaxLength(400))
    .addIntegerOption((option) => option.setName("hours").setDescription("Duration in hours (default 24, maximum 720)").setMinValue(1).setMaxValue(720)),
  async execute(interaction) {
    const question = interaction.options.getString("question", true).trim();
    const options = interaction.options.getString("choices", true)
      .split("|").map((choice) => choice.trim()).filter(Boolean);
    if (!question || options.length < 2 || options.length > 5 || new Set(options.map((x) => x.toLocaleLowerCase())).size !== options.length) {
      await interaction.reply({ content: "Enter a non-empty question and 2–5 distinct choices separated by `|`.", ephemeral: true });
      return;
    }
    if (!interaction.guild || !interaction.channel?.isTextBased() || !interaction.channel.isSendable()) {
      await interaction.reply({ content: "Polls can only be created in server text channels.", ephemeral: true });
      return;
    }
    const closesAt = Date.now() + (interaction.options.getInteger("hours") ?? 24) * 3_600_000;
    const poll = { question, options, closesAt, votes: {} };
    const message = await interaction.channel.send({
      embeds: [renderPoll(poll)],
      components: [pollRow("pending", poll, true)],
      allowedMentions: { parse: [] },
    });
    try {
      await savePoll(interaction.guild.id, message.id, poll);
      await message.edit({ components: [pollRow(message.id, poll)] });
    } catch (error) {
      await message.delete().catch((cleanupError) => console.error("Unable to remove incomplete poll:", cleanupError));
      throw error;
    }
    await interaction.reply({ content: `Poll created: ${message.url}`, ephemeral: true, allowedMentions: { parse: [] } });
  },
}];

export async function handlePollInteraction(interaction) {
  if (!interaction.isStringSelectMenu() || !interaction.customId.startsWith("poll:")) return false;
  if (!interaction.guildId) {
    await interaction.reply({ content: "Polls can only be used in a server.", ephemeral: true });
    return true;
  }
  const poll = await getPoll(interaction.guildId, interaction.message.id);
  if (!poll) {
    await interaction.reply({ content: "This poll is no longer available.", ephemeral: true });
    return true;
  }
  if (Date.now() >= poll.closesAt) {
    await interaction.update({ embeds: [renderPoll(poll)], components: [pollRow(interaction.message.id, poll, true)] });
    return true;
  }
  const updated = await recordPollVote(interaction.guildId, interaction.message.id, interaction.user.id, interaction.values.map(Number));
  await interaction.update({ embeds: [renderPoll(updated)], components: [pollRow(interaction.message.id, updated)] });
  return true;
}
