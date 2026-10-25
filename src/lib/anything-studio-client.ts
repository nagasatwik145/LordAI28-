import { z } from "zod";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

export async function loadStudioJson<T>(
  url: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("Studio request timed out. Please retry."));
    }, timeoutMs);
  });

  const request = (async () => {
    const response = await authenticatedFetch(url, { signal: controller.signal });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = z
        .object({ error: z.object({ message: z.string().optional() }).optional() })
        .safeParse(payload);
      throw new Error(
        (error.success ? error.data.error?.message : undefined) ??
          "Could not load Anything Studio.",
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new Error("LORD returned invalid Studio data.");
    return parsed.data;
  })();

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
