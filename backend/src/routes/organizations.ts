import { Router } from "express";
import bcrypt from "bcryptjs";
import slugify from "slugify";
import { prisma } from "../db/prisma";
import { authMiddleware } from "../middleware/auth";

const router = Router();

router.use(authMiddleware);

// POST /organizations - create organization with join password
router.post("/", async (req, res) => {
  try {
    const { name, joinPassword } = req.body as {
      name?: string;
      joinPassword?: string;
    };

    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!name || !joinPassword) {
      return res
        .status(400)
        .json({ error: "name and joinPassword are required" });
    }

    const userId = req.user!.userId;
    const slugBase = slugify(name, { lower: true, strict: true }) || "org";
    let slug = slugBase;
    let suffix = 1;
    // Ensure slug uniqueness
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await prisma.organization.findUnique({ where: { slug } });
      if (!existing) break;
      slug = `${slugBase}-${suffix++}`;
    }

    const joinPasswordHash = await bcrypt.hash(joinPassword, 10);

    const organization = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name,
          slug,
          joinPasswordHash,
          ownerId: userId,
        memberships: {
          create: {
            userId,
            role: "OWNER",
          },
        },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          ownerId: true,
          createdAt: true,
        },
      });
      await tx.space.create({
        data: {
          organizationId: org.id,
          name: "Main Office",
          isDefault: true,
        },
      });
      return org;
    });

    return res.status(201).json({ organization });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /organizations/join - join existing org with password
router.post("/join", async (req, res) => {
  try {
    const { orgIdentifier, joinPassword } = req.body as {
      orgIdentifier?: string; // slug or id
      joinPassword?: string;
    };

    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!orgIdentifier || !joinPassword) {
      return res
        .status(400)
        .json({ error: "orgIdentifier and joinPassword are required" });
    }

    const organization = await prisma.organization.findFirst({
      where: {
        OR: [{ slug: orgIdentifier }, { id: orgIdentifier }],
      },
    });

    if (!organization) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const correctPassword = await bcrypt.compare(
      joinPassword,
      organization.joinPasswordHash,
    );
    if (!correctPassword) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const existingMembership = await prisma.orgMembership.findUnique({
      where: {
        userId_organizationId: {
          userId: req.user.userId,
          organizationId: organization.id,
        },
      },
    });

    if (!existingMembership) {
      await prisma.orgMembership.create({
        data: {
          userId: req.user.userId,
          organizationId: organization.id,
          role: "MEMBER",
        },
      });
    }

    return res.json({ organizationId: organization.id });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /organizations/my - list orgs current user belongs to
router.get("/my", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const memberships = await prisma.orgMembership.findMany({
      where: { userId: req.user.userId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            ownerId: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const organizations = memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      ownerId: m.organization.ownerId,
      createdAt: m.organization.createdAt,
      role: m.role,
    }));

    return res.json({ organizations });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Helper: ensure user is member of org, return 403 else
async function ensureOrgMember(
  userId: string,
  orgId: string,
): Promise<boolean> {
  const m = await prisma.orgMembership.findUnique({
    where: {
      userId_organizationId: { userId, organizationId: orgId },
    },
  });
  return !!m;
}

// GET /organizations/:orgId/avatar/me
router.get("/:orgId/avatar/me", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const { orgId } = req.params;
    const isMember = await ensureOrgMember(req.user.userId, orgId);
    if (!isMember) {
      return res.status(403).json({ error: "Not a member of this organization" });
    }
    const avatar = await prisma.avatar.findUnique({
      where: {
        userId_organizationId: { userId: req.user.userId, organizationId: orgId },
      },
    });
    if (!avatar) {
      return res.status(404).json({ error: "No avatar set" });
    }
    return res.json({
      avatar: {
        id: avatar.id,
        spriteSet: avatar.spriteSet,
        colors: avatar.colors,
        accessories: avatar.accessories,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /organizations/:orgId/avatar - create or update
router.post("/:orgId/avatar", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const { orgId } = req.params;
    const isMember = await ensureOrgMember(req.user.userId, orgId);
    if (!isMember) {
      return res.status(403).json({ error: "Not a member of this organization" });
    }
    const { spriteSet, colors, accessories } = req.body as {
      spriteSet?: string;
      colors?: object;
      accessories?: object;
    };
    if (!spriteSet) {
      return res.status(400).json({ error: "spriteSet is required" });
    }
    const avatar = await prisma.avatar.upsert({
      where: {
        userId_organizationId: { userId: req.user.userId, organizationId: orgId },
      },
      create: {
        userId: req.user.userId,
        organizationId: orgId,
        spriteSet,
        colors: colors ?? undefined,
        accessories: accessories ?? undefined,
      },
      update: {
        spriteSet,
        colors: colors ?? undefined,
        accessories: accessories ?? undefined,
      },
    });
    return res.json({
      avatar: {
        id: avatar.id,
        spriteSet: avatar.spriteSet,
        colors: avatar.colors,
        accessories: avatar.accessories,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /organizations/:orgId/spaces
router.get("/:orgId/spaces", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const { orgId } = req.params;
    const isMember = await ensureOrgMember(req.user.userId, orgId);
    if (!isMember) {
      return res.status(403).json({ error: "Not a member of this organization" });
    }
    const spaces = await prisma.space.findMany({
      where: { organizationId: orgId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true, name: true, isDefault: true, createdAt: true },
    });
    return res.json({ spaces });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /organizations/:orgId/spaces
router.post("/:orgId/spaces", async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const { orgId } = req.params;
    const isMember = await ensureOrgMember(req.user.userId, orgId);
    if (!isMember) {
      return res.status(403).json({ error: "Not a member of this organization" });
    }
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name is required" });
    }
    const space = await prisma.space.create({
      data: {
        organizationId: orgId,
        name: name.trim(),
        isDefault: false,
      },
      select: { id: true, name: true, isDefault: true, createdAt: true },
    });
    return res.status(201).json({ space });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

