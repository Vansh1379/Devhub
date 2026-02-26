import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import * as THREE from "three";
import { io, Socket } from "socket.io-client";
import { getStoredToken } from "@/api";
import { useAuth } from "@/context/AuthContext";

const MOVE_THROTTLE_MS = 100;
const GRID_SIZE = 24;
const CELL = 1.5;
const FLOOR_W = GRID_SIZE * CELL;
const FLOOR_D = GRID_SIZE * CELL;
const WALL_H = 4;
const CAMERA_FOLLOW_LERP = 0.08;
const OTHERS_LERP = 0.15;

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
    case "up": return 0;
    case "right": return -Math.PI / 2;
    case "down": return Math.PI;
    case "left": return Math.PI / 2;
    default: return 0;
  }
}

// Axis-aligned boxes: [x, z, halfW, halfD]
const DESKS: [number, number, number, number][] = [
  [-12, -10, 2, 1],
  [8, -8, 2, 1],
  [-6, 8, 2.5, 1],
  [10, 6, 2, 1],
  [-10, 2, 1.5, 2],
  [0, -12, 3, 1],
];

function checkCollision(x: number, z: number, radius: number): { x: number; z: number } {
  let outX = x;
  let outZ = z;
  const margin = radius + 0.1;
  for (const [cx, cz, hw, hd] of DESKS) {
    const dx = Math.abs(x - cx);
    const dz = Math.abs(z - cz);
    if (dx < hw + margin && dz < hd + margin) {
      const px = (hw + margin) - dx;
      const pz = (hd + margin) - dz;
      if (px < pz) outX = outX > cx ? cx + hw + margin : cx - hw - margin;
      else outZ = outZ > cz ? cz + hd + margin : cz - hd - margin;
    }
  }
  const hw = FLOOR_W / 2 - margin;
  const hd = FLOOR_D / 2 - margin;
  outX = Math.max(-hw, Math.min(hw, outX));
  outZ = Math.max(-hd, Math.min(hd, outZ));
  return { x: outX, z: outZ };
}

function createCharacterMesh(color: number, isSelf: boolean): THREE.Group {
  const group = new THREE.Group();
  const bodyGeo = new THREE.CapsuleGeometry(0.35, 0.6, 4, 8);
  const bodyMat = new THREE.MeshStandardMaterial({ color });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.5;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const headGeo = new THREE.SphereGeometry(0.28, 12, 12);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffdbac });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.15;
  head.castShadow = true;
  group.add(head);

  return group;
}

function useKeyboardMovement(
  onMove: (x: number, z: number, direction: Direction) => void
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
        const collided = checkCollision(x, z, 0.4);
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
  const state = location.state as { orgId?: string; spaceId?: string; spaceName?: string } | null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const selfGroupRef = useRef<THREE.Group | null>(null);
  const othersGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const [others, setOthers] = useState<Map<string, OtherUser>>(new Map());
  const othersRef = useRef<Map<string, OtherUser>>(new Map());
  const othersTargetPosRef = useRef<Map<string, { x: number; z: number }>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  const spaceIdRef = useRef<string | null>(null);
  const myPosRef = useRef({ x: 0, z: 0 });
  const myDirRef = useRef<Direction>("down");
  const cameraTargetRef = useRef({ x: 0, z: 0 });
  const cameraPosRef = useRef({ x: 0, z: 12, y: 8 });

  const hasSpace = state?.spaceId && state?.spaceName;
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

  useKeyboardMovement(emitMove);

  useEffect(() => {
    if (!state?.spaceId || !state?.spaceName || !canvasRef.current || !user) return;

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
      map.forEach((u, id) => othersTargetPosRef.current.set(id, { x: u.x, z: u.z }));
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

    socket.on("user_moved", (data: { userId: string; socketId: string; x: number; y: number; z: number; direction: string }) => {
      if (data.socketId === socket.id) return;
      othersTargetPosRef.current.set(data.socketId, { x: data.x, z: data.z });
      setOthers((prev) => {
        const u = prev.get(data.socketId);
        if (!u) return prev;
        const next = new Map(prev);
        next.set(data.socketId, { ...u, x: data.x, y: data.y ?? 0, z: data.z, direction: data.direction });
        othersRef.current = next;
        return next;
      });
    });

    return () => {
      socket.emit("leave_space", { spaceId: state.spaceId });
      socket.disconnect();
      socketRef.current = null;
      spaceIdRef.current = null;
    };
  }, [state?.spaceId, state?.spaceName, user, navigate]);

  useEffect(() => {
    if (!canvasRef.current || !state?.spaceId) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f0f1a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(0, 8, 12);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true });
    renderer.setSize(canvasRef.current.clientWidth, canvasRef.current.clientHeight);
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

    const gridHelper = new THREE.GridHelper(FLOOR_W, GRID_SIZE, 0x334155, 0x334155);
    gridHelper.position.y = 0.02;
    scene.add(gridHelper);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 });
    const wallGeo = new THREE.BoxGeometry(1, WALL_H, 1);
    const addWall = (x: number, z: number, w: number, d: number) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, WALL_H, d),
        wallMat
      );
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

    const deskMat = new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.7 });
    DESKS.forEach(([cx, cz, hw, hd]) => {
      const desk = new THREE.Mesh(
        new THREE.BoxGeometry(hw * 2, 1, hd * 2),
        deskMat
      );
      desk.position.set(cx, 0.5, cz);
      desk.castShadow = true;
      desk.receiveShadow = true;
      scene.add(desk);
    });

    const selfGroup = createCharacterMesh(0x22c55e, true);
    selfGroup.position.set(0, 0, 0);
    scene.add(selfGroup);
    selfGroupRef.current = selfGroup;

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

      if (selfGroupRef.current) {
        selfGroupRef.current.position.set(x, 0, z);
        selfGroupRef.current.rotation.y = directionToAngle(dir);
      }

      cameraTargetRef.current = { x, z };
      cameraPosRef.current.x += (cameraTargetRef.current.x - cameraPosRef.current.x) * CAMERA_FOLLOW_LERP;
      cameraPosRef.current.z += (cameraTargetRef.current.z + 12 - cameraPosRef.current.z) * CAMERA_FOLLOW_LERP;
      cameraPosRef.current.y += (8 - cameraPosRef.current.y) * CAMERA_FOLLOW_LERP;
      if (cameraRef.current) {
        cameraRef.current.position.set(cameraPosRef.current.x, cameraPosRef.current.y, cameraPosRef.current.z);
        cameraRef.current.lookAt(cameraTargetRef.current.x, 0, cameraTargetRef.current.z);
      }

      const currentOthers = othersRef.current;
      othersGroupsRef.current.forEach((group, socketId) => {
        const u = currentOthers.get(socketId);
        if (!u) {
          group.visible = false;
          return;
        }
        group.visible = true;
        let target = othersTargetPosRef.current.get(socketId) ?? { x: u.x, z: u.z };
        const gx = group.position.x + (target.x - group.position.x) * OTHERS_LERP;
        const gz = group.position.z + (target.z - group.position.z) * OTHERS_LERP;
        group.position.set(gx, 0, gz);
        group.rotation.y = directionToAngle(u.direction as Direction);
      });

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
      othersGroupsRef.current.forEach((g) => {
        scene.remove(g);
        g.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            c.geometry?.dispose();
            if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
            else c.material?.dispose();
          }
        });
      });
      othersGroupsRef.current.clear();
      scene.remove(selfGroup);
      selfGroup.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry?.dispose();
          if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
          else c.material?.dispose();
        }
      });
      renderer.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      selfGroupRef.current = null;
    };
  }, [state?.spaceId]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const existing = othersGroupsRef.current;
    const needed = new Set(others.keys());
    existing.forEach((group, id) => {
      if (!needed.has(id)) {
        scene.remove(group);
        group.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            c.geometry?.dispose();
            if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
            else c.material?.dispose();
          }
        });
        existing.delete(id);
      }
    });
    others.forEach((u, socketId) => {
      if (!existing.has(socketId)) {
        const group = createCharacterMesh(0xf97316, false);
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
        <nav className="flex gap-4">
          <Link to="/" className="text-primary underline-offset-4 hover:underline">
            Home
          </Link>
          <Link to="/dashboard" className="text-primary underline-offset-4 hover:underline">
            Dashboard
          </Link>
        </nav>
      </header>
      <div className="relative flex-1">
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          style={{ width: "100%", height: "100%", minHeight: "400px" }}
        />
        <div className="absolute bottom-4 left-4 rounded-lg border border-white/20 bg-black/70 px-4 py-2 font-mono text-sm text-white shadow-lg">
          <span className="text-emerald-400">WASD</span> or <span className="text-emerald-400">↑↓←→</span> move · Camera follows
        </div>
      </div>
    </div>
  );
}
