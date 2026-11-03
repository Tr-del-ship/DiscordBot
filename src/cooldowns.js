const cooldowns = new Map();
const cooldownMilliseconds = 2_000;
const maxCooldownEntries = 10_000;
const actionWindowMilliseconds = 60_000;
const maxActionEntries = 100_000;
const actionCounts = new Map();

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

export function getGuildActionRateLimit(
  userId,
  guildId,
  userLimit,
  guildLimit,
  now = Date.now(),
) {
  const userKey = `user:${guildId}:${userId}`;
  const guildKey = `guild:${guildId}`;
  const activeTimestamps = (key) =>
    (actionCounts.get(key) ?? []).filter(
      (timestamp) => timestamp > now - actionWindowMilliseconds,
    );
  const userTimestamps = activeTimestamps(userKey);
  const guildTimestamps = activeTimestamps(guildKey);
  if (userTimestamps.length) actionCounts.set(userKey, userTimestamps);
  else actionCounts.delete(userKey);
  if (guildTimestamps.length) actionCounts.set(guildKey, guildTimestamps);
  else actionCounts.delete(guildKey);
  const userRemaining = userLimit - userTimestamps.length;
  const guildRemaining = guildLimit - guildTimestamps.length;
  if (userRemaining <= 0) return { limited: true, scope: "user" };
  if (guildRemaining <= 0) return { limited: true, scope: "guild" };
  if (actionCounts.size >= maxActionEntries) {
    for (const [key, timestamps] of actionCounts) {
      if (timestamps.some((timestamp) => timestamp > now - actionWindowMilliseconds)) continue;
      actionCounts.delete(key);
    }
    if (actionCounts.size >= maxActionEntries) {
      return { limited: true, scope: "system" };
    }
  }

  actionCounts.set(userKey, [...userTimestamps, now]);
  actionCounts.set(guildKey, [...guildTimestamps, now]);
  return { limited: false, scope: null };
}
