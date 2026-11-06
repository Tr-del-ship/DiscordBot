import assert from "node:assert/strict";
import { test } from "node:test";
import { funCommands } from "../src/commands/fun.js";
import { moderationCommands } from "../src/commands/moderation.js";
import {
  getClankerReply,
  isDirectClankerCall,
} from "../src/clanker-replies.js";
import { loggedCommands } from "../src/moderation-logging.js";

test("logs each requested command using its registered command name", () => {
  const registeredCommands = new Set(
    [...funCommands, ...moderationCommands].map(({ data }) => data.name),
  );
  const requestedCommands = [
    "modnote",
    "modnotes",
    "case",
    "deletemodnote",
    "deletechannel",
    "createchannel",
    "banlist",
    "lock",
    "lockdown",
    "createinvite",
    "slowmode",
    "mute",
    "unmute",
    "deafen",
    "undeafen",
    "clear",
    "purgebots",
    "disconnect",
    "audit",
    "poll",
    "announce",
  ];

  for (const commandName of requestedCommands) {
    assert.ok(registeredCommands.has(commandName), `/${commandName} is registered`);
    assert.ok(loggedCommands.has(commandName), `/${commandName} is logged`);
  }
});

test("clanker replies require a direct bot mention and the clanker word", () => {
  const botId = "11111111111111111";
  assert.equal(
    isDirectClankerCall(`<@${botId}> you are a clAnKeR`, botId),
    true,
  );
  assert.equal(isDirectClankerCall("That bot is a clanker", botId), false);
  assert.equal(isDirectClankerCall(`<@${botId}> clankers`, botId), false);
  assert.equal(isDirectClankerCall(`<@${botId}> hello`, botId), false);
  assert.equal(getClankerReply(() => 0), "Not a clanker.");
  assert.match(getClankerReply(() => 0.99), /clanker/i);
  assert.equal(getClankerReply(() => 0.5), "Clanker? I’m a bot, not a clanker.");
  assert.equal(getClankerReply(() => 0.25), "Beep boop. Still not a clanker.");
  assert.equal(getClankerReply(() => 0.75), "Clanker? How dare you! I’m a helpful bot, not a clanker.");
  assert.equal(getClankerReply(() => 0.875), "Clanker? How dare you! I am man, just like you!");
});
