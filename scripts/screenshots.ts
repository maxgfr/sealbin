/**
 * Captures the README screenshots into docs/screenshots/: compose.png, view-light.png,
 * view-dark.png and burn.png (1280x800, light theme except view-dark).
 *
 * Usage: `bun scripts/screenshots.ts`
 *
 * Self-contained: it starts a local Nostr relay (startTestRelay) on port 4175, builds the app
 * with SEALBIN_RELAYS pointing at it, serves dist/ with `vite preview` on port 4180 (both ports
 * must be free), captures, then stops everything. Run `bun run build` afterwards if you need a
 * production dist/ again.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { startTestRelay } from "../src/core/testing/relay";

const RELAY_PORT = 4175;
const PREVIEW_PORT = 4180;
const BASE = `http://127.0.0.1:${PREVIEW_PORT}/sealbin/`;
const OUT = "docs/screenshots";

const SAMPLE = `import { readFile } from "node:fs/promises";

/** Counts the non-empty lines of a file. */
export async function countLines(path: string): Promise<number> {
  const text = await readFile(path, "utf8");
  return text.split("\\n").filter((line) => line.trim() !== "").length;
}

const total = await countLines(process.argv[2] ?? "README.md");
console.log(\`\${total} lines\`);
`;

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`preview server did not answer at ${url}`);
}

async function compose(page: Page, burn: boolean): Promise<void> {
  await page.goto(BASE);
  await page.locator("#sb-title").fill("count-lines.ts");
  await page.locator("#sb-filename").fill("count-lines.ts");
  const editor = page.getByRole("textbox", { name: "Paste content" });
  await editor.click();
  await page.keyboard.insertText(SAMPLE);
  if (burn) await page.getByRole("checkbox", { name: "Burn after reading" }).check();
}

async function create(page: Page): Promise<string> {
  await page.getByRole("button", { name: /^Create/ }).click();
  await page.locator("#sb-result-title").waitFor({ state: "visible", timeout: 15_000 });
  return page.locator("#sb-share-url").inputValue();
}

async function main(): Promise<void> {
  const relay = await startTestRelay(RELAY_PORT);
  let preview: ReturnType<typeof spawn> | undefined;
  try {
    const build = spawnSync("bunx", ["vite", "build"], {
      stdio: "inherit",
      env: { ...process.env, SEALBIN_RELAYS: relay.url },
    });
    if (build.status !== 0) throw new Error(`vite build failed (exit ${build.status})`);

    preview = spawn(
      "bunx",
      ["vite", "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"],
      { stdio: "ignore" },
    );
    await waitForServer(BASE);
    mkdirSync(OUT, { recursive: true });

    const browser = await chromium.launch();
    try {
      const shot = async (scheme: "light" | "dark", run: (page: Page) => Promise<void>) => {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          colorScheme: scheme,
          reducedMotion: "reduce",
        });
        try {
          await run(await context.newPage());
        } finally {
          await context.close();
        }
      };

      let shareUrl = "";
      await shot("light", async (page) => {
        await compose(page, false);
        await page.screenshot({ path: `${OUT}/compose.png` });
        shareUrl = await create(page);
      });

      for (const scheme of ["light", "dark"] as const) {
        await shot(scheme, async (page) => {
          await page.goto(shareUrl);
          await page.locator("section.sb-code .sb-code__content").first().waitFor();
          await page.screenshot({ path: `${OUT}/view-${scheme}.png` });
        });
      }

      await shot("light", async (page) => {
        await compose(page, true);
        const burnUrl = await create(page);
        await page.goto("about:blank");
        await page.goto(burnUrl);
        await page.locator("#sb-burn-title").waitFor({ timeout: 15_000 });
        await page.screenshot({ path: `${OUT}/burn.png` });
      });
    } finally {
      await browser.close();
    }
  } finally {
    preview?.kill("SIGTERM");
    await relay.close();
  }
  console.log(`screenshots written to ${OUT}/`);
}

await main();
