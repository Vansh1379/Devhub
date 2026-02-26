import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GameSkyBackground } from "@/components/GameSkyBackground";

interface Org {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
  role: string;
}

export default function Dashboard() {
  const { user, loading: authLoading, logout } = useAuth();
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [joinSlug, setJoinSlug] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [createError, setCreateError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [joinSubmitting, setJoinSubmitting] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!user) return;
    setLoadingOrgs(true);
    api
      .get<{ organizations: Org[] }>("/organizations/my")
      .then((res) => setOrganizations(res.data.organizations))
      .catch(() => setOrganizations([]))
      .finally(() => setLoadingOrgs(false));
  }, [user]);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setCreateSubmitting(true);
    try {
      await api.post("/organizations", {
        name: createName,
        joinPassword: createPassword,
      });
      const { data } = await api.get<{ organizations: Org[] }>(
        "/organizations/my",
      );
      setOrganizations(data.organizations);
      setCreateName("");
      setCreatePassword("");
    } catch (err) {
      setCreateError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || "Failed to create organization",
      );
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleJoinOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError("");
    setJoinSubmitting(true);
    try {
      await api.post("/organizations/join", {
        orgIdentifier: joinSlug.trim(),
        joinPassword: joinPassword,
      });
      const { data } = await api.get<{ organizations: Org[] }>(
        "/organizations/my",
      );
      setOrganizations(data.organizations);
      setJoinSlug("");
      setJoinPassword("");
    } catch (err) {
      setJoinError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || "Failed to join organization",
      );
    } finally {
      setJoinSubmitting(false);
    }
  };

  const cardClass =
    "bg-[#0f0e1a]/70 backdrop-blur-md border-white/10 shadow-2xl shadow-black/30 text-gray-100 [&_input]:bg-white/10 [&_input]:border-white/20 [&_input]:text-gray-100 [&_input]:placeholder:text-gray-500";
  const inputClass =
    "bg-white/10 border-white/20 text-gray-100 placeholder:text-gray-500";

  if (authLoading || !user) {
    return (
      <div className="relative min-h-screen">
        <GameSkyBackground variant="minimal" moon={false} birds />
        <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
          <p className="text-gray-400">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <GameSkyBackground variant="minimal" moon={false} birds />
      <div className="relative z-10 mx-auto max-w-2xl space-y-8 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-white">Dev</span>
            <span className="text-[#ff9900]">hub</span>
          </h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">
              {user.displayName} ({user.email})
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={logout}
              className="border-white/20 bg-white/10 text-gray-200 hover:bg-white/20"
            >
              Log out
            </Button>
          </div>
        </div>

        <h2 className="text-xl font-semibold text-white">Dashboard</h2>

        <Card className={cardClass}>
          <CardHeader>
            <CardTitle className="text-white">Your organizations</CardTitle>
            <CardDescription className="text-gray-400">
              Create a new org or join one with a link and password.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingOrgs ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : organizations.length === 0 ? (
            <p className="text-sm text-gray-400">
              You’re not in any organization yet.
            </p>
          ) : (
              <ul className="space-y-2">
                {organizations.map((org) => (
                  <li key={org.id}>
                    <Card className="flex flex-wrap items-center gap-2 border-white/10 bg-white/5 p-4">
                      <span className="font-medium text-white">{org.name}</span>
                      <span className="text-gray-400">
                        ({org.slug}) — {org.role}
                      </span>
                      <Link
                        to={`/org/${org.id}`}
                        className="ml-auto text-sm text-sky-300 underline-offset-4 hover:underline"
                      >
                        Enter
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className={cardClass}>
          <CardHeader>
            <CardTitle className="text-white">Create organization</CardTitle>
            <CardDescription className="text-gray-400">
              Others can join using the org slug and the password you set.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateOrg} className="space-y-4">
              <div className="space-y-2">
                <Input
                  placeholder="Organization name"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="Join password (others will use this to join)"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>
              {createError && (
                <p className="text-sm text-amber-300">{createError}</p>
              )}
              <Button type="submit" disabled={createSubmitting}>
                {createSubmitting ? "Creating…" : "Create"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className={cardClass}>
          <CardHeader>
            <CardTitle className="text-white">Join organization</CardTitle>
            <CardDescription className="text-gray-400">
              Enter the org slug or ID and the join password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleJoinOrg} className="space-y-4">
              <div className="space-y-2">
                <Input
                  placeholder="Org slug or ID"
                  value={joinSlug}
                  onChange={(e) => setJoinSlug(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="Join password"
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>
              {joinError && (
                <p className="text-sm text-amber-300">{joinError}</p>
              )}
              <Button type="submit" disabled={joinSubmitting}>
                {joinSubmitting ? "Joining…" : "Join"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-sm text-gray-400">
          <Link
            to="/"
            className="text-sky-300 underline-offset-4 hover:underline"
          >
            Home
          </Link>
          {" · "}
          <Link
            to="/office"
            className="text-sky-300 underline-offset-4 hover:underline"
          >
            Office
          </Link>
        </p>
      </div>
    </div>
  );
}
