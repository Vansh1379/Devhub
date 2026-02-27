import React, { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { api } from "@/api";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { GameSkyBackground } from "@/components/GameSkyBackground";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import OrgEntry from "./pages/OrgEntry";
import SpaceSelect from "./pages/SpaceSelect";
import Office from "./pages/Office";

const Home: React.FC = () => {
  const { user } = useAuth();
  const [health, setHealth] = useState<string>("Checking...");

  useEffect(() => {
    api
      .get("/health")
      .then((res) => setHealth(`API status: ${res.data.status}`))
      .catch(() => setHealth("API status: unreachable"));
  }, []);

  return (
    <div className="relative min-h-screen">
      <GameSkyBackground variant="minimal" moon={false} dogs />
      <div className="relative z-10 flex min-h-screen w-full flex-col items-center justify-center gap-6 px-6 py-12">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          <span className="text-white">Dev</span>
          <span className="text-[#ff9900]">hub</span>
        </h1>
        <div className="w-full max-w-sm rounded-lg border border-white/10 bg-[#0f0e1a]/70 px-6 py-5 backdrop-blur-md shadow-2xl shadow-black/30">
          <h2 className="text-xl font-semibold text-white">Virtual Office</h2>
          <p className="mt-2 text-sm text-gray-400">{health}</p>
          <nav className="mt-4 flex flex-wrap gap-4 text-sm">
            {user ? (
              <>
                <Link to="/dashboard" className="text-sky-300 underline-offset-4 hover:underline">Dashboard</Link>
                <Link to="/office" className="text-sky-300 underline-offset-4 hover:underline">Office</Link>
              </>
            ) : (
              <>
                <Link to="/login" className="text-sky-300 underline-offset-4 hover:underline">Login</Link>
                <Link to="/register" className="text-sky-300 underline-offset-4 hover:underline">Register</Link>
              </>
            )}
          </nav>
        </div>
      </div>
    </div>
  );
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/org/:orgId" element={<OrgEntry />} />
      <Route path="/org/:orgId/spaces" element={<SpaceSelect />} />
      <Route path="/office" element={<Office />} />
    </Routes>
  );
}

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
};

export default App;
