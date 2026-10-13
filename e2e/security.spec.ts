import { expect, type Page, test } from "@playwright/test";
import { createPaste, ORIGIN } from "./helpers";

const HOSTILE = [
  "# Hello",
  "",
  "<script>window.__pwned = 'script'</script>",
  "",
  "<img src=x onerror=\"window.__pwned = 'img'\">",
  "",
  "[click](javascript:window.__pwned='link')",
].join("\n");

/** Collects CSP violations (console reports and `securitypolicyviolation` events) for a page. */
async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  await page.exposeFunction("__reportCsp", (v: string) => {
    violations.push(v);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      const report = (window as unknown as { __reportCsp: (v: string) => void }).__reportCsp;
      report(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return violations;
}

test("hostile Markdown is rendered inert", async ({ page, browser }) => {
  const { shareUrl } = await createPaste(page, { content: HOSTILE, filename: "notes.md" });

  const reader = await browser.newContext();
  const view = await reader.newPage();
  const dialogs: string[] = [];
  view.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await view.goto(shareUrl);
  const article = view.locator("article.sb-markdown");
  if ((await article.count()) === 0) {
    await view.getByRole("button", { name: "Rendered Markdown" }).click();
  }
  await expect(article).toBeVisible();
  await expect(article.getByRole("heading", { name: "Hello" })).toBeVisible();
  await expect(article.locator("script")).toHaveCount(0);
  await expect(article.locator("[onerror]")).toHaveCount(0);
  await expect(article.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(await view.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBe(
    undefined,
  );
  expect(dialogs).toEqual([]);
  await reader.close();
});

test("link mode makes no cross-origin request from create to view", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    requests.push(r.url());
  });
  const { shareUrl } = await createPaste(page, {
    content: "export const answer = 42;\n",
    filename: "answer.ts",
  });
  await page.goto(shareUrl);
  await expect(page.locator("section.sb-code[data-state=highlighted]")).toBeVisible();

  expect(requests.length).toBeGreaterThan(0);
  const foreign = requests.filter((u) => !u.startsWith("data:") && new URL(u).origin !== ORIGIN);
  expect(foreign).toEqual([]);
});

test("no CSP violation across link, Markdown and Nostr flows", async ({ page }) => {
  const violations = await watchCsp(page);

  const link = await createPaste(page, { content: "# Title\n\nbody text", filename: "a.md" });
  await page.goto(link.shareUrl);
  await expect(page.locator("article.sb-markdown, section.sb-code").first()).toBeVisible();

  const nostr = await createPaste(page, {
    content: "const relay = true;",
    filename: "r.js",
    nostr: true,
  });
  await page.goto(nostr.shareUrl);
  await expect(page.locator("section.sb-code[data-state=highlighted]")).toBeVisible();

  expect(violations).toEqual([]);
});
