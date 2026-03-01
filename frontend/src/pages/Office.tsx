import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Phaser from "phaser";
import { io, Socket } from "socket.io-client";
import { api, getStoredToken } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DyteCallView } from "@/components/DyteCallView";
import { OfficeScene, OtherPlayer } from "@/game/OfficeScene";
import { GameSkyBackground } from "@/components/GameSkyBackground";

export interface ChatMessagePayload {
  id: string;
  channelType: "SPACE" | "DM";
  channelId: string;
  senderUserId: string;
  senderDisplayName: string;
  content: string;
  createdAt: string;
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

  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const spaceIdRef = useRef<string | null>(null);

  // Others state (for DM list)
  const [others, setOthers] = useState<Map<string, OtherPlayer>>(new Map());

  // Chat state
  const [spaceMessages, setSpaceMessages] = useState<ChatMessagePayload[]>([]);
  const [dmMessagesByUser, setDmMessagesByUser] = useState<
    Map<string, ChatMessagePayload[]>
  >(new Map());
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTab, setChatTab] = useState<"space" | "dm">("space");
  const [dmWithUserId, setDmWithUserId] = useState<string | null>(null);
  const chatListRef = useRef<HTMLDivElement>(null);

  // Meeting / video state
  const [meetingZone, setMeetingZone] = useState<{ roomId: string } | null>(null);
  const [inCall, setInCall] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [dyteToken, setDyteToken] = useState<string | null>(null);
  const [videoMenuOpen, setVideoMenuOpen] = useState(false);

  // ── Guard: must have space ──────────────────────────────────────────────────
  const hasSpace = state?.spaceId && state?.spaceName;
  useEffect(() => {
    if (!hasSpace && location.pathname === "/office") {
      navigate("/dashboard", { replace: true });
    }
  }, [hasSpace, location.pathname, navigate]);

  // ── Bootstrap Phaser ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !state?.spaceId || !state?.spaceName || !user)
      return;

    const officeScene = new OfficeScene();
    sceneRef.current = officeScene;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: containerRef.current.clientWidth || window.innerWidth,
      height: containerRef.current.clientHeight || window.innerHeight,
      transparent: true,   // sky bg shows through when map < viewport
      scene: officeScene,
      pixelArt: true,
      antialias: false,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    });
    gameRef.current = game;

    // Wait a tick for the scene to be fully created, then set display name
    setTimeout(() => {
      officeScene.setDisplayName(user.displayName ?? "You");
      officeScene.teleportSelf(8, 15, "down");
    }, 100);

    // Movement callback → socket
    officeScene.onMove = (tx: number, ty: number, direction: string) => {
      const socket = socketRef.current;
      const spaceId = spaceIdRef.current;
      if (socket && spaceId) {
        socket.emit("move", {
          spaceId,
          x: tx,
          y: 0,
          z: ty,
          direction,
        });
      }
    };

    officeScene.onZoneChange = (zone) => {
      setMeetingZone(zone);
    };

    return () => {
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, [state?.spaceId, state?.spaceName, user]);

  // ── Socket.IO ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state?.spaceId || !state?.spaceName || !user) return;

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
        x: 8,
        y: 0,
        z: 15,
        direction: "down",
      });
    });

    socket.on("space_state", (data: { users: OtherPlayer[] }) => {
      const map = new Map<string, OtherPlayer>();
      (data.users || []).forEach((u) => {
        if (u.socketId !== socket.id) map.set(u.socketId, u);
      });
      setOthers(map);
      sceneRef.current?.setOtherPlayers(Array.from(map.values()));
    });

    socket.on("user_joined", (u: OtherPlayer) => {
      if (u.socketId === socket.id) return;
      setOthers((prev) => {
        const next = new Map(prev);
        next.set(u.socketId, u);
        sceneRef.current?.setOtherPlayers(Array.from(next.values()));
        return next;
      });
    });

    socket.on("user_left", (data: { userId: string; socketId: string }) => {
      setOthers((prev) => {
        const next = new Map(prev);
        next.delete(data.socketId);
        sceneRef.current?.removeOtherPlayer(data.socketId);
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
        setOthers((prev) => {
          const u = prev.get(data.socketId);
          if (!u) return prev;
          const updated: OtherPlayer = {
            ...u,
            x: data.x,
            y: data.y ?? 0,
            z: data.z,
            direction: data.direction,
          };
          const next = new Map(prev);
          next.set(data.socketId, updated);
          sceneRef.current?.updateOtherPlayer(
            data.socketId,
            data.x,
            data.z,
            data.direction,
            u.displayName
          );
          return next;
        });
      }
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

  // ── Load initial space chat history ────────────────────────────────────────
  useEffect(() => {
    if (!state?.spaceId) return;
    api
      .get<{ messages: ChatMessagePayload[] }>(`/spaces/${state.spaceId}/messages`)
      .then((res) => setSpaceMessages(res.data.messages ?? []))
      .catch(() => setSpaceMessages([]));
  }, [state?.spaceId]);

  // ── DM room join ────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !user?.id) return;
    if (dmWithUserId) {
      socket.emit("join_dm", { otherUserId: dmWithUserId });
      api
        .get<{ messages: ChatMessagePayload[] }>(`/dms/${dmWithUserId}/messages`)
        .then((res) =>
          setDmMessagesByUser((prev) => {
            const next = new Map(prev);
            next.set(dmWithUserId, res.data.messages ?? []);
            return next;
          })
        )
        .catch(() => {});
    }
    return () => {
      if (dmWithUserId) socket.emit("leave_dm", { otherUserId: dmWithUserId });
    };
  }, [dmWithUserId, user?.id]);

  // ── Auto-scroll chat ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chatOpen) return;
    chatListRef.current?.scrollTo({
      top: chatListRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatOpen, spaceMessages, dmMessagesByUser, dmWithUserId]);

  // ── Send message ────────────────────────────────────────────────────────────
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
    [chatTab, dmWithUserId]
  );

  // ── Video call ──────────────────────────────────────────────────────────────
  const joinMeetingWithRoom = useCallback(
    async (roomId: string) => {
      if (!state?.spaceId || inCall) return;
      setCallError(null);
      try {
        const { data } = await api.post<{ token: string; meetingId: string }>(
          "/media/rooms",
          { spaceId: state.spaceId, roomId }
        );
        setDyteToken(data.token);
        setInCall(true);
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error ??
          (err as Error)?.message ??
          "Failed to join call";
        setCallError(msg);
      }
    },
    [state?.spaceId, inCall]
  );

  const joinMeeting = useCallback(async () => {
    if (meetingZone && !inCall) joinMeetingWithRoom(meetingZone.roomId);
  }, [meetingZone, inCall, joinMeetingWithRoom]);

  const leaveMeeting = useCallback(() => {
    setDyteToken(null);
    setInCall(false);
  }, []);

  // Press E to join meeting
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

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!state?.spaceId || !state?.spaceName) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Animated sky background — sits behind everything */}
      <GameSkyBackground variant="full" moon />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between border-b border-border bg-card/80 backdrop-blur-sm px-4 py-2">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
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
            className="text-primary underline-offset-4 hover:underline text-sm"
          >
            Home
          </Link>
          <Link
            to="/dashboard"
            className="text-primary underline-offset-4 hover:underline text-sm"
          >
            Dashboard
          </Link>
        </nav>
      </header>

      {/* Game area — canvas fills screen, sky visible through transparent canvas */}
      <div className="relative z-10 flex-1">
        {/* Phaser canvas fills the entire game area */}
        <div ref={containerRef} className="absolute inset-0" />

        {/* HUD: controls hint */}
        <div className="pointer-events-none absolute bottom-4 left-4 z-10">
          <div className="rounded-lg border border-white/20 bg-black/70 px-4 py-2 font-mono text-sm text-white shadow-lg">
            <span className="text-emerald-400">WASD</span> or{" "}
            <span className="text-emerald-400">↑↓←→</span> move ·{" "}
            <span className="text-sky-300">Scroll</span> or{" "}
            <span className="text-sky-300">+/-</span> zoom
          </div>
          {!inCall && (
            <p className="mt-1 text-xs text-white/70">
              <span className="font-medium text-blue-300">Blue zones</span> =
              meeting rooms · Walk in &amp; press{" "}
              <span className="font-medium text-blue-300">E</span> to join call
            </p>
          )}
        </div>

        {/* Zoom buttons */}
        <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded border border-white/20 bg-black/70 text-white shadow-lg hover:bg-black/90 active:scale-95 transition-transform text-lg font-bold leading-none"
            onClick={() => sceneRef.current?.zoomBy(1.25)}
            title="Zoom in (+)"
          >
            +
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded border border-white/20 bg-black/70 text-white shadow-lg hover:bg-black/90 active:scale-95 transition-transform text-lg font-bold leading-none"
            onClick={() => sceneRef.current?.zoomToFit()}
            title="Reset zoom (0)"
          >
            ⊙
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded border border-white/20 bg-black/70 text-white shadow-lg hover:bg-black/90 active:scale-95 transition-transform text-lg font-bold leading-none"
            onClick={() => sceneRef.current?.zoomBy(0.8)}
            title="Zoom out (-)"
          >
            −
          </button>
        </div>

        {/* Meeting zone prompt */}
        {meetingZone && !inCall && (
          <div className="absolute bottom-16 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 rounded-lg border border-primary/50 bg-card/95 px-4 py-3 shadow-xl">
            <span className="text-sm font-medium">
              Meeting room · {meetingZone.roomId}
            </span>
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

        {/* Active video call overlay */}
        {inCall && dyteToken && (
          <div className="absolute inset-0 z-20 flex flex-col bg-background/95 p-4">
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
              <DyteCallView token={dyteToken} onLeave={leaveMeeting} />
            </div>
          </div>
        )}

        {/* Chat panel */}
        <div className="absolute right-4 top-4 z-10 flex flex-col">
          <Button
            variant="outline"
            size="sm"
            className="mb-2 self-end rounded-full border-white/20 bg-black/70 text-white shadow-lg hover:bg-black/80"
            onClick={() => setChatOpen((o) => !o)}
          >
            {chatOpen ? "Close chat" : "Chat"}
          </Button>
          {chatOpen && (
            <div className="flex w-80 flex-col rounded-lg border border-border bg-card shadow-xl">
              {/* Tabs */}
              <div className="flex border-b border-border">
                <button
                  type="button"
                  className={`flex-1 px-3 py-2 text-sm font-medium ${
                    chatTab === "space"
                      ? "border-b-2 border-primary bg-muted/50 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setChatTab("space")}
                >
                  Space
                </button>
                <button
                  type="button"
                  className={`flex-1 px-3 py-2 text-sm font-medium ${
                    chatTab === "dm"
                      ? "border-b-2 border-primary bg-muted/50 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setChatTab("dm")}
                >
                  DMs
                </button>
              </div>

              {/* Space chat */}
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
                          "input[name=chat]"
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

              {/* DM chat */}
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
                            (o) => o.userId === dmWithUserId
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
                              "input[name=dm]"
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
