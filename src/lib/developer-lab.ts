import { z } from "zod";

export const DeveloperActionSchema = z.enum([
  "explain",
  "debug",
  "refactor",
  "tests",
  "security",
  "document",
]);
export const DeveloperRequestSchema = z.object({
  action: DeveloperActionSchema,
  code: z.string().min(1).max(40_000),
  language: z.string().min(1).max(40),
  errorMessage: z.string().max(8_000).optional(),
  environment: z.string().max(4_000).optional(),
  framework: z.string().max(100).optional(),
});
export const DeveloperSessionSchema = z
  .object({
    title: z.string().min(1).max(200),
    action: DeveloperActionSchema,
    language: z.string().min(1).max(40),
    code: z.string().min(1).max(40_000),
    output: z.string().min(1).max(40_000),
  })
  .strict();

export function developerApiError(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string" && error.message.trim()) return error.message;
  }
  return "Request failed. Please try again.";
}

export function formatDeveloperOutput(
  payload: unknown,
): { content: string; executed: false } | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as { content?: unknown; executed?: unknown; evidence?: unknown };
  if (typeof value.content !== "string" || !value.content.trim()) return null;
  return { content: value.content.trim(), executed: false };
}

export function validateBrowserApiUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function requiresRequestConfirmation(method: string): boolean {
  return method.toUpperCase() === "DELETE";
}

export function redactApiUrl(value: string): string {
  const url = validateBrowserApiUrl(value);
  if (!url) return value;
  for (const key of [...url.searchParams.keys()]) {
    if (/(?:token|secret|password|api[_-]?key|authorization|credential)/i.test(key)) {
      url.searchParams.set(key, "[redacted]");
    }
  }
  return url.toString();
}

export function formatApiResponse(body: string, maxLength = 30_000): string {
  return body.length > maxLength ? `${body.slice(0, maxLength)}\n[Response truncated]` : body;
}
