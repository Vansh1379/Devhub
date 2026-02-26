import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

  if (!orgId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Missing organization.</p>
        <Link
          to="/dashboard"
          className="mt-2 inline-block text-primary underline-offset-4 hover:underline"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <p className="text-muted-foreground">Loading spaces…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">
          {error}.{" "}
          <Link to="/dashboard" className="text-primary underline-offset-4 hover:underline">
            Dashboard
          </Link>
        </p>
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
      <div className="mx-auto max-w-md px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>No spaces yet</CardTitle>
            <CardDescription>
              This organization doesn&apos;t have a space yet. Create one to enter the virtual office.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {error && (
              <p className="text-sm text-destructive">{error}</p>
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
              className="mt-4 block text-center text-sm text-primary underline-offset-4 hover:underline"
            >
              Back to Dashboard
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Select a space</CardTitle>
          <CardDescription>
            Choose where to go in the virtual office.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {spaces.map((space) => (
            <Button
              key={space.id}
              variant="outline"
              className="h-auto w-full justify-start py-4 text-left font-normal"
              onClick={() => enterSpace(space)}
            >
              {space.name}
              {space.isDefault && (
                <span className="ml-2 text-muted-foreground">(default)</span>
              )}
            </Button>
          ))}
          <Link
            to="/dashboard"
            className="mt-4 block text-center text-sm text-primary underline-offset-4 hover:underline"
          >
            Back to Dashboard
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
