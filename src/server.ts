import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { getServerEnvironmentDiagnostics, reloadServerEnv } from "./lib/env.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

// Capacitor serves the bundled UI from a local HTTPS origin. Permit only the
// known Capacitor origins to call this server's API from the WebView.
const nativeOrigins = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
]);
const nativeCorsHeaders = {
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers":
    "Accept, Authorization, Content-Type, apikey, x-client-info, x-supabase-api-version",
  "access-control-max-age": "86400",
};

function addNativeCors(request: Request, response: Response): Response {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!url.pathname.startsWith("/api/") || !origin || !nativeOrigins.has(origin)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", [headers.get("vary"), "Origin"].filter(Boolean).join(", "));
  if (request.method === "OPTIONS") {
    for (const [name, value] of Object.entries(nativeCorsHeaders)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

let serverEntryPromise: Promise<ServerEntry> | undefined;

// Re-read the env files on every server start. The dev server otherwise keeps
// the dotenv snapshot taken when the process booted, so a `.env` edited after
// startup left the process holding a STALE provider key — the provider then
// answers 400 "API key not valid." / 401 "Incorrect API key provided." for a
// key that is perfectly valid on disk. Values are also normalized here
// (surrounding quotes and stray whitespace stripped) because those are sent
// verbatim in the auth header and rejected as invalid credentials.
const envReport = reloadServerEnv();

console.info(
  JSON.stringify({
    event: "server_env_loaded",
    message: "ENV LOADED",
    cwd: envReport.cwd,
    files: envReport.files,
    changes: envReport.changes.map((change) => ({
      name: change.name,
      action: change.action,
      before: { exists: change.before.exists },
      after: { exists: change.after.exists },
    })),
    providerKeys: envReport.providerKeys.map((key) => ({
      name: key.name,
      exists: key.exists,
      length: key.length,
    })),
  }),
);
for (const warning of envReport.warnings) {
  console.warn(`[env] ${warning}`);
}
const missingServerEnvironment = getServerEnvironmentDiagnostics()
  .filter((entry) => !entry.exists)
  .map((entry) => entry.name);
console.info(
  JSON.stringify({
    event: "server_environment_diagnostics",
    configured: getServerEnvironmentDiagnostics()
      .filter((entry) => entry.exists)
      .map((entry) => entry.name),
    missing: missingServerEnvironment,
  }),
);

console.info(
  JSON.stringify({
    event: "server_started",
    message: "SERVER STARTED",
    runtime: "TanStack Start",
    port: process.env.PORT ?? process.env.VITE_PORT ?? process.env.SERVER_PORT ?? 8080,
  }),
);

// Image pipeline startup check: verify Cloudflare credentials and per-model
// availability, and print a health report. Runs async so it never blocks boot;
// failures are logged but never crash the server.
void import("./lib/ai/image/image-health")
  .then(({ ensureImageHealth }) => ensureImageHealth())
  .catch((error) => {
    console.error(
      "[image-startup] Cloudflare image health check failed to run:",
      error instanceof Error ? error.message : String(error),
    );
  });

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname.startsWith("/api/") && request.method === "OPTIONS") {
      return addNativeCors(request, new Response(null, { status: 204 }));
    }
    if (requestUrl.pathname.startsWith("/api/")) {
      console.info(
        JSON.stringify({
          event: "request_received",
          message: "REQUEST RECEIVED",
          method: request.method,
          path: new URL(request.url).pathname,
        }),
      );
    }
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return addNativeCors(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error("ERROR", error);
      console.error("STACK TRACE", error instanceof Error ? error.stack : undefined);
      return addNativeCors(request, new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      }));
    }
  },
};
