import { buildServer } from './server.ts';
import { config } from './config.ts';
import { startWorker } from './jobs/worker.ts';
const app = await buildServer();
await app.listen({ port: config.port, host: '0.0.0.0' });
if (config.workerEnabled) startWorker(app.log);
