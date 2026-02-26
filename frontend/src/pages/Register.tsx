import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GameSkyBackground } from "@/components/GameSkyBackground";

export default function Register() {
  const { register, error, clearError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setSubmitting(true);
    try {
      await register(email, password, displayName);
      navigate("/", { replace: true });
    } catch {
      // error set in context
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen">
      <GameSkyBackground />
      <div className="relative z-10 flex min-h-screen w-full flex-col items-center justify-center gap-6 px-4 py-12">
        <h1 className="text-2xl font-bold tracking-tight drop-shadow-sm md:text-3xl">
          <span className="text-white">Dev</span>
          <span className="text-[#ff9900]">hub</span>
        </h1>
        <Card className="mx-auto w-full max-w-sm bg-[#0f0e1a]/70 backdrop-blur-md border-white/10 shadow-2xl shadow-black/30 text-gray-100 [&_input]:bg-white/10 [&_input]:border-white/20 [&_input]:text-gray-100 [&_input]:placeholder:text-gray-500">
        <CardHeader className="text-center">
          <CardTitle className="text-white">Register</CardTitle>
          <CardDescription className="text-gray-400">Create a new account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                autoComplete="name"
                placeholder="Your name"
                className="bg-white/10 border-white/20 text-gray-100 placeholder:text-gray-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="bg-white/10 border-white/20 text-gray-100 placeholder:text-gray-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="Min 6 characters"
                  className="bg-white/10 border-white/20 text-gray-100 placeholder:text-gray-500 pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 text-gray-400 hover:text-gray-200 hover:bg-white/10"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Creating account…" : "Register"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-gray-400">
            Already have an account?{" "}
            <Link to="/login" className="text-sky-300 underline-offset-4 hover:underline">
              Log in
            </Link>
          </p>
          <Link
            to="/"
            className="mt-2 block text-center text-sm text-sky-300 underline-offset-4 hover:underline"
          >
            Back to home
          </Link>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
