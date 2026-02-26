import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import orgRoutes from "./routes/organizations";
import chatRoutes from "./routes/chat";
import mediaRoutes from "./routes/media";

const app = express();

app.use(
  cors({
    origin: "*",
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

