const maxTranscriptBytes = 7 * 1024 * 1024;
const maxTranscriptMessages = 5_000;

export async function collectTicketMessages(channel) {
  const messages = [];
  let before;
  while (messages.length < maxTranscriptMessages) {
    const batch = await channel.messages.fetch({
      limit: Math.min(100, maxTranscriptMessages - messages.length),
      ...(before ? { before } : {}),
    });
    if (batch.size === 0) break;
    const batchMessages = [...batch.values()];
    messages.push(...batchMessages);
    before = batchMessages.at(-1).id;
    if (batch.size < 100) break;
  }
  const truncated = messages.length === maxTranscriptMessages &&
    (await channel.messages.fetch({ limit: 1, before })).size > 0;
  return {
    messages: messages.sort(
      (left, right) => left.createdTimestamp - right.createdTimestamp,
    ),
    truncated,
  };
}

export function formatTicketTranscript(
  messages,
  {
    guildName,
    channelName,
    openerId,
    closerId,
    reason,
    closedAt = new Date(),
  },
  truncated = false,
) {
  const lines = [
    `Ticket transcript: #${channelName}`,
    `Server: ${guildName}`,
    `Opened by: ${openerId}`,
    `Closed by: ${closerId ?? "unknown"}`,
    `Closed: ${closedAt.toISOString()}`,
    `Close reason: ${reason}`,
    "",
  ];
  let byteLength = Buffer.byteLength(lines.join("\n"), "utf8");
  let includedMessages = 0;
  let omittedMessages = truncated;

  for (const message of messages) {
    const timestamp = new Date(message.createdTimestamp).toISOString();
    const content = message.content?.trim() || "[no text content]";
    const attachmentLines = [...(message.attachments?.values?.() ?? [])]
      .map((attachment) => `  Attachment: ${attachment.url}`);
    const entry = [
      `[${timestamp}] ${message.author?.tag ?? "Unknown user"} (${message.author?.id ?? "unknown id"})`,
      content,
      ...attachmentLines,
      "",
    ].join("\n");
    const entryBytes = Buffer.byteLength(entry, "utf8");
    if (byteLength + entryBytes > maxTranscriptBytes) {
      omittedMessages = true;
      break;
    }
    lines.push(entry);
    byteLength += entryBytes;
    includedMessages += 1;
  }

  if (omittedMessages) {
    lines.push(
      "[Transcript truncated: the channel history or file exceeded the supported limit.]",
    );
  }
  return {
    content: Buffer.from(lines.join("\n"), "utf8"),
    includedMessages,
    truncated: omittedMessages,
  };
}
