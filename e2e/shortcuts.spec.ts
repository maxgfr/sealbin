import { expect, test } from "@playwright/test";
import { createPaste, readResult } from "./helpers";

test("? opens the shortcuts dialog and w toggles wrapping", async ({ page }) => {
  const { shareUrl } = await createPaste(page, { content: "a long line ".repeat(40) });
  await page.goto(shareUrl);
  await expect(page.locator("section.sb-code")).toBeVisible();

  await page.keyboard.press("?");
  const dialog = page.locator("dialog.sb-dialog", { hasText: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  const wrap = page.getByRole("toolbar", { name: "Paste actions" }).getByRole("button", {
    name: "Wrap",
  });
  const before = await wrap.getAttribute("aria-pressed");
  await page.keyboard.press("w");
  await expect(wrap).not.toHaveAttribute("aria-pressed", before ?? "");
  await page.keyboard.press("w");
  await expect(wrap).toHaveAttribute("aria-pressed", before ?? "");
});

test("the help button opens the same dialog", async ({ page }) => {
  await page.goto("./");
  await page.locator(".sb-header__help").click();
  await expect(page.locator("dialog.sb-dialog", { hasText: "Keyboard shortcuts" })).toBeVisible();
});

test("single-key shortcuts are inert while typing; Ctrl/Meta+S creates", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("textbox", { name: "Paste content" }).click();
  // Human-paced keys: back-to-back synthetic input into CodeMirror can stall Playwright's input ack.
  await page.keyboard.type("?wq", { delay: 80 });
  await expect(page.locator("dialog.sb-dialog", { hasText: "Keyboard shortcuts" })).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Paste content" })).toHaveText("?wq");

  await page.keyboard.press("ControlOrMeta+s");
  const { shareUrl } = await readResult(page);
  expect(new URL(shareUrl).hash).not.toBe("");
});
