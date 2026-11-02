import assert from "node:assert/strict";
import { test } from "node:test";
import { ChannelType } from "discord.js";
import { funCommands } from "../src/commands/fun.js";
import {
  handleAnnouncementInteraction,
  moderationCommands,
} from "../src/commands/moderation.js";

test("all registered slash commands serialize with unique names", () => {
  const definitions = [...funCommands, ...moderationCommands].map(
    ({ data }) => data.toJSON(),
  );
  const names = definitions.map(({ name }) => name);
  assert.ok(definitions.length <= 100);
  assert.equal(new Set(names).size, names.length);
});

test("includes at least five newly added fun commands", () => {
  const names = new Set(funCommands.map(({ data }) => data.name));
  for (const name of [
    "dice",
    "randomnumber",
    "choose",
    "rps",
    "trivia",
    "fortune",
    "compliment",
  ]) {
    assert.ok(names.has(name), `Expected /${name} to be registered.`);
  }
});

test("registers the ticket panel setup command", () => {
  const names = new Set(moderationCommands.map(({ data }) => data.name));
  assert.ok(names.has("createticketpanel"));
});

test("registers a preview-first announcement command with constrained inputs", () => {
  const command = moderationCommands.find(
    ({ data }) => data.name === "announce",
  );
  assert.ok(command);

  const definition = command.data.toJSON();
  assert.equal(definition.default_member_permissions, "8192");
  assert.deepEqual(
    definition.options.map(({ name }) => name),
    ["channel", "title", "message", "color"],
  );
  assert.equal(definition.options[1].max_length, 256);
  assert.equal(definition.options[2].max_length, 4000);
});

test("announcement preview is owner-bound and posted without mention parsing", async () => {
  const command = moderationCommands.find(
    ({ data }) => data.name === "announce",
  );
  const author = { id: "11111111111111111" };
  const otherUser = { id: "22222222222222222" };
  const channel = {
    id: "33333333333333333",
    guildId: "55555555555555555",
    type: ChannelType.GuildText,
    permissionsFor: () => ({ has: () => true }),
    sentMessages: [],
    async send(payload) {
      this.sentMessages.push(payload);
    },
  };
  const member = { id: author.id };
  const botMember = { id: "44444444444444444" };
  const guild = {
    id: "55555555555555555",
    members: {
      me: botMember,
      async fetch() {
        return member;
      },
    },
    channels: {
      async fetch() {
        return channel;
      },
    },
  };
  let preview;
  await command.execute({
    guild,
    user: author,
    memberPermissions: { has: () => true },
    options: {
      getChannel: () => channel,
      getString(name) {
        return {
          title: "Server update",
          message: "Please review <@&66666666666666666>.",
          color: "Blue",
        }[name] ?? null;
      },
    },
    async deferReply() {},
    async editReply(payload) {
      preview = payload;
    },
  });

  const postButton = preview.components[0].components[0];
  const customId = postButton.data.custom_id;
  let unauthorizedReply;
  assert.equal(
    await handleAnnouncementInteraction({
      isButton: () => true,
      customId,
      user: otherUser,
      guildId: guild.id,
      guild,
      async reply(payload) {
        unauthorizedReply = payload;
      },
    }),
    true,
  );
  assert.match(unauthorizedReply.content, /Only the moderator/);
  assert.equal(channel.sentMessages.length, 0);

  let postedReply;
  await handleAnnouncementInteraction({
    isButton: () => true,
    customId,
    user: author,
    guildId: guild.id,
    guild,
    async deferUpdate() {},
    async editReply(payload) {
      postedReply = payload;
    },
  });
  assert.equal(channel.sentMessages.length, 1);
  assert.deepEqual(channel.sentMessages[0].allowedMentions, { parse: [] });
  assert.match(postedReply.content, /Announcement posted/);
});
