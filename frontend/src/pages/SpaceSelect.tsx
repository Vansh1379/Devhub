import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GameSkyBackground } from "@/components/GameSkyBackground";

interface Space {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
}

export default function SpaceSelect() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    api
      .get<{ spaces: Space[] }>(`/organizations/${orgId}/spaces`)
      .then((res) => setSpaces(res.data.spaces))
      .catch(() => {
        setError("Failed to load spaces");
        setSpaces([]);
      })
      .finally(() => setLoading(false));
  }, [orgId]);

  const enterSpace = (space: Space) => {
    navigate("/office", {
      state: { orgId, spaceId: space.id, spaceName: space.name },
    });
  };

  const cardClass =
    "bg-[#0f0e1a]/70 backdrop-blur-md border-white/10 shadow-2xl shadow-black/30 text-gray-100";
  const linkClass = "text-sky-300 underline-offset-4 hover:underline";

  if (!orgId) {
    return (
      <div className="relative min-h-screen">
        <GameSkyBackground variant="minimal" moon={false} />
        <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12">
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-white">Dev</span>
            <span className="text-[#ff9900]">hub</span>
          </h1>
          <div className="rounded-lg border border-white/10 bg-[#0f0e1a]/70 px-6 py-5 backdrop-blur-md">
            <p className="text-gray-400">Missing organization.</p>
            <Link to="/dashboard" className={`mt-3 inline-block text-sm ${linkClass}`}>
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="relative min-h-screen">
        <GameSkyBackground variant="minimal" moon={false} />
        <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
          <p className="text-gray-400">Loading spaces…</p>
        </div>
      </div>
    );
  }

  const createFirstSpace = async () => {
    if (!orgId || creating) return;
    setCreating(true);
    setError("");
    try {
      const { data } = await api.post<{ space: Space }>(`/organizations/${orgId}/spaces`, {
        name: "Main Office",
      });
      navigate("/office", {
        state: { orgId, spaceId: data.space.id, spaceName: data.space.name },
      });
    } catch {
      setError("Failed to create space");
    } finally {
      setCreating(false);
    }
  };

  if (spaces.length === 0) {
    return (
      <div className="relative min-h-screen">
        <GameSkyBackground variant="minimal" moon={false} />
        <div className="relative z-10 flex min-h-screen w-full flex-col items-center justify-center gap-6 px-6 py-12">
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-white">Dev</span>
            <span className="text-[#ff9900]">hub</span>
          </h1>
          <Card className={`w-full max-w-sm ${cardClass}`}>
            <CardHeader className="text-center">
              <CardTitle className="text-white">No spaces yet</CardTitle>
              <CardDescription className="text-gray-400">
                This organization doesn&apos;t have a space yet. Create one to enter the virtual office.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {error && (
                <p className="text-sm text-amber-300">{error}</p>
              )}
              <Button
                className="w-full"
                onClick={createFirstSpace}
                disabled={creating}
              >
                {creating ? "Creating…" : "Create Main Office"}
              </Button>
              <Link
                to="/dashboard"
                className={`mt-4 block text-center text-sm ${linkClass}`}
              >
                Back to Dashboard
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <GameSkyBackground variant="minimal" moon={false} />
      <div className="relative z-10 flex min-h-screen w-full flex-col items-center justify-center gap-6 px-6 py-12">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-white">Dev</span>
          <span className="text-[#ff9900]">hub</span>
        </h1>
        <Card className={`w-full max-w-sm ${cardClass}`}>
          <CardHeader className="text-center">
            <CardTitle className="text-white">Select a space</CardTitle>
            <CardDescription className="text-gray-400">
              Choose where to go in the virtual office.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {spaces.map((space) => (
              <Button
                key={space.id}
                variant="outline"
                className="h-auto w-full justify-start border-white/20 bg-white/10 py-4 text-left font-normal text-white hover:bg-white/20"
                onClick={() => enterSpace(space)}
              >
                {space.name}
                {space.isDefault && (
                  <span className="ml-2 text-gray-400">(default)</span>
                )}
              </Button>
            ))}
            <Link
              to="/dashboard"
              className={`mt-4 block text-center text-sm ${linkClass}`}
            >
              Back to Dashboard
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
