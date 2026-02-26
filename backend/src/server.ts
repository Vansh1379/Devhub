import http from "http";
import app from "./app";
import { env } from "./config/env";
import { attachSocket } from "./socket";

const port = env.port;
const httpServer = http.createServer(app);
attachSocket(httpServer);

httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API and Socket.IO listening on http://localhost:${port}`);
});
