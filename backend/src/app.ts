import express from "express";
import cors from "cors";
import { env } from "./config/env";
import authRoutes from "./routes/auth";
import orgRoutes from "./routes/organizations";
import chatRoutes from "./routes/chat";
import mediaRoutes from "./routes/media";

const app = express();

const allowedOrigins = env.corsOrigins
  ? env.corsOrigins.split(",").map((o: string) => o.trim())
  : ["http://localhost:3000"];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRoutes);
app.use("/organizations", orgRoutes);
app.use("/", chatRoutes);
app.use("/media", mediaRoutes);

export default app;

