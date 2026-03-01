import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import * as THREE from "three";
import { io, Socket } from "socket.io-client";
import { api, getStoredToken } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DyteCallView } from "@/components/DyteCallView";

export interface ChatMessagePayload {
  id: string;
  channelType: "SPACE" | "DM";
  channelId: string;
  senderUserId: string;
  senderDisplayName: string;
  content: string;
  createdAt: string;
}

const MOVE_THROTTLE_MS = 100;
const GRID_SIZE = 24;
const CELL = 1.5;
const FLOOR_W = GRID_SIZE * CELL;
const FLOOR_D = GRID_SIZE * CELL;
const WALL_H = 4;
const CAMERA_FOLLOW_LERP = 0.08;
const OTHERS_LERP = 0.15;
const DOOR_WIDTH = 2.2;

// 3D rooms (Gather.town / Sky Office style): center, size, door, optional type for furniture
export type DoorSide = "n" | "s" | "e" | "w";
export type RoomType = "meeting" | "breakroom" | "cubicles" | "open";
export interface RoomDef {
  cx: number;
  cz: number;
  w: number;
  d: number;
  door: DoorSide;
  roomId: string;
  roomType?: RoomType;
}

// Office layout from API (stored per space). Desks: [cx, cz, halfW, halfD].
export interface OfficeLayout {
  rooms?: RoomDef[];
  desks?: [number, number, number, number][];
}

// Sky Office–style layout: meeting room, break room, cubicles, open area
const DEFAULT_OFFICE_LAYOUT: OfficeLayout = {
  rooms: [
    { cx: -10, cz: -8, w: 7, d: 6, door: "e", roomId: "room1", roomType: "meeting" },
    { cx: 10, cz: -6, w: 6, d: 5, door: "w", roomId: "room2", roomType: "breakroom" },
    { cx: 10, cz: 8, w: 8, d: 6, door: "w", roomId: "room3", roomType: "cubicles" },
  ],
  desks: [
    [-6, 8, 2, 1],
    [0, 8, 2, 1],
    [6, 8, 2, 1],
    [-8, 2, 1.5, 2],
    [0, -12, 3, 1],
  ],
};

type Direction = "up" | "down" | "left" | "right";

interface OtherUser {
  userId: string;
  socketId: string;
  displayName: string;
  x: number;
  y: number;
  z: number;
  direction: string;
  avatar?: unknown;
}

function directionToAngle(d: Direction): number {
  switch (d) {
    case "up":
      return 0;
    case "right":
      return -Math.PI / 2;
    case "down":
      return Math.PI;
    case "left":
      return Math.PI / 2;
    default:
      return 0;
  }
}

// Wall segment for collision: [x1, z1, x2, z2]
type WallSegment = [number, number, number, number];

export interface LayoutData {
  roomDefs: RoomDef[];
  desks: [number, number, number, number][];
  wallSegments: WallSegment[];
  roomTables: [number, number, number, number][];
}

function getRoomWallSegments(roomDefs: RoomDef[]): WallSegment[] {
  const segments: WallSegment[] = [];
  const halfGap = DOOR_WIDTH / 2;
  for (const r of roomDefs) {
    const hw = r.w / 2;
    const hd = r.d / 2;
    const x0 = r.cx - hw;
    const x1 = r.cx + hw;
    const z0 = r.cz - hd;
    const z1 = r.cz + hd;
    // North (z = z1, x from x0 to x1) — top edge
    if (r.door === "n") {
      segments.push([x0, z1, r.cx - halfGap, z1]);
      segments.push([r.cx + halfGap, z1, x1, z1]);
    } else {
      segments.push([x0, z1, x1, z1]);
    }
    // South (z = z0)
    if (r.door === "s") {
      segments.push([x0, z0, r.cx - halfGap, z0]);
      segments.push([r.cx + halfGap, z0, x1, z0]);
    } else {
      segments.push([x0, z0, x1, z0]);
    }
    // East (x = x1)
    if (r.door === "e") {
      segments.push([x1, z0, x1, r.cz - halfGap]);
      segments.push([x1, r.cz + halfGap, x1, z1]);
    } else {
      segments.push([x1, z0, x1, z1]);
    }
    // West (x = x0)
    if (r.door === "w") {
      segments.push([x0, z0, x0, r.cz - halfGap]);
      segments.push([x0, r.cz + halfGap, x0, z1]);
    } else {
      segments.push([x0, z0, x0, z1]);
    }
  }
  return segments;
}

function buildLayoutData(layout: OfficeLayout): LayoutData {
  const roomDefs = layout?.rooms ?? [];
  const desks = layout?.desks ?? [];
  const wallSegments = getRoomWallSegments(roomDefs);
  const roomTables: [number, number, number, number][] = roomDefs.map(
    (r) => [
      r.cx,
      r.cz,
      Math.min(r.w * 0.25, 1.1),
      Math.min(r.d * 0.2, 0.6),
    ],
  );
  return { roomDefs, desks, wallSegments, roomTables };
}

function isInMeetingZone(
  x: number,
  z: number,
  roomDefs: RoomDef[],
): { roomId: string } | null {
  for (const r of roomDefs) {
    const hw = r.w / 2 - 0.05;
    const hd = r.d / 2 - 0.05;
    if (Math.abs(x - r.cx) <= hw && Math.abs(z - r.cz) <= hd)
      return { roomId: r.roomId };
  }
  return null;
}

// Closest point on segment [ax,az]-[bx,bz] to point (px, pz), and squared distance
function closestOnSegment(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  px: number,
  pz: number,
): { x: number; z: number; distSq: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq <= 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qz = az + t * dz;
  const distSq = (px - qx) ** 2 + (pz - qz) ** 2;
  return { x: qx, z: qz, distSq };
}

function checkCollision(
  x: number,
  z: number,
  radius: number,
  layout: LayoutData,
): { x: number; z: number } {
  let outX = x;
  let outZ = z;
  const margin = radius + 0.1;
  for (const [cx, cz, hw, hd] of [...layout.desks, ...layout.roomTables]) {
    const dx = Math.abs(x - cx);
    const dz = Math.abs(z - cz);
    if (dx < hw + margin && dz < hd + margin) {
      const px = hw + margin - dx;
      const pz = hd + margin - dz;
      if (px < pz) outX = outX > cx ? cx + hw + margin : cx - hw - margin;
      else outZ = outZ > cz ? cz + hd + margin : cz - hd - margin;
    }
  }
  // Room walls (Gather-style): push out from wall segments
  const r2 = margin * margin;
  for (const [ax, az, bx, bz] of layout.wallSegments) {
    const { x: qx, z: qz, distSq } = closestOnSegment(
      ax,
      az,
      bx,
      bz,
      outX,
      outZ,
    );
    if (distSq < r2 && distSq > 1e-6) {
      const dist = Math.sqrt(distSq);
      const nx = (outX - qx) / dist;
      const nz = (outZ - qz) / dist;
      outX = qx + nx * margin;
      outZ = qz + nz * margin;
    }
  }
  const hw = FLOOR_W / 2 - margin;
  const hd = FLOOR_D / 2 - margin;
  outX = Math.max(-hw, Math.min(hw, outX));
  outZ = Math.max(-hd, Math.min(hd, outZ));
  return { x: outX, z: outZ };
}

// Human-like 3D avatar (Sky Office / Gather style): torso, head, legs
function createCharacterMesh(
  color: number,
  _isSelf: boolean,
  displayName?: string,
): THREE.Group {
  const group = new THREE.Group();
  const skin = 0xffdbac;
  const legColor = 0x4a5568;

  // Torso (shirt) — rounded box
  const torsoGeo = new THREE.BoxGeometry(0.36, 0.5, 0.2);
  const torsoMat = new THREE.MeshStandardMaterial({ color });
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.y = 0.72;
  torso.castShadow = true;
  torso.receiveShadow = true;
  group.add(torso);

  // Head
  const headGeo = new THREE.SphereGeometry(0.22, 12, 12);
  const headMat = new THREE.MeshStandardMaterial({ color: skin });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.12;
  head.castShadow = true;
  group.add(head);

  // Legs (two simple boxes so it reads as a person from above)
  const legGeo = new THREE.BoxGeometry(0.12, 0.45, 0.1);
  const legMat = new THREE.MeshStandardMaterial({ color: legColor });
  const legL = new THREE.Mesh(legGeo, legMat);
  legL.position.set(-0.08, 0.22, 0);
  legL.castShadow = true;
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, legMat.clone());
  legR.position.set(0.08, 0.22, 0);
  legR.castShadow = true;
  group.add(legR);

  (group as THREE.Group & { displayName?: string }).displayName = displayName;
  return group;
}

// Build 3D room meshes (Gather.town style): walls with door gap + room floor
function addRoomMeshes(
  scene: THREE.Scene,
  roomDefs: RoomDef[],
  wallMat: THREE.MeshStandardMaterial,
  roomFloorMat: THREE.MeshStandardMaterial,
) {
  const halfGap = DOOR_WIDTH / 2;
  for (const r of roomDefs) {
    const hw = r.w / 2;
    const hd = r.d / 2;
    const x0 = r.cx - hw;
    const x1 = r.cx + hw;
    const z0 = r.cz - hd;
    const z1 = r.cz + hd;

    // Room floor (slightly raised, distinct color)
    const roomFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(r.w, r.d),
      roomFloorMat,
    );
    roomFloor.rotation.x = -Math.PI / 2;
    roomFloor.position.set(r.cx, 0.03, r.cz);
    roomFloor.receiveShadow = true;
    scene.add(roomFloor);

    const addWallStrip = (sx: number, sz: number, ex: number, ez: number) => {
      const len = Math.hypot(ex - sx, ez - sz);
      if (len < 0.1) return;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(len, WALL_H, 0.4),
        wallMat,
      );
      mesh.position.set((sx + ex) / 2, WALL_H / 2, (sz + ez) / 2);
      mesh.rotation.y = Math.atan2(ez - sz, ex - sx);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    };

    // North wall (z = z1)
    if (r.door === "n") {
      addWallStrip(x0, z1, r.cx - halfGap, z1);
      addWallStrip(r.cx + halfGap, z1, x1, z1);
    } else {
      addWallStrip(x0, z1, x1, z1);
    }
    if (r.door === "s") {
      addWallStrip(x0, z0, r.cx - halfGap, z0);
      addWallStrip(r.cx + halfGap, z0, x1, z0);
    } else {
      addWallStrip(x0, z0, x1, z0);
    }
    if (r.door === "e") {
      addWallStrip(x1, z0, x1, r.cz - halfGap);
      addWallStrip(x1, r.cz + halfGap, x1, z1);
    } else {
      addWallStrip(x1, z0, x1, z1);
    }
    if (r.door === "w") {
      addWallStrip(x0, z0, x0, r.cz - halfGap);
      addWallStrip(x0, r.cz + halfGap, x0, z1);
    } else {
      addWallStrip(x0, z0, x0, z1);
    }

    // Room-type-specific furniture (Sky Office style)
    const type = r.roomType ?? "open";
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x78716c,
      roughness: 0.7,
    });
    const chairMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.8,
    });
    const whiteMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.9,
    });

    if (type === "meeting") {
      // Large conference table + chairs + whiteboard on back wall
      const tableW = Math.min(r.w * 0.7, 3.5);
      const tableD = Math.min(r.d * 0.45, 1.8);
      const table = new THREE.Mesh(
        new THREE.BoxGeometry(tableW, 0.75, tableD),
        tableMat,
      );
      table.position.set(r.cx, 0.375, r.cz);
      table.castShadow = true;
      table.receiveShadow = true;
      scene.add(table);
      // Chairs around table (6)
      [0, 1, 2, 3, 4, 5].forEach((i) => {
        const angle = (i / 6) * Math.PI * 2;
        const rad = Math.max(tableW, tableD) * 0.5 + 0.35;
        const chairSeat = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 0.45, 0.4),
          chairMat,
        );
        const chairBack = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 0.35, 0.08),
          chairMat,
        );
        chairBack.position.y = 0.575;
        chairBack.position.z = -0.22;
        const chair = new THREE.Group();
        chair.add(chairSeat);
        chair.add(chairBack);
        chair.position.set(
          r.cx + Math.sin(angle) * rad,
          0,
          r.cz + Math.cos(angle) * rad,
        );
        chair.rotation.y = -angle;
        chair.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });
        scene.add(chair);
      });
      // Whiteboard on wall opposite door (back of room)
      const boardZ = r.door === "n" ? r.cz + hd - 0.3 : r.door === "s" ? r.cz - hd + 0.3 : r.cz;
      const boardX = r.door === "e" ? r.cx - hw + 0.3 : r.door === "w" ? r.cx + hw - 0.3 : r.cx;
      const whiteboard = new THREE.Mesh(
        new THREE.PlaneGeometry(r.w * 0.5, 1.2),
        whiteMat,
      );
      whiteboard.position.set(boardX, 1.5, boardZ);
      if (r.door === "n") whiteboard.rotation.y = 0;
      if (r.door === "s") whiteboard.rotation.y = Math.PI;
      if (r.door === "e") whiteboard.rotation.y = Math.PI / 2;
      if (r.door === "w") whiteboard.rotation.y = -Math.PI / 2;
      scene.add(whiteboard);
    } else if (type === "breakroom") {
      // Counter along wall, water cooler, wall screen
      const counterW = r.w * 0.7;
      const counter = new THREE.Mesh(
        new THREE.BoxGeometry(counterW, 1, 0.5),
        whiteMat,
      );
      counter.position.set(r.cx, 0.5, r.cz - hd + 0.4);
      counter.castShadow = true;
      scene.add(counter);
      const cooler = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.28, 0.9, 12),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8 }),
      );
      cooler.position.set(r.cx + hw * 0.4, 0.45, r.cz - hd + 0.4);
      cooler.castShadow = true;
      scene.add(cooler);
      const screen = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.7, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x1e293b }),
      );
      screen.position.set(r.cx - hw * 0.3, 1.6, r.cz - hd + 0.25);
      scene.add(screen);
      // Small table in center
      const table = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.75, 0.8),
        tableMat,
      );
      table.position.set(r.cx, 0.375, r.cz);
      table.castShadow = true;
      scene.add(table);
    } else if (type === "cubicles") {
      // 3 cubicle desks in a row: desk + monitor + chair
      const deskW = 1.2;
      const deskD = 0.7;
      [-1, 0, 1].forEach((i) => {
        const dx = r.cx + i * (deskW + 0.3);
        const desk = new THREE.Mesh(
          new THREE.BoxGeometry(deskW, 0.75, deskD),
          tableMat,
        );
        desk.position.set(dx, 0.375, r.cz);
        desk.castShadow = true;
        scene.add(desk);
        const monitor = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.35, 0.03),
          new THREE.MeshStandardMaterial({ color: 0x334155 }),
        );
        monitor.position.set(dx, 0.95, r.cz);
        scene.add(monitor);
        const chair = new THREE.Mesh(
          new THREE.BoxGeometry(0.45, 0.5, 0.45),
          chairMat,
        );
        chair.position.set(dx, 0.25, r.cz + deskD * 0.5 + 0.25);
        chair.castShadow = true;
        scene.add(chair);
      });
    } else {
      // Open: single table
      const tableW = Math.min(r.w * 0.5, 2.2);
      const tableD = Math.min(r.d * 0.4, 1.2);
      const table = new THREE.Mesh(
        new THREE.BoxGeometry(tableW, 0.8, tableD),
        tableMat,
      );
      table.position.set(r.cx, 0.4, r.cz);
      table.castShadow = true;
      scene.add(table);
    }
  }
}

function useKeyboardMovement(
  onMove: (x: number, z: number, direction: Direction) => void,
  layoutDataRef: React.MutableRefObject<LayoutData>,
) {
  const keys = useRef({ w: false, a: false, s: false, d: false });
  const lastSend = useRef(0);
  const pos = useRef({ x: 0, z: 0 });
  const dir = useRef<Direction>("down");

  useEffect(() => {
    const keyDown = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case "w":
        case "arrowup":
          e.preventDefault();
          keys.current.w = true;
          break;
        case "s":
        case "arrowdown":
          e.preventDefault();
          keys.current.s = true;
          break;
        case "a":
        case "arrowleft":
          e.preventDefault();
          keys.current.a = true;
          break;
        case "d":
        case "arrowright":
          e.preventDefault();
          keys.current.d = true;
          break;
      }
    };
    const keyUp = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case "w":
        case "arrowup":
          keys.current.w = false;
          break;
        case "s":
        case "arrowdown":
          keys.current.s = false;
          break;
        case "a":
        case "arrowleft":
          keys.current.a = false;
          break;
        case "d":
        case "arrowright":
          keys.current.d = false;
          break;
      }
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, []);

  useEffect(() => {
    const speed = 0.12;
    let raf = 0;
    const tick = () => {
      let dx = 0,
        dz = 0;
      if (keys.current.w) {
        dz -= speed;
        dir.current = "up";
      }
      if (keys.current.s) {
        dz += speed;
        dir.current = "down";
      }
      if (keys.current.a) {
        dx -= speed;
        if (!keys.current.w && !keys.current.s) dir.current = "left";
      }
      if (keys.current.d) {
        dx += speed;
        if (!keys.current.w && !keys.current.s) dir.current = "right";
      }
      if (dx !== 0 || dz !== 0) {
        let { x, z } = pos.current;
        x = Math.max(-FLOOR_W / 2 + 1, Math.min(FLOOR_W / 2 - 1, x + dx));
        z = Math.max(-FLOOR_D / 2 + 1, Math.min(FLOOR_D / 2 - 1, z + dz));
        const collided = checkCollision(x, z, 0.4, layoutDataRef.current);
        pos.current = { x: collided.x, z: collided.z };
        const now = Date.now();
        if (now - lastSend.current >= MOVE_THROTTLE_MS) {
          lastSend.current = now;
          onMove(pos.current.x, pos.current.z, dir.current);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onMove]);
}

export default function Office() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const state = location.state as {
    orgId?: string;
    spaceId?: string;
    spaceName?: string;
  } | null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const nameLabelRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const selfGroupRef = useRef<THREE.Group | null>(null);
  const othersGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const [others, setOthers] = useState<Map<string, OtherUser>>(new Map());
  const othersRef = useRef<Map<string, OtherUser>>(new Map());
  const othersTargetPosRef = useRef<Map<string, { x: number; z: number }>>(
    new Map(),
  );
  const socketRef = useRef<Socket | null>(null);
  const spaceIdRef = useRef<string | null>(null);
  const myPosRef = useRef({ x: 0, z: 0 });
  const myDirRef = useRef<Direction>("down");
  const cameraTargetRef = useRef({ x: 0, z: 0 });
  const cameraDistanceRef = useRef(16);
  const cameraAngleHRef = useRef(0);
  const cameraAngleVRef = useRef(0.38);
  const isPointerDownRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  const [spaceMessages, setSpaceMessages] = useState<ChatMessagePayload[]>([]);
  const [dmMessagesByUser, setDmMessagesByUser] = useState<
    Map<string, ChatMessagePayload[]>
  >(new Map());
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTab, setChatTab] = useState<"space" | "dm">("space");
  const [dmWithUserId, setDmWithUserId] = useState<string | null>(null);
  const chatListRef = useRef<HTMLDivElement>(null);

  const [meetingZone, setMeetingZone] = useState<{ roomId: string } | null>(
    null,
  );
  const [inCall, setInCall] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [dyteToken, setDyteToken] = useState<string | null>(null);
  const [videoMenuOpen, setVideoMenuOpen] = useState(false);
  const lastMeetingZoneRef = useRef<string | null>(null);

  // Office layout from API (per space); fallback to default
  const [layout, setLayout] = useState<OfficeLayout>(() => DEFAULT_OFFICE_LAYOUT);
  const layoutDataRef = useRef<LayoutData>(
    buildLayoutData(DEFAULT_OFFICE_LAYOUT),
  );

  const hasSpace = state?.spaceId && state?.spaceName;

  // Fetch office layout when entering a space
  useEffect(() => {
    if (!state?.spaceId) return;
    api
      .get<{ layout: OfficeLayout | null }>(`/spaces/${state.spaceId}/layout`)
      .then((res) => {
        const next =
          res.data.layout && typeof res.data.layout === "object"
            ? (res.data.layout as OfficeLayout)
            : DEFAULT_OFFICE_LAYOUT;
        setLayout(next);
      })
      .catch(() => setLayout(DEFAULT_OFFICE_LAYOUT));
  }, [state?.spaceId]);

  // Keep layout data ref in sync for collision / meeting zone
  useEffect(() => {
    layoutDataRef.current = buildLayoutData(layout);
  }, [layout]);

  useEffect(() => {
    if (!hasSpace && location.pathname === "/office") {
      navigate("/dashboard", { replace: true });
    }
  }, [hasSpace, location.pathname, navigate]);

  const emitMove = useCallback((x: number, z: number, direction: Direction) => {
    myPosRef.current = { x, z };
    myDirRef.current = direction;
    const socket = socketRef.current;
    const spaceId = spaceIdRef.current;
    if (socket && spaceId) {
      socket.emit("move", {
        spaceId,
        x,
        y: 0,
        z,
        direction,
      });
    }
  }, []);

  useKeyboardMovement(emitMove, layoutDataRef);

  useEffect(() => {
    if (!state?.spaceId || !state?.spaceName || !canvasRef.current || !user)
      return;

    const token = getStoredToken();
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    const socket = io({
      auth: { token },
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    spaceIdRef.current = state.spaceId;

    socket.on("connect", () => {
      socket.emit("join_space", {
        spaceId: state.spaceId,
        displayName: user.displayName,
        x: 0,
        y: 0,
        z: 0,
        direction: "down",
      });
    });

    socket.on("space_state", (data: { users: OtherUser[] }) => {
      const map = new Map<string, OtherUser>();
      (data.users || []).forEach((u) => {
        if (u.socketId !== socket.id) map.set(u.socketId, u);
      });
      othersRef.current = map;
      setOthers(map);
      map.forEach((u, id) =>
        othersTargetPosRef.current.set(id, { x: u.x, z: u.z }),
      );
    });

    socket.on("user_joined", (u: OtherUser) => {
      if (u.socketId === socket.id) return;
      othersTargetPosRef.current.set(u.socketId, { x: u.x, z: u.z });
      setOthers((prev) => {
        const next = new Map(prev);
        next.set(u.socketId, u);
        othersRef.current = next;
        return next;
      });
    });

    socket.on("user_left", (data: { userId: string; socketId: string }) => {
      othersTargetPosRef.current.delete(data.socketId);
      setOthers((prev) => {
        const next = new Map(prev);
        next.delete(data.socketId);
        othersRef.current = next;
        return next;
      });
    });

    socket.on(
      "user_moved",
      (data: {
        userId: string;
        socketId: string;
        x: number;
        y: number;
        z: number;
        direction: string;
      }) => {
        if (data.socketId === socket.id) return;
        othersTargetPosRef.current.set(data.socketId, { x: data.x, z: data.z });
        setOthers((prev) => {
          const u = prev.get(data.socketId);
          if (!u) return prev;
          const next = new Map(prev);
          next.set(data.socketId, {
            ...u,
            x: data.x,
            y: data.y ?? 0,
            z: data.z,
            direction: data.direction,
          });
          othersRef.current = next;
          return next;
        });
      },
    );

    socket.on("chat_message", (msg: ChatMessagePayload) => {
      if (msg.channelType === "SPACE" && msg.channelId === state.spaceId) {
        setSpaceMessages((prev) => [...prev, msg]);
      }
      if (msg.channelType === "DM" && user?.id) {
        const [id1, id2] = msg.channelId.split("_");
        const peerId = id1 === user.id ? id2 : id1;
        setDmMessagesByUser((prev) => {
          const list = prev.get(peerId) ?? [];
          if (list.some((m) => m.id === msg.id)) return prev;
          const next = new Map(prev);
          next.set(peerId, [...list, msg]);
          return next;
        });
      }
    });

    return () => {
      socket.emit("leave_space", { spaceId: state.spaceId });
      socket.disconnect();
      socketRef.current = null;
      spaceIdRef.current = null;
    };
  }, [state?.spaceId, state?.spaceName, user, navigate]);

  useEffect(() => {
    if (!state?.spaceId) return;
    api
      .get<{ messages: ChatMessagePayload[] }>(
        `/spaces/${state.spaceId}/messages`,
      )
      .then((res) => setSpaceMessages(res.data.messages ?? []))
      .catch(() => setSpaceMessages([]));
  }, [state?.spaceId]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !user?.id) return;
    if (dmWithUserId) {
      socket.emit("join_dm", { otherUserId: dmWithUserId });
      api
        .get<{ messages: ChatMessagePayload[] }>(
          `/dms/${dmWithUserId}/messages`,
        )
        .then((res) =>
          setDmMessagesByUser((prev) => {
            const next = new Map(prev);
            next.set(dmWithUserId, res.data.messages ?? []);
            return next;
          }),
        )
        .catch(() => {});
    }
    return () => {
      if (dmWithUserId) socket.emit("leave_dm", { otherUserId: dmWithUserId });
    };
  }, [dmWithUserId, user?.id]);

  useEffect(() => {
    if (!chatOpen) return;
    chatListRef.current?.scrollTo({
      top: chatListRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatOpen, spaceMessages, dmMessagesByUser, dmWithUserId]);

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const socket = socketRef.current;
      const spaceId = spaceIdRef.current;
      if (!socket || !spaceId) return;
      if (chatTab === "space") {
        socket.emit("chat_message", {
          channelType: "SPACE",
          channelId: spaceId,
          content: trimmed,
        });
      } else if (chatTab === "dm" && dmWithUserId) {
        socket.emit("chat_message", {
          channelType: "DM",
          channelId: dmWithUserId,
          content: trimmed,
        });
      }
    },
    [chatTab, dmWithUserId],
  );

  const joinMeetingWithRoom = useCallback(
    async (roomId: string) => {
      if (!state?.spaceId || inCall) return;
      setCallError(null);
      try {
        const { data } = await api.post<{ token: string; meetingId: string }>(
          "/media/rooms",
          {
            spaceId: state.spaceId,
            roomId,
          },
        );
        setDyteToken(data.token);
        setInCall(true);
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { error?: string; code?: string } } })
            ?.response?.data?.error ??
          (err as Error)?.message ??
          "Failed to join call";
        setCallError(msg);
      }
    },
    [state?.spaceId, inCall],
  );

  const joinMeeting = useCallback(async () => {
    if (meetingZone && !inCall) joinMeetingWithRoom(meetingZone.roomId);
  }, [meetingZone, inCall, joinMeetingWithRoom]);

  const leaveMeeting = useCallback(() => {
    setDyteToken(null);
    setInCall(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "e" || meetingZone === null || inCall) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      e.preventDefault();
      joinMeeting();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [meetingZone, inCall, joinMeeting]);

  useEffect(() => {
    if (!canvasRef.current || !state?.spaceId) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f0f1a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(0, 8, 12);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
    });
    renderer.setSize(
      canvasRef.current.clientWidth,
      canvasRef.current.clientHeight,
    );
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(8, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 80;
    dirLight.shadow.camera.left = -30;
    dirLight.shadow.camera.right = 30;
    dirLight.shadow.camera.top = 30;
    dirLight.shadow.camera.bottom = -30;
    dirLight.shadow.bias = -0.0001;
    scene.add(dirLight);

    const floorGeo = new THREE.PlaneGeometry(FLOOR_W + 2, FLOOR_D + 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.9,
      metalness: 0.05,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const gridHelper = new THREE.GridHelper(
      FLOOR_W,
      GRID_SIZE,
      0x334155,
      0x334155,
    );
    gridHelper.position.y = 0.02;
    scene.add(gridHelper);

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.8,
    });
    const addWall = (x: number, z: number, w: number, d: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
      mesh.position.set(x, WALL_H / 2, z);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      scene.add(mesh);
    };
    const hw = FLOOR_W / 2 + 0.5;
    const hd = FLOOR_D / 2 + 0.5;
    addWall(0, -hd, FLOOR_W + 2, 1);
    addWall(0, hd, FLOOR_W + 2, 1);
    addWall(-hw, 0, 1, FLOOR_D + 2);
    addWall(hw, 0, 1, FLOOR_D + 2);

    // 3D meeting rooms (Gather.town style): walls with doors + room floors
    const roomWallMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.75,
    });
    const roomFloorMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a5f,
      roughness: 0.9,
      metalness: 0.05,
    });
    const roomDefs = layout.rooms ?? [];
    addRoomMeshes(scene, roomDefs, roomWallMat, roomFloorMat);

    const deskMat = new THREE.MeshStandardMaterial({
      color: 0x78716c,
      roughness: 0.7,
    });
    (layout.desks ?? []).forEach(([cx, cz, hw, hd]) => {
      const desk = new THREE.Mesh(
        new THREE.BoxGeometry(hw * 2, 1, hd * 2),
        deskMat,
      );
      desk.position.set(cx, 0.5, cz);
      desk.castShadow = true;
      desk.receiveShadow = true;
      scene.add(desk);
    });

    const selfGroup = createCharacterMesh(
      0x22c55e,
      true,
      user?.displayName ?? "You",
    );
    selfGroup.position.set(0, 0, 0);
    scene.add(selfGroup);
    selfGroupRef.current = selfGroup;

    const tempVec = new THREE.Vector3();
    const canvas = canvasRef.current;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      if (absX > absY) {
        cameraAngleHRef.current -= e.deltaX * 0.008;
      } else {
        const delta = e.deltaY > 0 ? 1.5 : -1.5;
        cameraDistanceRef.current = Math.max(
          6,
          Math.min(40, cameraDistanceRef.current + delta),
        );
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2) isPointerDownRef.current = true;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isPointerDownRef.current) return;
      const dx = (e.clientX - lastPointerRef.current.x) * 0.01;
      const dy = (e.clientY - lastPointerRef.current.y) * 0.01;
      cameraAngleHRef.current -= dx;
      cameraAngleVRef.current = Math.max(
        0.15,
        Math.min(1.2, cameraAngleVRef.current + dy),
      );
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 2) isPointerDownRef.current = false;
    };
    canvas?.addEventListener("wheel", onWheel, { passive: false });
    canvas?.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    canvas?.addEventListener("contextmenu", (e) => e.preventDefault());

    const resize = () => {
      if (!canvasRef.current || !camera || !renderer) return;
      const w = canvasRef.current.clientWidth;
      const h = canvasRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", resize);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const { x, z } = myPosRef.current;
      const dir = myDirRef.current;
      const zone = isInMeetingZone(x, z, layoutDataRef.current.roomDefs);
      if ((zone?.roomId ?? null) !== lastMeetingZoneRef.current) {
        lastMeetingZoneRef.current = zone?.roomId ?? null;
        setMeetingZone(zone);
      }

      if (selfGroupRef.current) {
        selfGroupRef.current.position.set(x, 0, z);
        selfGroupRef.current.rotation.y = directionToAngle(dir);
      }

      // Name label above player (Sky Office style)
      if (
        nameLabelRef.current &&
        canvasContainerRef.current &&
        selfGroupRef.current &&
        cameraRef.current
      ) {
        tempVec.setFromMatrixPosition(selfGroupRef.current.matrixWorld);
        tempVec.y += 1.45;
        tempVec.project(cameraRef.current);
        const rect = canvasContainerRef.current.getBoundingClientRect();
        const px = (tempVec.x * 0.5 + 0.5) * rect.width;
        const py = (1 - (tempVec.y * 0.5 + 0.5)) * rect.height;
        if (tempVec.z <= 1 && rect.width > 0) {
          nameLabelRef.current.style.display = "block";
          nameLabelRef.current.style.left = `${px}px`;
          nameLabelRef.current.style.top = `${py}px`;
        } else {
          nameLabelRef.current.style.display = "none";
        }
      }

      cameraTargetRef.current.x +=
        (x - cameraTargetRef.current.x) * CAMERA_FOLLOW_LERP;
      cameraTargetRef.current.z +=
        (z - cameraTargetRef.current.z) * CAMERA_FOLLOW_LERP;
      const dist = cameraDistanceRef.current;
      const ah = cameraAngleHRef.current;
      const av = cameraAngleVRef.current;
      const ox = dist * Math.cos(av) * Math.sin(ah);
      const oy = dist * Math.sin(av);
      const oz = dist * Math.cos(av) * Math.cos(ah);
      if (cameraRef.current) {
        cameraRef.current.position.set(
          cameraTargetRef.current.x + ox,
          oy,
          cameraTargetRef.current.z + oz,
        );
        cameraRef.current.lookAt(
          cameraTargetRef.current.x,
          0,
          cameraTargetRef.current.z,
        );
      }

      const currentOthers = othersRef.current;
      othersGroupsRef.current.forEach((group, socketId) => {
        const u = currentOthers.get(socketId);
        if (!u) {
          group.visible = false;
          return;
        }
        group.visible = true;
        let target = othersTargetPosRef.current.get(socketId) ?? {
          x: u.x,
          z: u.z,
        };
        const gx =
          group.position.x + (target.x - group.position.x) * OTHERS_LERP;
        const gz =
          group.position.z + (target.z - group.position.z) * OTHERS_LERP;
        group.position.set(gx, 0, gz);
        group.rotation.y = directionToAngle(u.direction as Direction);
      });

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    return () => {
      canvas?.removeEventListener("wheel", onWheel);
      canvas?.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
      othersGroupsRef.current.forEach((g) => {
        scene.remove(g);
        g.traverse((c: THREE.Object3D) => {
          if (c instanceof THREE.Mesh) {
            c.geometry?.dispose();
            if (Array.isArray(c.material))
              c.material.forEach((m: THREE.Material) => m.dispose());
            else c.material?.dispose();
          }
        });
      });
      othersGroupsRef.current.clear();
      scene.remove(selfGroup);
      selfGroup.traverse((c: THREE.Object3D) => {
        if (c instanceof THREE.Mesh) {
          c.geometry?.dispose();
          if (Array.isArray(c.material))
            c.material.forEach((m: THREE.Material) => m.dispose());
          else c.material?.dispose();
        }
      });
      renderer.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      selfGroupRef.current = null;
    };
  }, [state?.spaceId, layout, user?.displayName]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const existing = othersGroupsRef.current;
    const needed = new Set(others.keys());
    existing.forEach((group, id) => {
      if (!needed.has(id)) {
        scene.remove(group);
        group.traverse((c: THREE.Object3D) => {
          if (c instanceof THREE.Mesh) {
            c.geometry?.dispose();
            if (Array.isArray(c.material))
              c.material.forEach((m: THREE.Material) => m.dispose());
            else c.material?.dispose();
          }
        });
        existing.delete(id);
      }
    });
    others.forEach((u, socketId) => {
      if (!existing.has(socketId)) {
        const group = createCharacterMesh(
          0xf97316,
          false,
          u.displayName ?? "Guest",
        );
        group.position.set(u.x, 0, u.z);
        scene.add(group);
        existing.set(socketId, group);
      }
    });
  }, [others]);

  if (!state?.spaceId || !state?.spaceName) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-lg font-semibold tracking-tight">
          Office — {state.spaceName}
        </h2>
        <nav className="flex items-center gap-4">
          {!inCall && (
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVideoMenuOpen((o) => !o)}
              >
                Video call
              </Button>
              {videoMenuOpen && (
                <>
                  <div className="absolute right-0 top-full z-20 mt-1 flex flex-col rounded-md border border-border bg-card py-1 shadow-lg">
                    <button
                      type="button"
                      className="px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        joinMeetingWithRoom("room1");
                        setVideoMenuOpen(false);
                      }}
                    >
                      Join Room 1
                    </button>
                    <button
                      type="button"
                      className="px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        joinMeetingWithRoom("room2");
                        setVideoMenuOpen(false);
                      }}
                    >
                      Join Room 2
                    </button>
                  </div>
                  <button
                    type="button"
                    className="fixed inset-0 z-10"
                    aria-label="Close menu"
                    onClick={() => setVideoMenuOpen(false)}
                  />
                </>
              )}
            </div>
          )}
          <Link
            to="/"
            className="text-primary underline-offset-4 hover:underline"
          >
            Home
          </Link>
          <Link
            to="/dashboard"
            className="text-primary underline-offset-4 hover:underline"
          >
            Dashboard
          </Link>
        </nav>
      </header>
      <div ref={canvasContainerRef} className="relative flex-1">
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          style={{ width: "100%", height: "100%", minHeight: "400px" }}
        />
        <div
          ref={nameLabelRef}
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap text-sm font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
          style={{ display: "none" }}
        >
          {user?.displayName ?? "You"}
        </div>
        <div className="absolute bottom-4 left-4 flex flex-col gap-2">
          <div className="rounded-lg border border-white/20 bg-black/70 px-4 py-2 font-mono text-sm text-white shadow-lg">
            <span className="text-emerald-400">WASD</span> or{" "}
            <span className="text-emerald-400">↑↓←→</span> move ·{" "}
            <span className="text-sky-300">Scroll</span> zoom ·{" "}
            <span className="text-sky-300">Right-drag or trackpad swipe</span>{" "}
            orbit
          </div>
          {!inCall && (
            <p className="text-xs text-white/80">
              Walk into <span className="font-medium text-sky-300">3D rooms</span> to
              join meetings · Or use{" "}
              <span className="font-medium text-sky-300">Video call</span> in
              header
            </p>
          )}
        </div>

        {meetingZone && !inCall && (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 rounded-lg border border-primary/50 bg-card/95 px-4 py-3 shadow-xl">
            <span className="text-sm font-medium">Meeting room</span>
            <div className="flex gap-2">
              <Button size="sm" onClick={joinMeeting}>
                Join video call
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Or press E</p>
            {callError && (
              <p className="text-xs text-destructive">{callError}</p>
            )}
          </div>
        )}

        {inCall && dyteToken && (
          <div className="absolute inset-0 z-10 flex flex-col bg-background/95 p-4">
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
              <DyteCallView token={dyteToken} onLeave={leaveMeeting} />
            </div>
          </div>
        )}

        <div className="absolute right-4 top-20 flex flex-col">
          <Button
            variant="outline"
            size="sm"
            className="mb-2 rounded-full border-white/20 bg-black/70 text-white shadow-lg hover:bg-black/80"
            onClick={() => setChatOpen((o) => !o)}
          >
            {chatOpen ? "Close chat" : "Chat"}
          </Button>
          {chatOpen && (
            <div className="flex w-80 flex-col rounded-lg border border-border bg-card shadow-xl">
              <div className="flex border-b border-border">
                <button
                  type="button"
                  className={`flex-1 px-3 py-2 text-sm font-medium ${chatTab === "space" ? "border-b-2 border-primary bg-muted/50 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setChatTab("space")}
                >
                  Space
                </button>
                <button
                  type="button"
                  className={`flex-1 px-3 py-2 text-sm font-medium ${chatTab === "dm" ? "border-b-2 border-primary bg-muted/50 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setChatTab("dm")}
                >
                  DMs
                </button>
              </div>
              {chatTab === "space" && (
                <>
                  <div
                    ref={chatListRef}
                    className="flex max-h-64 flex-col gap-1 overflow-y-auto p-2"
                  >
                    {spaceMessages.map((m) => (
                      <div
                        key={m.id}
                        className="rounded bg-muted/50 px-2 py-1 text-sm"
                      >
                        <span className="font-medium text-muted-foreground">
                          {m.senderDisplayName}:
                        </span>{" "}
                        {m.content}
                      </div>
                    ))}
                  </div>
                  <form
                    className="flex gap-2 border-t border-border p-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const input =
                        e.currentTarget.querySelector<HTMLInputElement>(
                          "input[name=chat]",
                        );
                      if (input) {
                        sendMessage(input.value);
                        input.value = "";
                      }
                    }}
                  >
                    <Input
                      name="chat"
                      placeholder="Message space..."
                      className="flex-1"
                      maxLength={2000}
                    />
                    <Button type="submit" size="sm">
                      Send
                    </Button>
                  </form>
                </>
              )}
              {chatTab === "dm" && (
                <>
                  {!dmWithUserId ? (
                    <div className="max-h-64 overflow-y-auto p-2">
                      <p className="mb-2 text-xs text-muted-foreground">
                        Start a conversation
                      </p>
                      {Array.from(others.values()).map((u) => (
                        <button
                          key={u.userId}
                          type="button"
                          className="mb-1 block w-full rounded bg-muted/50 px-2 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => setDmWithUserId(u.userId)}
                        >
                          {u.displayName}
                        </button>
                      ))}
                      {others.size === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No one else in space yet.
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:underline"
                          onClick={() => setDmWithUserId(null)}
                        >
                          ← Back
                        </button>
                        <span className="text-sm font-medium">
                          {Array.from(others.values()).find(
                            (o) => o.userId === dmWithUserId,
                          )?.displayName ?? "User"}
                        </span>
                      </div>
                      <div
                        ref={chatListRef}
                        className="flex max-h-64 flex-col gap-1 overflow-y-auto p-2"
                      >
                        {(dmMessagesByUser.get(dmWithUserId) ?? []).map((m) => (
                          <div
                            key={m.id}
                            className="rounded bg-muted/50 px-2 py-1 text-sm"
                          >
                            <span className="font-medium text-muted-foreground">
                              {m.senderDisplayName}:
                            </span>{" "}
                            {m.content}
                          </div>
                        ))}
                      </div>
                      <form
                        className="flex gap-2 border-t border-border p-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const input =
                            e.currentTarget.querySelector<HTMLInputElement>(
                              "input[name=dm]",
                            );
                          if (input) {
                            sendMessage(input.value);
                            input.value = "";
                          }
                        }}
                      >
                        <Input
                          name="dm"
                          placeholder="Message..."
                          className="flex-1"
                          maxLength={2000}
                        />
                        <Button type="submit" size="sm">
                          Send
                        </Button>
                      </form>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
