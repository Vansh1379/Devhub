## Virtual Office Platform – Project Roadmap

A Gather-style virtual office for organizations. Users log in, join or create organizations, choose an avatar, and move around a 3D office to chat and call teammates.

We will build this in **phases**, each one shippable and testable on its own.

Tech stack (agreed for this project):
- **Backend**: Node.js, **Express** + **Socket.IO**
- **DB**: **PostgreSQL**
- **Cache / Presence**: **Redis**
- **Realtime**: WebSockets (Socket.IO)
- **Media**: WebRTC via a managed provider (e.g. Daily/Agora/LiveKit Cloud)
- **Client**: React + **Three.js** for 3D characters and 3D office (free/OSS)

---

## Phase 0 – Project Setup & Foundations

**Goal**: Have a bare-bones backend + frontend skeleton running locally with basic tooling.

- **Backend**
  - Initialize Node.js project with TypeScript and Express.
  - Basic server structure (`src/app.ts`, `src/routes`, `src/config`).
  - Configure environment handling (.env, config loader).
  - Connect to PostgreSQL (via Prisma/TypeORM/Knex – to be chosen).
  - Set up Redis client (for later presence).
  - Health-check endpoint (`GET /health`).

- **Frontend**
  - Initialize React + TypeScript app.
  - Add basic routing (login, dashboard, empty “office” page).

- **Dev Tooling**
  - ESLint + Prettier.
  - Basic `docker-compose` for Postgres + Redis (optional, but recommended).

**Exit criteria**:
- `npm run dev` (or similar) for backend and frontend both work.
- Backend talks to Postgres.
- Simple page on frontend can call a health endpoint.

---

## Phase 1 – Auth & Organizations

**Goal**: Users can register, log in, and create/join organizations using a password.

- **Backend**
  - User entity + migration (id, email, password_hash, display_name).
  - Organization entity (id, name, slug, join_password_hash, owner_user_id).
  - OrgMembership entity (user_id, organization_id, role).
  - Endpoints:
    - `POST /auth/register`
    - `POST /auth/login`
    - `GET /me` (current user from JWT)
    - `POST /organizations` (create org with join password)
    - `POST /organizations/join` (join existing org using password)
    - `GET /organizations/my` (list orgs user belongs to)
  - JWT-based auth middleware.

- **Frontend**
  - Auth pages: register, login.
  - Store auth token (and attach to API requests).
  - Dashboard:
    - Show list of organizations.
    - Form to create organization.
    - Form to join org with password.

**Exit criteria**:
- User can sign up, log in, create an org, join an org with password, and see their org list.

---

## Phase 2 – Avatar & Basic Office Entry

**Goal**: After picking an organization, the user sets an avatar (first time) and then can “enter” a space (no realtime yet).

- **Backend**
  - Avatar entity (id, user_id, organization_id, sprite_set, colors/accessories JSON).
  - Space entity (id, organization_id, name, is_default).
  - Endpoints:
    - `GET /organizations/:orgId/avatar/me`
    - `POST /organizations/:orgId/avatar`
    - `GET /organizations/:orgId/spaces`
    - `POST /organizations/:orgId/spaces` (seed with a default “Main Office” for now)

- **Frontend**
  - When user selects an org:
    - Fetch avatar; if missing, show avatar creation UI.
    - Save avatar via API.
  - After avatar is set:
    - Simple “Select Space” screen (or auto-join default space).
    - Render static office screen (no movement, just UI stub saying “You are in space X”).

**Exit criteria**:
- Full flow from login → select org → create avatar → choose space → see basic office screen.

---

## Phase 3 – Realtime Movement & Presence (Socket.IO + Three.js)

**Goal**: Users in the same 3D space see each other’s avatars moving around in real time.

- **Backend (Socket.IO)**
  - WebSocket server with auth on connection (JWT check).
  - Rooms per space, e.g. `space:<spaceId>`.
  - Presence storage in Redis: `presence:space:<spaceId>`.
  - Events:
    - Client → Server:
      - `join_space { spaceId }`
      - `leave_space { spaceId }`
      - `move { spaceId, x, y, z, direction }` (z can be 0 for flat floors)
    - Server → Client:
      - `space_state { users: [...] }` (on join; includes x, y, z, avatar)
      - `user_joined { userId, x, y, z, avatar }`
      - `user_left { userId }`
      - `user_moved { userId, x, y, z, direction }`
  - Basic movement validation (keep inside map bounds, simple collisions).

- **Frontend (React + Three.js)**
  - Initialize a Three.js scene on the “office” page (camera, lights, renderer).
  - Load a simple 3D office (floor plane + a few walls/objects).
  - Load or create a simple 3D avatar model (can start with basic shapes).
  - Render the local avatar and allow keyboard movement in the scene.
  - Connect to Socket.IO with token.
  - Send throttled `move` events (10–15 per second).
  - Listen for `space_state`, `user_joined`, `user_moved`, `user_left` and update other avatars’ positions.

**Exit criteria**:
- Two browser windows, logged in as different users in same space, can see each other’s avatars moving.

---

## Phase 4 – Chat (Space + DM)

**Goal**: Users can chat in the space and send direct messages while in the office.

- **Backend**
  - ChatMessage entity (channel_type, channel_id, sender_user_id, content, created_at).
  - REST:
    - `GET /spaces/:spaceId/messages` (recent messages).
    - `GET /dms/:userId/messages` (recent messages between two users).
  - WebSocket events:
    - Client → Server:
      - `chat_message { channelType, channelId, content }`
    - Server → Client:
      - `chat_message { id, channelType, channelId, senderUserId, content, createdAt }`
  - Persist messages to DB and broadcast over Socket.IO.

- **Frontend**
  - Chat UI pane in office screen:
    - Space chat for current space.
    - DM panel (select a user from participant list to open DM).
  - Load initial history via REST; update live via WS events.

**Exit criteria**:
- Users in same space can send/receive messages in real time.
- Users can open a DM with someone and chat 1:1.

---

## Phase 5 – Audio/Video Calls (Room-Based)

**Goal**: Simple video calls in dedicated meeting rooms (no proximity logic yet).

- **Backend**
  - Map meeting rooms to logical `mediaRoomId` (e.g. by `spaceId + roomId`).
  - Media service integration (Daily/Agora/LiveKit Cloud):
    - Endpoint: `POST /media/rooms` with `{ spaceId, roomId }`.
    - Returns `{ callRoomId, token, serverUrl }`.

- **Frontend**
  - In office map, mark meeting rooms as interactive zones.
  - When user enters a meeting room:
    - Call `/media/rooms`.
    - Use provider SDK to join the call with returned token.
  - Simple UI for:
    - Toggle mic/camera.
    - Show grid of videos for participants.

**Exit criteria**:
- Multiple users can enter the same meeting room and see/hear each other via video call.

---

## Phase 6 – Enhancements & Advanced Features

**Goal**: Bring experience closer to Gather-level polish.

Possible tasks (to be prioritized later):
- **Map & UX**
  - Proper tilesets and nicer office maps.
  - Multiple spaces per org with different templates.
  - Teleporters/doors between rooms.
- **Proximity Audio/Video**
  - Proximity-based conversation groups instead of room-only calls.
  - Auto-join/leave calls based on avatar distance.
- **Integrations**
  - Calendar integration for scheduled meetings.
  - Slack/Teams notifications.
- **Admin Tools**
  - Map editor UI for org admins.
  - Org-level settings (access, themes, etc.).

---

## Next Step

We will start with **Phase 0 – Project Setup & Foundations** and then move phase by phase.  
Once you confirm, we can immediately begin implementing Phase 0 in this repo.

