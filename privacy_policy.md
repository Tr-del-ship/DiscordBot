# Discord Bot Privacy Policy
This privacy policy explains how this Discord bot handles data. Because this bot is self-hosted, the person running the bot is responsible for the infrastructure and hosting environment where the data is processed.

## Data Collection & Usage
This bot processes basic server information and user data necessary for its features and moderation functions. This includes information provided directly through the Discord API, such as server IDs, channel IDs, user IDs, usernames, role information, and warning/moderation records.


Message content is stored for audit by default. Only when `ENABLE_MESSAGE_AUDIT=true`, the Message Content privileged intent is enabled in the Discord Developer Portal, and a server administrator configures a channel with `/createlogchannel`, the bot stores up to the newest 10,000 guild message edits and deletions for `/audit` searches and posts them to that channel. The administrator can stop collection with `/removelogchannel` and remove old message audit records with `/cleanuplogs`. Separately, setting `ENABLE_CLANKER_REPLIES=true` enables detection of the word “clanker” in messages that directly mention the bot, so it can reply in that channel. This trigger content is processed in memory and is not stored by the feature; each member can trigger at most one reply every 30 seconds. Setting `ENABLE_TICKET_TRANSCRIPTS=true` enables collecting a ticket's message text when the ticket is closed. The transcript file is sent to the opener by DM and to a private channel selected by a server manager with `/tickettranscripts`; bot-sent copies in both destinations are scheduled for deletion after 30 days. Transcript generation requires the Message Content privileged intent. If transcripts are disabled or no private transcript channel is configured, the ticket is still closed and archived but no transcript is saved.

*The bot does not collect, process, or store private personal identifiers such as IP addresses or real-world locations.*


## Data Storage and Retention
Warnings, moderation actions, temporary-ban expiry times, configuration, and enabled message audit records are stored in the host user's application-data/state directory, or the absolute path configured in `BOT_DATA_DIR`. Existing installations migrate their former `data/bot-data.json` file to this location on startup. On POSIX systems the bot restricts its directory and files to owner-only access; on Windows, access follows the ACLs of the user-profile directory. This is not encryption, and the host operator remains responsible for OS account security, full-disk encryption, backups, and data retention. The bot uses an exclusive lock so multiple instances cannot write the same store simultaneously. `/cleanuplogs` affects message audit records only; warnings and moderation action records are retained unless explicitly removed or the state file is deleted.


## Data Sharing
No data is shared with third parties by the bot software. All data transmission stays strictly within the self-hosted environment and the official Discord API.

User Rights
Users who wish to have their data removed should contact the administrator of the specific Discord server hosting the bot instance, as the bot creator does not control or store any server data.

License: [LICENSE.md](https://github.com/Tr-del-ship/DiscordBot/tree/codespace-refactored-engine-4qw4pwjp4grq3j6qv?tab=License-1-ov-file)
