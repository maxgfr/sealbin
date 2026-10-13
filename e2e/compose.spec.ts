import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { createPaste, readResult, typeInEditor } from "./helpers";

/** Compose's own error, not the toast region (an always-present, empty role=alert live region). */
const createError = (page: Page) => page.getByRole("alert").filter({ hasText: "Nothing to seal" });

test("short link result: Open paste opens a new tab and leaving warns", async ({
  page,
  context,
}) => {
  await createPaste(page, { content: "keep my delete link", nostr: true });

  const open = page.getByRole("link", { name: "Open paste" });
  await expect(open).toHaveAttribute("target", "_blank");
  const [tab] = await Promise.all([context.waitForEvent("page"), open.click()]);
  await tab.close();
  await expect(page.locator("#sb-result-title")).toBeVisible();

  const [dialog] = await Promise.all([
    page.waitForEvent("dialog"),
    page.close({ runBeforeUnload: true }),
  ]);
  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept();
});

test("short link result: Delete now deletes the paste", async ({ page, browser }) => {
  const { shareUrl } = await createPaste(page, { content: "delete me now", nostr: true });
  await page.getByRole("button", { name: "Delete now" }).click();
  await expect(page.getByText("Paste deleted. Its link no longer opens it.")).toBeVisible({
    timeout: 15_000,
  });

  const reader = await browser.newContext();
  const later = await reader.newPage();
  await later.goto(shareUrl);
  await expect(later.locator("#sb-error-title")).toHaveText("This paste is gone");
  await reader.close();
});

test("burn result does not offer Open paste", async ({ page }) => {
  await createPaste(page, { content: "read once", burn: true });
  await expect(page.getByRole("link", { name: "Open paste" })).toHaveCount(0);
});

test("link result explains there is nothing to delete", async ({ page }) => {
  await createPaste(page, { content: "only in the link" });
  await expect(page.getByText(/nothing is stored, so there is nothing to delete/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete now" })).toHaveCount(0);
});

test("focus moves to the result heading after Create, and to the error on failure", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: /^Create/ }).click();
  await expect(createError(page)).toBeFocused();

  await typeInEditor(page, "focus me");
  await page.getByRole("button", { name: /^Create/ }).click();
  await readResult(page);
  await expect(page.locator("#sb-result-title")).toBeFocused();
});

test("Create shows the platform's shortcut and Control+S creates", async ({ page }) => {
  await page.goto("./");
  const create = page.getByRole("button", { name: /^Create/ });
  const apple = await page.evaluate(() => /Mac|iPod|iPhone|iPad/.test(navigator.platform));
  await expect(create.locator("kbd")).toHaveText(apple ? "⌘ S" : "Ctrl S");
  await expect(create).toHaveAttribute(
    "aria-keyshortcuts",
    apple ? "Meta+S Control+S" : "Control+S",
  );
  await typeInEditor(page, "control s");
  await page.keyboard.press("Control+s");
  await readResult(page);
});

test("Ctrl/Meta+S does nothing behind an open dialog", async ({ page }) => {
  await page.goto("./");
  await typeInEditor(page, "hidden behind a dialog");
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(page.locator("dialog.sb-dialog[open]")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(500);
  await expect(page.locator("#sb-result-title")).toHaveCount(0);
});

test("a stale Create error clears when an option changes", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /^Create/ }).click();
  await expect(createError(page)).toBeVisible();
  await page.getByRole("button", { name: "Short link (Nostr)" }).click();
  await expect(createError(page)).toHaveCount(0);

  await page.getByRole("button", { name: /^Create/ }).click();
  await expect(createError(page)).toBeVisible();
  await page.locator("#sb-expiry").selectOption({ index: 0 });
  await page.locator("#sb-title").fill("x");
  await expect(createError(page)).toHaveCount(0);
});

test("an opened CRLF file round-trips byte for byte", async ({ page, browser }) => {
  const text = "first line\r\nsecond line\r\n\r\nlast";
  await page.goto("./");
  await page.locator('input[type="file"]').setInputFiles({
    name: "windows.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(text, "utf8"),
  });
  await expect(page.locator("#sb-filename")).toHaveValue("windows.txt");
  await page.getByRole("button", { name: /^Create/ }).click();
  const { shareUrl } = await readResult(page);

  const reader = await browser.newContext({ acceptDownloads: true });
  const view = await reader.newPage();
  await view.goto(shareUrl);
  await expect(view.locator("section.sb-code")).toBeVisible();
  const [download] = await Promise.all([view.waitForEvent("download"), view.keyboard.press("d")]);
  const path = await download.path();
  expect(await readFile(path, "utf8")).toBe(text);
  await reader.close();
});

test("opening a file over existing text asks first", async ({ page }) => {
  await page.goto("./");
  await typeInEditor(page, "keep me");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator('input[type="file"]').setInputFiles({
    name: "other.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("replacement", "utf8"),
  });
  await expect(page.getByRole("textbox", { name: "Paste content" })).toHaveText("keep me");
  await expect(page.locator("#sb-filename")).toHaveValue("");

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({
    name: "other.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("replacement", "utf8"),
  });
  await expect(page.getByRole("textbox", { name: "Paste content" })).toHaveText("replacement");
});

test("a fork's language is a starting value that a new filename overrides", async ({ page }) => {
  await page.goto("./");
  await typeInEditor(page, "print('forked')");
  await page.locator("#sb-lang").selectOption("python");
  await page.getByRole("button", { name: /^Create/ }).click();
  const { shareUrl } = await readResult(page);

  await page.goto(shareUrl);
  await expect(page.locator("section.sb-code")).toBeVisible();
  await page.getByRole("button", { name: /^Fork/ }).click();
  const hint = page.locator("#sb-lang-hint");
  await expect(hint).toHaveText(/from the original paste\.$/);
  await expect(page.locator("#sb-lang")).toHaveValue("");

  await page.locator("#sb-filename").fill("main.rs");
  await expect(hint).toHaveText(/from the filename\.$/);
});
