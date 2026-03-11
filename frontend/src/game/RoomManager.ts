import Phaser from 'phaser'

// ─── Room Types ───────────────────────────────────────────────────────────────
export type RoomType = 'computer' | 'meeting' | 'boss' | 'lounge' | 'phone'

export interface RoomConfig {
  type: RoomType
  label: string
  description: string
  emoji: string
  color: number
  accentColor: number
  defaultW: number   // interior tile width
  defaultH: number   // interior tile height
  isMeetingZone: boolean
}

export const ROOM_CONFIGS: Record<RoomType, RoomConfig> = {
  computer: {
    type: 'computer', label: 'Computer Lab', emoji: '💻',
    description: 'Open workspace with desks and computers',
    color: 0xd4cfc9, accentColor: 0x8fa8b8,
    defaultW: 10, defaultH: 8, isMeetingZone: false,
  },
  meeting: {
    type: 'meeting', label: 'Meeting Room', emoji: '🤝',
    description: 'Conference room — triggers video call when entered',
    color: 0xc2d4e4, accentColor: 0x4a80b8,
    defaultW: 8, defaultH: 7, isMeetingZone: true,
  },
  boss: {
    type: 'boss', label: "CEO's Office", emoji: '👔',
    description: 'Private office with large desk and bookshelf',
    color: 0xc8a87a, accentColor: 0x8b6914,
    defaultW: 7, defaultH: 6, isMeetingZone: false,
  },
  lounge: {
    type: 'lounge', label: 'Lounge', emoji: '🛋️',
    description: 'Cozy hangout space with couches and TV',
    color: 0xd4b896, accentColor: 0x9c7248,
    defaultW: 8, defaultH: 6, isMeetingZone: false,
  },
  phone: {
    type: 'phone', label: 'Phone Booth', emoji: '📞',
    description: 'Small quiet booth for private calls',
    color: 0xe8e0d0, accentColor: 0x6b8299,
    defaultW: 3, defaultH: 3, isMeetingZone: true,
  },
}

// ─── Room Instance ────────────────────────────────────────────────────────────
export interface RoomInstance {
  id: string
  name: string
  type: RoomType
  px: number             // pixel X of room bounding box (incl. walls)
  py: number             // pixel Y
  pw: number             // pixel width
  ph: number             // pixel height
  corridor: CorridorBounds  // walkable passage connecting map to room
}

// ─── Layout constants ─────────────────────────────────────────────────────────
const T = 32                  // tile size in px
const MAP_W = 1280            // main Tiled map pixel width  (40 tiles)
const MAP_H = 960             // main Tiled map pixel height (30 tiles)
const CORRIDOR_W = T * 2      // hallway width = 2 tiles wide (64px)
// Corridor extends from 4 tiles INSIDE the map to the room left wall
// so it clearly punches through any right-edge wall tiles
const CORRIDOR_INSIDE = T * 4 // how many px inside the map the corridor starts
const GAP = T * 2             // vertical gap between attached rooms

export interface CorridorBounds {
  x: number   // corridor floor left edge (inside map)
  y: number   // corridor floor top edge
  w: number   // total corridor width in px
  h: number   // corridor height in px (= CORRIDOR_W)
}

export class RoomManager {
  private scene: Phaser.Scene
  private gfx: Phaser.GameObjects.Graphics
  private rooms: RoomInstance[] = []
  private labels = new Map<string, { badge: Phaser.GameObjects.Text; sub: Phaser.GameObjects.Text }>()
  private spriteObjects: Phaser.GameObjects.Image[] = []
  // Chairs placed inside dynamic rooms — exposed for the sit system
  private dynChairs: Array<{ x: number; y: number; frame: number }> = []

  // Placement cursor: rooms stack downward on the RIGHT side of the map
  // Each room's left wall is flush with the right edge of the main map,
  // connected by a corridor gap.
  private nextAttachY = T * 4  // start 4 tiles from top of map right edge

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.gfx = scene.add.graphics().setDepth(50)
  }

  // ── Public: add a room ────────────────────────────────────────────────────
  addRoom(id: string, name: string, type: RoomType): RoomInstance {
    const cfg = ROOM_CONFIGS[type]
    const iW  = cfg.defaultW * T          // interior px width
    const iH  = cfg.defaultH * T          // interior px height
    const totalW = iW + T * 2             // +1 wall each side
    const totalH = iH + T * 2

    // The room is placed to the RIGHT of the main map.
    // Room left wall starts at MAP_W.
    const px = MAP_W
    const py = this.nextAttachY

    // Corridor opening: centered vertically in the room interior
    const corridorY = py + T + Math.floor(iH / 2) - T  // top of the 2-tile opening

    // Corridor starts INSIDE the map (CORRIDOR_INSIDE px before MAP_W)
    // so it visually and physically punches through the right wall of the Tiled map
    const corridor: CorridorBounds = {
      x: MAP_W - CORRIDOR_INSIDE,
      y: corridorY,
      w: CORRIDOR_INSIDE + totalW, // spans from inside-map all the way to room right wall
      h: CORRIDOR_W,
    }

    const room: RoomInstance = { id, name, type, px, py, pw: totalW, ph: totalH, corridor }
    this.rooms.push(room)

    // Draw corridor floor (paints over Tiled map right wall visually)
    this.drawCorridor(corridor, corridorY)

    // Draw room
    this.drawRoom(room, corridorY)

    // Labels
    this.addLabels(room)

    // Advance cursor
    this.nextAttachY += totalH + GAP

    return room
  }

  getRooms(): RoomInstance[] { return this.rooms }

  // Returns the total world height needed (map + all attached rooms)
  getWorldBounds(): { w: number; h: number } {
    const maxX = this.rooms.length > 0
      ? Math.max(...this.rooms.map(r => r.px + r.pw))
      : MAP_W
    const maxY = this.rooms.length > 0
      ? Math.max(MAP_H, this.nextAttachY + GAP)
      : MAP_H
    return { w: maxX, h: maxY }
  }

  getRoomAt(wx: number, wy: number): RoomInstance | null {
    for (const r of this.rooms) {
      // interior bounds
      const iX = r.px + T, iY = r.py + T
      const iW = r.pw - T * 2, iH = r.ph - T * 2
      if (wx >= iX && wx <= iX + iW && wy >= iY && wy <= iY + iH) return r
    }
    return null
  }

  // Returns all chair positions in dynamic rooms (for the sit system)
  getDynChairPositions(): Array<{ x: number; y: number; frame: number }> {
    return [...this.dynChairs]
  }

  renameRoom(id: string, newName: string) {
    const r = this.rooms.find(r => r.id === id)
    if (!r) return
    r.name = newName
    const l = this.labels.get(id)
    if (l) l.badge.setText(`${ROOM_CONFIGS[r.type].emoji}  ${newName}`)
  }

  // ── Draw corridor floor + walls ────────────────────────────────────────────
  private drawCorridor(corridor: CorridorBounds, corridorY: number) {
    const g  = this.gfx
    const cX = corridor.x
    const cY = corridorY
    const cW = corridor.w
    const WALL_LIGHT = 0xfafafa
    const WALL_TOP   = 0x8fa8b8

    // ── Floor (slightly warm tone so it reads as a passage) ──
    g.fillStyle(0xdedad3, 1)
    g.fillRect(cX, cY, cW, CORRIDOR_W)

    // Tile grid on floor
    g.lineStyle(1, 0x000000, 0.07)
    for (let x = cX; x < cX + cW; x += T) {
      g.strokeRect(x, cY,     T, T)
      g.strokeRect(x, cY + T, T, T)
    }

    // ── Top wall of corridor ──
    for (let x = cX; x < cX + cW; x += T) {
      g.fillStyle(WALL_LIGHT, 1); g.fillRect(x, cY - T, T, T)
      g.fillStyle(WALL_TOP,   1); g.fillRect(x, cY - T, T, 7)
      g.fillStyle(0x6b8299,   1); g.fillRect(x, cY - 4,  T, 4)
    }

    // ── Bottom wall of corridor ──
    for (let x = cX; x < cX + cW; x += T) {
      g.fillStyle(WALL_LIGHT, 1); g.fillRect(x, cY + CORRIDOR_W, T, T)
      g.fillStyle(WALL_TOP,   1); g.fillRect(x, cY + CORRIDOR_W, T, 7)
    }

    // ── Directional arrows on corridor floor (visible from map side) ──
    g.fillStyle(0xa07830, 0.7)
    const arrowX   = MAP_W - T - 4
    const arrowMidY = cY + CORRIDOR_W / 2
    g.fillTriangle(arrowX + 10, arrowMidY, arrowX,     arrowMidY - 6, arrowX,     arrowMidY + 6)
    g.fillTriangle(arrowX + 18, arrowMidY, arrowX + 8, arrowMidY - 6, arrowX + 8, arrowMidY + 6)
  }

  // ── Draw room ──────────────────────────────────────────────────────────────
  private drawRoom(room: RoomInstance, corridorY: number) {
    const g = this.gfx
    const cfg = ROOM_CONFIGS[room.type]
    const { px, py, pw, ph } = room
    const W = T

    // ── Floor (checkerboard tile pattern) ──
    for (let x = px + W; x < px + pw - W; x += T) {
      for (let y = py + W; y < py + ph - W; y += T) {
        const even = ((x / T) + (y / T)) % 2 === 0
        g.fillStyle(even ? cfg.color : Phaser.Display.Color.ValueToColor(cfg.color).darken(8).color, 1)
        g.fillRect(x, y, T, T)
      }
    }

    // Subtle grout lines
    g.lineStyle(1, 0x000000, 0.10)
    for (let x = px + W; x < px + pw - W; x += T)
      for (let y = py + W; y < py + ph - W; y += T)
        g.strokeRect(x, y, T, T)

    // Meeting zone highlight
    if (cfg.isMeetingZone) {
      g.lineStyle(2, 0x3b82f6, 0.45)
      g.strokeRect(px + W + 2, py + W + 2, pw - W * 2 - 4, ph - W * 2 - 4)
    }

    // ── Walls ──
    const LIGHT = 0xfafafa
    const TOP   = cfg.accentColor
    const DARK  = 0x6b8299

    // Top wall
    for (let x = px; x < px + pw; x += W) {
      g.fillStyle(LIGHT, 1); g.fillRect(x, py, W, W)
      g.fillStyle(TOP,   1); g.fillRect(x, py, W, 7)
      g.fillStyle(DARK,  1); g.fillRect(x, py + W - 3, W, 3)
    }
    // Bottom wall
    for (let x = px; x < px + pw; x += W) {
      g.fillStyle(LIGHT, 1); g.fillRect(x, py + ph - W, W, W)
      g.fillStyle(TOP,   1); g.fillRect(x, py + ph - W, W, 7)
    }
    // Right wall
    for (let y = py + W; y < py + ph - W; y += W) {
      g.fillStyle(LIGHT, 1); g.fillRect(px + pw - W, y, W, W)
      g.fillStyle(TOP,   1); g.fillRect(px + pw - W, y, 7, W)
    }
    // Left wall — draw per tile, BUT leave a 2-tile opening at corridorY
    for (let y = py + W; y < py + ph - W; y += W) {
      const isOpening = y >= corridorY && y < corridorY + CORRIDOR_W
      if (!isOpening) {
        g.fillStyle(LIGHT, 1); g.fillRect(px, y, W, W)
        g.fillStyle(TOP,   1); g.fillRect(px, y, 7, W)
      }
      // Opening: draw floor color so it blends with corridor
      else {
        g.fillStyle(cfg.color, 1); g.fillRect(px, y, W, W)
      }
    }
    // Left wall corners (top-left, bottom-left)
    g.fillStyle(LIGHT, 1); g.fillRect(px, py, W, W)
    g.fillStyle(TOP,   1); g.fillRect(px, py, W, 7); g.fillRect(px, py, 7, W)
    g.fillStyle(LIGHT, 1); g.fillRect(px, py + ph - W, W, W)
    g.fillStyle(TOP,   1); g.fillRect(px, py + ph - W, W, 7); g.fillRect(px, py + ph - W, 7, W)

    // ── Props ──
    this.drawProps(g, room, cfg)

    // ── Archway at the left-wall opening — drawn LAST so walls don't cover it ──
    this.drawArch(g, px, corridorY)
  }

  // ── Archway drawn on top of the left-wall opening ────────────────────────
  // aX = px (left edge of room = MAP_W), openY = top of the corridor opening
  private drawArch(g: Phaser.GameObjects.Graphics, aX: number, openY: number) {
    const openH = CORRIDOR_W  // 64px = 2 tiles

    // ── Thick wooden door posts flanking the opening ──
    // Left/outer face of each post (dark brown)
    g.fillStyle(0x3d2b0e, 1)
    g.fillRect(aX - 6, openY - T,        6, T + openH + T)  // outer-left strip
    // Post above opening
    g.fillStyle(0x5c3d14, 1)
    g.fillRect(aX,     openY - T * 2,   T, T * 2)           // above opening (2 tiles tall)
    // Post below opening
    g.fillRect(aX,     openY + openH,   T, T * 2)           // below opening (2 tiles tall)
    // Highlight / light face on posts
    g.fillStyle(0x8b5e1a, 1)
    g.fillRect(aX + 2, openY - T * 2,  4, T * 2)
    g.fillRect(aX + 2, openY + openH,  4, T * 2)

    // ── Header beam spanning the full opening width ──
    g.fillStyle(0x3d2b0e, 1)
    g.fillRect(aX - 6, openY - T, T + 6, T)                 // dark beam body
    g.fillStyle(0x7a4e18, 1)
    g.fillRect(aX - 4, openY - T, T + 4, 5)                 // bright top edge
    g.fillStyle(0x2a1a08, 1)
    g.fillRect(aX - 4, openY - 2, T + 4, 2)                 // shadow under beam

    // ── Threshold strip right at the doorway edge (inside room) ──
    g.fillStyle(0xd4a050, 0.85)
    g.fillRect(aX + T, openY, 4, openH)                     // golden step strip

    // ── Doorstep corners (small accent blocks) ──
    g.fillStyle(0x5c3d14, 1)
    g.fillRect(aX + T, openY,          8, 8)                 // top-right corner
    g.fillRect(aX + T, openY + openH - 8, 8, 8)             // bottom-right corner
  }

  // ── Add a generic sprite prop ─────────────────────────────────────────────
  private addSprite(x: number, y: number, key: string, frame = 0, depth = 15): Phaser.GameObjects.Image {
    const img = this.scene.add.image(x, y, key, frame).setOrigin(0, 0).setDepth(depth)
    this.spriteObjects.push(img)
    return img
  }

  // ── Add a chair sprite + register its sit position ────────────────────────
  // x, y = top-left origin of the 32×64 chair sprite
  // sitFrame: 0=down, 1=up, 2=left, 3=right (matches OfficeScene.chairDir)
  private addChair(x: number, y: number, depth: number, sitFrame = 0): Phaser.GameObjects.Image {
    const img = this.scene.add.image(x, y, 'chairs', sitFrame).setOrigin(0, 0).setDepth(depth)
    this.spriteObjects.push(img)
    // Sit position = horizontal center, vertical center of chair sprite (32×64)
    this.dynChairs.push({ x: x + 16, y: y + 32, frame: sitFrame })
    return img
  }

  // ── Props per room type ───────────────────────────────────────────────────
  private drawProps(g: Phaser.GameObjects.Graphics, room: RoomInstance, cfg: RoomConfig) {
    const { px, py, pw, ph } = room
    const W = T
    const iX = px + W, iY = py + W
    const iW = pw - W * 2, iH = ph - W * 2

    switch (room.type) {
      case 'computer': {
        const cols = Math.max(1, Math.floor(iW / (W * 3)))
        const rows = Math.max(1, Math.floor(iH / (W * 4)))
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const dx = iX + c * W * 3, dy = iY + r * W * 4 + W
            this.addSprite(dx, dy - W, 'computers', 0, dy)
            // frame 0 = sit_down (facing the screen)
            this.addChair(dx + W, dy + W, dy + W * 2, 0)
          }
        }
        break
      }
      case 'meeting': {
        const tx = iX + W, ty = iY + W * 2
        const tw = iW - W * 2, th = iH - W * 3
        g.fillStyle(0xd4a96a, 1); g.fillRect(tx, ty, tw, th)
        g.fillStyle(0xb08040, 1); g.fillRect(tx, ty, tw, 4); g.fillRect(tx, ty + th - 4, tw, 4)
        const wX = iX + Math.floor(iW / 2) - W
        this.addSprite(wX, iY - W, 'whiteboards', 0, iY)
        const chairCount = Math.floor(tw / W)
        for (let c = 0; c < chairCount; c++) {
          this.addChair(tx + c * W, ty - W * 2, ty - W,       0)  // top row  → sit_down
          this.addChair(tx + c * W, ty + th,    ty + th + W,  1)  // bottom row → sit_up
        }
        // Side chairs
        this.addChair(tx - W, ty + Math.floor(th / 2) - W, ty + W, 3)   // left → sit_right
        this.addChair(tx + tw, ty + Math.floor(th / 2) - W, ty + W, 2)  // right → sit_left
        break
      }
      case 'boss': {
        const dX = iX + Math.floor(iW / 2 / W) * W - W
        g.fillStyle(0xb08040, 1); g.fillRect(dX, iY + W, W * 2, W)
        g.fillStyle(0xd4a96a, 1); g.fillRect(dX + 2, iY + W + 2, W * 2 - 4, W - 4)
        // Boss chair behind desk — sits facing down (toward desk)
        this.addChair(dX + W / 2, iY, iY + W, 0)
        for (let y = iY; y < iY + iH - W; y += W) this.bookshelf(g, iX, y)
        this.plant(g, iX + iW - W, iY); this.plant(g, iX + iW - W, iY + iH - W)
        break
      }
      case 'lounge': {
        const n = Math.min(4, Math.floor(iW / W) - 1)
        for (let i = 0; i < n; i++) this.couch(g, iX + i * W + 4, iY + W)
        this.tv(g, iX + W, iY + iH - W * 1.5); this.tv(g, iX + W * 2, iY + iH - W * 1.5)
        this.plant(g, iX, iY); this.plant(g, iX + iW - W, iY)
        break
      }
      case 'phone': {
        const dX = iX + Math.floor(iW / 2) - W / 2
        this.desk(g, dX, iY + W / 2)
        this.addChair(dX, iY + W * 1.5, iY + W * 2, 0)
        break
      }
    }
  }

  // ── Prop helpers ─────────────────────────────────────────────────────────
  private desk(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    const S = T
    g.fillStyle(0xb08040, 1); g.fillRect(x, y, S, S)
    g.fillStyle(0xd4a96a, 1); g.fillRect(x + 2, y + 2, S - 4, S - 6)
    g.fillStyle(0x1a1a2e, 1); g.fillRect(x + 6, y + 6, S - 14, S - 16)
    g.fillStyle(0x2a4a8a, 1); g.fillRect(x + 7, y + 7, S - 16, S - 18)
  }
  private chair(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    const S = T
    g.fillStyle(0x3a3a4a, 1); g.fillRect(x + 6, y + 2, S - 12, S - 10)
    g.fillStyle(0x4a4a5a, 1); g.fillRect(x + 5, y + 8, S - 10, S - 14)
    g.fillStyle(0x111111, 1)
    g.fillRect(x + 4, y + S - 8, 5, 4); g.fillRect(x + S - 9, y + S - 8, 5, 4)
  }
  private plant(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    const S = T
    g.fillStyle(0x8b4513, 1); g.fillRect(x + 10, y + S - 12, S - 20, 10)
    g.fillStyle(0x2d7a2d, 1); g.fillCircle(x + S / 2, y + S / 2 - 2, 10)
    g.fillStyle(0x1a5a1a, 1)
    g.fillCircle(x + S / 2 - 5, y + S / 2 + 2, 6); g.fillCircle(x + S / 2 + 5, y + S / 2 + 2, 6)
  }
  private bookshelf(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    const S = T
    g.fillStyle(0x8b6914, 1); g.fillRect(x + 1, y + 2, S - 2, S - 4)
    ;[0xc0392b, 0x27ae60, 0x2980b9, 0xf39c12, 0x8e44ad].forEach((c, i) => {
      g.fillStyle(c, 1); g.fillRect(x + 3 + i * 5, y + 5, 4, S - 12)
    })
  }
  private couch(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    const S = T
    g.fillStyle(0x5a6a7a, 1); g.fillRect(x + 2, y + 2, S - 4, S - 4)
    g.fillStyle(0x4a5a6a, 1); g.fillRect(x + 4, y + 10, S - 8, S - 14)
    g.fillStyle(0x5a6a7a, 1)
    g.fillRect(x + 2, y + 2, 5, S - 8); g.fillRect(x + S - 7, y + 2, 5, S - 8)
  }
  private tv(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    const S = T
    g.fillStyle(0x2a2a2a, 1); g.fillRect(x + 2, y + 4, S - 4, S - 10)
    g.fillStyle(0x1a3a6a, 1); g.fillRect(x + 4, y + 6, S - 8, S - 14)
    g.fillStyle(0x2a2a2a, 1); g.fillRect(x + S / 2 - 3, y + S - 8, 6, 5)
  }

  // ── Labels ────────────────────────────────────────────────────────────────
  private addLabels(room: RoomInstance) {
    const cfg = ROOM_CONFIGS[room.type]
    const cx  = room.px + room.pw / 2

    const badge = this.scene.add.text(
      cx, room.py + 6,
      `${cfg.emoji}  ${room.name}`,
      { fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 3, fontStyle: 'bold', resolution: 2 }
    ).setOrigin(0.5, 0).setDepth(6000)

    const sub = this.scene.add.text(
      cx, room.py + 20,
      cfg.label,
      { fontSize: '9px', color: '#aaccee', stroke: '#000000', strokeThickness: 2, resolution: 2 }
    ).setOrigin(0.5, 0).setDepth(6000)

    this.labels.set(room.id, { badge, sub })
  }
}
