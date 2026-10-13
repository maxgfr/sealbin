import { expect, type Page, test } from "@playwright/test";
import { codeLines, createPaste } from "./helpers";

/** Waits until a service worker controls the page (clientsClaim: no reload needed). */
async function waitForController(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
}

test("the service worker takes over at once: skipWaiting and clientsClaim, no waiting worker", async ({
  page,
  request,
}) => {
  const sw = await (await request.get("sw.js")).text();
  expect(sw).toContain("self.skipWaiting()");
  expect(sw).toContain("clientsClaim()");
  expect(sw).toContain("cleanupOutdatedCaches()");
  // The old build only skipped waiting on a message that nothing sent.
  expect(sw).not.toContain("SKIP_WAITING");

  await page.goto("./");
  await waitForController(page);
});

test("after one visit to home, a fresh link paste and a delete link open offline", async ({
  browser,
}) => {
  const author = await browser.newContext();
  const authorPage = await author.newPage();
  const { shareUrl } = await createPaste(authorPage, {
    content: "never seen here",
    filename: "a.txt",
  });
  const { deleteUrl } = await createPaste(authorPage, { content: "short link", nostr: true });
  expect(deleteUrl).not.toBeNull();
  await author.close();

  const reader = await browser.newContext();
  const page = await reader.newPage();
  await page.goto("./");
  await waitForController(page);
  await reader.setOffline(true);

  await page.goto(shareUrl);
  await expect(page.locator("section.sb-code")).toBeVisible();
  expect((await codeLines(page)).join("\n")).toBe("never seen here");

  await page.goto(deleteUrl ?? "");
  await expect(page.getByRole("heading", { name: "Delete this paste?" })).toBeVisible();
  await reader.close();
});

test("reopening the same delete link in the tab shows a fresh confirm and drops the key again", async ({
  page,
}) => {
  const { deleteUrl } = await createPaste(page, { content: "delete me twice", nostr: true });
  const hash = new URL(deleteUrl ?? "").hash;
  await page.goto(deleteUrl ?? "");
  await expect(page).not.toHaveURL(/#/);
  await page.getByRole("button", { name: "Delete paste" }).click();
  await expect(page.getByRole("heading", { name: "Paste deleted" })).toBeVisible();

  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await expect(page.getByRole("heading", { name: "Delete this paste?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Paste deleted" })).toHaveCount(0);
  await expect(page).not.toHaveURL(/#/);
});

test("the brand link and the n shortcut open a fresh Compose from the result panel", async ({
  page,
}) => {
  await createPaste(page, { content: "first" });
  await page.getByRole("link", { name: "sealbin" }).click();
  await expect(page.locator("#sb-result-title")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Paste content" })).toBeVisible();

  await page.getByRole("textbox", { name: "Paste content" }).click();
  await page.keyboard.insertText("second");
  await page.getByRole("button", { name: /^Create/ }).click();
  await expect(page.locator("#sb-result-title")).toHaveText("Paste sealed", { timeout: 15_000 });
  await page.locator("#sb-result-title").click();
  await page.keyboard.press("n");
  await expect(page.locator("#sb-result-title")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Paste content" })).toBeVisible();

  // Already on #/ now: the brand link must still give a fresh Compose (no hashchange fires).
  await expect(page).toHaveURL(/#\/$/);
  await page.getByRole("textbox", { name: "Paste content" }).click();
  await page.keyboard.insertText("third");
  await page.getByRole("button", { name: /^Create/ }).click();
  await expect(page.locator("#sb-result-title")).toHaveText("Paste sealed", { timeout: 15_000 });
  await page.getByRole("link", { name: "sealbin" }).click();
  await expect(page.locator("#sb-result-title")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Paste content" })).toBeVisible();
});

test.describe("lazy screen load failure", () => {
  test.use({ serviceWorkers: "block" });

  test("shows the error with a Reload button that recovers", async ({ page, browser }) => {
    const author = await browser.newContext();
    const { shareUrl } = await createPaste(await author.newPage(), { content: "retry me" });
    await author.close();

    await page.route(/\/assets\/View-[^/]*\.js$/, (r) => r.abort());
    await page.goto(shareUrl);
    const alert = page.getByRole("alert").filter({ hasText: "This screen could not load" });
    await expect(alert).toBeVisible();

    await page.unroute(/\/assets\/View-[^/]*\.js$/);
    await alert.getByRole("button", { name: "Reload" }).click();
    await expect(page.locator("section.sb-code")).toBeVisible();
    expect((await codeLines(page)).join("\n")).toBe("retry me");
  });
});
