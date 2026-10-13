import { bundledLanguagesInfo } from "shiki/langs";
import { describe, expect, it } from "vitest";
import {
  detectLang,
  type LangInfo,
  langFromFilename,
  langFromHljs,
  langLabel,
  resolveLang,
} from "./lang";

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

describe("detectLang", () => {
  it.each([
    ["The quick brown fox jumps over the lazy dog."],
    ["Meeting notes\nBuy milk and eggs\nCall Bob tomorrow"],
    ["short one\nline2\nline3"],
  ])("leaves prose as plain text: %j", async (content) => {
    expect(await detectLang(content, infos)).toBe("");
  });

  it.each([
    [
      "python",
      'def greet(name):\n    """Say hello."""\n    if not name:\n        return None\n    for i in range(3):\n        print(f"hello {name} {i}")\n    return True\n\n\nclass Greeter:\n    def __init__(self):\n        self.count = 0\n',
    ],
    [
      "sql",
      "SELECT u.id, u.name, COUNT(o.id) AS orders\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nWHERE u.created_at > '2024-01-01'\nGROUP BY u.id, u.name\nORDER BY orders DESC;\n",
    ],
    [
      "json",
      '{\n  "name": "sealbin",\n  "version": "1.0.0",\n  "private": true,\n  "tags": ["a", "b"],\n  "count": 3\n}\n',
    ],
    [
      "javascript",
      "function sum(values) {\n  let total = 0;\n  for (const v of values) {\n    total += v;\n  }\n  return total;\n}\n\nconsole.log(sum([1, 2, 3]));\n",
    ],
    [
      "shellscript",
      '#!/usr/bin/env bash\nset -euo pipefail\nfor f in *.txt; do\n  echo "$f"\ndone\n',
    ],
  ])("detects %s", async (expected, content) => {
    expect(await detectLang(content, infos)).toBe(expected);
  });
});
