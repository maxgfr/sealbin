import { describe, expect, it } from "vitest";
import { downloadName, extensionFor, textBlobUrl } from "./download";

describe("downloadName", () => {
  it("keeps the paste's filename", () => {
    expect(downloadName({ filename: "main.rs", lang: "rust" })).toBe("main.rs");
    expect(downloadName({ filename: "  notes.txt ", lang: "" })).toBe("notes.txt");
  });

  it("drops directories and replaces reserved characters", () => {
    expect(downloadName({ filename: "../../etc/passwd", lang: "" })).toBe("passwd");
    expect(downloadName({ filename: "C:\\tmp\\a<b>?.js", lang: "javascript" })).toBe("a_b__.js");
    expect(downloadName({ filename: "..", lang: "python" })).toBe("paste.py");
  });

  it("falls back to paste.<ext> from the language", () => {
    expect(downloadName({ filename: "", lang: "typescript" })).toBe("paste.ts");
    expect(downloadName({ filename: "", lang: "markdown" })).toBe("paste.md");
    expect(downloadName({ filename: "", lang: "go" })).toBe("paste.go");
    expect(downloadName({ filename: "", lang: "" })).toBe("paste.txt");
    expect(downloadName({ filename: "", lang: "docker" })).toBe("Dockerfile");
  });
});

describe("extensionFor", () => {
  it("maps known ids and keeps other ids alphanumeric", () => {
    expect(extensionFor("shellscript")).toBe("sh");
    expect(extensionFor("c")).toBe("c");
    expect(extensionFor("objective-cpp")).toBe("objectivecpp");
    expect(extensionFor("")).toBe("txt");
  });
});

describe("textBlobUrl", () => {
  it("creates a text/plain blob: URL", async () => {
    const url = textBlobUrl("<script>alert(1)</script>");
    expect(url.startsWith("blob:")).toBe(true);
    const res = await fetch(url);
    expect(res.headers.get("content-type")).toBe("text/plain;charset=utf-8");
    expect(await res.text()).toBe("<script>alert(1)</script>");
    URL.revokeObjectURL(url);
  });
});
