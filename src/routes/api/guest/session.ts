import { createFileRoute } from "@tanstack/react-router";
import {
  buildGuestSessionCookieHeader,
  createGuestSessionRecord,
  enforceGuestSessionCreationRateLimit,
  getGuestSessionStatus,
  readGuestSessionFromRequest,
} from "@/lib/guest-session";

export const Route = createFileRoute("/api/guest/session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const status = await getGuestSessionStatus(request);
        return Response.json(
          {
            guest: status.guest,
            active: status.active,
            expired: status.expired,
            expiresAt: status.expiresAt,
            remainingMs: status.remainingMs,
          },
          {
            status: 200,
            headers: { "Cache-Control": "no-store, private" },
          },
        );
      },
      POST: async ({ request }) => {
        try {
          const existing = await readGuestSessionFromRequest(request);
          if (existing && existing.expiresAt > Date.now()) {
            return Response.json(
              {
                guest: true,
                active: true,
                expired: false,
                expiresAt: existing.expiresAt,
                remainingMs: Math.max(0, existing.expiresAt - Date.now()),
              },
              {
                status: 200,
                headers: { "Cache-Control": "no-store, private" },
              },
            );
          }

          if (!enforceGuestSessionCreationRateLimit(request)) {
            return Response.json(
              {
                error: {
                  code: "GUEST_RATE_LIMITED",
                  message:
                    "Too many guest sessions were created from this device. Please try again shortly.",
                },
              },
              {
                status: 429,
                headers: { "Cache-Control": "no-store, private", "Retry-After": "60" },
              },
            );
          }

          const session = await createGuestSessionRecord();
          const response = Response.json(
            {
              guest: true,
              active: true,
              expired: false,
              expiresAt: session.expiresAt,
              remainingMs: Math.max(0, session.expiresAt - Date.now()),
            },
            {
              status: 200,
              headers: { "Cache-Control": "no-store, private" },
            },
          );
          response.headers.set(
            "Set-Cookie",
            await buildGuestSessionCookieHeader(
              session.sessionId,
              session.expiresAt,
              request.url,
              session.createdAt,
            ),
          );
          return response;
        } catch (error) {
          console.error("Guest session creation failed", error);
          return Response.json(
            {
              error: {
                code: "GUEST_SESSION_FAILED",
                message: "Guest access could not be started.",
              },
            },
            {
              status: 500,
              headers: { "Cache-Control": "no-store, private" },
            },
          );
        }
      },
    },
  },
});
