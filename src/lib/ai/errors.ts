export type OpenRouterErrorKind =
  | "missing_api_key"
  | "invalid_api_key"
  | "rate_limit"
  | "insufficient_credits"
  | "unsupported_model"
  | "malformed_response"
  | "unavailable"
  | "network"
  | "timeout"
  | "aborted"
  | "request";

const ERROR_MESSAGES: Record<OpenRouterErrorKind, string> = {
  missing_api_key: "OpenRouter API key is missing.",
  invalid_api_key: "Invalid OpenRouter API key.",
  rate_limit: "OpenRouter rate limit reached.",
  insufficient_credits: "The configured OpenRouter account has insufficient credits.",
  unsupported_model: "The selected model is not available from OpenRouter.",
  malformed_response: "OpenRouter returned an invalid response.",
  unavailable: "OpenRouter is temporarily unavailable.",
  network: "Unable to reach OpenRouter.",
  timeout: "OpenRouter timed out.",
  aborted: "The OpenRouter request was cancelled.",
  request: "OpenRouter rejected the request.",
};

export class OpenRouterError extends Error {
  readonly kind: OpenRouterErrorKind;
  readonly status?: number;
  /** Sanitized provider metadata; never contains the provider response body. */
  readonly providerCode?: string;
  readonly retryAfterMs?: number;

  constructor(
    kind: OpenRouterErrorKind,
    status?: number,
    cause?: unknown,
    metadata?: { providerCode?: string; retryAfterMs?: number },
  ) {
    super(ERROR_MESSAGES[kind], { cause });
    this.name = "OpenRouterError";
    this.kind = kind;
    this.status = status;
    this.providerCode = metadata?.providerCode;
    this.retryAfterMs = metadata?.retryAfterMs;
  }
}

export function normalizeOpenRouterError(error: unknown): OpenRouterError {
  if (error instanceof OpenRouterError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new OpenRouterError("aborted", undefined, error);
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new OpenRouterError("timeout", undefined, error);
  }
  if (error instanceof TypeError) return new OpenRouterError("network", undefined, error);
  return new OpenRouterError("unavailable", undefined, error);
}

export function errorFromStatus(
  status: number,
  cause?: unknown,
  headers?: Headers,
): OpenRouterError {
  const details = extractProviderDetails(cause);
  const retryAfterMs = parseRetryAfter(headers);
  if (status === 401) return new OpenRouterError("invalid_api_key", status, cause, details);
  if (status === 403) {
    return new OpenRouterError(
      isModelUnavailable(details.providerCode) ? "unsupported_model" : "invalid_api_key",
      status,
      cause,
      details,
    );
  }
  if (status === 402 || (status === 429 && isCreditExhaustion(details.providerCode)))
    return new OpenRouterError("insufficient_credits", status, cause, details);
  if (status === 429)
    return new OpenRouterError("rate_limit", status, cause, { ...details, retryAfterMs });
  if (status === 404) return new OpenRouterError("unsupported_model", status, cause, details);
  if (status >= 500) return new OpenRouterError("unavailable", status, cause, details);
  return new OpenRouterError("request", status, cause, details);
}

function extractProviderDetails(cause: unknown): { providerCode?: string } {
  if (!cause || typeof cause !== "object") return {};
  const body = cause as { error?: unknown };
  const providerError = body.error && typeof body.error === "object" ? body.error : body;
  if (!providerError || typeof providerError !== "object") return {};
  const code = (providerError as { code?: unknown }).code;
  const message = (providerError as { message?: unknown }).message;
  if (typeof message === "string") {
    if (/(quota|credit|insufficient|payment|billing)/i.test(message)) {
      return { providerCode: "insufficient_quota" };
    }
    if (/(model.*(not found|unavailable|invalid)|unknown model)/i.test(message)) {
      return { providerCode: "model_unavailable" };
    }
  }
  if (typeof code === "string" || typeof code === "number") {
    // Provider codes are metadata, but still constrain their shape before
    // logging so unexpected text cannot carry response details into logs.
    const providerCode = String(code);
    return /^[a-zA-Z0-9_.-]{1,80}$/.test(providerCode) ? { providerCode } : {};
  }
  return {};
}

function isCreditExhaustion(providerCode?: string): boolean {
  return Boolean(providerCode && /(quota|credit|insufficient|payment|billing)/i.test(providerCode));
}

function isModelUnavailable(providerCode?: string): boolean {
  return Boolean(providerCode && /(model|provider_not_found|not_available)/i.test(providerCode));
}

function parseRetryAfter(headers?: Headers): number | undefined {
  const value = headers?.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10 * 60 * 1000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(Math.max(0, date - Date.now()), 10 * 60 * 1000);
}
