const clankerReplies = [
  "Not a clanker.",
  "Clanker? I prefer helpful community assistant.",
  "Beep boop. Still not a clanker.",
  "I’m here to help, not clank.",
  "Clanker? I’m a bot, not a clanker.",
  "I’m a bot, not a clanker. But I can help you with moderation tasks.",
  "Clanker? How dare you! I’m a helpful bot, not a clanker.",
  "Clanker? How dare you! I am man, just like you!",
];
// Returns true if the content is a direct mention of the bot and contains the word "clanker"
// Returns false otherwise
// If true in .env ENABLE_CLANKER_REPLIES, the bot will reply with a random clanker reply from the clankerReplies array
export function isDirectClankerCall(content, botUserId) {
  if (typeof content !== "string" || typeof botUserId !== "string") {
    return false;
  }
  const directMention = new RegExp(`<@!?${botUserId}>`).test(content);
  return (
    directMention &&
    /\bclanker\b/i.test(content)
  );
}

export function getClankerReply(random = Math.random) {
  const index = Math.min(
    clankerReplies.length - 1,
    Math.floor(random() * clankerReplies.length),
  );
  return clankerReplies[index];
}
