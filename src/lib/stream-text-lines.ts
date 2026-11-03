import { formatUserFacingError, parseLordError } from "@/lib/lord-error";

type StreamChunkHandler = (delta: string) => void;
type StreamEvent = { type?: unknown; delta?: unknown; errorText?: unknown };

function streamError(errorText: string): Error {
  const lordError = parseLordError(errorText);
  return Object.assign(
    new Error(
      lordError
        ? formatUserFacingError(lordError)
        : errorText || "LORD could not complete the response. Please retry.",
    ),
    lordError ? { code: lordError.code } : {},
  );
}

export async function streamTextLines(res: Response, onDelta: StreamChunkHandler): Promise<string> {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event: StreamEvent;
      try {
        event = JSON.parse(payload) as StreamEvent;
      } catch {
        continue;
      }
      if (event.type === "text-delta" && typeof event.delta === "string") {
        acc += event.delta;
        onDelta(acc);
      } else if (event.type === "error") {
        const errorText = typeof event.errorText === "string" ? event.errorText : "";
        throw streamError(errorText);
      }
    }
  }
  buf += decoder.decode();
  const trailing = buf.trim();
  if (trailing.startsWith("data:")) {
    const payload = trailing.slice(5).trim();
    if (payload && payload !== "[DONE]") {
      let event: StreamEvent | null = null;
      try {
        event = JSON.parse(payload) as StreamEvent;
      } catch {
        // Ignore a malformed final chunk just like malformed chunks in the stream.
      }
      if (event?.type === "text-delta" && typeof event.delta === "string") {
        acc += event.delta;
        onDelta(acc);
      } else if (event?.type === "error") {
        const errorText = typeof event.errorText === "string" ? event.errorText : "";
        throw streamError(errorText);
      }
    }
  }
  return acc;
}
