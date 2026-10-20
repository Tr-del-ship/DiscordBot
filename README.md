# DiscordBot

A fast, configurable Discord bot for server moderation and a few lightweight fun commands, built with JavaScript and discord.js.

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

<img width="1200" height="540" alt="image" src="https://github.com/user-attachments/assets/2bcf94be-7597-4063-82c5-866c8a6a7747" />


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

3. In the Developer Portal, enable the **bot** and **applications.commands** scopes when generating an invite link. Invite the bot to your server and grant only the permissions it needs. Moderation commands require the bot to have the corresponding server permission. Enabling administrator is recommended for permissions.

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
+ More permissions may be required soon!
------------------------------------------------------------------------------------------------------------------ 
   

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


## Extra Information

Some commands are easily configurable like eightball in fun.json.
What to know: A lot more commands coming next month such as, '/createlogchannel' and many more!
- `/createlogchannel` will allow a user to pick a channel that exists in the server which will show all moderation commands like /warn into that specific channel. Fun commands like ping, eightball, coinflip and other ones that may be considered fun will not show up in the channel. Simplified: Shows all moderation actions taken against users like /warn, /purge, /cleanup and whatnot.

## Looking Towards The Future
- Commands like `userinfo` will show all the roles that the user currently has also including, join date, server join date and infractions like warnings, kicks and bans.
- `serverinfo` will present more things about the server like the server description.
- Fix the /warn bug. (Ability to warn yourself.) There will also be some additional restrictions to the warn command like the abilty to warn roles that have a higher ranking than them.
- Instead of `clearwarnings` clearing ALL warnings, it will present all warnings they have at the moment and give mods the ability to clear one specific warning.
- Removing the ability to use ALL moderation commands on yourself.
- If there are updates available, some text will appear in the terminal that the bot is running on saying "Update available for the bot, please refer to [DiscordBot Install](https://github.com/Tr-del-ship/DiscordBot/tree/codespace-refactored-engine-4qw4pwjp4grq3j6qv)."

### Future Security Updates
- restricting dangerous commands: Locking owner only or high privilege administrative commands behind checks like `@command.is_owner()` 
- Sanitizing inputs and/or URLs to prevent injections attacks and `SSRF`. (Server-Side-Request-Forgery)
- Cooldown of 1-3 seconds for each command.
- Moderation action log. (stated above.)
- Hierarchy checks: Makes sure that low rank mods can not full fill a request of kicking, or banning and other high risk commands.
And maybe more!


Last updated 10/20/26 2:49 PM.
