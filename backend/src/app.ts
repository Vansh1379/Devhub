import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import orgRoutes from "./routes/organizations";

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

export default app;

