import Phaser from 'phaser'
import { RoomManager } from './RoomManager'
import type { RoomType, RoomInstance } from './RoomManager'
import { ROOM_CONFIGS } from './RoomManager'
export type { RoomType, RoomInstance } from './RoomManager'
export { ROOM_CONFIGS } from './RoomManager'

// ─── Constants ───────────────────────────────────────────────────────────────
export const CHARACTERS = ['adam', 'ash', 'lucy', 'nancy'] as const
export type CharacterName = (typeof CHARACTERS)[number]

const SPEED      = 200
const ZOOM_MAX   = 2.5
const ZOOM_LERP  = 0.1

// ─── Types ───────────────────────────────────────────────────────────────────
export interface OtherPlayer {
  userId: string
  socketId: string
  displayName: string
  x: number   // world-px X
  y: number
  z: number   // world-px Y (backend convention — z = map Y)
  direction: string
  avatar?: unknown
}

export type MoveCallback         = (worldX: number, worldY: number, anim: string) => void
export type ZoneCallback         = (zone: { roomId: string } | null) => void
export type RoomsChangedCallback = (rooms: { id: string; name: string }[]) => void

// ─── Meeting zones (pixel-space rectangles on the Tiled map) ─────────────────
interface MeetingZone { roomId: string; x: number; y: number; w: number; h: number }
const MEETING_ZONES: MeetingZone[] = [
  { roomId: 'room1', x: 896, y:  32, w: 384, h: 320 },
  { roomId: 'room2', x: 640, y: 640, w: 320, h: 256 },
]
function getZoneAt(wx: number, wy: number): MeetingZone | null {
  for (const z of MEETING_ZONES)
    if (wx >= z.x && wx <= z.x + z.w && wy >= z.y && wy <= z.y + z.h) return z
  return null
}

// ─── Animation registration (matches SkyOffice CharacterAnims.ts) ────────────
export function registerAnims(anims: Phaser.Animations.AnimationManager) {
  const FPS = 15
  for (const char of CHARACTERS) {
    // idle: frames 0-23 (6 per direction: right, up, left, down)
    ;(['right','up','left','down'] as const).forEach((dir, i) => {
      anims.create({
        key: `${char}_idle_${dir}`,
        frames: anims.generateFrameNumbers(char, { start: i*6, end: i*6+5 }),
        repeat: -1, frameRate: FPS * 0.6,
      })
    })
    // run: frames 24-47
    ;(['right','up','left','down'] as const).forEach((dir, i) => {
      anims.create({
        key: `${char}_run_${dir}`,
        frames: anims.generateFrameNumbers(char, { start: 24+i*6, end: 24+i*6+5 }),
        repeat: -1, frameRate: FPS,
      })
    })
    // sit: frames 48-51
    anims.create({ key: `${char}_sit_down`,  frames: anims.generateFrameNumbers(char,{start:48,end:48}), repeat:0, frameRate:FPS })
    anims.create({ key: `${char}_sit_left`,  frames: anims.generateFrameNumbers(char,{start:49,end:49}), repeat:0, frameRate:FPS })
    anims.create({ key: `${char}_sit_right`, frames: anims.generateFrameNumbers(char,{start:50,end:50}), repeat:0, frameRate:FPS })
    anims.create({ key: `${char}_sit_up`,    frames: anims.generateFrameNumbers(char,{start:51,end:51}), repeat:0, frameRate:FPS })
  }
}

// ─── Scene ───────────────────────────────────────────────────────────────────
export class OfficeScene extends Phaser.Scene {
  // self
  private selfSprite!: Phaser.Physics.Arcade.Sprite
  private selfNameText!: Phaser.GameObjects.Text
  private selfChar: CharacterName = 'adam'
  private selfDisplayName = 'Me'
  private lastAnim = 'adam_idle_down'

  // others
  private otherSprites = new Map<string, {
    sprite: Phaser.Physics.Arcade.Sprite
    nameText: Phaser.GameObjects.Text
    dialogText: Phaser.GameObjects.Text
    targetX: number
    targetY: number
    char: CharacterName
    data: OtherPlayer
  }>()

  // input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: { W: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key }

  // zoom — starts at zoom-to-fit, updated in create()
  private targetZoom = 1
  private zoomFit    = 1   // zoom that makes the full map fill the screen width
  private pinchDist: number | null = null

  // map dimensions (set in create)
  private mapW = 1280
  private mapH = 960
  private isFollowing = true

  // dynamic rooms
  private roomManager!: RoomManager
  private roomIdCounter = 0
  private groundLayer!: Phaser.Tilemaps.TilemapLayer

  // callbacks
  onMove?: MoveCallback
  onZoneChange?: ZoneCallback
  onRoomsChanged?: (rooms: RoomInstance[]) => void

  private lastZoneId: string | null = null

  constructor() { super({ key: 'OfficeScene' }) }

  // ── Public setters (from React) ───────────────────────────────────────────
  setDisplayName(name: string) {
    this.selfDisplayName = name
    if (this.selfNameText) this.selfNameText.setText(name)
  }
  setCharacter(char: CharacterName) {
    this.selfChar = char
    if (this.selfSprite) { this.selfSprite.setTexture(char); this.selfSprite.play(`${char}_idle_down`, true) }
  }

  // ── Preload ──────────────────────────────────────────────────────────────
  preload() {
    this.load.tilemapTiledJSON('tilemap', '/assets/map/map.json')
    this.load.spritesheet('tiles_wall','/assets/map/FloorAndGround.png',{ frameWidth:32, frameHeight:32 })
    this.load.spritesheet('office',    '/assets/tileset/Modern_Office_Black_Shadow.png',{ frameWidth:32, frameHeight:32 })
    this.load.spritesheet('generic',   '/assets/tileset/Generic.png',  { frameWidth:32, frameHeight:32 })
    this.load.spritesheet('basement',  '/assets/tileset/Basement.png', { frameWidth:32, frameHeight:32 })
    this.load.spritesheet('chairs',        '/assets/items/chair.png',        { frameWidth:32, frameHeight:64 })
    this.load.spritesheet('computers',     '/assets/items/computer.png',     { frameWidth:96, frameHeight:64 })
    this.load.spritesheet('whiteboards',   '/assets/items/whiteboard.png',   { frameWidth:64, frameHeight:64 })
    this.load.spritesheet('vendingmachines','/assets/items/vendingmachine.png',{ frameWidth:48, frameHeight:72 })
    for (const char of CHARACTERS)
      this.load.spritesheet(char, `/assets/character/${char}.png`, { frameWidth:32, frameHeight:48 })
  }

  // Zoom that makes the full map fit entirely inside the viewport (both axes)
  private calcZoomFit(): number {
    const zx = this.scale.width  / this.mapW
    const zy = this.scale.height / this.mapH
    return Math.min(zx, zy) * 0.96 // 4% padding so edges don't clip
  }

  // ── Create ───────────────────────────────────────────────────────────────
  create() {
    registerAnims(this.anims)

    const map = this.make.tilemap({ key: 'tilemap' })
    const floorTs = map.addTilesetImage('FloorAndGround', 'tiles_wall')!
    this.groundLayer = map.createLayer('Ground', floorTs)!
    this.groundLayer.setCollisionByProperty({ collides: true })
    const groundLayer = this.groundLayer

    // Static object layers
    const vendGroup = this.buildObjectLayer(map, 'Wall',                 'tiles_wall','FloorAndGround',false)
    this.buildObjectLayer(map, 'Objects',            'office',    'Modern_Office_Black_Shadow', false)
    this.buildObjectLayer(map, 'ObjectsOnCollide',   'office',    'Modern_Office_Black_Shadow', true)
    this.buildObjectLayer(map, 'GenericObjects',     'generic',   'Generic',  false)
    this.buildObjectLayer(map, 'GenericObjectsOnCollide','generic','Generic', true)
    this.buildObjectLayer(map, 'Basement',           'basement',  'Basement', true)
    this.buildObjectLayer(map, 'Chair',              'chairs',    'chair',    false)
    this.buildObjectLayer(map, 'Computer',           'computers', 'computer', false)
    this.buildObjectLayer(map, 'Whiteboard',         'whiteboards','whiteboard',false)
    const vmGroup = this.buildObjectLayer(map, 'VendingMachine','vendingmachines','vendingmachine', true)

    // Self sprite
    this.selfSprite = this.physics.add.sprite(705, 500, this.selfChar)
    this.selfSprite.setDepth(this.selfSprite.y)
    this.selfSprite.setCollideWorldBounds(true)
    const body = this.selfSprite.body as Phaser.Physics.Arcade.Body
    body.setSize(this.selfSprite.width * 0.5, this.selfSprite.height * 0.2)
    body.setOffset(this.selfSprite.width * 0.25, this.selfSprite.height * 0.8)
    this.selfSprite.play(`${this.selfChar}_idle_down`, true)

    this.selfNameText = this.add.text(0, 0, this.selfDisplayName, {
      fontSize: '11px', color: '#111111', stroke: '#ffffff', strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5, 1).setDepth(5001)

    // Collisions
    this.physics.add.collider(this.selfSprite, groundLayer)
    if (vmGroup) this.physics.add.collider(this.selfSprite, vmGroup)

    // Store map size for centering logic
    this.mapW = map.widthInPixels
    this.mapH = map.heightInPixels

    // Dynamic room manager (renders custom rooms below the Tiled map)
    this.roomManager = new RoomManager(this)

    // Physics world starts at map size, expands as rooms are added
    this.physics.world.setBounds(0, 0, this.mapW, this.mapH)

    // Camera — NO setBounds so we can freely center the map
    // Fit the ENTIRE map inside the viewport (both axes), with 4% padding
    this.zoomFit    = this.calcZoomFit()
    this.targetZoom = this.zoomFit

    this.cameras.main.setZoom(this.zoomFit)
    this.cameras.main.centerOn(this.mapW / 2, this.mapH / 2)
    this.isFollowing = false

    // Recalculate on resize
    this.scale.on('resize', () => {
      this.zoomFit = this.calcZoomFit()
      if (!this.isFollowing) this.targetZoom = this.zoomFit
    })

    // Input
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasd = this.input.keyboard!.addKeys('W,S,A,D') as typeof this.wasd

    // Zoom events
    this.input.on('wheel', (_p:unknown,_o:unknown,_dx:number,dy:number) => {
      this.targetZoom = Phaser.Math.Clamp(this.targetZoom * (dy > 0 ? 0.9 : 1.1), this.zoomFit, ZOOM_MAX)
    })
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1, p2 = this.input.pointer2
      if (p1.isDown && p2.isDown) {
        const d = Math.hypot(p1.x-p2.x, p1.y-p2.y)
        if (this.pinchDist != null)
          this.targetZoom = Phaser.Math.Clamp(this.targetZoom * (d/this.pinchDist), this.zoomFit, ZOOM_MAX)
        this.pinchDist = d; void ptr
      } else { this.pinchDist = null }
    })
    this.input.keyboard!.on('keydown-PLUS',  () => this.zoomBy(1.15))
    this.input.keyboard!.on('keydown-MINUS', () => this.zoomBy(0.87))
    this.input.keyboard!.on('keydown-EQUAL', () => this.zoomBy(1.15))
    this.input.keyboard!.on('keydown-ZERO',  () => { this.targetZoom = this.zoomFit })

    void vendGroup
  }

  // ── Object layer builder ─────────────────────────────────────────────────
  private buildObjectLayer(
    map: Phaser.Tilemaps.Tilemap,
    layerName: string,
    textureKey: string,
    tilesetName: string,
    collidable: boolean
  ): Phaser.Physics.Arcade.StaticGroup | null {
    const layer = map.getObjectLayer(layerName)
    if (!layer) return null
    const tileset = map.getTileset(tilesetName)
    if (!tileset) return null
    const group = this.physics.add.staticGroup()
    layer.objects.forEach((obj) => {
      if (obj.gid == null) return
      const x = obj.x! + obj.width!  * 0.5
      const y = obj.y! - obj.height! * 0.5
      group.get(x, y, textureKey, obj.gid - tileset.firstgid).setDepth(y)
    })
    if (collidable && this.selfSprite)
      this.physics.add.collider(this.selfSprite, group)
    return group
  }

  // ── Public zoom API ──────────────────────────────────────────────────────
  // ── Dynamic Room API (called from React) ──────────────────────────────────
  addRoom(type: RoomType, name: string): RoomInstance {
    const id   = `dyn_${++this.roomIdCounter}`
    const room = this.roomManager.addRoom(id, name, type)
    const cor  = room.corridor

    // ── Punch a walkable corridor through the Tiled right-wall collision ──
    // 1. Remove collision tiles in the ground layer at the corridor passage
    if (this.groundLayer) {
      const tileSize = 32
      const startTileX = Math.floor(cor.x / tileSize)
      const endTileX   = Math.floor((cor.x + cor.w) / tileSize)
      const startTileY = Math.floor(cor.y / tileSize)
      const endTileY   = Math.ceil((cor.y + cor.h) / tileSize)
      for (let tx = startTileX; tx <= endTileX; tx++) {
        for (let ty = startTileY; ty < endTileY; ty++) {
          const tile = this.groundLayer.getTileAt(tx, ty)
          if (tile) tile.setCollision(false, false, false, false)
        }
      }
    }

    // 2. Add a static transparent zone in the room's walkable area so the
    //    player's collideWorldBounds doesn't trap them at MAP_W boundary
    this.physics.world.setBounds(0, 0, 99999, 99999)  // temporarily unlimited
    this.selfSprite?.setCollideWorldBounds(false)      // disable world bounds clamp

    // Expand physics + camera world
    const bounds = this.roomManager.getWorldBounds()
    this.physics.world.setBounds(0, 0, bounds.w + 512, bounds.h + 512)

    // Update map size so zoom-to-fit recalculates correctly
    this.mapW = bounds.w
    this.mapH = Math.max(this.mapH, bounds.h)
    this.zoomFit    = this.calcZoomFit()
    this.targetZoom = this.zoomFit

    this.onRoomsChanged?.(this.roomManager.getRooms())
    return room
  }

  renameRoom(id: string, newName: string) {
    this.roomManager.renameRoom(id, newName)
    this.onRoomsChanged?.(this.roomManager.getRooms())
  }

  getRooms(): RoomInstance[] {
    return this.roomManager?.getRooms() ?? []
  }

  zoomBy(f: number) { this.targetZoom = Phaser.Math.Clamp(this.targetZoom * f, this.zoomFit, ZOOM_MAX) }
  zoomTo(v: number) { this.targetZoom = Phaser.Math.Clamp(v, this.zoomFit, ZOOM_MAX) }
  zoomToFit()       { this.targetZoom = this.zoomFit }
  getZoom()         { return this.cameras.main.zoom }

  // ── Other player API ──────────────────────────────────────────────────────
  setOtherPlayers(players: OtherPlayer[]) {
    if (!this.scene.isActive()) return
    const seen = new Set<string>()
    for (const p of players) {
      seen.add(p.socketId)
      if (this.otherSprites.has(p.socketId)) {
        const e = this.otherSprites.get(p.socketId)!
        e.targetX = p.x; e.targetY = p.z; e.data = p
        e.nameText.setText(p.displayName)
        this.playOtherAnim(e, p.direction)
      } else {
        this.spawnOther(p)
      }
    }
    this.otherSprites.forEach((e, id) => {
      if (!seen.has(id)) { e.sprite.destroy(); e.nameText.destroy(); e.dialogText.destroy(); this.otherSprites.delete(id) }
    })
  }

  removeOtherPlayer(socketId: string) {
    const e = this.otherSprites.get(socketId)
    if (e) { e.sprite.destroy(); e.nameText.destroy(); e.dialogText.destroy(); this.otherSprites.delete(socketId) }
  }

  updateOtherPlayer(socketId: string, x: number, z: number, direction: string, displayName: string) {
    const e = this.otherSprites.get(socketId)
    if (!e) return
    e.targetX = x; e.targetY = z
    e.data.direction = direction
    e.nameText.setText(displayName)
    this.playOtherAnim(e, direction)
  }

  showDialogBubble(socketId: string, content: string) {
    const e = this.otherSprites.get(socketId)
    if (!e) return
    e.dialogText.setText(content).setVisible(true)
    this.time.delayedCall(6000, () => e.dialogText.setVisible(false))
  }

  teleportSelf(worldX: number, worldY: number) {
    if (!this.selfSprite) return
    this.selfSprite.setPosition(worldX, worldY)
  }

  // ── Internals ─────────────────────────────────────────────────────────────
  private spawnOther(p: OtherPlayer) {
    // Cycle through non-adam characters for visual variety
    const chars: CharacterName[] = ['ash', 'lucy', 'nancy']
    const char = chars[this.otherSprites.size % chars.length]
    const sprite = this.physics.add.sprite(p.x, p.z, char)
    sprite.setDepth(p.z).play(`${char}_idle_down`, true)
    const nameText = this.add.text(p.x, p.z - 30, p.displayName, {
      fontSize: '11px', color: '#111111', stroke: '#ffffff', strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5, 1).setDepth(5001)
    const dialogText = this.add.text(p.x, p.z - 52, '', {
      fontSize: '10px', color: '#000000',
      backgroundColor: '#ffffffdd',
      padding: { x: 4, y: 2 },
      wordWrap: { width: 160 },
    }).setOrigin(0.5, 1).setDepth(5002).setVisible(false)
    this.otherSprites.set(p.socketId, { sprite, nameText, dialogText, targetX: p.x, targetY: p.z, char, data: p })
  }

  private playOtherAnim(
    e: { sprite: Phaser.Physics.Arcade.Sprite; char: CharacterName },
    direction: string
  ) {
    if (!direction) return
    // direction may be a full anim key like 'adam_run_right', or just 'down'
    let key: string
    if (direction.includes('_run_') || direction.includes('_idle_'))
      key = direction.replace(/^[a-z]+_/, `${e.char}_`) // swap character prefix
    else
      key = `${e.char}_idle_${direction}`
    if (e.sprite.anims.currentAnim?.key !== key) e.sprite.play(key, true)
  }

  // ── Game loop ─────────────────────────────────────────────────────────────
  update() {
    if (!this.selfSprite || !this.cursors) return

    // Smooth zoom lerp
    const cam = this.cameras.main
    const cz = cam.zoom
    const newZoom = Math.abs(cz - this.targetZoom) > 0.0005
      ? cz + (this.targetZoom - cz) * ZOOM_LERP
      : this.targetZoom
    cam.setZoom(newZoom)

    // Determine if we are in "overview" mode (zoom at or near zoomFit)
    const atFit = this.targetZoom <= this.zoomFit + 0.05

    if (atFit) {
      // Stop following player — center the camera on the map midpoint
      if (this.isFollowing) {
        cam.stopFollow()
        this.isFollowing = false
      }
      // Center on map (no bounds, so scrollX/Y can go anywhere)
      const cx = this.mapW / 2 - cam.width  / (2 * newZoom)
      const cy = this.mapH / 2 - cam.height / (2 * newZoom)
      cam.scrollX += (cx - cam.scrollX) * 0.1
      cam.scrollY += (cy - cam.scrollY) * 0.1
    } else {
      // Resume following the player when zoomed in
      if (!this.isFollowing) {
        cam.startFollow(this.selfSprite, true, 0.1, 0.1)
        cam.setBounds(0, 0, this.mapW, this.mapH)
        this.isFollowing = true
      }
    }

    // Velocity
    let vx = 0, vy = 0
    if (this.cursors.left.isDown  || this.wasd.A.isDown) vx -= SPEED
    if (this.cursors.right.isDown || this.wasd.D.isDown) vx += SPEED
    if (this.cursors.up.isDown    || this.wasd.W.isDown) vy -= SPEED
    if (this.cursors.down.isDown  || this.wasd.S.isDown) vy += SPEED

    this.selfSprite.setVelocity(vx, vy)
    if (vx !== 0 || vy !== 0)
      (this.selfSprite.body as Phaser.Physics.Arcade.Body).velocity.setLength(SPEED)
    this.selfSprite.setDepth(this.selfSprite.y)

    // Animation
    let newAnim: string
    if      (vx > 0) newAnim = `${this.selfChar}_run_right`
    else if (vx < 0) newAnim = `${this.selfChar}_run_left`
    else if (vy < 0) newAnim = `${this.selfChar}_run_up`
    else if (vy > 0) newAnim = `${this.selfChar}_run_down`
    else             newAnim = this.lastAnim.replace('_run_', '_idle_')

    if (newAnim !== this.selfSprite.anims.currentAnim?.key)
      this.selfSprite.play(newAnim, true)
    this.lastAnim = newAnim

    // Name tag
    this.selfNameText.setPosition(this.selfSprite.x, this.selfSprite.y - this.selfSprite.height * 0.5 - 2)

    // Emit move to React / socket
    if (vx !== 0 || vy !== 0)
      this.onMove?.(this.selfSprite.x, this.selfSprite.y, newAnim)

    // Meeting zone: check static Tiled zones first, then dynamic rooms
    const staticZone = getZoneAt(this.selfSprite.x, this.selfSprite.y)
    const dynRoom    = this.roomManager?.getRoomAt(this.selfSprite.x, this.selfSprite.y)
    const dynZone    = dynRoom && ROOM_CONFIGS[dynRoom.type].isMeetingZone
      ? { roomId: dynRoom.id }
      : null
    const zone    = staticZone ?? dynZone
    const zoneId  = zone?.roomId ?? null
    if (zoneId !== this.lastZoneId) {
      this.lastZoneId = zoneId
      this.onZoneChange?.(zone ?? null)
    }

    // Interpolate other players
    this.otherSprites.forEach((e) => {
      e.sprite.x += (e.targetX - e.sprite.x) * 0.15
      e.sprite.y += (e.targetY - e.sprite.y) * 0.15
      e.sprite.setDepth(e.sprite.y)
      e.nameText.setPosition(e.sprite.x, e.sprite.y - e.sprite.height * 0.5 - 2)
      e.dialogText.setPosition(e.sprite.x, e.sprite.y - e.sprite.height * 0.5 - 22)
    })
  }
}
