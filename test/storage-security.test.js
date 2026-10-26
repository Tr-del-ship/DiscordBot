import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getCommandCooldown } from "../src/cooldowns.js";

const testRoot = await mkdtemp(path.join(os.tmpdir(), "discord-bot-test-"));
const dataDirectory = path.join(testRoot, "private-state");
process.env.BOT_DATA_DIR = dataDirectory;

const storage = await import("../src/storage.js");
const { expireTemporaryBans } = await import("../src/temporary-bans.js");
const guildId = "11111111111111111";
const userId = "22222222222222222";

after(async () => {
  storage.releaseStorageLock();
  await rm(testRoot, { recursive: true, force: true });
});

test("restricts state storage and prevents concurrent bot writers", async () => {
  await storage.initializeStorage();
  const dataFile = path.join(dataDirectory, "state.json");
  const contents = await stat(dataFile).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  assert.equal(contents, null);

  const storageUrl = pathToFileURL(
    path.resolve("src", "storage.js"),
  ).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { initializeStorage } from ${JSON.stringify(storageUrl)}; await initializeStorage();`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, BOT_DATA_DIR: dataDirectory },
    },
  );
  assert.equal(child.status, 1);
  assert.match(child.stderr, /already using this data directory/);

  const emptyOverride = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(storageUrl)}); console.log("loaded");`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, BOT_DATA_DIR: "" },
    },
  );
  assert.equal(emptyOverride.status, 0, emptyOverride.stderr);

  const defaultProfile = path.join(testRoot, "default-profile");
  const defaultDataDirectory = path.join(
    defaultProfile,
    "DiscordModerationBot",
  );
  const defaultPath = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { initializeStorage, releaseStorageLock } from ${JSON.stringify(storageUrl)}; await initializeStorage(); releaseStorageLock();`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        BOT_DATA_DIR: "",
        LOCALAPPDATA: defaultProfile,
      },
    },
  );
  assert.equal(defaultPath.status, 0, defaultPath.stderr);
  assert.ok((await stat(defaultDataDirectory)).isDirectory());
});

test("stores temporary ban generations and ignores stale expiry records", async () => {
  const oldId = await storage.setTemporaryBan(
    guildId,
    userId,
    Date.now() - 1_000,
  );
  const replacementId = await storage.setTemporaryBan(
    guildId,
    userId,
    Date.now() + 60_000,
  );
  assert.equal(
    await storage.removeTemporaryBan(guildId, userId, oldId),
    false,
  );
  assert.equal(
    (await storage.getTemporaryBan(guildId, userId)).id,
    replacementId,
  );

  const stateFile = path.join(dataDirectory, "state.json");
  const permissions = (await stat(stateFile)).mode & 0o777;
  if (process.platform !== "win32") assert.equal(permissions, 0o600);
});

test("does not expire a replacement ban while processing an old expiry", async () => {
  await storage.setTemporaryBan(guildId, userId, Date.now() - 1_000);
  let unbanCalls = 0;
  const guild = {
    bans: {
      async fetch() {
        await storage.setTemporaryBan(
          guildId,
          userId,
          Date.now() + 60_000,
        );
      },
    },
    members: {
      async unban() {
        unbanCalls += 1;
      },
    },
  };
  const client = {
    guilds: {
      cache: new Map([[guildId, guild]]),
      async fetch() {
        return guild;
      },
    },
  };

  await expireTemporaryBans(client);
  assert.equal(unbanCalls, 0);
  assert.ok((await storage.getTemporaryBan(guildId, userId)).expiresAt > Date.now());
});

test("expires a current temporary ban and clears its record", async () => {
  await storage.setTemporaryBan(guildId, userId, Date.now() - 1_000);
  let unbanCalls = 0;
  const guild = {
    bans: { async fetch() {} },
    members: {
      async unban(id, reason) {
        assert.equal(id, userId);
        assert.equal(reason, "Temporary ban expired");
        unbanCalls += 1;
      },
    },
  };
  const client = {
    guilds: {
      cache: new Map([[guildId, guild]]),
      async fetch() {
        return guild;
      },
    },
  };

  await expireTemporaryBans(client);
  assert.equal(unbanCalls, 1);
  assert.equal(await storage.getTemporaryBan(guildId, userId), null);
});

test("invalidates temporary-ban expiry when an unban is followed by a new ban", async () => {
  const oldId = await storage.setTemporaryBan(
    guildId,
    userId,
    Date.now() - 1_000,
  );
  await storage.withBanLock(guildId, userId, () =>
    storage.removeTemporaryBan(guildId, userId, oldId),
  );
  assert.equal(await storage.getTemporaryBan(guildId, userId), null);

  let unbanCalls = 0;
  const guild = {
    bans: { async fetch() {} },
    members: {
      async unban() {
        unbanCalls += 1;
      },
    },
  };
  const client = {
    guilds: {
      cache: new Map([[guildId, guild]]),
      async fetch() {
        return guild;
      },
    },
  };
  await expireTemporaryBans(client);
  assert.equal(unbanCalls, 0);
});

test("applies independent per-user command cooldowns", () => {
  const now = 1_000_000;
  assert.equal(getCommandCooldown("test", userId, guildId, now), 0);
  assert.equal(getCommandCooldown("test", userId, guildId, now + 1_000), 1_000);
  assert.equal(getCommandCooldown("other", userId, guildId, now + 1_000), 0);
  assert.equal(
    getCommandCooldown("test", "33333333333333333", guildId, now + 1_000),
    0,
  );
  assert.equal(getCommandCooldown("test", userId, guildId, now + 2_000), 0);
});
