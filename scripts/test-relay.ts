/** Local NIP-01 relay for the Playwright e2e run (`playwright.config.ts` webServer). */
import { startTestRelay } from "../src/core/testing/relay";

const port = Number(process.env.PORT ?? 4174);
const relay = await startTestRelay(port);
console.log(`test relay listening on ${relay.url}`);

const stop = () => {
  void relay.close().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
