# DiscordBot

A fast, configurable Discord bot for server moderation and a few lightweight fun commands, built with JavaScript and discord.js.

## Requirements

- Node.js 20 or newer
- A Discord application and bot created in the [Discord Developer Portal](https://discord.com/developers/applications)

## Setup

Open the `DiscordBot` project folder in your editor, then run the commands below from its integrated terminal. If your terminal prompt is in `C:\Windows\System32`, change to the folder where you saved the project first; npm must be run in the folder containing `package.json`.

Simplified: Make a brand new folder on your computer outside of the zip file, right click the zip file then click extract all, browse files and click on the empty folder you made on your computer then click confirm. Secondly, open the file, go to address bar and type cmd then hit enter. (Terminal should open.) Type npm install in the terminal and hit enter. Third: Rename `.env.example` to `.env` please click confirm if a warning shows up that is completely fine. Fourth, open the `.env` and enter your token and client id, guild_id iis optional

1. Install dependencies:

   ```sh
   npm install
   ```

2. rename `.env.example` to `.env` and fill in the bot token and application ID:
s
   ```env
   DISCORD_TOKEN=your_bot_token
   CLIENT_ID=your_application_id
   # Optional: register commands in this server for quick testing
   DISCORD_GUILD_ID=your_test_server_id
   ```

   Keep `.env` private; it is excluded from Git.

3. In the Developer Portal, enable the **bot** and **applications.commands** scopes when generating an invite link. Invite the bot to your server and grant only the permissions it needs. Moderation commands require the bot to have the corresponding server permission.

4. Start the bot:

   ```
   npm start
   ```

   The bot registers its slash commands on startup. Set `DISCORD_GUILD_ID` while developing to register commands in one server, where updates are available quickly. Leave it unset to register commands globally; global updates may take some time to propagate.

## Commands

| Command | Description | Required server permission |
| --- | --- | --- |
| `/ping` | Check the bot's response time | None |
| `/eightball` | Ask the magic eight ball a question | None |
| `/coinflip` | Flip a coin | None |
| `/serverinfo` | Show information about this server | None |
| `/clear amount` | Delete 1–100 recent messages | Manage Messages |
| `/kick user [reason]` | Remove a member from the server | Kick Members |
| `/ban user [reason]` | Ban a user from the server | Ban Members |
| `/timeout user minutes [reason]` | Time out a member for 1–40,320 minutes | Moderate Members |
| `/untimeout user` | Remove a member's timeout | Moderate Members |
| `/warn user reason` | Issue a warning to a user | Moderate Members |
| `/warnings user` | Check a member's stored warnings | Moderate Members |
| `/clearwarnings user` | Clear a member's warnings | Moderate Members |
| `/mute user [reason]` | Add the muted role to a member | Manage Roles |
| `/unmute user [reason]` | Remove the muted role from a member | Manage Roles |
| `/deafen user [reason]` | Deafen a member in voice chat | Moderate Members |
| `/undeafen user [reason]` | Undeafen a member in voice chat | Moderate Members |
| `/addrole user role [reason]` | Add a role to a member | Manage Roles |
| `/removerole user role [reason]` | Remove a role from a member | Manage Roles |
| `/setnickname user nickname [reason]` | Set a member's nickname | Manage Nicknames |
| `/resetnickname user [reason]` | Reset a member's nickname | Manage Nicknames |
| `/slowmode seconds` | Set channel slowmode | Manage Channels |
| `/lock [reason]` | Lock the current channel | Manage Channels |
| `/unlock [reason]` | Unlock the current channel | Manage Channels |
| `/lockdown [reason]` | Lock down all text channels | Manage Channels |
| `/unlockdown [reason]` | Unlock all text channels | Manage Channels |
| `/softban user [reason]` | Ban and immediately unban to clear recent messages | Ban Members |
| `/tempban user minutes [reason]` | Temporarily ban a member | Ban Members |
| `/unban user [reason]` | Unban a user | Ban Members |
| `/banlist` | Show the current server ban list | Ban Members |
| `/createinvite [minutes] [uses]` | Create a channel invite | Create Instant Invite |
| `/move user channel [reason]` | Move a member to a different voice channel | Move Members |
| `/disconnect user [reason]` | Disconnect a member from voice | Move Members |
| `/createchannel name [topic]` | Create a text channel | Manage Channels |
| `/deletechannel channel [reason]` | Delete a channel | Manage Channels |
| `/roleinfo role` | Show details for a role | View Audit Log |
| `/userinfo user` | Show details for a member | View Audit Log |
| `/cleanup user amount` | Remove a user's recent messages in this channel | Manage Messages |
| `/purgebots amount` | Remove recent bot messages from this channel | Manage Messages |

All moderation commands are restricted to servers. The bot checks the invoking member's permission, and Discord also enforces the command's configured default permission.
