import {
  getTemporaryBan,
  getTemporaryBans,
  removeTemporaryBan,
  withBanLock,
} from "./storage.js";

export async function expireTemporaryBans(client) {
  const scheduledBans = await getTemporaryBans();
  for (const scheduledBan of scheduledBans) {
    if (scheduledBan.expiresAt > Date.now()) continue;
    const { guildId, userId, id } = scheduledBan;
    try {
      await withBanLock(guildId, userId, async () => {
        const current = await getTemporaryBan(guildId, userId);
        if (!current || current.id !== id || current.expiresAt > Date.now()) {
          return;
        }

        const guild =
          client.guilds.cache.get(guildId) ??
          await client.guilds.fetch(guildId);
        try {
          await guild.bans.fetch({ user: userId });
        } catch (error) {
          if (error.code === 10026) {
            await removeTemporaryBan(guildId, userId, id);
            return;
          }
          throw error;
        }

        const latest = await getTemporaryBan(guildId, userId);
        if (!latest || latest.id !== id || latest.expiresAt > Date.now()) {
          return;
        }
        await guild.members.unban(userId, "Temporary ban expired");
        await removeTemporaryBan(guildId, userId, id);
      });
    } catch (error) {
      if (error.code === 10004) {
        await removeTemporaryBan(guildId, userId, id);
      } else {
        console.error(
          `Unable to expire temporary ban for ${userId} in guild ${guildId}:`,
          error,
        );
      }
    }
  }
}
