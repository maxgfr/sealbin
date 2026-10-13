import { expect, test } from "@playwright/test";
import { createPaste, typeInEditor } from "./helpers";

const DRACULA = { bg: "rgb(40, 42, 54)", fg: "rgb(248, 248, 242)", keyword: "rgb(255, 121, 198)" };
const GITHUB_LIGHT = { bg: "rgb(255, 255, 255)", keyword: "rgb(215, 58, 73)" };

test("the editor follows the code theme", async ({ page }) => {
  await page.goto("./");
  await page.locator("#sb-lang").selectOption("javascript");
  await typeInEditor(page, 'const greeting = "hi";');
  const keyword = page.locator(".cm-line span", { hasText: /^const$/ });

  await page.locator("#sb-theme-code").selectOption("dracula");
  await expect(page.locator(".cm-editor")).toHaveCSS("background-color", DRACULA.bg);
  await expect(page.locator(".cm-editor")).toHaveCSS("color", DRACULA.fg);
  await expect(keyword).toHaveCSS("color", DRACULA.keyword);

  await page.locator("#sb-theme-code").selectOption("github-light");
  await expect(page.locator(".cm-editor")).toHaveCSS("background-color", GITHUB_LIGHT.bg);
  await expect(keyword).toHaveCSS("color", GITHUB_LIGHT.keyword);
});

test("a plain-text paste takes the code theme's colours", async ({ page }) => {
  const { shareUrl } = await createPaste(page, { content: "just some words" });
  await page.goto(shareUrl);
  const code = page.locator("section.sb-code");
  await expect(code).toHaveAttribute("data-state", "plain");

  await page.locator("#sb-theme-code").selectOption("dracula");
  await expect(code).toHaveCSS("background-color", DRACULA.bg);
  await expect(code).toHaveCSS("color", DRACULA.fg);
});
