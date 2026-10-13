import { bundledLanguagesInfo } from "shiki/langs";
import { describe, expect, it } from "vitest";
import { type LangInfo, langFromFilename, langFromHljs, langLabel, resolveLang } from "./lang";

const infos: LangInfo[] = bundledLanguagesInfo;

describe("resolveLang", () => {
  it("matches ids and aliases, case-insensitively", () => {
    expect(resolveLang("TypeScript", infos)).toBe("typescript");
    expect(resolveLang("ts", infos)).toBe("typescript");
    expect(resolveLang("sh", infos)).toBe("shellscript");
    expect(resolveLang("nope-lang", infos)).toBeNull();
    expect(resolveLang("  ", infos)).toBeNull();
  });
});

describe("langFromFilename", () => {
  it.each([
    ["main.ts", "typescript"],
    ["App.tsx", "tsx"],
    ["server.mjs", "javascript"],
    ["script.py", "python"],
    ["lib.rs", "rust"],
    ["config.yml", "yaml"],
    ["README.md", "markdown"],
    ["deploy.sh", "shellscript"],
    ["foo.hpp", "cpp"],
    ["src/dir/x.go", "go"],
    ["Dockerfile", "docker"],
    ["Makefile", "make"],
    ["notes.txt", ""],
  ])("%s → %s", (name, id) => {
    expect(langFromFilename(name, infos)).toBe(id);
  });

  it("returns null when nothing matches", () => {
    expect(langFromFilename("", infos)).toBeNull();
    expect(langFromFilename("README", infos)).toBeNull();
    expect(langFromFilename("archive.zzz", infos)).toBeNull();
    expect(langFromFilename("trailing.", infos)).toBeNull();
  });

  it("only returns ids Shiki knows", () => {
    for (const name of ["a.cjs", "a.h", "a.cc", "a.htm", "a.kts", "a.ex", "a.hs", "a.ps1"]) {
      const id = langFromFilename(name, infos);
      expect(id && infos.some((l) => l.id === id), name).toBe(true);
    }
  });
});

describe("langFromHljs", () => {
  it("maps highlight.js names to Shiki ids", () => {
    expect(langFromHljs("javascript", infos)).toBe("javascript");
    expect(langFromHljs("bash", infos)).toBe("shellscript");
    expect(langFromHljs("plaintext", infos)).toBe("");
    expect(langFromHljs(undefined, infos)).toBe("");
  });
});

describe("langLabel", () => {
  it("uses Shiki's display name", () => {
    expect(langLabel("", infos)).toBe("Plain text");
    expect(langLabel("python", infos)).toBe("Python");
  });
});
