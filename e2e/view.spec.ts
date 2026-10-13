import { expect, type Page, test } from "@playwright/test";
import { codeLines, createPaste } from "./helpers";

test("switching the theme and reloading a link paste raises no page error", async ({
  page: author,
  browser,
}) => {
  const { shareUrl } = await createPaste(author, {
    content: `# Notes\n\nSome *text* and a long line ${"word ".repeat(60)}`,
    title: "Notes",
    filename: "notes.md",
  });
  const reader = await browser.newContext();
  const page = await reader.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(shareUrl);
  await expect(page.locator("section.sb-code")).toBeVisible();
  await page.locator("#sb-theme-scheme").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#sb-theme-scheme").selectOption("light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("#sb-theme-code").selectOption("dracula");
  await expect(page.locator("section.sb-code[data-state=highlighted]")).toBeVisible();
  expect(errors).toEqual([]);
  await reader.close();
});

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

/** Shows the rendered Markdown (it may already be the default view). */
async function renderedMarkdown(page: Page) {
  const article = page.locator("article.sb-markdown");
  if ((await article.count()) === 0) {
    await page.getByRole("button", { name: "Rendered Markdown" }).click();
  }
  await expect(article).toBeVisible();
  return article;
}

test("burn: a second tab already on the interstitial finds the paste gone on reveal", async ({
  page,
  browser,
}) => {
  const { shareUrl } = await createPaste(page, { content: "only once", burn: true });

  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage();
  const b = await second.newPage();
  await a.goto(shareUrl);
  await b.goto(shareUrl);
  await expect(a.locator("#sb-burn-title")).toBeVisible();
  await expect(b.locator("#sb-burn-title")).toBeVisible();

  await a.getByRole("button", { name: "Reveal and destroy" }).click();
  expect((await codeLines(a)).join("\n")).toBe("only once");
  await expect(a.getByText("Destroyed on the relays")).toBeVisible({ timeout: 15_000 });

  await b.getByRole("button", { name: "Reveal and destroy" }).click();
  await expect(b.locator("#sb-error-title")).toHaveText("This paste is gone");
  await expect(b.locator("section.sb-code")).toHaveCount(0);
  await first.close();
  await second.close();
});

test("Markdown: an in-page anchor scrolls to its heading and stays on the paste", async ({
  page,
  browser,
}) => {
  const filler = Array.from({ length: 80 }, (_, i) => `Paragraph ${i}.`).join("\n\n");
  const content = [
    "# Guide",
    "",
    "[jump](#usage) and [out](https://example.com/)",
    "",
    filler,
    "",
    "## Usage",
    "",
    "Run it.",
  ].join("\n");
  const { shareUrl } = await createPaste(page, { content, filename: "guide.md" });

  const reader = await browser.newContext();
  const view = await reader.newPage();
  await view.goto(shareUrl);
  const article = await renderedMarkdown(view);
  await expect(article.locator("h2#md-usage")).toHaveText("Usage");
  await expect(article.getByRole("link", { name: "out" })).toHaveAttribute("target", "_blank");
  await expect(article.getByRole("link", { name: "out" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );

  await article.getByRole("link", { name: "jump" }).click();
  await expect(article.locator("h2#md-usage")).toBeInViewport();
  expect(view.url()).toBe(shareUrl);
  await expect(view.locator("#sb-view-title")).toHaveText("guide.md");
  await reader.close();
});

test("Markdown: raw HTML is shown as text and causes no CSP violation", async ({
  page,
  browser,
}) => {
  const content = ["# Raw", "", "<img src=x onerror=alert(1)>", "", "inline <b>bold</b>"].join(
    "\n",
  );
  const { shareUrl } = await createPaste(page, { content, filename: "raw.md" });

  const reader = await browser.newContext();
  const view = await reader.newPage();
  const violations = await watchCsp(view);
  await view.goto(shareUrl);
  const article = await renderedMarkdown(view);
  await expect(article.getByRole("heading", { name: "Raw" })).toBeVisible();
  await expect(article).toContainText("<img src=x onerror=alert(1)>");
  await expect(article).toContainText("inline <b>bold</b>");
  await expect(article.locator("img, b")).toHaveCount(0);
  expect(violations).toEqual([]);
  await reader.close();
});

test("an open paste switches to the expired state once its expiry passes", async ({
  page,
  browser,
}) => {
  const created = Date.now();
  const { shareUrl } = await createPaste(page, { content: "fleeting", expiry: "10 minutes" });

  const reader = await browser.newContext();
  const view = await reader.newPage();
  await view.clock.install({ time: created + 9 * 60_000 });
  await view.goto(shareUrl);
  expect((await codeLines(view)).join("\n")).toBe("fleeting");

  await view.clock.fastForward(2 * 60_000);
  await expect(view.locator("#sb-error-title")).toHaveText("This paste has expired");
  await expect(view.locator("section.sb-code")).toHaveCount(0);
  await reader.close();
});
