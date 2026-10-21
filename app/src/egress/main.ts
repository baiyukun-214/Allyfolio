// Run: npx tsx src/egress/main.ts  (docker-compose service "egress"; the app sets SCAN_PROXY=http://egress:3128)
import { createEgressProxy } from './proxy.ts';
const port = Number(process.env.EGRESS_PORT ?? 3128);
createEgressProxy({ log: (m) => console.log(`[egress] ${m}`) }).listen(port, '0.0.0.0', () => console.log(`[egress] listening on :${port}`));
