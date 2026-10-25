export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ACTION"
  | "AI_NOT_CONFIGURED"
  | "AI_AUTH_ERROR"
  | "AI_BAD_REQUEST"
  | "AI_CREDITS_EXHAUSTED"
  | "AI_RATE_LIMITED"
  | "AI_TIMEOUT"
  | "AI_UPSTREAM_ERROR"
  | "AI_INVALID_OUTPUT"
  | "AI_ERROR"
  | "WEB_SEARCH_NOT_CONFIGURED"
  | "WEB_SEARCH_UNAVAILABLE"
  | "WEB_SEARCH_RATE_LIMITED"
  | "DB_ERROR"
  | "NO_VALID_CONCEPTS"
  | "WHAT_IF_GENERATION_FAILED"
  | "WHAT_IF_ERROR"
  | "INTERNAL_ERROR"
  | "NOT_FOUND"
  | "PRO_REQUIRED"
  | "REQUEST_CANCELLED"
  | "RESEARCH_FAILED";

export interface ProviderStatus {
  provider: string;
  status: "healthy" | "rate_limited" | "unavailable" | "missing_api_key" | "invalid";
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    attempts?: Array<{
      model: string;
      status: number;
      reason: string;
      retryable: boolean;
      providerMessage?: string;
      errorCode?: string;
      requestId?: string;
    }>;
    configuredProviders?: string[];
    providerStatuses?: ProviderStatus[];
  };
}

export function apiErrorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  requestId: string,
  extra?: {
    attempts?: Array<{
      model: string;
      status: number;
      reason: string;
      retryable: boolean;
      providerMessage?: string;
      errorCode?: string;
      requestId?: string;
    }>;
    configuredProviders?: string[];
    providerStatuses?: ProviderStatus[];
  },
) {
  return Response.json(
    {
      error: {
        code,
        message,
        requestId,
        ...(extra?.attempts && { attempts: extra.attempts }),
        ...(extra?.configuredProviders && { configuredProviders: extra.configuredProviders }),
        ...(extra?.providerStatuses && { providerStatuses: extra.providerStatuses }),
      },
    } satisfies ApiErrorBody,
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function apiOkResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function apiNoContentResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

export function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return "The request failed without an error message.";
}
