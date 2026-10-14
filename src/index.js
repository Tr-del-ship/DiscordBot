import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
} from "discord.js";
import { funCommands } from "./commands/fun.js";
import { moderationCommands } from "./commands/moderation.js";

const commands = [...funCommands, ...moderationCommands];
const commandMap = new Map(
  commands.map((command) => [command.data.name, command]),
);

function readConfig() {
  const { DISCORD_TOKEN, CLIENT_ID, DISCORD_GUILD_ID } = process.env;
  const missing = [
    !DISCORD_TOKEN && "DISCORD_TOKEN",
    !CLIENT_ID && "CLIENT_ID",
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(
      `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Copy .env.example to .env and fill it in.`,
    );
  }

  return { token: DISCORD_TOKEN, clientId: CLIENT_ID, guildId: DISCORD_GUILD_ID };
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

async function main() {
  const config = readConfig();
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on("error", (error) => {
    console.error("Discord client error:", error);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

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
      await command.execute(interaction);
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

  client.once("ready", () => {
    console.info(`Logged in as ${client.user.tag}.`);
  });

  try {
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
