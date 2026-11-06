import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectTicketMessages,
  formatTicketTranscript,
} from "../src/ticket-transcripts.js";

test("collects ticket messages in chronological order across pages", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: `page-one-${index}`,
    createdTimestamp: 300 + index,
    content: `page-one-${index}`,
  }));
  const secondPage = [
    { id: "page-two", createdTimestamp: 100, content: "oldest" },
  ];
  const pages = [
    firstPage,
    secondPage,
  ];
  const channel = {
    messages: {
      async fetch({ before }) {
        return new Map(
          (before ? pages[1] : pages[0]).map((message) => [message.id, message]),
        );
      },
    },
  };
  const result = await collectTicketMessages(channel);
  assert.equal(result.messages[0].content, "oldest");
  assert.equal(result.messages.length, 101);
  assert.equal(result.truncated, false);
});

test("formats a text transcript with close details and attachment references", () => {
  const result = formatTicketTranscript(
    [{
      createdTimestamp: Date.parse("2026-11-06T12:00:00.000Z"),
      author: { tag: "member#1234", id: "11111111111111111" },
      content: "Please help.",
      attachments: new Map([["file", { url: "https://cdn.example/file.png" }]]),
    }],
    {
      guildName: "Example server",
      channelName: "closed-ticket-member",
      openerId: "11111111111111111",
      reason: "Issue resolved",
      closedAt: new Date("2026-11-06T12:05:00.000Z"),
    },
  );
  const text = result.content.toString("utf8");
  assert.match(text, /Example server/);
  assert.match(text, /Issue resolved/);
  assert.match(text, /member#1234/);
  assert.match(text, /Please help\./);
  assert.match(text, /https:\/\/cdn\.example\/file\.png/);
  assert.equal(result.includedMessages, 1);
  assert.equal(result.truncated, false);
});
