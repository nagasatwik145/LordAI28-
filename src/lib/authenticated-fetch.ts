import { supabase } from "@/integrations/supabase/client";

type Session = NonNullable<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]>;

async function getUsableSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) return { session: null, refreshAttempted: false };
  const session = data.session;
  if (!session) return { session: null, refreshAttempted: false };

  // Avoid sending a token that is about to expire while the app was in the
  // background. Supabase persists the refreshed session for the next request.
  if (session.expires_at && session.expires_at <= Math.floor(Date.now() / 1000) + 30) {
    const refreshed = await supabase.auth.refreshSession();
    return {
      session: refreshed.error ? session : (refreshed.data.session ?? session),
      refreshAttempted: true,
    };
  }
  return { session, refreshAttempted: false };
}

function authorizationHeader(session: Session | null): Record<string, string> {
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export async function getSupabaseAuthHeaders(): Promise<Record<string, string>> {
  const { session } = await getUsableSession();
  return authorizationHeader(session);
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const { session, refreshAttempted } = await getUsableSession();
  const authHeaders = authorizationHeader(session);
  const headers = new Headers(init.headers);
  headers.set("Accept", headers.get("Accept") ?? "application/json, text/event-stream");

  for (const [key, value] of Object.entries(authHeaders)) {
    headers.set(key, value);
  }

  const retryInput = input instanceof Request ? input.clone() : input;
  const canReplayBody = !(
    typeof ReadableStream !== "undefined" && init.body instanceof ReadableStream
  );
  const response = await fetch(input, {
    ...init,
    credentials: "same-origin",
    headers,
  });

  // A single refresh/replay handles a token that expired between session read
  // and request validation. Never retry a request more than once.
  if (
    response.status !== 401 ||
    !session?.access_token ||
    refreshAttempted ||
    !canReplayBody ||
    init.signal?.aborted
  ) {
    return response;
  }

  const refreshed = await supabase.auth.refreshSession();
  const newSession = refreshed.error ? null : refreshed.data.session;
  if (!newSession?.access_token || newSession.access_token === session.access_token)
    return response;

  headers.set("Authorization", `Bearer ${newSession.access_token}`);
  return fetch(retryInput, { ...init, credentials: "same-origin", headers });
}
