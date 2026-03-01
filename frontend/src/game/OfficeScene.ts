import Phaser from "phaser";

// ─── Tile IDs ───────────────────────────────────────────────────────────────
export const T = {
  EMPTY: 0,
  FLOOR: 1,
  FLOOR_ALT: 2,        // slightly different floor tile (lobby carpet)
  WALL_H: 3,
  WALL_V: 4,
  WALL_CORNER_TL: 5,
  WALL_CORNER_TR: 6,
  WALL_CORNER_BL: 7,
  WALL_CORNER_BR: 8,
  DESK: 9,
  CHAIR: 10,
  PLANT: 11,
  TV: 12,
  WHITEBOARD: 13,
  MEETING_FLOOR: 14,   // blue tinted meeting room floor
  DOOR: 15,
  WINDOW: 16,
  BOOKSHELF: 17,
  COUCH: 18,
  CARPET: 19,
  OUTER: 20,           // outside wall / void
};

export const TILE = 32; // px per tile
export const MAP_W = 40; // tiles wide
export const MAP_H = 32; // tiles tall

// ─── Map layout ─────────────────────────────────────────────────────────────
// We build a 2-layer map:
//   layer0 = floor tiles
//   layer1 = objects (walls, desks, chairs …) — 0 = transparent

// prettier-ignore
export function buildMap(): { floor: number[][]; objects: number[][] } {
  const F  = T.FLOOR;
  const FA = T.FLOOR_ALT;
  const MT = T.MEETING_FLOOR;
  const CA = T.CARPET;
  const OU = T.OUTER;
  const EM = T.EMPTY;
  const WH = T.WALL_H;
  const WV = T.WALL_V;
  const TL = T.WALL_CORNER_TL;
  const TR = T.WALL_CORNER_TR;
  const BL = T.WALL_CORNER_BL;
  const BR = T.WALL_CORNER_BR;
  const DS = T.DESK;
  const CH = T.CHAIR;
  const PL = T.PLANT;
  const TV = T.TV;
  const WB = T.WHITEBOARD;
  const DO = T.DOOR;
  const WI = T.WINDOW;
  const BS = T.BOOKSHELF;
  const CO = T.COUCH;

  // floor layer – every cell has a floor type or outer
  const floor: number[][] = [];
  for (let r = 0; r < MAP_H; r++) {
    const row: number[] = [];
    for (let c = 0; c < MAP_W; c++) {
      // outer border of map = void
      if (r === 0 || r === MAP_H - 1 || c === 0 || c === MAP_W - 1) {
        row.push(OU);
      }
      // lobby area (top-left 12×8)
      else if (r >= 1 && r <= 8 && c >= 1 && c <= 12) {
        row.push(FA);
      }
      // meeting room top-right (rows 1-10, cols 26-39)
      else if (r >= 1 && r <= 10 && c >= 27 && c <= 39) {
        row.push(MT);
      }
      // open office (big central area)
      else {
        row.push(F);
      }
    }
    floor.push(row);
  }

  // object layer – 0 = nothing
  const obj: number[][] = Array.from({ length: MAP_H }, () =>
    Array(MAP_W).fill(EM)
  );

  const set = (r: number, c: number, v: number) => {
    if (r >= 0 && r < MAP_H && c >= 0 && c < MAP_W) obj[r][c] = v;
  };
  const hwall = (r: number, c1: number, c2: number) => {
    for (let c = c1; c <= c2; c++) set(r, c, WH);
  };
  const vwall = (r1: number, r2: number, c: number) => {
    for (let r = r1; r <= r2; r++) set(r, c, WV);
  };

  // ── Outer boundary walls ─────────────────────────────────────────────────
  hwall(1, 1, MAP_W - 2);            // top wall
  hwall(MAP_H - 2, 1, MAP_W - 2);   // bottom wall
  vwall(1, MAP_H - 2, 1);           // left wall
  vwall(1, MAP_H - 2, MAP_W - 2);   // right wall
  set(1, 1, TL); set(1, MAP_W - 2, TR);
  set(MAP_H - 2, 1, BL); set(MAP_H - 2, MAP_W - 2, BR);

  // ── Lobby room (rows 1-9, cols 1-13) ─────────────────────────────────────
  hwall(9, 2, 13); // lobby bottom wall
  vwall(2, 8, 13); // lobby right wall
  set(9, 13, BR);
  // door in lobby bottom wall
  set(9, 7, DO);
  set(9, 8, DO);
  // TV in lobby
  set(4, 3, TV);
  set(4, 4, TV);
  // lobby couch
  set(6, 5, CO); set(6, 6, CO); set(6, 7, CO);
  set(6, 9, CO); set(6, 10, CO); set(6, 11, CO);
  // plant in lobby corners
  set(3, 11, PL);
  set(7, 3, PL);

  // ── Meeting room top-right (rows 1-11, cols 27-38) ───────────────────────
  hwall(11, 27, 38);
  vwall(2, 10, 27);
  set(11, 27, BL);
  // windows on right and top walls of meeting room
  for (let c = 29; c <= 37; c += 3) set(1, c, WI);
  set(6, 38, WI); set(8, 38, WI);
  // whiteboard
  set(2, 30, WB); set(2, 31, WB); set(2, 32, WB);
  // meeting table + chairs
  set(5, 29, DS); set(5, 30, DS); set(5, 31, DS); set(5, 32, DS); set(5, 33, DS);
  set(6, 29, DS); set(6, 30, DS); set(6, 31, DS); set(6, 32, DS); set(6, 33, DS);
  set(4, 29, CH); set(4, 31, CH); set(4, 33, CH);
  set(7, 29, CH); set(7, 31, CH); set(7, 33, CH);
  set(5, 28, CH); set(6, 28, CH);
  set(5, 34, CH); set(6, 34, CH);
  // door to meeting room
  set(11, 32, DO); set(11, 33, DO);

  // ── Small meeting room bottom-right (rows 20-30, cols 27-38) ─────────────
  hwall(20, 27, 38);
  hwall(30, 27, 38);
  vwall(21, 29, 27);
  set(20, 27, TL); set(20, 38, TR);
  set(30, 27, BL); set(30, 38, BR);
  set(21, 29, DO); set(22, 29, DO);
  // table
  set(24, 29, DS); set(24, 30, DS); set(24, 31, DS); set(24, 32, DS);
  set(25, 29, DS); set(25, 30, DS); set(25, 31, DS); set(25, 32, DS);
  set(23, 30, CH); set(23, 32, CH);
  set(26, 30, CH); set(26, 32, CH);
  set(24, 28, CH); set(25, 28, CH);
  set(24, 33, CH); set(25, 33, CH);
  // whiteboard
  set(21, 35, WB); set(21, 36, WB);
  // plant
  set(29, 37, PL);

  // ── Open office desks (center area rows 13-18, cols 4-24) ─────────────────
  // Row of desks 1
  for (let c = 4; c <= 10; c += 3) {
    set(13, c, DS); set(13, c + 1, DS);
    set(14, c, CH);
  }
  // Row of desks 2
  for (let c = 4; c <= 10; c += 3) {
    set(16, c, DS); set(16, c + 1, DS);
    set(17, c, CH);
  }
  // Row of desks 3 (right side)
  for (let c = 15; c <= 24; c += 3) {
    set(13, c, DS); set(13, c + 1, DS);
    set(14, c, CH);
  }
  for (let c = 15; c <= 24; c += 3) {
    set(16, c, DS); set(16, c + 1, DS);
    set(17, c, CH);
  }

  // ── Bottom open office desks (rows 22-28, cols 4-22) ──────────────────────
  for (let c = 4; c <= 22; c += 4) {
    set(22, c, DS); set(22, c + 1, DS); set(22, c + 2, DS);
    set(23, c, CH); set(23, c + 2, CH);
    set(25, c, DS); set(25, c + 1, DS); set(25, c + 2, DS);
    set(26, c, CH); set(26, c + 2, CH);
  }

  // ── Internal divider wall (rows 11-19, cols 14-15) ───────────────────────
  vwall(11, 19, 14);
  set(11, 14, WH);

  // ── Plants scattered ─────────────────────────────────────────────────────
  set(11, 4, PL);
  set(11, 25, PL);
  set(19, 2, PL);
  set(19, 25, PL);
  set(28, 3, PL);
  set(28, 24, PL);

  // ── Bookshelves along top wall ────────────────────────────────────────────
  for (let c = 15; c <= 26; c += 2) set(2, c, BS);

  // ── Windows along bottom wall ─────────────────────────────────────────────
  for (let c = 4; c <= 22; c += 4) set(MAP_H - 2, c, WI);

  return { floor, objects: obj };
}

// ─── Walkability ─────────────────────────────────────────────────────────────
const SOLID_OBJECTS = new Set([
  T.WALL_H, T.WALL_V,
  T.WALL_CORNER_TL, T.WALL_CORNER_TR,
  T.WALL_CORNER_BL, T.WALL_CORNER_BR,
  T.DESK, T.TV, T.WHITEBOARD, T.BOOKSHELF,
  T.COUCH, T.WINDOW,
]);

export function isSolid(
  objects: number[][],
  tileX: number,
  tileY: number
): boolean {
  if (tileX < 0 || tileY < 0 || tileX >= MAP_W || tileY >= MAP_H) return true;
  const floorTile = T.OUTER; // we'll check floor too if needed
  void floorTile;
  return SOLID_OBJECTS.has(objects[tileY][tileX]);
}

// ─── Meeting zone detection ───────────────────────────────────────────────────
export function getMeetingZone(
  tileX: number,
  tileY: number
): { roomId: string } | null {
  // Top-right meeting room
  if (tileX >= 28 && tileX <= 37 && tileY >= 2 && tileY <= 10)
    return { roomId: "room1" };
  // Bottom-right meeting room
  if (tileX >= 28 && tileX <= 37 && tileY >= 21 && tileY <= 29)
    return { roomId: "room2" };
  return null;
}

// ─── Color palette ────────────────────────────────────────────────────────────
const PAL = {
  OUTER:        0x1a1a2e,
  FLOOR:        0xd4cfc9,   // light grey concrete
  FLOOR_ALT:    0xc8a87a,   // warm carpet
  CARPET:       0xa0b4c8,
  MEETING:      0xc8d8e8,   // light blue-grey for meeting rooms
  WALL:         0x8fa8b8,
  WALL_DARK:    0x6b8299,
  WALL_INNER:   0xfafafa,   // white inner room walls
  DESK_TOP:     0xd4a96a,   // wooden desk surface
  DESK_EDGE:    0xb08040,
  CHAIR_SEAT:   0x4a4a5a,
  CHAIR_BACK:   0x3a3a4a,
  PLANT_POT:    0x8b4513,
  PLANT_LEAF:   0x2d7a2d,
  TV_BODY:      0x2a2a2a,
  TV_SCREEN:    0x1a3a6a,
  WB_BODY:      0xfafafa,
  WB_FRAME:     0xcccccc,
  BOOK_BODY:    0x8b6914,
  BOOK_SPINE:   0x6b4a14,
  COUCH_BODY:   0x5a6a7a,
  COUCH_SEAT:   0x4a5a6a,
  DOOR_FRAME:   0x8b6914,
  DOOR_PANEL:   0xa07830,
  WINDOW_FRAME: 0x9ab0c0,
  WINDOW_GLASS: 0xb8d4e8,
  GRID:         0x00000015, // subtle grid overlay
};

// ─── Phaser Scene ─────────────────────────────────────────────────────────────
export interface OtherPlayer {
  userId: string;
  socketId: string;
  displayName: string;
  x: number;
  y: number;
  z: number;
  direction: string;
  avatar?: unknown;
}

export type MoveCallback = (
  tx: number,
  ty: number,
  direction: string
) => void;

export type ZoneCallback = (zone: { roomId: string } | null) => void;

export class OfficeScene extends Phaser.Scene {
  private floorMap!: number[][];
  private objMap!: number[][];

  private tileGfx!: Phaser.GameObjects.Graphics;
  private objGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;

  // Self
  private selfSprite!: Phaser.GameObjects.Graphics;
  private selfLabel!: Phaser.GameObjects.Text;
  private selfTileX = 8;
  private selfTileY = 15;
  private selfPxX = 0;
  private selfPxY = 0;
  private selfDirection = "down";
  private selfDisplayName = "You";

  // Others
  private others: Map<string, {
    sprite: Phaser.GameObjects.Graphics;
    label: Phaser.GameObjects.Text;
    targetX: number;
    targetY: number;
    pxX: number;
    pxY: number;
    data: OtherPlayer;
  }> = new Map();

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  private moveTimer = 0;
  private readonly MOVE_DELAY = 140; // ms between moves

  // Zoom — canvas fills screen, camera zoom controls how much map is visible
  private targetZoom = 1;
  private zoomMin = 0.3;           // recalculated on create/resize to fit full map
  private readonly ZOOM_MAX = 2.0; // max: ~2 rooms visible, not too close
  private readonly ZOOM_LERP = 0.12;

  // Pinch tracking
  private pinchDist: number | null = null;

  // Callbacks (set from React)
  onMove?: MoveCallback;
  onZoneChange?: ZoneCallback;

  private lastZoneId: string | null = null;

  constructor() {
    super({ key: "OfficeScene" });
  }

  setDisplayName(name: string) {
    this.selfDisplayName = name;
    if (this.selfLabel) this.selfLabel.setText(name);
  }

  // Returns the zoom level that makes the entire map just fit the viewport
  private calcZoomToFit(): number {
    const vw = this.scale.width;
    const vh = this.scale.height;
    const zx = vw / (MAP_W * TILE);
    const zy = vh / (MAP_H * TILE);
    return Math.min(zx, zy);
  }

  create() {
    const { floor, objects } = buildMap();
    this.floorMap = floor;
    this.objMap = objects;

    // Camera world bounds = full map
    this.cameras.main.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);

    // Recalculate zoom limits when the game is resized
    this.scale.on("resize", () => {
      this.zoomMin = this.calcZoomToFit();
      this.targetZoom = Phaser.Math.Clamp(this.targetZoom, this.zoomMin, this.ZOOM_MAX);
    });

    // Graphics layers
    this.tileGfx = this.add.graphics();
    this.objGfx = this.add.graphics();
    this.overlayGfx = this.add.graphics();

    this.drawFloor();
    this.drawObjects();
    this.drawOverlay();

    // Self pixel position (center of tile)
    this.selfPxX = this.selfTileX * TILE + TILE / 2;
    this.selfPxY = this.selfTileY * TILE + TILE / 2;

    // Self sprite
    this.selfSprite = this.add.graphics();
    this.selfLabel = this.add
      .text(0, 0, this.selfDisplayName, {
        fontSize: "10px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5, 1);

    this.drawCharacter(this.selfSprite, 0x22c55e, this.selfDirection);
    this.updateSelfPosition();

    // Camera follow
    this.cameras.main.startFollow(this.selfSprite, true, 0.08, 0.08);

    // Set initial zoom: fit the whole map in view (zoom-to-fit)
    this.zoomMin = this.calcZoomToFit();
    this.targetZoom = this.zoomMin;  // start fully zoomed out
    this.cameras.main.setZoom(this.targetZoom);

    // ── Zoom: mouse wheel ────────────────────────────────────────────────────
    this.input.on(
      "wheel",
      (
        _ptr: Phaser.Input.Pointer,
        _objs: unknown,
        _dx: number,
        dy: number
      ) => {
        const factor = dy > 0 ? 0.9 : 1.1;
        this.targetZoom = Phaser.Math.Clamp(
          this.targetZoom * factor,
          this.zoomMin,
          this.ZOOM_MAX
        );
      }
    );

    // ── Zoom: pinch (touch / trackpad) ───────────────────────────────────────
    this.input.on("pointermove", (ptr: Phaser.Input.Pointer) => {
      // Phaser tracks active pointers; check if 2 are down
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        const dx = p1.x - p2.x;
        const dy2 = p1.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy2 * dy2);
        if (this.pinchDist !== null) {
          const ratio = dist / this.pinchDist;
          this.targetZoom = Phaser.Math.Clamp(
            this.targetZoom * ratio,
            this.zoomMin,
            this.ZOOM_MAX
          );
        }
        this.pinchDist = dist;
        void ptr; // suppress unused warning
      } else {
        this.pinchDist = null;
      }
    });

    // ── Zoom: keyboard + / - ─────────────────────────────────────────────────
    this.input.keyboard!.on("keydown-PLUS",  () => { this.zoomBy(1.15); });
    this.input.keyboard!.on("keydown-MINUS", () => { this.zoomBy(0.87); });
    this.input.keyboard!.on("keydown-EQUAL", () => { this.zoomBy(1.15); }); // = without shift
    this.input.keyboard!.on("keydown-ZERO",  () => { this.zoomToFit(); }); // reset to fit

    // Input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
  }

  // Public zoom control (called from React buttons)
  zoomBy(factor: number) {
    this.targetZoom = Phaser.Math.Clamp(
      this.targetZoom * factor,
      this.zoomMin,
      this.ZOOM_MAX
    );
  }

  zoomTo(value: number) {
    this.targetZoom = Phaser.Math.Clamp(value, this.zoomMin, this.ZOOM_MAX);
  }

  zoomToFit() {
    this.targetZoom = this.calcZoomToFit();
  }

  getZoom(): number {
    return this.cameras.main.zoom;
  }

  // ── Drawing helpers ─────────────────────────────────────────────────────────
  private drawFloor() {
    const g = this.tileGfx;
    g.clear();
    for (let r = 0; r < MAP_H; r++) {
      for (let c = 0; c < MAP_W; c++) {
        const ft = this.floorMap[r][c];
        const x = c * TILE;
        const y = r * TILE;
        let col: number;
        switch (ft) {
          case T.OUTER:       col = PAL.OUTER; break;
          case T.FLOOR_ALT:   col = PAL.FLOOR_ALT; break;
          case T.MEETING_FLOOR: col = PAL.MEETING; break;
          case T.CARPET:      col = PAL.CARPET; break;
          default:            col = PAL.FLOOR; break;
        }
        g.fillStyle(col, 1);
        g.fillRect(x, y, TILE, TILE);

        // subtle tile grid lines
        if (ft !== T.OUTER) {
          g.lineStyle(1, 0x000000, 0.06);
          g.strokeRect(x, y, TILE, TILE);
        }
      }
    }
  }

  private drawObjects() {
    const g = this.objGfx;
    g.clear();
    for (let r = 0; r < MAP_H; r++) {
      for (let c = 0; c < MAP_W; c++) {
        const t = this.objMap[r][c];
        if (t === T.EMPTY) continue;
        const x = c * TILE;
        const y = r * TILE;
        this.drawTileObject(g, t, x, y);
      }
    }
  }

  private drawTileObject(
    g: Phaser.GameObjects.Graphics,
    t: number,
    x: number,
    y: number
  ) {
    const S = TILE;
    switch (t) {
      // ── Walls ──────────────────────────────────────────────────────────────
      case T.WALL_H: {
        g.fillStyle(PAL.WALL_INNER, 1);
        g.fillRect(x, y, S, S);
        g.fillStyle(PAL.WALL_DARK, 1);
        g.fillRect(x, y, S, 6);
        g.fillRect(x, y + S - 4, S, 4);
        break;
      }
      case T.WALL_V: {
        g.fillStyle(PAL.WALL_INNER, 1);
        g.fillRect(x, y, S, S);
        g.fillStyle(PAL.WALL_DARK, 1);
        g.fillRect(x, y, 6, S);
        g.fillRect(x + S - 4, y, 4, S);
        break;
      }
      case T.WALL_CORNER_TL:
      case T.WALL_CORNER_TR:
      case T.WALL_CORNER_BL:
      case T.WALL_CORNER_BR: {
        g.fillStyle(PAL.WALL_INNER, 1);
        g.fillRect(x, y, S, S);
        g.fillStyle(PAL.WALL_DARK, 1);
        g.fillRect(x, y, S, 6);
        g.fillRect(x, y, 6, S);
        break;
      }
      // ── Door ───────────────────────────────────────────────────────────────
      case T.DOOR: {
        g.fillStyle(PAL.DOOR_FRAME, 1);
        g.fillRect(x, y, S, 6);
        g.fillStyle(PAL.DOOR_PANEL, 1);
        g.fillRect(x + 3, y + 6, S - 6, S - 6);
        g.fillStyle(0xffd700, 1);
        g.fillCircle(x + S - 8, y + S / 2, 2);
        break;
      }
      // ── Window ─────────────────────────────────────────────────────────────
      case T.WINDOW: {
        g.fillStyle(PAL.WINDOW_FRAME, 1);
        g.fillRect(x, y, S, S);
        g.fillStyle(PAL.WINDOW_GLASS, 1);
        g.fillRect(x + 4, y + 4, S - 8, S - 8);
        g.lineStyle(1, PAL.WINDOW_FRAME, 1);
        g.lineBetween(x + S / 2, y + 4, x + S / 2, y + S - 4);
        g.lineBetween(x + 4, y + S / 2, x + S - 4, y + S / 2);
        break;
      }
      // ── Desk ───────────────────────────────────────────────────────────────
      case T.DESK: {
        g.fillStyle(PAL.DESK_EDGE, 1);
        g.fillRect(x, y, S, S);
        g.fillStyle(PAL.DESK_TOP, 1);
        g.fillRect(x + 2, y + 2, S - 4, S - 6);
        // monitor hint
        g.fillStyle(0x1a1a2e, 1);
        g.fillRect(x + 6, y + 6, S - 14, S - 16);
        g.fillStyle(0x2a4a8a, 1);
        g.fillRect(x + 7, y + 7, S - 16, S - 18);
        break;
      }
      // ── Chair ──────────────────────────────────────────────────────────────
      case T.CHAIR: {
        g.fillStyle(PAL.CHAIR_BACK, 1);
        g.fillRect(x + 6, y + 2, S - 12, S - 10);
        g.fillStyle(PAL.CHAIR_SEAT, 1);
        g.fillRect(x + 5, y + 8, S - 10, S - 14);
        // wheels
        g.fillStyle(0x1a1a1a, 1);
        g.fillRect(x + 4, y + S - 8, 5, 4);
        g.fillRect(x + S - 9, y + S - 8, 5, 4);
        break;
      }
      // ── Plant ──────────────────────────────────────────────────────────────
      case T.PLANT: {
        g.fillStyle(PAL.PLANT_POT, 1);
        g.fillRect(x + 10, y + S - 12, S - 20, 10);
        g.fillStyle(PAL.PLANT_LEAF, 1);
        g.fillCircle(x + S / 2, y + S / 2 - 2, 10);
        g.fillStyle(0x1a5a1a, 1);
        g.fillCircle(x + S / 2 - 5, y + S / 2 + 2, 6);
        g.fillCircle(x + S / 2 + 5, y + S / 2 + 2, 6);
        break;
      }
      // ── TV ─────────────────────────────────────────────────────────────────
      case T.TV: {
        g.fillStyle(PAL.TV_BODY, 1);
        g.fillRect(x + 2, y + 4, S - 4, S - 10);
        g.fillStyle(PAL.TV_SCREEN, 1);
        g.fillRect(x + 4, y + 6, S - 8, S - 14);
        // stand
        g.fillStyle(PAL.TV_BODY, 1);
        g.fillRect(x + S / 2 - 3, y + S - 8, 6, 5);
        break;
      }
      // ── Whiteboard ─────────────────────────────────────────────────────────
      case T.WHITEBOARD: {
        g.fillStyle(PAL.WB_FRAME, 1);
        g.fillRect(x, y + 4, S, S - 8);
        g.fillStyle(PAL.WB_BODY, 1);
        g.fillRect(x + 3, y + 7, S - 6, S - 14);
        // chart lines on whiteboard
        g.lineStyle(1, 0x4a90d9, 0.8);
        g.lineBetween(x + 6, y + S - 10, x + 10, y + 14);
        g.lineBetween(x + 10, y + 14, x + 16, y + 18);
        g.lineBetween(x + 16, y + 18, x + 20, y + 12);
        g.lineBetween(x + 20, y + 12, x + 26, y + 16);
        break;
      }
      // ── Bookshelf ──────────────────────────────────────────────────────────
      case T.BOOKSHELF: {
        g.fillStyle(PAL.BOOK_BODY, 1);
        g.fillRect(x + 1, y + 2, S - 2, S - 4);
        // book spines
        const bookColors = [0xc0392b, 0x27ae60, 0x2980b9, 0xf39c12, 0x8e44ad];
        for (let i = 0; i < 5; i++) {
          g.fillStyle(bookColors[i], 1);
          g.fillRect(x + 3 + i * 5, y + 5, 4, S - 12);
        }
        g.fillStyle(PAL.BOOK_SPINE, 1);
        g.fillRect(x + 1, y + S - 6, S - 2, 4);
        break;
      }
      // ── Couch ──────────────────────────────────────────────────────────────
      case T.COUCH: {
        g.fillStyle(PAL.COUCH_BODY, 1);
        g.fillRect(x + 2, y + 2, S - 4, S - 4);
        g.fillStyle(PAL.COUCH_SEAT, 1);
        g.fillRect(x + 4, y + 10, S - 8, S - 14);
        g.fillStyle(PAL.COUCH_BODY, 1);
        g.fillRect(x + 2, y + 2, 5, S - 8);
        g.fillRect(x + S - 7, y + 2, 5, S - 8);
        break;
      }
    }
  }

  private drawOverlay() {
    // Draw meeting zone highlights
    const g = this.overlayGfx;
    g.clear();

    // Zone 1 highlight (slightly different floor already; add a subtle border)
    const z1 = { x: 28 * TILE, y: 2 * TILE, w: 10 * TILE, h: 9 * TILE };
    const z2 = { x: 28 * TILE, y: 21 * TILE, w: 10 * TILE, h: 9 * TILE };
    for (const z of [z1, z2]) {
      g.lineStyle(2, 0x3b82f6, 0.5);
      g.strokeRect(z.x, z.y, z.w, z.h);
    }
  }

  // ── Character drawing ───────────────────────────────────────────────────────
  drawCharacter(
    gfx: Phaser.GameObjects.Graphics,
    color: number,
    direction: string
  ) {
    gfx.clear();
    const S = TILE;
    const hw = S / 2;

    // Shadow
    gfx.fillStyle(0x000000, 0.2);
    gfx.fillEllipse(hw, S - 4, S - 8, 6);

    // Legs
    gfx.fillStyle(0x1a237e, 1);
    gfx.fillRect(hw - 5, S - 12, 4, 8);
    gfx.fillRect(hw + 1, S - 12, 4, 8);

    // Body
    gfx.fillStyle(color, 1);
    gfx.fillRect(hw - 6, S - 22, 12, 11);

    // Head (skin tone)
    gfx.fillStyle(0xffd5b0, 1);
    gfx.fillRect(hw - 5, S - 30, 10, 9);

    // Eyes (direction-dependent)
    gfx.fillStyle(0x1a1a1a, 1);
    if (direction === "down") {
      gfx.fillRect(hw - 3, S - 24, 2, 2);
      gfx.fillRect(hw + 1, S - 24, 2, 2);
    } else if (direction === "up") {
      // back of head – no eyes visible
    } else if (direction === "left") {
      gfx.fillRect(hw - 4, S - 24, 2, 2);
    } else {
      gfx.fillRect(hw + 2, S - 24, 2, 2);
    }

    // Hair
    gfx.fillStyle(0x5c3317, 1);
    gfx.fillRect(hw - 5, S - 30, 10, 3);
    gfx.fillRect(hw - 6, S - 28, 2, 4);
  }

  private updateSelfPosition() {
    this.selfSprite.setPosition(this.selfPxX, this.selfPxY);
    this.selfLabel.setPosition(this.selfPxX, this.selfPxY - TILE / 2 - 2);
  }

  // ── Public API (called from React) ─────────────────────────────────────────
  setOtherPlayers(players: OtherPlayer[]) {
    if (!this.scene.isActive()) return;

    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.socketId);
      const px = p.x * TILE + TILE / 2;
      const py = p.z * TILE + TILE / 2; // z is tile Y in our coord system

      if (this.others.has(p.socketId)) {
        const entry = this.others.get(p.socketId)!;
        entry.targetX = px;
        entry.targetY = py;
        entry.data = p;
        this.drawCharacter(entry.sprite, 0xf97316, p.direction);
        entry.label.setText(p.displayName);
      } else {
        const sprite = this.add.graphics();
        sprite.setDepth(5);
        const label = this.add
          .text(px, py - TILE / 2 - 2, p.displayName, {
            fontSize: "10px",
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 3,
            resolution: 2,
          })
          .setOrigin(0.5, 1)
          .setDepth(6);
        this.drawCharacter(sprite, 0xf97316, p.direction);
        sprite.setPosition(px, py);
        this.others.set(p.socketId, {
          sprite,
          label,
          targetX: px,
          targetY: py,
          pxX: px,
          pxY: py,
          data: p,
        });
      }
    }

    // Remove departed players
    this.others.forEach((entry, id) => {
      if (!seen.has(id)) {
        entry.sprite.destroy();
        entry.label.destroy();
        this.others.delete(id);
      }
    });
  }

  removeOtherPlayer(socketId: string) {
    const entry = this.others.get(socketId);
    if (entry) {
      entry.sprite.destroy();
      entry.label.destroy();
      this.others.delete(socketId);
    }
  }

  updateOtherPlayer(
    socketId: string,
    x: number,
    z: number,
    direction: string,
    displayName: string
  ) {
    const entry = this.others.get(socketId);
    if (!entry) return;
    entry.targetX = x * TILE + TILE / 2;
    entry.targetY = z * TILE + TILE / 2;
    entry.data.direction = direction;
    this.drawCharacter(entry.sprite, 0xf97316, direction);
    entry.label.setText(displayName);
  }

  teleportSelf(tileX: number, tileY: number, direction = "down") {
    this.selfTileX = tileX;
    this.selfTileY = tileY;
    this.selfDirection = direction;
    this.selfPxX = tileX * TILE + TILE / 2;
    this.selfPxY = tileY * TILE + TILE / 2;
    this.updateSelfPosition();
    this.drawCharacter(this.selfSprite, 0x22c55e, this.selfDirection);
    this.selfSprite.setDepth(5);
    this.selfLabel.setDepth(6);
  }

  // ── Game loop ───────────────────────────────────────────────────────────────
  update(_time: number, delta: number) {
    // Smooth zoom lerp every frame
    const currentZoom = this.cameras.main.zoom;
    if (Math.abs(currentZoom - this.targetZoom) > 0.001) {
      this.cameras.main.setZoom(
        currentZoom + (this.targetZoom - currentZoom) * this.ZOOM_LERP
      );
    }

    this.moveTimer += delta;
    if (this.moveTimer < this.MOVE_DELAY) {
      // Still interpolate others
      this.interpolateOthers();
      return;
    }

    let dx = 0;
    let dy = 0;
    let dir = this.selfDirection;

    const up =
      this.cursors.up.isDown || this.wasd.up.isDown;
    const down =
      this.cursors.down.isDown || this.wasd.down.isDown;
    const left =
      this.cursors.left.isDown || this.wasd.left.isDown;
    const right =
      this.cursors.right.isDown || this.wasd.right.isDown;

    if (up)    { dy = -1; dir = "up"; }
    if (down)  { dy =  1; dir = "down"; }
    if (left)  { dx = -1; dir = "left"; }
    if (right) { dx =  1; dir = "right"; }

    if (dx !== 0 || dy !== 0) {
      this.moveTimer = 0;
      const nx = this.selfTileX + dx;
      const ny = this.selfTileY + dy;

      if (!isSolid(this.objMap, nx, ny) && this.floorMap[ny]?.[nx] !== T.OUTER) {
        this.selfTileX = nx;
        this.selfTileY = ny;
      }
      this.selfDirection = dir;
      this.selfPxX = this.selfTileX * TILE + TILE / 2;
      this.selfPxY = this.selfTileY * TILE + TILE / 2;
      this.drawCharacter(this.selfSprite, 0x22c55e, this.selfDirection);

      this.onMove?.(this.selfTileX, this.selfTileY, this.selfDirection);

      // Zone check
      const zone = getMeetingZone(this.selfTileX, this.selfTileY);
      const zoneId = zone?.roomId ?? null;
      if (zoneId !== this.lastZoneId) {
        this.lastZoneId = zoneId;
        this.onZoneChange?.(zone);
      }
    }

    this.updateSelfPosition();
    this.interpolateOthers();
  }

  private interpolateOthers() {
    const LERP = 0.12;
    this.others.forEach((entry) => {
      entry.pxX += (entry.targetX - entry.pxX) * LERP;
      entry.pxY += (entry.targetY - entry.pxY) * LERP;
      entry.sprite.setPosition(entry.pxX, entry.pxY);
      entry.label.setPosition(entry.pxX, entry.pxY - TILE / 2 - 2);
    });
  }

  getSelfTile(): { x: number; y: number } {
    return { x: this.selfTileX, y: this.selfTileY };
  }
}
