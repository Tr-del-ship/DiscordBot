import assert from "node:assert/strict";
import { test } from "node:test";
import { funCommands } from "../src/commands/fun.js";
import { moderationCommands } from "../src/commands/moderation.js";

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
