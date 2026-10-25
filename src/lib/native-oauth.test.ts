import { describe, expect, it, vi } from "vitest";
import {
  ANDROID_OAUTH_CALLBACK,
  createOAuthCallbackProcessor,
  getOAuthRedirect,
  parseAndroidOAuthCallback,
} from "./native-oauth";

describe("native OAuth callbacks", () => {
  it("accepts the configured Android callback and extracts its code", () => {
    expect(parseAndroidOAuthCallback(`${ANDROID_OAUTH_CALLBACK}?code=pkce-code`)).toEqual({
      type: "code",
      code: "pkce-code",
    });
  });

  it.each([
    "https://example.com/auth/callback?code=x",
    "lordai://open/auth/callback?code=x",
    "com.nagasatwik145.lordai://auth/other?code=x",
    "com.nagasatwik145.lordai://auth/callback/path?code=x",
    "com.nagasatwik145.lordai://auth/callback",
    "com.nagasatwik145.lordai://auth/callback?error=access_denied",
  ])("rejects invalid or unsuccessful callback %s", (url) => {
    expect(parseAndroidOAuthCallback(url)).not.toMatchObject({ type: "code" });
  });

  it("exchanges a callback code only once and navigates only after a session exists", async () => {
    let resolveExchange!: (result: { session: { user: object } | null }) => void;
    const exchange = vi.fn(
      () =>
        new Promise<{ session: { user: object } | null }>((resolve) => (resolveExchange = resolve)),
    );
    const navigate = vi.fn();
    const processCallback = createOAuthCallbackProcessor(exchange, navigate);
    const callback = `${ANDROID_OAUTH_CALLBACK}?code=one-use-code`;

    const first = processCallback(callback);
    const duplicate = processCallback(callback);
    expect(exchange).toHaveBeenCalledTimes(1);
    resolveExchange({ session: { user: {} } });
    await Promise.all([first, duplicate]);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("keeps browser OAuth redirects on the website", () => {
    expect(getOAuthRedirect(false, "https://lordai.example")).toBe("https://lordai.example/auth");
    expect(getOAuthRedirect(true, "https://lordai.example")).toBe(ANDROID_OAUTH_CALLBACK);
  });
});
