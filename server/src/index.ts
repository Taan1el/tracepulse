import { createApp } from './app.js';

const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
const PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536 ? parsedPort : 4000;

const { app } = createApp();

app.listen(PORT, () => {
  console.log(`[TracePulse Server] REST API listening on http://localhost:${PORT}`);
  console.log(`[TracePulse Server] Ingestion endpoint ready at http://localhost:${PORT}/api/traces`);
});
