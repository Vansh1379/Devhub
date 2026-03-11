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
const MAP_W      = 1280   // pixel width of the Tiled map

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
export type ChairNearCallback    = (near: boolean) => void

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

// ─── Teleport zone ────────────────────────────────────────────────────────────
interface TeleportZone {
  // trigger rect: player x/y inside this triggers a warp
  triggerX: number; triggerY: number; triggerW: number; triggerH: number
  // destination: where to place the player after warping
  destX: number; destY: number
  // return trigger (inside room → back to map)
  returnX: number; returnY: number; returnW: number; returnH: number
  returnDestX: number; returnDestY: number
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

  // zoom
  private targetZoom = 1
  private zoomFit    = 1
  private pinchDist: number | null = null

  // map dimensions
  private mapW = 1280
  private mapH = 960
  private isFollowing = true

  // dynamic rooms
  private roomManager!: RoomManager
  private roomIdCounter = 0
  private groundLayer!: Phaser.Tilemaps.TilemapLayer

  // teleport zones for dynamic rooms
  private teleportZones: TeleportZone[] = []
  private teleportCooldown = false

  // chair interaction
  private chairPositions: Array<{ x: number; y: number; frame: number }> = []
  private isSitting = false
  private wasNearChair = false
  private eKey!: Phaser.Input.Keyboard.Key

  // callbacks
  onMove?: MoveCallback
  onZoneChange?: ZoneCallback
  onRoomsChanged?: (rooms: RoomInstance[]) => void
  onChairNear?: ChairNearCallback

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

  private calcZoomFit(): number {
    const zx = this.scale.width  / this.mapW
    const zy = this.scale.height / this.mapH
    return Math.min(zx, zy) * 0.96
  }

  // ── Create ───────────────────────────────────────────────────────────────
  create() {
    registerAnims(this.anims)

    const map = this.make.tilemap({ key: 'tilemap' })
    const floorTs = map.addTilesetImage('FloorAndGround', 'tiles_wall')!
    this.groundLayer = map.createLayer('Ground', floorTs)!
    this.groundLayer.setCollisionByProperty({ collides: true })
    const groundLayer = this.groundLayer

    // Static object layers — all built before selfSprite exists,
    // so collidable groups are captured and wired up below after selfSprite creation.
    this.buildObjectLayer(map, 'Wall',                     'tiles_wall',    'FloorAndGround',              false)
    this.buildObjectLayer(map, 'Objects',                  'office',        'Modern_Office_Black_Shadow',   false)
    const officeColGroup  = this.buildObjectLayer(map, 'ObjectsOnCollide',         'office',    'Modern_Office_Black_Shadow', false)
    this.buildObjectLayer(map, 'GenericObjects',           'generic',       'Generic',                     false)
    const genericColGroup = this.buildObjectLayer(map, 'GenericObjectsOnCollide',  'generic',   'Generic',                   false)
    const basementGroup   = this.buildObjectLayer(map, 'Basement',                 'basement',  'Basement',                  false)
    const chairGroup      = this.buildObjectLayer(map, 'Chair',                    'chairs',    'chair',                     false)
    const computerGroup   = this.buildObjectLayer(map, 'Computer',                 'computers', 'computer',                  false)
    const whiteboardGroup = this.buildObjectLayer(map, 'Whiteboard',               'whiteboards','whiteboard',               false)
    const vmGroup         = this.buildObjectLayer(map, 'VendingMachine',           'vendingmachines','vendingmachine',        false)

    // Self sprite
    this.selfSprite = this.physics.add.sprite(705, 500, this.selfChar)
    this.selfSprite.setDepth(this.selfSprite.y)
    this.selfSprite.setCollideWorldBounds(false)
    const body = this.selfSprite.body as Phaser.Physics.Arcade.Body
    body.setSize(this.selfSprite.width * 0.5, this.selfSprite.height * 0.2)
    body.setOffset(this.selfSprite.width * 0.25, this.selfSprite.height * 0.8)
    this.selfSprite.play(`${this.selfChar}_idle_down`, true)

    this.selfNameText = this.add.text(0, 0, this.selfDisplayName, {
      fontSize: '11px', color: '#111111', stroke: '#ffffff', strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5, 1).setDepth(5001)

    // Resize item physics bodies to cover the visible object area so the player
    // cannot walk through seats/desks from any direction.
    // The body top is placed just below the decorative "back" of each object
    // so players can walk behind chairs but cannot enter the seat/body area.
    // Args: group, bodyW, bodyH, offsetX, offsetY (relative to sprite top-left)
    this.shrinkGroupBodies(chairGroup,      22, 36,  5, 20)   // 32×64: covers seat+legs
    this.shrinkGroupBodies(computerGroup,   80, 40,  8, 16)   // 96×64: covers monitor body
    this.shrinkGroupBodies(whiteboardGroup, 52, 48,  6, 12)   // 64×64: covers board face
    this.shrinkGroupBodies(vmGroup,         38, 56,  5,  8)   // 48×72: covers machine body

    // Collisions — all wired after selfSprite exists
    this.physics.add.collider(this.selfSprite, groundLayer)
    for (const g of [officeColGroup, genericColGroup, basementGroup, chairGroup, computerGroup, whiteboardGroup, vmGroup]) {
      if (g) this.physics.add.collider(this.selfSprite, g)
    }

    // Store map size for centering logic
    this.mapW = map.widthInPixels
    this.mapH = map.heightInPixels

    // Dynamic room manager
    this.roomManager = new RoomManager(this)

    // Physics world — generous bounds
    this.physics.world.setBounds(0, 0, this.mapW, this.mapH)

    // Camera
    this.zoomFit    = this.calcZoomFit()
    this.targetZoom = this.zoomFit
    this.cameras.main.setZoom(this.zoomFit)
    this.cameras.main.centerOn(this.mapW / 2, this.mapH / 2)
    this.isFollowing = false

    this.scale.on('resize', () => {
      this.zoomFit = this.calcZoomFit()
      if (!this.isFollowing) this.targetZoom = this.zoomFit
    })

    // Collect chair positions + frame (encodes facing direction) from Tiled object layer
    const chairLayer   = map.getObjectLayer('Chair')
    const chairTileset = map.getTileset('chair')
    if (chairLayer) {
      for (const obj of chairLayer.objects) {
        if (obj.x != null && obj.y != null) {
          const frame = (obj.gid != null && chairTileset)
            ? obj.gid - chairTileset.firstgid
            : 0
          this.chairPositions.push({
            x: obj.x + (obj.width  ?? 32) * 0.5,
            y: obj.y - (obj.height ?? 32) * 0.5,
            frame,
          })
        }
      }
    }

    // Input
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasd    = this.input.keyboard!.addKeys('W,S,A,D') as typeof this.wasd
    this.eKey    = this.input.keyboard!.addKey('E')

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

  // ── Shrink static group physics bodies to a thin base strip ──────────────
  // Keeps objects solid at foot-level only so players can walk close without
  // being blocked from above by the tall sprite bounding box.
  private shrinkGroupBodies(
    group: Phaser.Physics.Arcade.StaticGroup | null,
    bodyW: number,   // desired physics body width
    bodyH: number,   // desired physics body height (small, foot-level strip)
    offsetX: number, // x offset from sprite origin to body left edge
    offsetY: number  // y offset from sprite origin to body top edge
  ) {
    if (!group) return
    group.getChildren().forEach((child) => {
      const sprite = child as Phaser.Physics.Arcade.Sprite
      const body   = sprite.body as Phaser.Physics.Arcade.StaticBody
      body.setSize(bodyW, bodyH)
      body.setOffset(offsetX, offsetY)
    })
    group.refresh()
  }

  // ── Dynamic Room API ──────────────────────────────────────────────────────
  addRoom(type: RoomType, name: string): RoomInstance {
    const id   = `dyn_${++this.roomIdCounter}`
    const room = this.roomManager.addRoom(id, name, type)
    const cor  = room.corridor

    // Expand physics world to include the new room
    this.physics.world.setBounds(0, 0, room.px + room.pw + 512, this.mapH + room.py + room.ph + 512)

    // Update map size so zoom-to-fit recalculates correctly
    const bounds = this.roomManager.getWorldBounds()
    this.mapW = bounds.w
    this.mapH = Math.max(this.mapH, bounds.h)
    this.zoomFit    = this.calcZoomFit()
    this.targetZoom = this.zoomFit

    // ── Clear tile collisions in the corridor strip ───────────────────────
    // The Tiled ground layer marks right-wall tiles as collides=true which
    // physically blocks the player. Remove collision only in the corridor opening
    // so the player can walk through into the room.
    const TILE = 32
    const tileY1 = Math.floor(cor.y / TILE)
    const tileY2 = Math.ceil((cor.y + cor.h) / TILE)
    const tileX1 = Math.floor(cor.x / TILE)
    const tileX2 = Math.ceil(MAP_W / TILE)
    for (let tx = tileX1; tx <= tileX2; tx++) {
      for (let ty = tileY1; ty <= tileY2; ty++) {
        const tile = this.groundLayer.getTileAt(tx, ty)
        if (tile) tile.setCollision(false, false, false, false)
      }
    }

    // ── Expand camera bounds if already in follow mode ────────────────────
    if (this.isFollowing) {
      this.cameras.main.setBounds(0, 0, this.mapW, this.mapH)
    }

    // ── Register teleport zone instead of fighting tile collisions ────────
    // Trigger: player walks right into the corridor at map edge (x near MAP_W)
    // They get teleported to inside the room.
    // NOTE: entry destination must be PAST the return trigger zone to avoid
    // the player immediately bouncing back out after arrival.
    const roomInteriorX = room.px + TILE * 5  // 5 tiles into room, well past return trigger
    const corridorMidY  = cor.y + cor.h / 2

    const zone: TeleportZone = {
      // entry trigger: a strip straddling MAP_W (map → room)
      triggerX: MAP_W - 16,
      triggerY: cor.y - 4,
      triggerW: 32,
      triggerH: cor.h + 8,
      destX: roomInteriorX,
      destY: corridorMidY,
      // return trigger: first 2 tiles of room interior (left wall opening)
      // Must NOT overlap with entry destination (room.px + TILE*5)
      returnX: room.px + TILE,
      returnY: cor.y - 4,
      returnW: TILE * 2,
      returnH: cor.h + 8,
      returnDestX: MAP_W - 80,
      returnDestY: corridorMidY,
    }
    this.teleportZones.push(zone)

    // ── Register chairs placed inside this room for the sit system ───────
    for (const c of this.roomManager.getDynChairPositions()) {
      if (!this.chairPositions.some(p => p.x === c.x && p.y === c.y))
        this.chairPositions.push(c)
    }

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
    let key: string
    if (direction.includes('_run_') || direction.includes('_idle_'))
      key = direction.replace(/^[a-z]+_/, `${e.char}_`)
    else
      key = `${e.char}_idle_${direction}`
    if (e.sprite.anims.currentAnim?.key !== key) e.sprite.play(key, true)
  }

  // ── Chair frame → sit direction ───────────────────────────────────────────
  // chair.png layout (32×64 per frame): 0=down, 1=up, 2=left, 3=right
  private chairDir(frame: number): 'down' | 'up' | 'left' | 'right' {
    if (frame === 1) return 'up'
    if (frame === 2) return 'left'
    if (frame === 3) return 'right'
    return 'down'
  }

  // ── Sit / stand ───────────────────────────────────────────────────────────
  private sitDown(chair: { x: number; y: number; frame: number }) {
    this.isSitting = true
    const dir = this.chairDir(chair.frame)

    // Snap player onto the chair seat
    this.selfSprite.setPosition(chair.x, chair.y)
    this.selfSprite.setVelocity(0, 0)

    this.selfSprite.play(`${this.selfChar}_sit_${dir}`, true)
    // Keep lastAnim pointed at the chair direction so standUp resumes correctly
    this.lastAnim = `${this.selfChar}_idle_${dir}`
  }

  private standUp() {
    this.isSitting = false
    // lastAnim was set to the chair direction in sitDown — resume idle that way
    const idleAnim = this.lastAnim.replace('_run_', '_idle_')
    this.selfSprite.play(idleAnim, true)
    this.lastAnim = idleAnim
    this.onChairNear?.(this.wasNearChair)
  }

  // ── Teleport check ────────────────────────────────────────────────────────
  private checkTeleports() {
    if (!this.selfSprite || this.teleportCooldown || this.teleportZones.length === 0) return
    const px = this.selfSprite.x
    const py = this.selfSprite.y

    for (const z of this.teleportZones) {
      // Entry: map → room
      if (
        px >= z.triggerX && px <= z.triggerX + z.triggerW &&
        py >= z.triggerY && py <= z.triggerY + z.triggerH
      ) {
        this.selfSprite.setPosition(z.destX, z.destY)
        this.selfSprite.setVelocity(0, 0)
        this.startTeleportCooldown()
        return
      }
      // Return: room → map
      if (
        px >= z.returnX && px <= z.returnX + z.returnW &&
        py >= z.returnY && py <= z.returnY + z.returnH
      ) {
        this.selfSprite.setPosition(z.returnDestX, z.returnDestY)
        this.selfSprite.setVelocity(0, 0)
        this.startTeleportCooldown()
        return
      }
    }
  }

  private startTeleportCooldown() {
    this.teleportCooldown = true
    // If zoomed out (fit mode), zoom in so the camera enters follow mode and
    // tracks the player into/out of the room.
    if (!this.isFollowing) {
      this.targetZoom = Phaser.Math.Clamp(this.zoomFit * 2, this.zoomFit, ZOOM_MAX)
    }
    this.time.delayedCall(400, () => { this.teleportCooldown = false })
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

    const atFit = this.targetZoom <= this.zoomFit + 0.05

    if (atFit) {
      if (this.isFollowing) {
        cam.stopFollow()
        this.isFollowing = false
      }
      const cx = this.mapW / 2 - cam.width  / (2 * newZoom)
      const cy = this.mapH / 2 - cam.height / (2 * newZoom)
      cam.scrollX += (cx - cam.scrollX) * 0.1
      cam.scrollY += (cy - cam.scrollY) * 0.1
    } else {
      if (!this.isFollowing) {
        cam.startFollow(this.selfSprite, true, 0.1, 0.1)
        cam.setBounds(0, 0, this.mapW, this.mapH)
        this.isFollowing = true
      }
    }

    // ── Chair proximity — find nearest chair within radius ───────────────
    const px = this.selfSprite.x, py = this.selfSprite.y
    const CHAIR_RADIUS = 40
    const nearby = this.chairPositions.filter(
      c => Math.abs(c.x - px) < CHAIR_RADIUS && Math.abs(c.y - py) < CHAIR_RADIUS
    )
    const nearestChair = nearby.sort(
      (a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py)
    )[0] ?? null
    const nearChair = nearestChair !== null
    if (nearChair !== this.wasNearChair) {
      this.wasNearChair = nearChair
      if (!nearChair && this.isSitting) this.standUp()
      this.onChairNear?.(nearChair)
    }

    // ── E key: sit / stand (only when not in a meeting zone) ─────────────
    if (Phaser.Input.Keyboard.JustDown(this.eKey) && this.lastZoneId === null) {
      if (this.isSitting) {
        this.standUp()
      } else if (nearestChair) {
        this.sitDown(nearestChair)
      }
    }

    // ── Velocity (blocked while sitting) ─────────────────────────────────
    let vx = 0, vy = 0
    if (!this.isSitting) {
      if (this.cursors.left.isDown  || this.wasd.A.isDown) vx -= SPEED
      if (this.cursors.right.isDown || this.wasd.D.isDown) vx += SPEED
      if (this.cursors.up.isDown    || this.wasd.W.isDown) vy -= SPEED
      if (this.cursors.down.isDown  || this.wasd.S.isDown) vy += SPEED
    }

    // Any movement key while sitting → stand up
    if (this.isSitting && (vx !== 0 || vy !== 0)) this.standUp()

    this.selfSprite.setVelocity(vx, vy)
    if (vx !== 0 || vy !== 0)
      (this.selfSprite.body as Phaser.Physics.Arcade.Body).velocity.setLength(SPEED)
    this.selfSprite.setDepth(this.selfSprite.y)

    // ── Animation ─────────────────────────────────────────────────────────
    let newAnim: string
    if (this.isSitting) {
      // Keep sitting anim — sitDown() already set it, don't override
      newAnim = this.selfSprite.anims.currentAnim?.key ?? `${this.selfChar}_sit_down`
    } else if (vx > 0) newAnim = `${this.selfChar}_run_right`
    else if (vx < 0)   newAnim = `${this.selfChar}_run_left`
    else if (vy < 0)   newAnim = `${this.selfChar}_run_up`
    else if (vy > 0)   newAnim = `${this.selfChar}_run_down`
    else               newAnim = this.lastAnim.replace('_run_', '_idle_')

    if (!this.isSitting && newAnim !== this.selfSprite.anims.currentAnim?.key)
      this.selfSprite.play(newAnim, true)
    if (!this.isSitting) this.lastAnim = newAnim

    // Name tag
    this.selfNameText.setPosition(this.selfSprite.x, this.selfSprite.y - this.selfSprite.height * 0.5 - 2)

    // Emit move
    if (vx !== 0 || vy !== 0)
      this.onMove?.(this.selfSprite.x, this.selfSprite.y, newAnim)

    // Meeting zone
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

    // Teleport into/out of dynamic rooms
    this.checkTeleports()

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
