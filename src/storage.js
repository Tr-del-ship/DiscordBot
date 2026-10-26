import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rmdir,
  rename,
  unlink,
} from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const legacyDataDirectory = path.join(projectRoot, "data");
const legacyDataFile = path.join(legacyDataDirectory, "bot-data.json");
const configuredDataDirectory = process.env.BOT_DATA_DIR?.trim() || undefined;

if (configuredDataDirectory && !path.isAbsolute(configuredDataDirectory)) {
  throw new Error("BOT_DATA_DIR must be an absolute path.");
}

function getDefaultDataDirectory() {
  if (process.platform === "win32") {
    const baseDirectory =
      process.env.LOCALAPPDATA ||
      path.join(os.homedir(), "AppData", "Local");
    return path.join(baseDirectory, "DiscordModerationBot");
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "DiscordModerationBot",
    );
  }
  const stateHome = process.env.XDG_STATE_HOME?.trim();
  const baseDirectory =
    stateHome && path.isAbsolute(stateHome)
      ? stateHome
      : path.join(os.homedir(), ".local", "state");
  return path.join(baseDirectory, "discord-moderation-bot");
}

const dataDirectory =
  configuredDataDirectory ?? getDefaultDataDirectory();
const dataFile = path.join(dataDirectory, "state.json");
const lockFile = path.join(dataDirectory, ".bot.lock");
const maxDataFileSize = 64 * 1024 * 1024;
const emptyState = () => ({ guilds: {} });
let statePromise;
let writeQueue = Promise.resolve();
let storageLockToken;
const keyedLocks = new Map();

function assertPlainObject(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} must be an object.`);
  }
}

function validateState(state) {
  assertPlainObject(state, "Bot data");
  assertPlainObject(state.guilds, "Bot data guilds");
  for (const [guildId, guild] of Object.entries(state.guilds)) {
    if (!/^\d{17,20}$/.test(guildId)) {
      throw new Error("Bot data contains an invalid guild ID.");
    }
    assertPlainObject(guild, `Bot data for guild ${guildId}`);
    if (
      (guild.warnings !== undefined &&
        (typeof guild.warnings !== "object" ||
          guild.warnings === null ||
          Array.isArray(guild.warnings))) ||
      (guild.actions !== undefined && !Array.isArray(guild.actions)) ||
      (guild.audit !== undefined && !Array.isArray(guild.audit)) ||
      (guild.moderatorRoleIds !== undefined &&
        !Array.isArray(guild.moderatorRoleIds)) ||
      (guild.temporaryBans !== undefined &&
        (typeof guild.temporaryBans !== "object" ||
          guild.temporaryBans === null ||
          Array.isArray(guild.temporaryBans)))
    ) {
      throw new Error(`Bot data for guild ${guildId} has an invalid structure.`);
    }
    for (const userId of Object.keys(guild.temporaryBans ?? {})) {
      if (!/^\d{17,20}$/.test(userId)) {
        throw new Error(`Bot data for guild ${guildId} has an invalid user ID.`);
      }
    }
  }
  return state;
}

function validateSnowflake(value, label) {
  if (typeof value !== "string" || !/^\d{17,20}$/.test(value)) {
    throw new Error(`${label} must be a valid Discord ID.`);
  }
}

async function ensurePrivateDirectory() {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const details = await lstat(dataDirectory);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`Bot data path is not a private directory: ${dataDirectory}`);
  }
  if (process.platform !== "win32") {
    await chmod(dataDirectory, 0o700);
  }
}

async function writeState(state) {
  await ensurePrivateDirectory();
  const temporaryFile = path.join(
    dataDirectory,
    `.state-${process.pid}-${randomUUID()}.tmp`,
  );
  const contents = JSON.stringify(state, null, 2);
  if (Buffer.byteLength(contents, "utf8") > maxDataFileSize) {
    throw new Error(`Bot data would exceed the ${maxDataFileSize}-byte limit.`);
  }
  const file = await open(temporaryFile, "wx", 0o600);
  try {
    await file.writeFile(contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporaryFile, dataFile);
  } catch (error) {
    await unlink(temporaryFile).catch((cleanupError) => {
      if (cleanupError.code !== "ENOENT") throw cleanupError;
    });
    throw error;
  }
  if (process.platform !== "win32") {
    await chmod(dataFile, 0o600);
  }
}

async function readStateFile(filePath) {
  const details = await lstat(filePath);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`Bot data path must be a regular file: ${filePath}`);
  }
  if (details.size > maxDataFileSize) {
    throw new Error(`Bot data file exceeds the ${maxDataFileSize}-byte limit.`);
  }
  if (process.platform !== "win32") {
    await chmod(filePath, 0o600);
  }
  const contents = await readFile(filePath, "utf8");
  return validateState(JSON.parse(contents));
}

async function getState() {
  if (!statePromise) {
    statePromise = readStateFile(dataFile)
      .catch(async (error) => {
        if (error.code !== "ENOENT") throw error;
        try {
          return await readStateFile(legacyDataFile);
        } catch (legacyError) {
          if (legacyError.code === "ENOENT") return emptyState();
          throw legacyError;
        }
      })
      .catch((error) => {
        throw new Error(`Unable to read bot data: ${error.message}`, {
          cause: error,
        });
      });
  }
  return statePromise;
}

function guildData(state, guildId) {
  validateSnowflake(guildId, "Guild ID");
  const guilds = state.guilds;
  if (!Object.hasOwn(guilds, guildId)) {
    guilds[guildId] = {
      warnings: {},
      logChannelId: null,
      actions: [],
      audit: [],
      moderatorRoleIds: [],
      temporaryBans: {},
    };
  }
  const guild = guilds[guildId];
  guild.warnings ??= {};
  guild.logChannelId ??= null;
  guild.actions ??= [];
  guild.audit ??= [];
  guild.moderatorRoleIds ??= [];
  guild.temporaryBans ??= {};
  return guild;
}

async function updateGuild(guildId, update) {
  validateSnowflake(guildId, "Guild ID");
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const state = await getState();
    update(guildData(state, guildId));
    await writeState(state);
  });
  await writeQueue;
}

async function acquireStorageLock() {
  await ensurePrivateDirectory();
  const token = `${process.pid}:${randomUUID()}`;
  let file;
  try {
    file = await open(lockFile, "wx", 0o600);
    await file.writeFile(token, "utf8");
    await file.sync();
    await file.close();
  } catch (error) {
    if (file) {
      await file.close().catch((closeError) => {
        if (closeError.code !== "EBADF") throw closeError;
      });
      await unlink(lockFile).catch((cleanupError) => {
        if (cleanupError.code !== "ENOENT") throw cleanupError;
      });
    }
    if (error.code !== "EEXIST") throw error;

    let lockDetails;
    try {
      lockDetails = await lstat(lockFile);
    } catch (readError) {
      throw new Error("Unable to inspect the bot data lock file.", {
        cause: readError,
      });
    }
    if (!lockDetails.isFile() || lockDetails.isSymbolicLink()) {
      throw new Error("Bot data lock path is not a regular file.");
    }
    const existing = await readFile(lockFile, "utf8");
    const match = /^(\d+):[0-9a-f-]{36}$/.exec(existing);
    if (!match || Number(match[1]) <= 0) {
      throw new Error(
        "The bot data lock file is invalid; remove it only after confirming no bot process is running.",
      );
    }
    try {
      process.kill(Number(match[1]), 0);
    } catch (processError) {
      if (processError.code === "ESRCH") {
        throw new Error(
          "A stale bot data lock was found. Confirm no bot is running, then remove .bot.lock from the data directory and restart.",
          { cause: processError },
        );
      }
      throw processError;
    }
    throw new Error("Another bot process is already using this data directory.");
  }

  storageLockToken = token;
  if (process.platform !== "win32") await chmod(lockFile, 0o600);
  process.once("exit", releaseStorageLockSync);
}

function releaseStorageLockSync() {
  if (!storageLockToken) return;
  try {
    if (readFileSync(lockFile, "utf8") === storageLockToken) {
      unlinkSync(lockFile);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Unable to release bot data lock:", error);
    }
  }
  storageLockToken = undefined;
}

async function migrateLegacyData(state) {
  try {
    await lstat(dataFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      await lstat(legacyDataFile);
    } catch (legacyError) {
      if (legacyError.code === "ENOENT") return;
      throw legacyError;
    }
    await writeState(state);
  }

  await unlink(legacyDataFile).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await rmdir(legacyDataDirectory).catch((error) => {
    if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
  });
}

export async function initializeStorage() {
  try {
    if (!storageLockToken) await acquireStorageLock();
    const state = await getState();
    await migrateLegacyData(state);
  } catch (error) {
    releaseStorageLockSync();
    throw error;
  }
}

export function releaseStorageLock() {
  releaseStorageLockSync();
}

export async function withBanLock(guildId, userId, operation) {
  validateSnowflake(guildId, "Guild ID");
  validateSnowflake(userId, "User ID");
  const key = `${guildId}:${userId}`;
  const previous = keyedLocks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  keyedLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (keyedLocks.get(key) === queued) keyedLocks.delete(key);
  }
}

export async function getWarnings(guildId, userId) {
  validateSnowflake(userId, "User ID");
  const state = await getState();
  return guildData(state, guildId).warnings[userId] ?? [];
}

export async function addWarning(guildId, userId, moderator, reason) {
  validateSnowflake(userId, "User ID");
  const warning = {
    id: randomUUID().replaceAll("-", ""),
    reason,
    moderatorId: moderator.id,
    moderatorTag: moderator.tag,
    timestamp: new Date().toISOString(),
  };
  await updateGuild(guildId, (guild) => {
    guild.warnings[userId] ??= [];
    guild.warnings[userId].push(warning);
  });
  return warning;
}

export async function removeWarning(guildId, userId, warningId) {
  validateSnowflake(userId, "User ID");
  let removed = false;
  await updateGuild(guildId, (guild) => {
    const warnings = guild.warnings[userId] ?? [];
    const remaining = warnings.filter((warning) => {
      if (warning.id !== warningId) return true;
      removed = true;
      return false;
    });
    if (remaining.length) guild.warnings[userId] = remaining;
    else delete guild.warnings[userId];
  });
  return removed;
}

export async function setLogChannel(guildId, channelId) {
  if (channelId !== null) validateSnowflake(channelId, "Channel ID");
  await updateGuild(guildId, (guild) => {
    guild.logChannelId = channelId;
  });
}

export async function getLogChannelId(guildId) {
  const state = await getState();
  return guildData(state, guildId).logChannelId;
}

export async function addAuditEvent(guildId, event) {
  await updateGuild(guildId, (guild) => {
    guild.audit.push(event);
    if (guild.audit.length > 10_000) {
      guild.audit.splice(0, guild.audit.length - 10_000);
    }
  });
}

export async function searchAudit(guildId, { phrase, userId }) {
  if (userId) validateSnowflake(userId, "User ID");
  const state = await getState();
  const audit = guildData(state, guildId).audit;
  const normalizedPhrase = phrase?.toLocaleLowerCase();
  return audit.filter((event) => {
    if (userId && event.userId !== userId) return false;
    if (
      normalizedPhrase &&
      !`${event.oldContent ?? ""}\n${event.newContent ?? ""}`
        .toLocaleLowerCase()
        .includes(normalizedPhrase)
    ) {
      return false;
    }
    return true;
  });
}

export async function pruneAudit(guildId, olderThan) {
  let removed = 0;
  await updateGuild(guildId, (guild) => {
    const retained = guild.audit.filter(
      (event) => new Date(event.timestamp).getTime() >= olderThan,
    );
    removed = guild.audit.length - retained.length;
    guild.audit = retained;
  });
  return removed;
}

export async function addModerationAction(guildId, action) {
  await updateGuild(guildId, (guild) => {
    guild.actions.push(action);
  });
}

export async function getModerationActions(guildId, userId) {
  validateSnowflake(userId, "User ID");
  const state = await getState();
  return guildData(state, guildId).actions.filter(
    (action) => action.targetId === userId,
  );
}

export async function setTemporaryBan(guildId, userId, expiresAt) {
  validateSnowflake(userId, "User ID");
  const banId = randomUUID();
  await updateGuild(guildId, (guild) => {
    guild.temporaryBans[userId] = { id: banId, expiresAt };
  });
  return banId;
}

function normalizeTemporaryBan(value) {
  if (Number.isFinite(value)) {
    return { id: `legacy-${value}`, expiresAt: value };
  }
  if (
    value &&
    typeof value.id === "string" &&
    Number.isFinite(value.expiresAt)
  ) {
    return value;
  }
  return null;
}

export async function getTemporaryBan(guildId, userId) {
  validateSnowflake(userId, "User ID");
  const state = await getState();
  const stored = guildData(state, guildId).temporaryBans[userId];
  return normalizeTemporaryBan(stored);
}

export async function removeTemporaryBan(guildId, userId, expectedId) {
  validateSnowflake(userId, "User ID");
  let removed = false;
  await updateGuild(guildId, (guild) => {
    const stored = guild.temporaryBans[userId];
    if (
      expectedId !== undefined &&
      normalizeTemporaryBan(stored)?.id !== expectedId
    ) {
      return;
    }
    delete guild.temporaryBans[userId];
    removed = stored !== undefined;
  });
  return removed;
}

export async function getTemporaryBans() {
  const state = await getState();
  return Object.entries(state.guilds).flatMap(([guildId, guild]) =>
    Object.entries(guild.temporaryBans ?? {}).flatMap(([userId, stored]) => {
      const temporaryBan = normalizeTemporaryBan(stored);
      return temporaryBan ? [{ guildId, userId, ...temporaryBan }] : [];
    }),
  );
}

export async function setModeratorRole(guildId, roleId, enabled) {
  validateSnowflake(roleId, "Role ID");
  await updateGuild(guildId, (guild) => {
    const roles = new Set(guild.moderatorRoleIds);
    if (enabled) roles.add(roleId);
    else roles.delete(roleId);
    guild.moderatorRoleIds = [...roles];
  });
}

export async function hasModeratorRole(guildId, roleIds) {
  const state = await getState();
  const allowedRoles = new Set(guildData(state, guildId).moderatorRoleIds);
  return roleIds.some((roleId) => allowedRoles.has(roleId));
}
