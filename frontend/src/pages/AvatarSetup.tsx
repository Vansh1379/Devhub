import React, { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SPRITE_SETS = ["default", "casual", "professional"];

export default function AvatarSetup() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [spriteSet, setSpriteSet] = useState("default");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setError("");
    setSubmitting(true);
    try {
      await api.post(`/organizations/${orgId}/avatar`, {
        spriteSet,
        colors: {},
        accessories: {},
      });
      navigate(`/org/${orgId}`, { replace: true });
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          "Failed to save avatar"
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!orgId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Missing organization.</p>
        <Link
          to="/dashboard"
          className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Choose your avatar</CardTitle>
          <CardDescription>
            Select a style for your character in this organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="spriteSet">Style</Label>
              <Select
                id="spriteSet"
                value={spriteSet}
                onChange={(e) => setSpriteSet(e.target.value)}
              >
                {SPRITE_SETS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Saving…" : "Continue"}
            </Button>
          </form>
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
