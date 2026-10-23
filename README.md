# DiscordBot

A fast, configurable Discord bot for server moderation and a few lightweight fun commands, built with JavaScript and discord.js.
This bot aims to be better than the Dyno bot itself, faster and including more commands.
## Requirements

- Node.js 20 or newer [Node.js install](https://nodejs.org/en)
- A Discord application and bot created in the [Discord Developer Portal](https://discord.com/developers/applications)

Supported security versions of the bot: 
| Version | Supported          |
| ------- | ------------------ |
| v1.1.0   | :white_check_mark: |
| N/A   | :x:                |
| N/A   | :x: |
| N/A   | :x:                |
## Setup

Open the `DiscordBot` project folder in your editor, then run the commands below from its integrated terminal. If your terminal prompt is in `C:\Windows\System32`, change to the folder where you saved the project first; npm must be run in the folder containing `package.json`.

Simplified: Make a brand new folder on your computer outside of the zip file, right click the zip file then click extract all, browse files and click on the empty folder you made on your computer then click confirm. 
Please note: This is only for setting up, not to enable the permissions.
Secondly, open the file, go to address bar and type cmd then hit enter. (Terminal should open.) Type `npm install` in the terminal and hit enter. 

Third: Rename `.env.example` to `.env` please click confirm if a warning shows up that is completely fine. 

Fourth, open the `.env` and enter your token and client id, guild_id is optional. (Remember to hit save!!) Finally, type `npm start` in terminal and hit enter, the bot should go online. Note: Enabling guild_id is recommended if you are using this for one server.
Please view [Bot Permissions](https://github.com/Tr-del-ship/DiscordBot/blob/codespace-refactored-engine-4qw4pwjp4grq3j6qv/README.md#commands) to get your entire list of perms.

<img width="1200" height="540" alt="image" src="https://github.com/user-attachments/assets/2bcf94be-7597-4063-82c5-866c8a6a7747" />


1. Install dependencies:

   ```sh
   npm install
   ```

2. rename `.env.example` to `.env` and fill in the bot token and application ID:

   ```env
   DISCORD_TOKEN=your_bot_token
   CLIENT_ID=your_application_id
   # Optional: register commands in this server for quick testing
   DISCORD_GUILD_ID=your_test_server_id
   # Optional: enable message edit/delete auditing
   ENABLE_MESSAGE_AUDIT=false
   ```

   Keep `.env` private; it is excluded from Git.

3. In the Developer Portal, enable the **bot** and **applications.commands** scopes when generating an invite link. For message auditing, set `ENABLE_MESSAGE_AUDIT=true` in `.env` and enable **Message Content Intent** under **Bot > Privileged Gateway Intents**, then restart the bot and configure `/createlogchannel`. Without that setting, the bot does not request the privileged intent and only moderation actions are logged. Invite the bot to your server and grant only the permissions it needs; do not grant Administrator unless you specifically need it.

4. Start the bot:

   ```
   npm start
   ```

   The bot registers its slash commands on startup. Set `DISCORD_GUILD_ID` while developing to register commands in one server, where updates are available quickly. Leave it unset to register commands globally; global updates may take some time to propagate.
## All permissions
I recommend not enabling administrative perms to the bot to prevent large scale attacks and whatnot.
Need:
- kick user
- ban users
- send messages
- view channel
- manage channel
- manage messages
- moderate members
- manage roles
- manage nicknames
- create instant invite
- move members
- view audit log
- manage server (to configure log channels and moderator roles)
+ More permissions may be required soon!
------------------------------------------------------------------------------------------------------------------ 
   

## Commands

| Command | Description | Required server permission |
| --- | --- | --- |
| `/ping` | Check the bot's response time | None |
| `/eightball` | Ask the magic eight ball a question | None |
| `/coinflip` | Flip a coin | None |
| `/serverinfo` | Show information and description for this server | None |
| `/clear amount` | Delete 1–100 recent messages | Manage Messages |
| `/kick user [reason]` | Remove a member from the server | Kick Members |
| `/ban user [reason]` | Ban a user from the server | Ban Members |
| `/timeout user minutes [reason]` | Time out a member for 1–40,320 minutes | Moderate Members |
| `/untimeout user` | Remove a member's timeout | Moderate Members |
| `/warn user reason` | Issue a warning to a user | Moderate Members or assigned moderator role |
| `/warnings user` | Check a member's stored warnings | Moderate Members or assigned moderator role |
| `/clearwarnings user warning_id` | Clear one specific warning shown by `/warnings` | Moderate Members or assigned moderator role |
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
| `/userinfo user` | Show account and server join dates, roles, and stored infractions | View Audit Log |
| `/cleanup user amount` | Remove a user's recent messages in this channel | Manage Messages |
| `/purgebots amount` | Remove recent bot messages from this channel | Manage Messages |
| `/createlogchannel channel` | Configure a channel for moderation logs and opt-in message edit/delete auditing | Manage Server |
| `/removelogchannel` | Disable moderation log delivery and message audit collection | Manage Server |
| `/audit [phrase] [user_id]` | Search recorded message edits and deletions | View Audit Log |
| `/cleanuplogs days` | Remove old message audit records while retaining moderation-action and warning records | Manage Server |
| `/moderatorperm role enabled` | Grant or revoke a role's access to `/warn`, `/warnings`, and `/clearwarnings` | Manage Server |
| `/ticket` | Create a private support channel | None |
| `/closeticket` | Close a ticket you opened (or manage as a channel moderator) | Ticket opener or Manage Channels |

All moderation commands are restricted to servers. The bot checks the invoking member's permission, prevents self-targeting, and enforces member and role hierarchy checks before moderation actions. The configured log channel is optional; message content auditing begins only when both `ENABLE_MESSAGE_AUDIT=true` and `/createlogchannel` are configured, and requires the Message Content privileged intent. The bot stores warnings, moderation action records, temporary-ban expiry times, log-channel settings, moderator-role settings, and (when enabled) edited/deleted message content locally in `data/bot-data.json`. Expired temporary bans are processed after restart as well as while the bot is running.


## Frequently Asked Questions
Why are my slash commands not showing up immediately?
If you left `DISCORD_GUILD_ID` blank, your commands were registered globally. Discord global commands can take up to an hour to propagate across all servers. For instant updates during testing, fill in your test server's ID in the .env file.

I get an error when running npm install or npm start. What am I doing wrong?
Ensure your terminal prompt path matches your project folder (where package.json is located). If your terminal says `C:\Windows\System32`, you need to switch folders first. Follow the simplified setup steps to open cmd directly inside your extracted project folder.

The bot is online, but commands say "Interaction Failed" or do nothing.

Make sure you checked the applications.commands scope alongside the bot scope when generating your bot's invite link in the Discord Developer Portal. This may be also because you did not wait for the bot to fully startup or it is offline.


What makes this bot better than Dyno?

This bot is built from the ground up using Node.js 20 and modern discord.js architecture. It runs completely lightweight, registers native Discord slash commands for rapid performance, and packs a massive suite of built-in utility, moderation, and cleanup commands without locking features behind a paywall.

My computer says `npm is not recognized as an internal or external command.` How do I fix it?

This means Node.js is either not installed or your system's environment variables haven't updated. Ensure you have installed Node.js 20 or newer. If you just installed it, restart your terminal or restart your computer for the change to take effect.

Why does the bot keep crashing with TokenInvalid?

Double-check your `.env` file. Make sure your `DISCORD_TOKEN` contains only the token string without quotation marks, spaces, or brackets around it. Also, make sure you didn't accidentally copy your Client Secret instead of your Bot Token.

Why am I getting a `Disallowed Intents error` on startup?

Your bot code requires permission to read server data (like tracking member joins or text moderation). Go to the [Discord Developer Portal](https://discord.com/developers/applications), click on your application, open the Bot tab on the left sidebar, scroll down to `Privileged Gateway Intents`, and toggle on the intents your bot needs (such as `Guild Members` or `Message Content`). Remember to save changes!






## Data and privacy notes

Message audit logging is off until `ENABLE_MESSAGE_AUDIT=true`, the Message Content privileged intent is enabled in Discord, and a server manager selects a log channel with `/createlogchannel`. After activation, message edits and deletions are saved locally so `/audit` can search them (up to the newest 10,000 records per server). Use `/removelogchannel` to stop collection and log delivery. `/cleanuplogs` removes only these message audit records; warnings and moderation-action records are stored separately. Data is kept in `data/bot-data.json`, which should be included in your hosting backups and protected from public access.

The ticket feature creates one private text channel each time `/ticket` is used. The opener and the bot can view it; grant staff access by managing the ticket channel's permissions. The opener or a member with Manage Channels can close it with `/closeticket`.


Last updated 10/23/26.
