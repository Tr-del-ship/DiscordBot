const cooldowns = new Map();
const cooldownMilliseconds = 2_000;
const maxCooldownEntries = 10_000;

export function getCommandCooldown(commandName, userId, guildId, now = Date.now()) {
  const key = `${guildId ?? "dm"}:${userId}:${commandName}`;
  const expiresAt = cooldowns.get(key);
  if (expiresAt && expiresAt > now) return expiresAt - now;
  cooldowns.delete(key);

  if (cooldowns.size >= maxCooldownEntries) {
    for (const [entry, expiry] of cooldowns) {
      if (expiry <= now) cooldowns.delete(entry);
    }
    if (cooldowns.size >= maxCooldownEntries) {
      return cooldownMilliseconds;
    }
  }

  cooldowns.set(key, now + cooldownMilliseconds);
  return 0;
}
