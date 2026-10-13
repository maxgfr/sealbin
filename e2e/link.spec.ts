import { expect, test } from "@playwright/test";
import { codeLines, createPaste } from "./helpers";

const SOURCE = 'fn main() {\n    println!("hello, sealbin");\n}';

test("link paste opens in a fresh context with the same content, highlighted", async ({
  page,
  browser,
}) => {
  const { shareUrl, deleteUrl } = await createPaste(page, {
    content: SOURCE,
    title: "Greeting",
    filename: "main.rs",
  });
  expect(deleteUrl).toBeNull();
  expect(new URL(shareUrl).hash).not.toBe("");

  const reader = await browser.newContext();
  const view = await reader.newPage();
  await view.goto(shareUrl);
  await expect(view.locator("#sb-view-title")).toHaveText("Greeting");
  await expect(view.locator("section.sb-code[data-state=highlighted]")).toBeVisible();
  expect((await codeLines(view)).join("\n")).toBe(SOURCE);
  await reader.close();
});

test("password-protected link: wrong password is refused, the right one unlocks", async ({
  page,
  browser,
}) => {
  const { shareUrl } = await createPaste(page, {
    content: "the secret recipe",
    title: "Recipe",
    password: "correct horse",
  });

  const reader = await browser.newContext();
  const view = await reader.newPage();
  await view.goto(shareUrl);
  const input = view.locator("#sb-unlock-password");
  await input.fill("wrong battery");
  await view.getByRole("button", { name: "Unlock" }).click();
  await expect(view.locator("#sb-unlock-error")).toContainText("Wrong password");

  await input.fill("correct horse");
  await view.getByRole("button", { name: "Unlock" }).click();
  await expect(view.locator("#sb-view-title")).toHaveText("Recipe");
  expect((await codeLines(view)).join("\n")).toBe("the secret recipe");
  await reader.close();
});

test("link paste expiry is enforced by the reader's clock", async ({ page, browser }) => {
  const created = Date.now();
  const { shareUrl } = await createPaste(page, { content: "short-lived", expiry: "10 minutes" });

  const reader = await browser.newContext();
  const view = await reader.newPage();
  await view.clock.setFixedTime(created + 11 * 60_000);
  await view.goto(shareUrl);
  await expect(view.locator("#sb-error-title")).toHaveText("This paste has expired");
  await expect(view.locator("section.sb-code")).toHaveCount(0);
  await reader.close();
});

test("a visited link paste reloads offline from the service worker", async ({ page, context }) => {
  const { shareUrl } = await createPaste(page, { content: "works on a plane", filename: "a.txt" });
  await page.goto(shareUrl);
  await expect(page.locator("section.sb-code")).toBeVisible();
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
  // A controlled reload caches the lazy chunks this view needs (runtime CacheFirst).
  await page.reload();
  await expect(page.locator("section.sb-code")).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("section.sb-code")).toBeVisible();
  expect((await codeLines(page)).join("\n")).toBe("works on a plane");
  await context.setOffline(false);
});

test("fast typing in the editor keeps the page responsive and the text intact", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("textbox", { name: "Paste content" }).click();
  // Back-to-back keys used to make the editor and Compose write stale text into each other forever.
  const text = "const answer = 42; // typed quickly, one key after another";
  await page.keyboard.type(text);
  await expect(page.getByRole("textbox", { name: "Paste content" })).toHaveText(text);
  await page.locator("#sb-title").fill("still responsive");
  await expect(page.locator("#sb-title")).toHaveValue("still responsive");
});
