import { expect, test } from "@playwright/test";
import { codeLines, createPaste } from "./helpers";

test("short link: create, open, delete with the delete link, then gone", async ({
  page,
  browser,
}) => {
  const { shareUrl, deleteUrl } = await createPaste(page, {
    content: "stored on the relay",
    title: "Relay note",
    nostr: true,
  });
  expect(deleteUrl).not.toBeNull();

  const reader = await browser.newContext();
  const view = await reader.newPage();
  await view.goto(shareUrl);
  await expect(view.locator("#sb-view-title")).toHaveText("Relay note");
  expect((await codeLines(view)).join("\n")).toBe("stored on the relay");

  await page.goto(deleteUrl ?? "");
  await page.getByRole("button", { name: "Delete paste" }).click();
  await expect(page.getByRole("heading", { name: "Paste deleted" })).toBeVisible();

  const later = await reader.newPage();
  await later.goto(shareUrl);
  await expect(later.locator("#sb-error-title")).toHaveText("This paste is gone");
  await reader.close();
});

test("burn after reading: the first reader sees it once, the second finds it gone", async ({
  page,
  browser,
}) => {
  const { shareUrl } = await createPaste(page, { content: "read me once", burn: true });

  const first = await browser.newContext();
  const view = await first.newPage();
  await view.goto(shareUrl);
  await expect(view.locator("#sb-burn-title")).toBeVisible();
  await view.getByRole("button", { name: "Reveal and destroy" }).click();
  expect((await codeLines(view)).join("\n")).toBe("read me once");
  await expect.poll(() => new URL(view.url()).hash).toBe("");
  await first.close();

  const second = await browser.newContext();
  const again = await second.newPage();
  await again.goto(shareUrl);
  await expect(again.locator("#sb-error-title")).toHaveText("This paste is gone");
  await second.close();
});

test("short link: a long incompressible paste is split across relay events, opens and deletes", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  // ~320 KB of random base64 in 76-character lines: several events on a 131,072-byte relay
  const bytes = new Uint8Array(240_000);
  for (let i = 0; i < bytes.length; i += 65_536)
    crypto.getRandomValues(bytes.subarray(i, i + 65_536));
  const content = (
    Buffer.from(bytes)
      .toString("base64")
      .match(/.{1,76}/g) ?? []
  ).join("\n");
  expect(content.length).toBeGreaterThan(300_000);

  const { shareUrl, deleteUrl } = await createPaste(page, {
    content,
    title: "Long note",
    nostr: true,
    paste: true,
  });
  expect(deleteUrl).not.toBeNull();

  const reader = await browser.newContext();
  const view = await reader.newPage();
  await view.goto(shareUrl);
  await expect(view.locator("#sb-view-title")).toHaveText("Long note");
  expect((await codeLines(view)).join("\n")).toBe(content);

  await page.goto(deleteUrl ?? "");
  await page.getByRole("button", { name: "Delete paste" }).click();
  await expect(page.getByRole("heading", { name: "Paste deleted" })).toBeVisible();

  const later = await reader.newPage();
  await later.goto(shareUrl);
  await expect(later.locator("#sb-error-title")).toHaveText("This paste is gone");
  await reader.close();
});
