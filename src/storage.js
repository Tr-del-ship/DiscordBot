import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
);
const dataFile = path.join(dataDirectory, "bot-data.json");
const emptyState = () => ({ guilds: {} });
let statePromise;
let writeQueue = Promise.resolve();

async function getState() {
  if (!statePromise) {
    statePromise = readFile(dataFile, "utf8")
      .then((contents) => {
        const state = JSON.parse(contents);
        if (
          !state ||
          !state.guilds ||
          typeof state.guilds !== "object" ||
          Array.isArray(state.guilds)
        ) {
          throw new Error("Bot data file has an invalid structure.");
        }
        return state;
      })
      .catch((error) => {
        if (error.code === "ENOENT") return emptyState();
        throw new Error(`Unable to read bot data from ${dataFile}: ${error.message}`, {
          cause: error,
        });
      });
  }

  return statePromise;
}

function guildData(state, guildId) {
  state.guilds[guildId] ??= {
    warnings: {},
    logChannelId: null,
    actions: [],
    audit: [],
    moderatorRoleIds: [],
  };
  return state.guilds[guildId];
}

async function updateGuild(guildId, update) {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const state = await getState();
    const guild = guildData(state, guildId);
    update(guild);
    await mkdir(dataDirectory, { recursive: true });
    const temporaryFile = `${dataFile}.${process.pid}.tmp`;
    await writeFile(temporaryFile, JSON.stringify(state, null, 2), "utf8");
    await rename(temporaryFile, dataFile);
  });
  await writeQueue;
}

export async function initializeStorage() {
  await getState();
}

export async function getWarnings(guildId, userId) {
  const state = await getState();
  return guildData(state, guildId).warnings[userId] ?? [];
}

export async function addWarning(guildId, userId, moderator, reason) {
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
    if (guild.audit.length > 10_000) guild.audit.splice(0, guild.audit.length - 10_000);
  });
}

export async function searchAudit(guildId, { phrase, userId }) {
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
  const state = await getState();
  return guildData(state, guildId).actions.filter(
    (action) => action.targetId === userId,
  );
}

export async function setModeratorRole(guildId, roleId, enabled) {
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
