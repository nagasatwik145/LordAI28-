import { errorFromStatus, normalizeOpenRouterError, OpenRouterError } from "./errors";
import type { ChatMessage, OpenRouterRequest } from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterStreamEvent {
  type: "text" | "reasoning";
  delta: string;
}

export class OpenRouterClient {
  constructor(private readonly apiKey: string) {}

  async completeChat(
    messages: readonly ChatMessage[],
    model: string,
    signal?: AbortSignal,
    maxTokens = 1400,
  ): Promise<string> {
    const body = {
      model,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      stream: false,
      max_tokens: maxTokens,
    };

    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://lordai.app",
          "X-Title": "LordAI",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw normalizeOpenRouterError(error);
    }

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw errorFromStatus(response.status, parseProviderError(details), response.headers);
    }

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") {
      throw new OpenRouterError("malformed_response");
    }
    const choices = (payload as { choices?: unknown }).choices;
    const message =
      Array.isArray(choices) && choices[0] && typeof choices[0] === "object"
        ? (choices[0] as { message?: unknown }).message
        : null;
    const content =
      message && typeof message === "object" ? (message as { content?: unknown }).content : null;
    if (typeof content !== "string" || !content.trim()) {
      throw new OpenRouterError("malformed_response");
    }
    return content;
  }

  async *streamChat(
    messages: readonly ChatMessage[],
    model: string,
    signal?: AbortSignal,
    maxTokens = 1400,
  ): AsyncGenerator<string> {
    for await (const event of this.streamChatEvents(messages, model, signal, maxTokens)) {
      if (event.type === "text") yield event.delta;
    }
  }

  async *streamChatEvents(
    messages: readonly ChatMessage[],
    model: string,
    signal?: AbortSignal,
    maxTokens = 1400,
  ): AsyncGenerator<OpenRouterStreamEvent> {
    const body: OpenRouterRequest = {
      model,
      messages: messages.map((message) => {
        const files = message.files ?? [];
        const images = message.images ?? [];
        return {
          role: message.role,
          content:
            images.length || files.length
              ? [
                  { type: "text" as const, text: message.content },
                  ...images.map((url) => ({
                    type: "image_url" as const,
                    image_url: { url },
                  })),
                  ...files.map((file) => ({
                    type: "file" as const,
                    file: { filename: file.filename, file_data: file.fileData },
                  })),
                ]
              : message.content,
        };
      }),
      stream: true,
      max_tokens: maxTokens,
    };
    if (messages.some((message) => message.files?.length)) {
      body.plugins = [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }];
    }
    const requestBody = JSON.stringify(body);
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://lordai.app",
      "X-Title": "LordAI",
    };

    console.info("OpenRouter request started", {
      url: OPENROUTER_URL,
      model,
      stream: body.stream,
      messageCount: messages.length,
      inputCharacters: messages.reduce((total, message) => total + message.content.length, 0),
    });

    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers,
        body: requestBody,
        signal,
      });
    } catch (error) {
      throw normalizeOpenRouterError(error);
    }

    if (!response.body) {
      logResponse(response);
      throw new OpenRouterError("network");
    }

    try {
      if (!response.ok) {
        const details = await readResponseBody(response.body);
        throw errorFromStatus(response.status, parseProviderError(details), response.headers);
      }

      yield* this.readEventStream(response.body);
    } catch (error) {
      throw normalizeOpenRouterError(error);
    } finally {
      logResponse(response);
    }
  }

  private async *readEventStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<OpenRouterStreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedDone = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const event = parseSseLine(line);
          if (event === null) {
            receivedDone = true;
            return;
          }
          if (event) yield event;
        }
        if (done) {
          if (buffer.trim()) {
            const event = parseSseLine(buffer);
            if (event === null) receivedDone = true;
            else if (event) yield event;
          }
          if (!receivedDone) throw new OpenRouterError("malformed_response");
          return;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

async function readResponseBody(body: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(body).text().catch(() => "");
}

function logResponse(response: Response): void {
  console.info("OpenRouter response received", {
    status: response.status,
    statusText: response.statusText,
  });
}

function parseSseLine(line: string): OpenRouterStreamEvent | null | undefined {
  const data = line.trim();
  if (!data.startsWith("data:")) return undefined;
  const payload = data.slice(5).trim();
  if (payload === "[DONE]") return null;

  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: unknown; reasoning?: unknown } }>;
      error?: { code?: number; message?: string };
    };
    if (parsed.error) {
      throw errorFromStatus(
        typeof parsed.error.code === "number" ? parsed.error.code : 503,
        parsed.error,
      );
    }
    const delta = parsed.choices?.[0]?.delta;
    const reasoning = extractText(delta?.reasoning);
    const content = extractText(delta?.content);
    if (reasoning) return { type: "reasoning", delta: reasoning };
    if (content) return { type: "text", delta: content };
    return undefined;
  } catch (error) {
    if (error instanceof OpenRouterError) throw error;
    throw new OpenRouterError("malformed_response", undefined, error);
  }
}

/** Keep provider diagnostics structured without retaining or logging raw bodies. */
function parseProviderError(body: string): unknown {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const error = (parsed as { error?: unknown }).error;
    return error && typeof error === "object" ? { error } : parsed;
  } catch {
    return undefined;
  }
}

function extractText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value.map(extractText).filter(Boolean).join("");
    return text || undefined;
  }
  if (value && typeof value === "object" && "text" in value) {
    return extractText((value as { text?: unknown }).text);
  }
  return undefined;
}
