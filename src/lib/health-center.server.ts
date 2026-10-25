import "@tanstack/react-start/server-only";
import { LORD_PRO_ENABLED } from "@/lib/billing/entitlements.server";
import { readEnvApiKey } from "@/lib/env.server";
import type { HealthCheck, HealthCenterSnapshot, HealthStatus } from "./health-center.types";

const DATABASE_TIMEOUT_MS = 3_500;
const PROVIDER_TIMEOUT_MS = 4_500;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_USER = 8;

const requestsByUser = new Map<string, number[]>();

type ProviderProbeResult = "healthy" | "invalid" | "rate-limited" | "unavailable";
type CatalogProvider = {
  id: string;
  url: string;
  key: string | undefined;
  header: "authorization" | "x-goog-api-key";
  modelField: "data" | "models";
  query?: string;
};

export interface HealthCenterEnvironment {
  supabaseConfigured: boolean;
  openRouterKey: string | undefined;
  openAiKey: string | undefined;
  geminiKey: string | undefined;
  additionalAiProviderConfigured: boolean;
  tavilyKey: string | undefined;
  gameProviderConfigured: boolean;
  proEnabled: boolean;
}

export interface HealthCenterOptions {
  databaseCheck: (signal: AbortSignal) => Promise<void>;
  requestSignal: AbortSignal;
  activeChecks: boolean;
  fetcher?: typeof fetch;
  environment?: HealthCenterEnvironment;
  now?: () => Date;
}

export function readHealthCenterEnvironment(): HealthCenterEnvironment {
  const openRouterKey = readEnvApiKey("OPENROUTER_API_KEY");
  const openAiKey = readEnvApiKey("OPENAI_API_KEY");
  const geminiKey = readEnvApiKey("GEMINI_API_KEY");
  const cloudflareToken = readEnvApiKey("CLOUDFLARE_API_TOKEN");
  const cloudflareAccountId = readEnvApiKey("CLOUDFLARE_ACCOUNT_ID");
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  return {
    supabaseConfigured: Boolean(supabaseUrl && supabaseKey),
    openRouterKey,
    openAiKey,
    geminiKey,
    additionalAiProviderConfigured: Boolean(cloudflareToken && cloudflareAccountId),
    tavilyKey: readEnvApiKey("TAVILY_API_KEY"),
    gameProviderConfigured: Boolean(openRouterKey),
    proEnabled: LORD_PRO_ENABLED,
  };
}

export function checkHealthCenterRateLimit(userId: string, now = Date.now()): boolean {
  const recent = (requestsByUser.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= MAX_REQUESTS_PER_USER) {
    requestsByUser.set(userId, recent);
    return false;
  }

  recent.push(now);
  requestsByUser.set(userId, recent);
  if (requestsByUser.size > 5_000) {
    for (const [id, timestamps] of requestsByUser) {
      if (timestamps.every((timestamp) => now - timestamp >= RATE_LIMIT_WINDOW_MS)) {
        requestsByUser.delete(id);
      }
    }
  }
  return true;
}

export function summarizeHealthStatus(checks: readonly HealthCheck[]): HealthStatus {
  const criticalIds = new Set(["frontend", "backend", "database", "authentication"]);
  if (checks.some((check) => criticalIds.has(check.id) && check.status === "Unavailable")) {
    return "Unavailable";
  }
  if (checks.some((check) => check.status === "Unavailable" || check.status === "Degraded")) {
    return "Degraded";
  }
  return "Healthy";
}

export async function createHealthCenterSnapshot(
  options: HealthCenterOptions,
): Promise<HealthCenterSnapshot> {
  const environment = options.environment ?? readHealthCenterEnvironment();
  const fetcher = options.fetcher ?? fetch;
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const databaseStatus = await checkDatabase(options.databaseCheck, options.requestSignal);
  const aiStatus = await checkAiProviders({
    environment,
    activeChecks: options.activeChecks,
    fetcher,
    requestSignal: options.requestSignal,
  });

  const checks: HealthCheck[] = [
    {
      id: "frontend",
      label: "Frontend application",
      status: "Healthy",
      summary: "The authenticated dashboard loaded and reached its diagnostics endpoint.",
      verification: "request",
      checkedAt,
    },
    {
      id: "backend",
      label: "Backend API",
      status: "Healthy",
      summary: "The authenticated health-center API handled this request.",
      verification: "request",
      checkedAt,
    },
    {
      id: "database",
      label: "Database",
      status: databaseStatus,
      summary:
        databaseStatus === "Healthy"
          ? "A read-only, user-scoped database query completed."
          : databaseStatus === "Degraded"
            ? "The database health check timed out."
            : "The database health check could not complete.",
      verification: databaseStatus === "Healthy" ? "connectivity" : "not-tested",
      checkedAt,
    },
    {
      id: "authentication",
      label: "Authentication service",
      status: "Healthy",
      summary: "Supabase authenticated this request before diagnostics ran.",
      verification: "request",
      checkedAt,
    },
    {
      id: "ai-provider",
      label: "AI providers and model catalog",
      status: aiStatus.status,
      summary: aiStatus.summary,
      verification: aiStatus.verified
        ? "connectivity"
        : aiStatus.configured
          ? "not-tested"
          : "configuration",
      checkedAt,
    },
    {
      id: "web-search",
      label: "Web search provider",
      status: environment.tavilyKey ? "Not Tested" : "Not Configured",
      summary: environment.tavilyKey
        ? "Search credentials are configured; no billable search query was sent."
        : "No web search provider is configured.",
      verification: environment.tavilyKey ? "not-tested" : "configuration",
      checkedAt,
    },
    {
      id: "games",
      label: "Game generation and preview",
      status: environment.gameProviderConfigured ? "Not Tested" : "Not Configured",
      summary: environment.gameProviderConfigured
        ? "Generation requires an AI request and was not run; browser preview was not exercised."
        : "Game generation requires an OpenRouter provider; no generation request was sent.",
      verification: environment.gameProviderConfigured ? "not-tested" : "configuration",
      checkedAt,
    },
    {
      id: "voice-speech",
      label: "Voice and speech",
      status: "Not Tested",
      summary:
        "Speech and microphone capabilities are detected in the browser without requesting access.",
      verification: "not-tested",
      checkedAt,
    },
    {
      id: "file-storage",
      label: "File upload and storage",
      status: environment.supabaseConfigured ? "Not Tested" : "Not Configured",
      summary: environment.supabaseConfigured
        ? "Storage is configured through Supabase; no file was uploaded."
        : "Supabase storage credentials are not configured.",
      verification: environment.supabaseConfigured ? "not-tested" : "configuration",
      checkedAt,
    },
    {
      id: "subscription",
      label: "Subscription and entitlements",
      status: environment.proEnabled ? "Not Tested" : "Not Configured",
      summary: environment.proEnabled
        ? "Entitlements are enabled; no subscription or payment operation was run."
        : "LORD Pro entitlement features are disabled in this deployment.",
      verification: environment.proEnabled ? "not-tested" : "configuration",
      checkedAt,
    },
    {
      id: "notifications",
      label: "Notifications",
      status: "Not Tested",
      summary:
        "Browser and native notification capabilities are inspected without requesting permission.",
      verification: "not-tested",
      checkedAt,
    },
    {
      id: "capacitor-android",
      label: "Capacitor and Android",
      status: "Not Tested",
      summary:
        "The active runtime is detected in the browser; no Android device operation is performed.",
      verification: "not-tested",
      checkedAt,
    },
  ];

  return {
    status: summarizeHealthStatus(checks),
    checkedAt,
    checks,
    activeChecks: options.activeChecks,
  };
}

async function checkDatabase(
  databaseCheck: (signal: AbortSignal) => Promise<void>,
  requestSignal: AbortSignal,
): Promise<HealthStatus> {
  try {
    await withTimeout(
      (signal) => databaseCheck(AbortSignal.any([signal, requestSignal])),
      DATABASE_TIMEOUT_MS,
    );
    return "Healthy";
  } catch (error) {
    return isTimeout(error) ? "Degraded" : "Unavailable";
  }
}

async function checkAiProviders(options: {
  environment: HealthCenterEnvironment;
  activeChecks: boolean;
  fetcher: typeof fetch;
  requestSignal: AbortSignal;
}): Promise<{ status: HealthStatus; summary: string; configured: boolean; verified: boolean }> {
  const providers = configuredCatalogProviders(options.environment);
  const hasConfiguredProvider =
    providers.length > 0 ||
    options.environment.additionalAiProviderConfigured ||
    options.environment.gameProviderConfigured;

  if (!hasConfiguredProvider) {
    return {
      status: "Not Configured",
      summary: "No supported AI provider credentials are configured.",
      configured: false,
      verified: false,
    };
  }

  if (!options.activeChecks || providers.length === 0) {
    return {
      status: "Not Tested",
      summary: options.activeChecks
        ? "Configured providers do not expose a safe catalog probe; no generation request was sent."
        : "Provider credentials are present, but availability has not been tested.",
      configured: true,
      verified: false,
    };
  }

  const results = await Promise.all(
    providers.map((provider) => probeCatalog(provider, options.fetcher, options.requestSignal)),
  );
  const reachable = results.filter((result) => result === "healthy").length;
  if (reachable === results.length && !options.environment.additionalAiProviderConfigured) {
    return {
      status: "Healthy",
      summary:
        "All configured model catalog endpoints responded successfully; no model was invoked.",
      configured: true,
      verified: true,
    };
  }
  if (reachable > 0) {
    return {
      status: "Degraded",
      summary: "Some configured model catalog endpoints could not be verified or were not probed.",
      configured: true,
      verified: true,
    };
  }
  const rateLimited = results.some((result) => result === "rate-limited");
  return {
    status: rateLimited ? "Degraded" : "Unavailable",
    summary:
      "Configured model catalog endpoints could not be verified; provider details were withheld.",
    configured: true,
    verified: true,
  };
}

function configuredCatalogProviders(environment: HealthCenterEnvironment): CatalogProvider[] {
  const providers: CatalogProvider[] = [];
  if (environment.openRouterKey) {
    providers.push({
      id: "openrouter",
      url: "https://openrouter.ai/api/v1/models?limit=10",
      key: environment.openRouterKey,
      header: "authorization",
      modelField: "data",
    });
  }
  if (environment.openAiKey) {
    providers.push({
      id: "openai",
      url: "https://api.openai.com/v1/models?limit=10",
      key: environment.openAiKey,
      header: "authorization",
      modelField: "data",
    });
  }
  if (environment.geminiKey) {
    providers.push({
      id: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=10",
      key: environment.geminiKey,
      header: "x-goog-api-key",
      modelField: "models",
    });
  }
  return providers;
}

async function probeCatalog(
  provider: CatalogProvider,
  fetcher: typeof fetch,
  requestSignal: AbortSignal,
): Promise<ProviderProbeResult> {
  try {
    const response = await fetcher(provider.url, {
      headers: {
        accept: "application/json",
        [provider.header]:
          provider.header === "authorization" ? `Bearer ${provider.key}` : provider.key!,
      },
      cache: "no-store",
      signal: AbortSignal.any([AbortSignal.timeout(PROVIDER_TIMEOUT_MS), requestSignal]),
    });
    if (response.status === 401 || response.status === 403) return "invalid";
    if (response.status === 429) return "rate-limited";
    if (!response.ok) return "unavailable";

    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== "object" ||
      !(provider.modelField in body) ||
      !Array.isArray(Reflect.get(body, provider.modelField))
    ) {
      return "unavailable";
    }
    return "healthy";
  } catch {
    return "unavailable";
  }
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Timed out");
      error.name = "TimeoutError";
      reject(error);
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timedOut]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
