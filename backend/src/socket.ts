import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "./config/env";
import { prisma } from "./db/prisma";
import {
  getSpaceUsers,
  setUserInSpace,
  removeUserFromSpace,
  updateUserPosition,
} from "./presence";

const JWT_SECRET = env.jwtSecret;

function dmChannelId(userId1: string, userId2: string): string {
  return [userId1, userId2].sort().join("_");
}

const MAX_CHAT_CONTENT_LENGTH = 2000;

// Phase 3: movement bounds (match frontend floor size)
const FLOOR_HALF = 17.5;

function clampPosition(x: number, z: number): { x: number; z: number } {
  return {
    x: Math.max(-FLOOR_HALF, Math.min(FLOOR_HALF, x)),
    z: Math.max(-FLOOR_HALF, Math.min(FLOOR_HALF, z)),
  };
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

    socket.on("join_space", async (payload: { spaceId: string; displayName?: string; x?: number; y?: number; z?: number; direction?: string; avatar?: unknown }) => {
      const spaceId = payload?.spaceId;
      if (!spaceId || typeof spaceId !== "string") return;
      const displayName = typeof payload.displayName === "string" && payload.displayName.trim() ? payload.displayName.trim() : "User";
      let x = typeof payload.x === "number" ? payload.x : 0;
      const y = typeof payload.y === "number" ? payload.y : 0;
      let z = typeof payload.z === "number" ? payload.z : 0;
      const direction = typeof payload.direction === "string" ? payload.direction : "down";
      const avatar = payload.avatar ?? null;

      const clamped = clampPosition(x, z);
      x = clamped.x;
      z = clamped.z;

      const room = `space:${spaceId}`;
      socket.join(room);
      await setUserInSpace(spaceId, socket.id, {
        userId,
        displayName,
        x,
        y,
        z,
        direction,
        avatar,
      });
      (socket as Socket & { currentSpaceId?: string }).currentSpaceId = spaceId;

      const spaceUsers = await getSpaceUsers(spaceId);
      const users = spaceUsers.map((u) => ({ userId: u.userId, socketId: u.socketId, displayName: u.displayName, x: u.x, y: u.y, z: u.z, direction: u.direction, avatar: u.avatar }));
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

    socket.on("leave_space", async (payload: { spaceId: string }) => {
      const spaceId = payload?.spaceId ?? (socket as Socket & { currentSpaceId?: string }).currentSpaceId;
      if (!spaceId) return;
      const room = `space:${spaceId}`;
      socket.leave(room);
      await removeUserFromSpace(spaceId, socket.id);
      (socket as Socket & { currentSpaceId?: string }).currentSpaceId = undefined;
      socket.to(room).emit("user_left", { userId: (socket as Socket & { userId: string }).userId, socketId: socket.id });
    });

    socket.on("join_dm", (payload: { otherUserId: string }) => {
      const otherUserId = payload?.otherUserId;
      if (!otherUserId || typeof otherUserId !== "string" || otherUserId === userId) return;
      const room = `dm:${dmChannelId(userId, otherUserId)}`;
      socket.join(room);
    });

    socket.on("leave_dm", (payload: { otherUserId: string }) => {
      const otherUserId = payload?.otherUserId;
      if (!otherUserId || typeof otherUserId !== "string") return;
      socket.leave(`dm:${dmChannelId(userId, otherUserId)}`);
    });

    socket.on("chat_message", async (payload: { channelType: string; channelId: string; content: string }) => {
      const channelType = payload?.channelType;
      const channelId = payload?.channelId;
      let content = typeof payload?.content === "string" ? payload.content.trim() : "";
      if (!channelType || !channelId || !content) return;
      if (content.length > MAX_CHAT_CONTENT_LENGTH) content = content.slice(0, MAX_CHAT_CONTENT_LENGTH);
      if (channelType !== "SPACE" && channelType !== "DM") return;

      try {
        if (channelType === "SPACE") {
          const space = await prisma.space.findUnique({
            where: { id: channelId },
            select: { id: true, organizationId: true },
          });
          if (!space) return;
          const membership = await prisma.orgMembership.findUnique({
            where: { userId_organizationId: { userId, organizationId: space.organizationId } },
          });
          if (!membership) return;

          const msg = await prisma.chatMessage.create({
            data: { channelType: "SPACE", channelId, senderUserId: userId, content },
            include: { sender: { select: { displayName: true } } },
          });
          const payloadOut = {
            id: msg.id,
            channelType: "SPACE",
            channelId: msg.channelId,
            senderUserId: msg.senderUserId,
            senderDisplayName: msg.sender.displayName,
            content: msg.content,
            createdAt: msg.createdAt.toISOString(),
          };
          io.to(`space:${channelId}`).emit("chat_message", payloadOut);
        } else {
          const otherUserId = channelId;
          const roomId = dmChannelId(userId, otherUserId);
          const msg = await prisma.chatMessage.create({
            data: { channelType: "DM", channelId: roomId, senderUserId: userId, content },
            include: { sender: { select: { displayName: true } } },
          });
          const payloadOut = {
            id: msg.id,
            channelType: "DM",
            channelId: roomId,
            senderUserId: msg.senderUserId,
            senderDisplayName: msg.sender.displayName,
            content: msg.content,
            createdAt: msg.createdAt.toISOString(),
          };
          io.to(`dm:${roomId}`).emit("chat_message", payloadOut);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
    });

    socket.on("move", async (payload: { spaceId: string; x: number; y: number; z?: number; direction: string }) => {
      const spaceId = payload?.spaceId;
      if (!spaceId || typeof spaceId !== "string") return;
      let x = typeof payload.x === "number" ? payload.x : 0;
      const y = typeof payload.y === "number" ? payload.y : 0;
      let z = typeof payload.z === "number" ? payload.z : 0;
      const direction = typeof payload.direction === "string" ? payload.direction : "down";

      const clamped = clampPosition(x, z);
      x = clamped.x;
      z = clamped.z;

      const updated = await updateUserPosition(spaceId, socket.id, { x, y, z, direction });
      if (!updated) return;

      socket.to(`space:${spaceId}`).emit("user_moved", {
        userId: (socket as Socket & { userId: string }).userId,
        socketId: socket.id,
        x,
        y,
        z,
        direction,
      });
    });

    socket.on("disconnect", async () => {
      const spaceId = (socket as Socket & { currentSpaceId?: string }).currentSpaceId;
      if (spaceId) {
        const room = `space:${spaceId}`;
        await removeUserFromSpace(spaceId, socket.id);
        socket.to(room).emit("user_left", { userId: (socket as Socket & { userId: string }).userId, socketId: socket.id });
      }
    });
  });

  return io;
}
