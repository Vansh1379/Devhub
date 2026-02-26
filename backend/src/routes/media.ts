import { Router, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { authMiddleware } from "../middleware/auth";
import { env } from "../config/env";

const router = Router();
router.use(authMiddleware);

const DYTE_API = "https://api.dyte.io/v2";

// In-memory: roomKey -> meetingId (so multiple users join the same meeting)
const meetingCache = new Map<string, string>();

function roomKey(spaceId: string, roomId: string): string {
  return `${spaceId}:${roomId}`;
}

function getDyteAuthHeader(): string {
  if (env.dyteAuthHeader) return env.dyteAuthHeader;
  if (env.dyteOrgId && env.dyteApiKey) {
    return `Basic ${Buffer.from(`${env.dyteOrgId}:${env.dyteApiKey}`).toString("base64")}`;
  }
  return "";
}

async function ensureSpaceMember(userId: string, spaceId: string): Promise<boolean> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { organizationId: true },
  });
  if (!space) return false;
  const m = await prisma.orgMembership.findUnique({
    where: {
      userId_organizationId: { userId, organizationId: space.organizationId },
    },
  });
  return !!m;
}

// POST /rooms — create or get Dyte meeting and return participant token (full path: /media/rooms)
router.post("/rooms", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const authHeader = getDyteAuthHeader();
    if (!authHeader) {
      return res.status(503).json({
        error: "Video calls are not configured",
        code: "MEDIA_NOT_CONFIGURED",
      });
    }

    const { spaceId, roomId } = req.body as { spaceId?: string; roomId?: string };
    if (!spaceId || !roomId) {
      return res.status(400).json({ error: "spaceId and roomId are required" });
    }

    const isMember = await ensureSpaceMember(userId, spaceId);
    if (!isMember) {
      return res.status(403).json({ error: "Not a member of this space's organization" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    const displayName = user?.displayName ?? "User";

    const key = roomKey(spaceId, roomId);
    let meetingId = meetingCache.get(key);

    const headers: Record<string, string> = {
      Authorization: authHeader,
      "Content-Type": "application/json",
    };

    if (!meetingId) {
      const createRes = await fetch(`${DYTE_API}/meetings`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: `Office ${roomId}`,
          preferred_region: "ap-south-1",
          record_on_start: false,
        }),
      });

      if (!createRes.ok) {
        const errBody = await createRes.text();
        // eslint-disable-next-line no-console
        console.error("Dyte create meeting failed", createRes.status, errBody);
        return res.status(502).json({ error: "Failed to create meeting" });
      }

      const createData = (await createRes.json()) as { data?: { id?: string } };
      meetingId = createData.data?.id;
      if (!meetingId) {
        return res.status(502).json({ error: "Invalid meeting response" });
      }
      meetingCache.set(key, meetingId);
    }

    const participantRes = await fetch(`${DYTE_API}/meetings/${meetingId}/participants`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: displayName,
        preset_name: env.dytePresetName,
        client_specific_id: userId,
      }),
    });

    if (!participantRes.ok) {
      const errBody = await participantRes.text();
      // eslint-disable-next-line no-console
      console.error("Dyte add participant failed", participantRes.status, errBody);
      return res.status(502).json({ error: "Failed to add participant" });
    }

    const participantData = (await participantRes.json()) as { data?: { token?: string } };
    const token = participantData.data?.token;
    if (!token) {
      return res.status(502).json({ error: "Invalid participant response" });
    }

    return res.json({
      token,
      meetingId,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
