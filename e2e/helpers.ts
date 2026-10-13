import { expect, type Page } from "@playwright/test";

export const ORIGIN = "http://127.0.0.1:4173";

export interface ComposeOptions {
  content: string;
  title?: string;
  filename?: string;
  /** Expiry option label, e.g. "10 minutes". */
  expiry?: string;
  password?: string;
  nostr?: boolean;
  burn?: boolean;
}

export interface Created {
  shareUrl: string;
  deleteUrl: string | null;
}

/** Types `text` into the CodeMirror editor (no auto-indent or bracket surprises: inserted as is). */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  const editor = page.getByRole("textbox", { name: "Paste content" });
  await editor.click();
  await page.keyboard.insertText(text);
}

/** Opens Compose, fills it in and creates the paste; returns the links from the result panel. */
export async function createPaste(page: Page, o: ComposeOptions): Promise<Created> {
  await page.goto("./");
  if (o.title) await page.locator("#sb-title").fill(o.title);
  if (o.filename) await page.locator("#sb-filename").fill(o.filename);
  await typeInEditor(page, o.content);
  if (o.expiry) await page.locator("#sb-expiry").selectOption({ label: o.expiry });
  if (o.password) await page.locator("#sb-password").fill(o.password);
  if (o.nostr) await page.getByRole("button", { name: "Short link (Nostr)" }).click();
  if (o.burn) await page.getByRole("checkbox", { name: "Burn after reading" }).check();
  await page.getByRole("button", { name: /^Create/ }).click();
  return readResult(page);
}

export async function readResult(page: Page): Promise<Created> {
  await expect(page.locator("#sb-result-title")).toHaveText("Paste sealed", { timeout: 15_000 });
  const shareUrl = await page.locator("#sb-share-url").inputValue();
  const del = page.locator("#sb-delete-url");
  const deleteUrl = (await del.count()) > 0 ? await del.inputValue() : null;
  return { shareUrl, deleteUrl };
}

/** Lines of the highlighted code view, as text. */
export async function codeLines(page: Page): Promise<string[]> {
  await expect(
    page.locator("section.sb-code .sb-code__line .sb-code__content").first(),
  ).toBeVisible();
  return page.locator("section.sb-code .sb-code__line .sb-code__content").allInnerTexts();
}
