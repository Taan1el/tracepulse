import { createApp } from './app.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

const { app } = createApp();

app.listen(PORT, () => {
  console.log(`[TracePulse Server] REST API listening on http://localhost:${PORT}`);
  console.log(`[TracePulse Server] Ingestion endpoint ready at http://localhost:${PORT}/api/traces`);
});
