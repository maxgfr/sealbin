import { describe, expect, it } from "vitest";
import { registerServiceWorker } from "./sw";

function container(result: Promise<unknown>): { register: () => Promise<unknown> } {
  return { register: () => result };
}

describe("registerServiceWorker", () => {
  it("registers the worker for the app's scope", async () => {
    const calls: [string, RegistrationOptions | undefined][] = [];
    await registerServiceWorker(
      {
        register: (url: string, opts?: RegistrationOptions) => {
          calls.push([url, opts]);
          return Promise.resolve({});
        },
      },
      "/sealbin/",
    );
    expect(calls).toEqual([["/sealbin/sw.js", { scope: "/sealbin/" }]]);
  });

  it("settles when the browser aborts the registration (Firefox, page unloading)", async () => {
    const aborted = new DOMException("The operation was aborted.", "AbortError");
    await expect(
      registerServiceWorker(container(Promise.reject(aborted)), "/sealbin/"),
    ).resolves.toBeUndefined();
  });

  it("still reports any other failure", async () => {
    const broken = new TypeError("bad script");
    await expect(
      registerServiceWorker(container(Promise.reject(broken)), "/sealbin/"),
    ).rejects.toBe(broken);
  });
});
