import React, { useEffect, useRef } from "react";
import { DyteProvider, useDyteClient, useDyteMeeting } from "@dytesdk/react-web-core";
import { DyteMeeting } from "@dytesdk/react-ui-kit";
import { Button } from "@/components/ui/button";

interface DyteCallViewProps {
  token: string;
  onLeave: () => void;
}

function DyteMeetingContent({ onLeave }: { onLeave: () => void }) {
  const { meeting } = useDyteMeeting();

  const handleLeave = () => {
    meeting.leaveRoom();
    onLeave();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-2 py-2">
        <span className="font-medium">Video call</span>
        <Button variant="outline" size="sm" onClick={handleLeave}>
          Leave call
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <DyteMeeting meeting={meeting} />
      </div>
    </div>
  );
}

export function DyteCallView({ token, onLeave }: DyteCallViewProps) {
  const [meeting, initMeeting] = useDyteClient();
  const joinedRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    initMeeting({
      authToken: token,
      defaults: {
        audio: true,
        video: true,
      },
    });
  }, [token, initMeeting]);

  useEffect(() => {
    if (!meeting || joinedRef.current) return;
    joinedRef.current = true;
    meeting.join();
  }, [meeting]);

  useEffect(() => {
    return () => {
      if (meeting) {
        meeting.leaveRoom().catch(() => {});
      }
    };
  }, [meeting]);

  if (!meeting) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Joining call…
      </div>
    );
  }

  return (
    <DyteProvider value={meeting}>
      <DyteMeetingContent onLeave={onLeave} />
    </DyteProvider>
  );
}
