import React, { useState } from "react";
import { ROOM_CONFIGS, RoomType } from "@/game/RoomManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  onAdd: (type: RoomType, name: string) => void;
  onClose: () => void;
}

const ROOM_ORDER: RoomType[] = ["computer", "meeting", "boss", "lounge", "phone"];

export function AddRoomModal({ onAdd, onClose }: Props) {
  const [selectedType, setSelectedType] = useState<RoomType>("computer");
  const [roomName, setRoomName] = useState("");

  const cfg = ROOM_CONFIGS[selectedType];

  const handleAdd = () => {
    const name = roomName.trim() || cfg.label;
    onAdd(selectedType, name);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-[520px] max-w-[95vw] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold">Add a Room</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose a room type, give it a name, and it will appear below your office
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {/* Room type grid */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
              Room Type
            </label>
            <div className="grid grid-cols-5 gap-2">
              {ROOM_ORDER.map((type) => {
                const c = ROOM_CONFIGS[type];
                const isSelected = selectedType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSelectedType(type)}
                    className={`
                      flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all
                      ${isSelected
                        ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/40"
                        : "border-border bg-muted/30 hover:bg-muted/60 hover:border-muted-foreground/40"
                      }
                    `}
                  >
                    <span className="text-2xl">{c.emoji}</span>
                    <span className="text-[10px] font-medium leading-tight text-foreground">
                      {c.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected type description */}
          <div
            className="rounded-lg px-4 py-3 text-sm border"
            style={{
              backgroundColor: `${intToHex(ROOM_CONFIGS[selectedType].color)}22`,
              borderColor: `${intToHex(ROOM_CONFIGS[selectedType].accentColor)}55`,
            }}
          >
            <span className="font-medium">{cfg.emoji} {cfg.label}</span>
            <span className="text-muted-foreground"> — {cfg.description}</span>
            {cfg.isMeetingZone && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-400 border border-blue-500/30">
                📹 Video call zone
              </span>
            )}
          </div>

          {/* Room name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Room Name
            </label>
            <Input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder={cfg.label}
              maxLength={40}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              Leave blank to use the default name for this room type
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <Button className="flex-1" onClick={handleAdd}>
              {cfg.emoji} Add {roomName.trim() || cfg.label}
            </Button>
            <Button variant="outline" onClick={onClose} className="w-24">
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper: convert 0xRRGGBB number to CSS hex string
function intToHex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}
