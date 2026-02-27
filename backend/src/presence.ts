/**
 * Presence storage for Phase 3: in-memory or Redis (when REDIS_URL is set).
 * Key: presence:space:<spaceId> (Redis hash: socketId -> JSON payload)
 */

import Redis from "ioredis";
import { env } from "./config/env";

export interface PresenceUser {
  userId: string;
  displayName: string;
  x: number;
  y: number;
  z: number;
  direction: string;
  avatar: unknown;
}

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis !== undefined && redis !== null) return redis;
  if (!env.redisUrl || env.redisUrl.trim() === "") {
    redis = null;
    return null;
  }
  try {
    redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 3 });
    return redis;
  } catch {
    redis = null;
    return null;
  }
}

const REDIS_KEY_PREFIX = "presence:space:";
const IN_MEMORY = new Map<
  string,
  Map<string, PresenceUser>
>();

function redisKey(spaceId: string): string {
  return `${REDIS_KEY_PREFIX}${spaceId}`;
}

export async function getSpaceUsers(
  spaceId: string
): Promise<Array<PresenceUser & { socketId: string }>> {
  const client = getRedis();
  if (client) {
    try {
      const raw = await client.hgetall(redisKey(spaceId));
      if (!raw || Object.keys(raw).length === 0) return [];
      return Object.entries(raw).map(([socketId, json]) => {
        const data = JSON.parse(json) as PresenceUser;
        return { socketId, ...data };
      });
    } catch {
      return [];
    }
  }
  const space = IN_MEMORY.get(spaceId);
  if (!space) return [];
  return Array.from(space.entries()).map(([socketId, data]) => ({
    socketId,
    ...data,
  }));
}

export async function setUserInSpace(
  spaceId: string,
  socketId: string,
  data: PresenceUser
): Promise<void> {
  const client = getRedis();
  if (client) {
    try {
      await client.hset(
        redisKey(spaceId),
        socketId,
        JSON.stringify(data)
      );
    } catch {
      // fallback: in-memory for this process only
      let space = IN_MEMORY.get(spaceId);
      if (!space) {
        space = new Map();
        IN_MEMORY.set(spaceId, space);
      }
      space.set(socketId, data);
    }
    return;
  }
  let space = IN_MEMORY.get(spaceId);
  if (!space) {
    space = new Map();
    IN_MEMORY.set(spaceId, space);
  }
  space.set(socketId, data);
}

export async function removeUserFromSpace(
  spaceId: string,
  socketId: string
): Promise<void> {
  const client = getRedis();
  if (client) {
    try {
      await client.hdel(redisKey(spaceId), socketId);
    } catch {
      const space = IN_MEMORY.get(spaceId);
      if (space) space.delete(socketId);
    }
    return;
  }
  const space = IN_MEMORY.get(spaceId);
  if (space) {
    space.delete(socketId);
    if (space.size === 0) IN_MEMORY.delete(spaceId);
  }
}

export async function updateUserPosition(
  spaceId: string,
  socketId: string,
  update: { x: number; y: number; z: number; direction: string }
): Promise<PresenceUser | null> {
  const client = getRedis();
  if (client) {
    try {
      const key = redisKey(spaceId);
      const json = await client.hget(key, socketId);
      if (!json) return null;
      const data = JSON.parse(json) as PresenceUser;
      const next = { ...data, ...update };
      await client.hset(key, socketId, JSON.stringify(next));
      return next;
    } catch {
      return null;
    }
  }
  const space = IN_MEMORY.get(spaceId);
  const existing = space?.get(socketId);
  if (!existing) return null;
  existing.x = update.x;
  existing.y = update.y;
  existing.z = update.z;
  existing.direction = update.direction;
  return existing;
}
