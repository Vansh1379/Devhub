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

  // Placement cursor: rooms stack downward on the RIGHT side of the map
  // Each room's left wall is flush with the right edge of the main map,
  // connected by a corridor gap.
  private nextAttachY = T * 4  // start 4 tiles from top of map right edge

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.gfx = scene.add.graphics().setDepth(10)
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

  renameRoom(id: string, newName: string) {
    const r = this.rooms.find(r => r.id === id)
    if (!r) return
    r.name = newName
    const l = this.labels.get(id)
    if (l) l.badge.setText(`${ROOM_CONFIGS[r.type].emoji}  ${newName}`)
  }

  // ── Draw corridor floor + walls ────────────────────────────────────────────
  // The corridor is drawn from INSIDE the Tiled map outward to the room wall.
  // This visually covers any wall tiles at the map right edge.
  // The scene will also create a physics sensor over this area to allow walking through.
  private drawCorridor(corridor: CorridorBounds, corridorY: number) {
    const g    = this.gfx
    const cX   = corridor.x
    const cY   = corridorY
    const cW   = corridor.w
    const WALL_LIGHT = 0xfafafa
    const WALL_TOP   = 0x8fa8b8

    // ── Floor strip (covers the Tiled right-wall visually) ──
    g.fillStyle(0xd4cfc9, 1)
    g.fillRect(cX, cY, cW, CORRIDOR_W)

    // ── Tile grid on floor ──
    g.lineStyle(1, 0x000000, 0.06)
    for (let x = cX; x < cX + cW; x += T) {
      g.strokeRect(x, cY,     T, T)
      g.strokeRect(x, cY + T, T, T)
    }

    // ── Top wall of corridor (above the opening) ──
    for (let x = cX; x < cX + cW; x += T) {
      g.fillStyle(WALL_LIGHT, 1); g.fillRect(x, cY - T, T, T)
      g.fillStyle(WALL_TOP,   1); g.fillRect(x, cY - T, T, 7)
      g.fillStyle(0x6b8299,   1); g.fillRect(x, cY - 4,  T, 4)   // shadow drop
    }

    // ── Bottom wall of corridor (below the opening) ──
    for (let x = cX; x < cX + cW; x += T) {
      g.fillStyle(WALL_LIGHT, 1); g.fillRect(x, cY + CORRIDOR_W, T, T)
      g.fillStyle(WALL_TOP,   1); g.fillRect(x, cY + CORRIDOR_W, T, 7)
    }

    // ── Door frame at the map edge (visual indicator) ──
    const doorX = MAP_W - T
    g.fillStyle(0xa07830, 1)
    g.fillRect(doorX, cY - T,          T, 6)  // top lintel
    g.fillRect(doorX, cY + CORRIDOR_W, T, 6)  // bottom sill
    // Gold knob
    g.fillStyle(0xffd700, 1)
    g.fillCircle(doorX + 6, cY + CORRIDOR_W / 2, 3)
  }

  // ── Draw room ──────────────────────────────────────────────────────────────
  private drawRoom(room: RoomInstance, corridorY: number) {
    const g = this.gfx
    const cfg = ROOM_CONFIGS[room.type]
    const { px, py, pw, ph } = room
    const W = T

    // ── Floor ──
    g.fillStyle(cfg.color, 1)
    g.fillRect(px + W, py + W, pw - W * 2, ph - W * 2)

    // Floor tile grid
    g.lineStyle(1, 0x000000, 0.06)
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
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const dx = iX + c * W * 3 + 4, dy = iY + r * W * 4 + W
            this.desk(g, dx, dy); this.chair(g, dx, dy + W)
          }
        break
      }
      case 'meeting': {
        const tx = iX + W, ty = iY + W * 2
        const tw = iW - W * 2, th = iH - W * 3
        g.fillStyle(0xd4a96a, 1); g.fillRect(tx, ty, tw, th)
        g.fillStyle(0xb08040, 1); g.fillRect(tx, ty, tw, 4); g.fillRect(tx, ty + th - 4, tw, 4)
        // Whiteboard on top wall
        const wX = iX + Math.floor(iW / 2) - W
        g.fillStyle(0xfafafa, 1); g.fillRect(wX, iY + 2, W * 2, W - 4)
        g.lineStyle(1, 0xbbbbbb, 1); g.strokeRect(wX, iY + 2, W * 2, W - 4)
        g.lineStyle(1, 0x4a90d9, 0.9)
        g.lineBetween(wX + 4, iY + W - 6, wX + 10, iY + 8)
        g.lineBetween(wX + 10, iY + 8, wX + 20, iY + 13)
        // Chairs around table
        for (let c = 0; c < Math.floor(tw / W); c++) {
          this.chair(g, tx + c * W, ty - W)
          this.chair(g, tx + c * W, ty + th)
        }
        this.chair(g, tx - W, ty + Math.floor(th / 2))
        this.chair(g, tx + tw, ty + Math.floor(th / 2))
        break
      }
      case 'boss': {
        const dX = iX + Math.floor(iW / 2 / W) * W - W
        this.desk(g, dX, iY + W); this.desk(g, dX + W, iY + W)
        this.chair(g, dX + W / 2, iY + W * 2)
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
        this.desk(g, dX, iY + W / 2); this.chair(g, dX, iY + W * 1.5)
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
