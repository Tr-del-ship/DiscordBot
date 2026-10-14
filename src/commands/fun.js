import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

const eightBallAnswers = [
  "It is certain.",
  "Without a doubt.",
  "Yes, definitely.",
  "Most likely.",
  "Outlook good.",
  "Ask again later.",
  "Cannot predict that right now.",
  "Don't count on it.",
  "Very doubtful.",
  "The signs point to no.",
];

export const funCommands = [
  {
    data: new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Check the bot's response time"),
    async execute(interaction) {
      await interaction.reply(
        `Pong! Gateway heartbeat: ${Math.round(interaction.client.ws.ping)} ms.`,
      );
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("eightball")
      .setDescription("Ask the magic eight ball a question")
      .addStringOption((option) =>
        option
          .setName("question")
          .setDescription("What would you like to ask?")
          .setRequired(true)
          .setMaxLength(500),
      ),
    async execute(interaction) {
      const answer =
        eightBallAnswers[Math.floor(Math.random() * eightBallAnswers.length)];
      await interaction.reply(
        `🎱 **${interaction.options.getString("question", true)}**\n${answer}`,
      );
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("coinflip")
      .setDescription("Flip a coin"),
    async execute(interaction) {
      const result = Math.random() < 0.5 ? "Heads" : "Tails";
      await interaction.reply(`🪙 ${result}!`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("serverinfo")
      .setDescription("Show information about this server"),
    async execute(interaction) {
      if (!interaction.guild) {
        await interaction.reply({
          content: "This command can only be used in a server.",
          ephemeral: true,
        });
        return;
      }

      const guild = interaction.guild;
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(guild.name)
        .addFields(
          { name: "Members", value: String(guild.memberCount), inline: true },
          {
            name: "Created",
            value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,
            inline: true,
          },
          { name: "Server ID", value: guild.id },
        );

      const icon = guild.iconURL();
      if (icon) embed.setThumbnail(icon);

      await interaction.reply({ embeds: [embed] });
    },
  },
];
