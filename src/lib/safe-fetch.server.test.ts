import { describe, expect, it } from "vitest";
import { isPublicAddress, safeFetchText } from "./safe-fetch.server";

describe("safeFetchText SSRF protection", () => {
  it("allows globally routable IPv4 and IPv6 addresses", () => {
    expect(isPublicAddress("1.1.1.1")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.31.255.255",
    "169.254.169.254",
    "192.168.1.1",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])("blocks non-public IP address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://localhost/",
    "http://user:pass@example.com/",
  ])("rejects unsafe URL %s before making a request", async (url) => {
    await expect(safeFetchText(url)).rejects.toThrow();
  });
});
