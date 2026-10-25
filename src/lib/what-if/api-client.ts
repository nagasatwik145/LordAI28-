import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { z } from "zod";

export async function requestWhatIf<T>(schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch("/api/what-if", {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
        ? body.error.message
        : "What-If Lab request failed.";
    throw new Error(message);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error("What-If Lab returned an invalid response.");
  return parsed.data;
}
