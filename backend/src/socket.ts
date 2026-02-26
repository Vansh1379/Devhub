import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "./config/env";

const JWT_SECRET = env.jwtSecret;

// In-memory presence: spaceId -> socketId -> { userId, displayName, x, y, z, direction, avatar }
const presence = new Map<string, Map<string, { userId: string; displayName: string; x: number; y: number; z: number; direction: string; avatar: unknown }>>();

function getOrCreateSpace(spaceId: string): Map<string, { userId: string; displayName: string; x: number; y: number; z: number; direction: string; avatar: unknown }> {
  let space = presence.get(spaceId);
  if (!space) {
    space = new Map();
    presence.set(spaceId, space);
  }
  return space;
}

function getSpaceUsers(spaceId: string): Array<{ socketId: string; userId: string; displayName: string; x: number; y: number; z: number; direction: string; avatar: unknown }> {
  const space = presence.get(spaceId);
  if (!space) return [];
  return Array.from(space.entries()).map(([socketId, data]) => ({ socketId, ...data }));
}

export function attachSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: "*" },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on("connection", (socket: Socket) => {
    const handshakeAuth = socket.handshake.auth as { token?: string };
    const token = handshakeAuth?.token;
    if (!token) {
      socket.disconnect(true);
      return;
    }
    let userId: string;
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      userId = decoded.userId;
    } catch {
      socket.disconnect(true);
      return;
    }
    (socket as Socket & { userId: string }).userId = userId;

    socket.on("join_space", (payload: { spaceId: string; displayName?: string; x?: number; y?: number; z?: number; direction?: string; avatar?: unknown }) => {
      const spaceId = payload?.spaceId;
      if (!spaceId || typeof spaceId !== "string") return;
      const displayName = typeof payload.displayName === "string" && payload.displayName.trim() ? payload.displayName.trim() : "User";
      const x = typeof payload.x === "number" ? payload.x : 0;
      const y = typeof payload.y === "number" ? payload.y : 0;
      const z = typeof payload.z === "number" ? payload.z : 0;
      const direction = typeof payload.direction === "string" ? payload.direction : "down";
      const avatar = payload.avatar ?? null;

      const room = `space:${spaceId}`;
      socket.join(room);
      const space = getOrCreateSpace(spaceId);
      space.set(socket.id, { userId, displayName, x, y, z, direction, avatar });
      (socket as Socket & { currentSpaceId?: string }).currentSpaceId = spaceId;

      const users = getSpaceUsers(spaceId).map((u) => ({ userId: u.userId, socketId: u.socketId, displayName: u.displayName, x: u.x, y: u.y, z: u.z, direction: u.direction, avatar: u.avatar }));
      socket.emit("space_state", { users });

      socket.to(room).emit("user_joined", {
        userId,
        socketId: socket.id,
        displayName,
        x,
        y,
        z,
        direction,
        avatar,
      });
    });

    socket.on("leave_space", (payload: { spaceId: string }) => {
      const spaceId = payload?.spaceId ?? (socket as Socket & { currentSpaceId?: string }).currentSpaceId;
      if (!spaceId) return;
      const room = `space:${spaceId}`;
      socket.leave(room);
      const space = presence.get(spaceId);
      if (space) {
        space.delete(socket.id);
        if (space.size === 0) presence.delete(spaceId);
      }
      (socket as Socket & { currentSpaceId?: string }).currentSpaceId = undefined;
      socket.to(room).emit("user_left", { userId: (socket as Socket & { userId: string }).userId, socketId: socket.id });
    });

    socket.on("move", (payload: { spaceId: string; x: number; y: number; z?: number; direction: string }) => {
      const spaceId = payload?.spaceId;
      if (!spaceId || typeof spaceId !== "string") return;
      const x = typeof payload.x === "number" ? payload.x : 0;
      const y = typeof payload.y === "number" ? payload.y : 0;
      const z = typeof payload.z === "number" ? payload.z : 0;
      const direction = typeof payload.direction === "string" ? payload.direction : "down";

      const space = getOrCreateSpace(spaceId);
      const existing = space.get(socket.id);
      if (existing) {
        existing.x = x;
        existing.y = y;
        existing.z = z;
        existing.direction = direction;
      }
      socket.to(`space:${spaceId}`).emit("user_moved", {
        userId: (socket as Socket & { userId: string }).userId,
        socketId: socket.id,
        x,
        y,
        z,
        direction,
      });
    });

    socket.on("disconnect", () => {
      const spaceId = (socket as Socket & { currentSpaceId?: string }).currentSpaceId;
      if (spaceId) {
        const room = `space:${spaceId}`;
        const space = presence.get(spaceId);
        if (space) {
          space.delete(socket.id);
          if (space.size === 0) presence.delete(spaceId);
        }
        socket.to(room).emit("user_left", { userId: (socket as Socket & { userId: string }).userId, socketId: socket.id });
      }
    });
  });

  return io;
}
