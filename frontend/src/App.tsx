import React, { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { api } from "@/api";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import OrgEntry from "./pages/OrgEntry";
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
    <div className="min-h-screen bg-background p-8">
      <h2 className="text-2xl font-semibold tracking-tight">Virtual Office</h2>
      <p className="mt-2 text-muted-foreground">{health}</p>
      <nav className="mt-4 flex gap-4">
        {user ? (
          <>
            <Link to="/dashboard" className="text-primary underline-offset-4 hover:underline">Dashboard</Link>
            <Link to="/office" className="text-primary underline-offset-4 hover:underline">Office</Link>
          </>
        ) : (
          <>
            <Link to="/login" className="text-primary underline-offset-4 hover:underline">Login</Link>
            <Link to="/register" className="text-primary underline-offset-4 hover:underline">Register</Link>
          </>
        )}
      </nav>
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
