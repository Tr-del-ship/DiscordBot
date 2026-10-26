import { randomInt } from "node:crypto";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

function randomItem(items) {
  return items[randomInt(items.length)];
}

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
  "uhhhhhhh hmmmm ermm I don't know?",
  "Maybe, but I'm not sure.",
  "Yes",
  "Signs point to yes with a 1000% certainty.",
  "Very likely.",
  "Highly likely.",
  "No. Just no.",
  "Absolutely not.",
  "Definitely not.",
  "I wouldn't bet on it.",
  "Outlook not so good.",
  "Certainly",
  "Without a doubt.",
  "It is decidedly so.",
  "Yes, without a doubt.",
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
      const answer = randomItem(eightBallAnswers);
      await interaction.reply({
        content: `🎱 **${interaction.options.getString("question", true)}**\n${answer}`,
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("coinflip")
      .setDescription("Flip a coin"),
    async execute(interaction) {
      const result = randomInt(2) === 0 ? "Heads" : "Tails";
      await interaction.reply(`🪙 ${result}!`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("dice")
      .setDescription("Roll a die with the selected number of sides")
      .addIntegerOption((option) =>
        option
          .setName("sides")
          .setDescription("Number of sides (2–1000)")
          .setMinValue(2)
          .setMaxValue(1000),
      ),
    async execute(interaction) {
      const sides = interaction.options.getInteger("sides") ?? 6;
      await interaction.reply(`🎲 You rolled ${randomInt(1, sides + 1)} (d${sides}).`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("randomnumber")
      .setDescription("Pick a random whole number in a range")
      .addIntegerOption((option) =>
        option
          .setName("minimum")
          .setDescription("Smallest possible number")
          .setRequired(true)
          .setMinValue(-1_000_000)
          .setMaxValue(1_000_000),
      )
      .addIntegerOption((option) =>
        option
          .setName("maximum")
          .setDescription("Largest possible number")
          .setRequired(true)
          .setMinValue(-1_000_000)
          .setMaxValue(1_000_000),
      ),
    async execute(interaction) {
      const minimum = interaction.options.getInteger("minimum", true);
      const maximum = interaction.options.getInteger("maximum", true);
      if (minimum > maximum) {
        await interaction.reply({
          content: "The minimum must not be greater than the maximum.",
          ephemeral: true,
        });
        return;
      }
      await interaction.reply(
        `🎯 Random number: ${randomInt(minimum, maximum + 1)}`,
      );
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("choose")
      .setDescription("Choose one option from a | separated list")
      .addStringOption((option) =>
        option
          .setName("options")
          .setDescription("Enter 2–10 choices separated by |")
          .setRequired(true)
          .setMaxLength(500),
      ),
    async execute(interaction) {
      const options = interaction.options
        .getString("options", true)
        .split("|")
        .map((option) => option.trim())
        .filter(Boolean);
      if (options.length < 2 || options.length > 10) {
        await interaction.reply({
          content: "Provide between 2 and 10 non-empty choices separated by |.",
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        content: `I choose: **${randomItem(options)}**`,
        allowedMentions: { parse: [] },
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("rps")
      .setDescription("Play rock, paper, scissors with the bot")
      .addStringOption((option) =>
        option
          .setName("choice")
          .setDescription("Your move")
          .setRequired(true)
          .addChoices(
            { name: "Rock", value: "rock" },
            { name: "Paper", value: "paper" },
            { name: "Scissors", value: "scissors" },
          ),
      ),
    async execute(interaction) {
      const player = interaction.options.getString("choice", true);
      const bot = randomItem(["rock", "paper", "scissors"]);
      const result = player === bot
        ? "It's a tie!"
        : (player === "rock" && bot === "scissors") ||
            (player === "paper" && bot === "rock") ||
            (player === "scissors" && bot === "paper")
          ? "You win!"
          : "I win!";
      await interaction.reply(
        `You chose **${player}**; I chose **${bot}**. ${result}`,
      );
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("trivia")
      .setDescription("Get a random trivia question and its answer"),
    async execute(interaction) {
      const question = randomItem([
        {
          prompt: "Which planet is known as the Red Planet?",
          answer: "Mars",
        },
        {
          prompt: "What is the largest ocean on Earth?",
          answer: "The Pacific Ocean",
        },
        {
          prompt: "What is the chemical symbol for gold?",
          answer: "Au",
        },
        {
          prompt: "How many sides does a hexagon have?",
          answer: "Six",
        },
        {
          prompt: "What is the largest mammal?",
          answer: "The blue whale",
        },
      ]);
      await interaction.reply(`🧠 ${question.prompt}\nAnswer: **${question.answer}**`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("fortune")
      .setDescription("Get a small fortune for the day"),
    async execute(interaction) {
      await interaction.reply(
        `🥠 ${randomItem([
          "A small step today leads somewhere interesting.",
          "Good things grow when you share them.",
          "Curiosity will point you toward a new idea.",
          "A little patience will make the next step clearer.",
          "Your next great conversation may start with a simple hello.",
          "A new opportunity may arise unexpectedly.",
          "A moment of reflection can lead to unexpected insights.",
          "Small acts of kindness can have a big impact.",
          "A little humor can brighten someone's day.",
          "A positive attitude can influence those around you.",
          "A little effort can lead to significant progress.",
          "A little creativity can make a big difference.",
          "A little patience can lead to unexpected rewards.",
          "A little kindness can create a ripple effect.",
          "A little gratitude can enhance your well-being.",
          "The right mindset can transform challenges into opportunities.",
          "uhhhhhhh hmmmm ermm I don't know?",
        ])}`,
      );
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("compliment")
      .setDescription("Get a friendly, wholesome compliment"),
    async execute(interaction) {
      await interaction.reply(
        `✨ ${randomItem([
          "You make this server a nicer place to be.",
          "Your curiosity is a superpower.",
          "You deserve credit for showing up and trying.",
          "You have excellent potential for making someone's day.",
          "Your perspective adds something unique to the conversation.",
        ])}`,
      );
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
          {
            name: "Description",
            value: guild.description?.slice(0, 1024) ?? "No server description set.",
            inline: false,
          },
          { name: "Server ID", value: guild.id },
        );

      const icon = guild.iconURL();
      if (icon) embed.setThumbnail(icon);

      await interaction.reply({ embeds: [embed] });
    },
  },
];
