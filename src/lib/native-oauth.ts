import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";

export const ANDROID_OAUTH_CALLBACK = "com.nagasatwik145.lordai://auth/callback";

export type OAuthCallback =
  { type: "code"; code: string } | { type: "error" } | { type: "invalid" };

export function parseAndroidOAuthCallback(value: string): OAuthCallback {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "com.nagasatwik145.lordai:" ||
      url.hostname !== "auth" ||
      url.pathname !== "/callback" ||
      url.port ||
      url.username ||
      url.password
    ) {
      return { type: "invalid" };
    }
    if (url.searchParams.has("error") || url.searchParams.has("error_description")) {
      return { type: "error" };
    }
    const code = url.searchParams.get("code");
    return code ? { type: "code", code } : { type: "invalid" };
  } catch {
    return { type: "invalid" };
  }
}

export function createOAuthCallbackProcessor(
  exchange: (code: string) => Promise<{ session: { user: unknown } | null; error?: unknown }>,
  onAuthenticated: () => void,
) {
  const exchanges = new Map<string, Promise<void>>();

  return (value: string): Promise<void> => {
    const callback = parseAndroidOAuthCallback(value);
    if (callback.type !== "code") return Promise.resolve();
    const existing = exchanges.get(callback.code);
    if (existing) return existing;

    const exchangePromise = exchange(callback.code)
      .then(({ session, error }) => {
        if (!error && session?.user) onAuthenticated();
      })
      .catch(() => undefined);
    exchanges.set(callback.code, exchangePromise);
    return exchangePromise;
  };
}

export function getOAuthRedirect(isNative: boolean, origin: string) {
  return isNative ? ANDROID_OAUTH_CALLBACK : `${origin}/auth`;
}

export async function registerNativeOAuthCallbacks(onAuthenticated: () => void) {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  let active = true;
  const { supabase } = await import("@/integrations/supabase/client");
  const processCallback = createOAuthCallbackProcessor(
    async (code) => {
      await Browser.close().catch(() => undefined);
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      return { session: data.session, error };
    },
    () => {
      if (active) onAuthenticated();
    },
  );

  const receiveCallback = async (url: string) => {
    const callback = parseAndroidOAuthCallback(url);
    if (callback.type === "error") {
      await Browser.close().catch(() => undefined);
      return;
    }
    if (callback.type === "code") await processCallback(url);
  };

  const urlHandle = await App.addListener("appUrlOpen", ({ url }) => {
    if (active) void receiveCallback(url);
  });
  const launch = await App.getLaunchUrl().catch(() => undefined);
  if (active && launch?.url) await receiveCallback(launch.url);

  return () => {
    active = false;
    void urlHandle.remove();
  };
}
