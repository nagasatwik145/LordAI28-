import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { apiErrorResponse } from "@/lib/api-error";

const TtsRequestSchema = z.object({
  text: z.string().trim().min(1).max(12_000),
  model: z.string().trim().min(1).max(128).optional(),
  voiceId: z.string().trim().min(1).max(128).nullable().optional(),
  speed: z.number().min(0.5).max(2).optional(),
});

export const Route = createFileRoute("/api/voice/tts")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request }) => {
        const requestId = crypto.randomUUID();

        try {
          const payload = (await request.json().catch(() => null)) as unknown;
          const parsed = TtsRequestSchema.safeParse(payload);
          if (!parsed.success) {
            return apiErrorResponse(
              400,
              "INVALID_REQUEST",
              "Speech text is required before playback can start.",
              requestId,
            );
          }

          const apiKey = process.env.FISH_API_KEY;
          if (!apiKey) {
            return apiErrorResponse(
              500,
              "AI_NOT_CONFIGURED",
              "Speech synthesis is not configured on this server.",
              requestId,
            );
          }

          const model = process.env.FISH_TTS_MODEL || parsed.data.model || "s2.1-pro-free";
          const voiceId = process.env.FISH_VOICE_ID?.trim();

          const upstream = await fetch("https://api.fish.audio/v1/tts", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
              model,
            },
            body: JSON.stringify({
              text: parsed.data.text,
              format: "mp3",
              prosody: { speed: parsed.data.speed ?? 1 },
              ...(voiceId ? { reference_id: voiceId } : {}),
            }),
            signal: request.signal,
          });
          if (!upstream.ok) {
            const upstreamText = await upstream.text().catch(() => "");
            console.error("[voice-tts] Fish Audio request failed", {
              requestId,
              model,
              status: upstream.status,
              message: upstreamText.slice(0, 400),
            });
            return apiErrorResponse(
              502,
              "AI_UPSTREAM_ERROR",
              "Speech synthesis is unavailable right now. The text response is still available.",
              requestId,
            );
          }

          const contentType = upstream.headers.get("content-type") || "audio/mpeg";
          const buffer = Buffer.from(await upstream.arrayBuffer());

          return new Response(buffer, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "no-store",
              "Accept-Ranges": "bytes",
            },
          });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return apiErrorResponse(
              499,
              "REQUEST_CANCELLED",
              "Speech playback was cancelled.",
              requestId,
            );
          }

          console.error("[voice-tts] unexpected failure", { requestId, error });
          return apiErrorResponse(
            500,
            "AI_ERROR",
            "Speech synthesis failed. The text response is still available.",
            requestId,
          );
        }
      },
    },
  },
});
