import { Router } from "express";
import { prisma } from "../db/prisma";
import { authMiddleware } from "../middleware/auth";

const router = Router();
router.use(authMiddleware);

const CHAT_PAGE_SIZE = 50;

function dmChannelId(userId1: string, userId2: string): string {
  return [userId1, userId2].sort().join("_");
}

// GET /spaces/:spaceId/messages — recent space chat messages
router.get("/spaces/:spaceId/messages", async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { spaceId } = req.params;
    if (!spaceId) return res.status(400).json({ error: "spaceId required" });

    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { id: true, organizationId: true },
    });
    if (!space) return res.status(404).json({ error: "Space not found" });

    const membership = await prisma.orgMembership.findUnique({
      where: {
        userId_organizationId: { userId, organizationId: space.organizationId },
      },
    });
    if (!membership) return res.status(403).json({ error: "Not a member of this space's organization" });

    const messages = await prisma.chatMessage.findMany({
      where: { channelType: "SPACE", channelId: spaceId },
      orderBy: { createdAt: "desc" },
      take: CHAT_PAGE_SIZE,
      include: {
        sender: { select: { id: true, displayName: true } },
      },
    });

    const list = messages.reverse().map((m) => ({
      id: m.id,
      channelType: m.channelType,
      channelId: m.channelId,
      senderUserId: m.senderUserId,
      senderDisplayName: m.sender.displayName,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }));

    return res.json({ messages: list });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /dms/:otherUserId/messages — recent DM messages between current user and otherUserId
router.get("/dms/:otherUserId/messages", async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const otherUserId = req.params.otherUserId;
    if (!otherUserId || otherUserId === userId) {
      return res.status(400).json({ error: "Valid otherUserId required" });
    }

    const channelId = dmChannelId(userId, otherUserId);

    const messages = await prisma.chatMessage.findMany({
      where: { channelType: "DM", channelId },
      orderBy: { createdAt: "desc" },
      take: CHAT_PAGE_SIZE,
      include: {
        sender: { select: { id: true, displayName: true } },
      },
    });

    const list = messages.reverse().map((m) => ({
      id: m.id,
      channelType: m.channelType,
      channelId: m.channelId,
      senderUserId: m.senderUserId,
      senderDisplayName: m.sender.displayName,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }));

    return res.json({ messages: list });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
