import { createFileRoute } from "@tanstack/react-router";
import type { UIMessage } from "ai";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { streamChat, isAIConfigurationError, isOpenRouterError } from "@/lib/ai/gateway";
import { OpenRouterError } from "@/lib/ai/errors";
import { preferAvailableModels } from "@/lib/ai/model-availability";
import { orderChatModelCandidates } from "@/lib/ai/chat-model-selection";
import { apiErrorResponse } from "@/lib/api-error";
import { buildChatContextMessages } from "./chat/-context";
import {
  CHAT_MODEL_MAP,
  classifyTask,
  buildRouteDecision,
  getModeCandidates,
  LORD_IDENTITY,
  LORD_SYSTEM_PROMPT,
} from "@/config/lord-config";
import { buildMemoryPrompt } from "./chat/-memory";
import { ChatRequestSchema } from "./chat/-schema";
import { RESPONSE_STYLE_INSTRUCTIONS, type ResponseStyle } from "@/lib/ai/response-style";
import {
  buildResearchInstructions,
  shouldResearchQuestion,
  type WebResearchStatus,
  type WebSource,
} from "@/lib/ai/web-sources";
import { hasProEntitlement } from "@/lib/billing/entitlements.server";
import { FREE_CHAT_MODEL_IDS, isFreeChatModel } from "@/lib/ai/chat-model-catalog";
import { readEnvApiKey } from "@/lib/env.server";
import { canUseFastReply } from "@/lib/ai/fast-reply-access";
import { isModelAvailable } from "@/lib/ai/model-availability";
import {
  claimCouncilQuota,
  estimateCouncilCostUsd,
  getCouncilProviderHealth,
  getCouncilLimits,
  isSimpleCouncilTask,
  selectCouncilModels,
  streamCouncilResponse,
} from "@/lib/ai/council.server";
import { claimRealityCheckQuota } from "@/lib/ai/reality-check.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const requestId = crypto.randomUUID();
        let rawBody: unknown;
        try {
          rawBody = await request.json();
        } catch {
          console.error(
            JSON.stringify({
              event: "chat_request_invalid_json",
              requestId,
              stack: new Error("Invalid JSON request body").stack,
            }),
          );
          return apiErrorResponse(
            400,
            "INVALID_REQUEST",
            "Request body must be valid JSON.",
            requestId,
          );
        }

        const parsed = ChatRequestSchema.safeParse(rawBody);
        if (!parsed.success) {
          console.error(
            JSON.stringify({
              event: "chat_request_validation_failed",
              requestId,
              issues: parsed.error.issues,
              bodyShape: summarizeRequestBody(rawBody),
              stack: new Error("Chat request validation failed").stack,
            }),
          );
          return apiErrorResponse(
            400,
            "INVALID_REQUEST",
            "Please send a valid conversation with 1-100 messages.",
            requestId,
          );
        }

        const entitlementContext = context as {
          userId?: string;
          claims?: { email?: string; email_confirmed_at?: string | null };
        };
        const isPro = Boolean(
          entitlementContext.userId &&
          (await safelyCheckProEntitlement({
            id: entitlementContext.userId,
            ...(entitlementContext.claims ?? {}),
          })),
        );
        if (parsed.data.context?.fastReply === true && !canUseFastReply(isPro)) {
          return apiErrorResponse(
            403,
            "PRO_REQUIRED",
            "Fast Reply Mode is available to LORD Pro subscribers.",
            requestId,
          );
        }
        const wantsCouncil = parsed.data.context?.council === true;
        if (wantsCouncil && parsed.data.context?.realityCheck === true) {
          return apiErrorResponse(
            400,
            "INVALID_REQUEST",
            "LORD Council and Reality Check cannot run together. Choose one verification mode.",
            requestId,
          );
        }
        const councilLimits = getCouncilLimits();
        if (
          wantsCouncil &&
          (!entitlementContext.userId ||
            !claimCouncilQuota(entitlementContext.userId, councilLimits.requestsPerMinute))
        ) {
          return apiErrorResponse(
            429,
            "AI_RATE_LIMITED",
            "LORD Council has reached its per-account request limit. Please try again shortly.",
            requestId,
          );
        }

        console.info(
          JSON.stringify({
            event: "chat_request_validated",
            requestId,
            mode: parsed.data.mode ?? "balanced",
            modelId: parsed.data.modelId ?? null,
            bodyShape: summarizeRequestBody(parsed.data),
          }),
        );

        const authContext = context as
          { userId?: string; supabase?: Parameters<typeof buildMemoryPrompt>[0] } | undefined;
        let memoryPrompt = "";
        if (authContext?.userId && authContext.supabase) {
          memoryPrompt = await buildMemoryPrompt(
            authContext.supabase,
            authContext.userId,
            getLastUserText(parsed.data.messages as unknown as UIMessage[]),
            parsed.data.context?.projectId ?? null,
          ).catch(() => "");
        }

        try {
          const mode = parsed.data.mode ?? LORD_IDENTITY.defaultMode;
          const restoredMessages = await restoreChatAttachmentReferences(
            parsed.data.messages as unknown as UIMessage[],
            authContext?.supabase,
            authContext?.userId,
          );
          const contextMessages = keepRecentMultimodalFiles(restoredMessages, 4);
          const lastUserText = getLastUserText(contextMessages);
          const taskType = classifyTask(lastUserText || "general");
          const multimodalFiles = contextMessages.flatMap((message) =>
            message.parts.filter((part) => {
              if (!part || typeof part !== "object") return false;
              const item = part as { type?: unknown; mediaType?: unknown; url?: unknown };
              return (
                item.type === "file" &&
                typeof item.url === "string" &&
                ((typeof item.mediaType === "string" &&
                  item.mediaType.startsWith("image/") &&
                  item.url.startsWith("data:image/")) ||
                  (item.mediaType === "application/pdf" &&
                    item.url.startsWith("data:application/pdf;base64,")))
              );
            }),
          );
          const imageCount = multimodalFiles.filter((part) =>
            (part as { mediaType?: string }).mediaType?.startsWith("image/"),
          ).length;
          const hasImage = imageCount > 0;
          const hasMultimodal = multimodalFiles.length > 0;
          const multimodalPayloadSize = multimodalFiles.reduce<number>((total, part) => {
            const url = (part as { url?: unknown }).url;
            return total + (typeof url === "string" ? url.length : 0);
          }, 0);
          if (multimodalFiles.length > 4 || imageCount > 4) {
            return apiErrorResponse(
              400,
              "INVALID_REQUEST",
              "Attach no more than four images or PDFs to one message.",
              requestId,
            );
          }
          if (multimodalPayloadSize > 17 * 1024 * 1024) {
            return apiErrorResponse(
              413,
              "INVALID_REQUEST",
              "The combined image and PDF data is too large. Reduce the files to 12 MB total.",
              requestId,
            );
          }
          const requestedModelId = parsed.data.modelId;
          const requestedModel = requestedModelId
            ? CHAT_MODEL_MAP.get(requestedModelId)
            : undefined;
          if (
            requestedModelId &&
            (!requestedModel || !requestedModel.enabled || requestedModel.provider !== "openrouter")
          ) {
            return apiErrorResponse(
              400,
              "INVALID_REQUEST",
              "That model is not in the configured chat model registry.",
              requestId,
            );
          }
          if (requestedModelId && !isPro && !isFreeChatModel(requestedModelId)) {
            return apiErrorResponse(
              403,
              "PRO_REQUIRED",
              "LORD Pro is required to use this AI model.",
              requestId,
            );
          }
          if (!readEnvApiKey("OPENROUTER_API_KEY")) {
            return apiErrorResponse(
              503,
              "AI_NOT_CONFIGURED",
              "OpenRouter is not configured on this deployment.",
              requestId,
            );
          }
          if (requestedModel && hasMultimodal && !requestedModel.capabilities.supportsVision) {
            return apiErrorResponse(
              400,
              "INVALID_REQUEST",
              "The selected model does not support image or PDF attachments. Choose a model marked Vision.",
              requestId,
            );
          }

          const allowedModelIds = new Set(
            [...CHAT_MODEL_MAP.values()]
              .filter(
                (model) =>
                  model.enabled &&
                  model.provider === "openrouter" &&
                  (isPro || isFreeChatModel(model.id)) &&
                  (!hasMultimodal ||
                    (model.capabilities.supportsVision &&
                      model.limits.maxImagesPerRequest >= imageCount)),
              )
              .map((model) => model.id),
          );
          const freeRoute =
            isPro || hasMultimodal ? null : buildRouteDecision(lastUserText || "general", mode);
          const rankedModelCandidates = requestedModelId
            ? getModeCandidates(mode, requestedModelId)
                .filter((candidate) => allowedModelIds.has(candidate.modelId))
                .map((candidate) => candidate.modelId)
            : isPro
              ? getModeCandidates(mode)
                  .filter((candidate) => allowedModelIds.has(candidate.modelId))
                  .map((candidate) => candidate.modelId)
              : hasMultimodal
                ? [...allowedModelIds]
                : (() => {
                    const routedFreeCandidates = (freeRoute?.candidates ?? []).filter((modelId) =>
                      allowedModelIds.has(modelId),
                    );
                    return routedFreeCandidates.length > 0
                      ? routedFreeCandidates
                      : [...FREE_CHAT_MODEL_IDS].filter((modelId) => allowedModelIds.has(modelId));
                  })();

          if (parsed.data.context?.fastReply) {
            rankedModelCandidates.sort((left, right) => {
              if (left === requestedModelId) return -1;
              if (right === requestedModelId) return 1;
              return (
                (CHAT_MODEL_MAP.get(left)?.latency.expectedMs ?? Number.MAX_SAFE_INTEGER) -
                (CHAT_MODEL_MAP.get(right)?.latency.expectedMs ?? Number.MAX_SAFE_INTEGER)
              );
            });
          }

          const fallbackRankedModelCandidates = requestedModelId
            ? [
                ...rankedModelCandidates,
                ...[...CHAT_MODEL_MAP.values()]
                  .filter(
                    (model) =>
                      allowedModelIds.has(model.id) &&
                      (!hasMultimodal || model.capabilities.supportsVision),
                  )
                  .sort((a, b) => a.metadata.priority - b.metadata.priority)
                  .map((model) => model.id),
              ]
            : rankedModelCandidates;
          const availableFallbackIds = preferAvailableModels(
            fallbackRankedModelCandidates
              .filter((modelId) => modelId !== requestedModelId)
              .map((modelId) => ({ modelId })),
          ).map(({ modelId }) => modelId);
          const modelCandidates = orderChatModelCandidates(requestedModelId, availableFallbackIds);

          console.info(
            JSON.stringify({
              event: "chat_model_selection",
              requestId,
              hasImage,
              hasMultimodal,
              imageCount,
              pdfCount: multimodalFiles.length - imageCount,
              candidates: modelCandidates,
            }),
          );

          if (modelCandidates.length === 0) {
            return apiErrorResponse(
              503,
              hasMultimodal ? "AI_UPSTREAM_ERROR" : "AI_NOT_CONFIGURED",
              hasMultimodal
                ? "No model on your plan supports the attached image or PDF combination."
                : "No configured model is currently available.",
              requestId,
            );
          }

          const selectedCandidates = modelCandidates;
          const contextLimit = Math.min(
            ...selectedCandidates.map(
              (modelId) => CHAT_MODEL_MAP.get(modelId)?.limits.maxContextTokens ?? 8192,
            ),
          );
          const selectedModel = CHAT_MODEL_MAP.get(selectedCandidates[0]);
          const context = parsed.data.context;
          const wantsRealityCheck = context?.realityCheck === true;
          const shouldSearchWeb =
            context?.webSearch === true ||
            wantsRealityCheck ||
            shouldResearchQuestion(lastUserText);
          const realityCheckVerifierUnavailable =
            wantsRealityCheck &&
            (!authContext?.userId || !claimRealityCheckQuota(authContext.userId));
          let sourceSearchUnavailable = false;
          let webSources: WebSource[] = [];
          if (shouldSearchWeb) {
            const tavily = await import("@/lib/ai/tavily-search.server");
            const { checkWebSearchRateLimit, readTavilyApiKey, searchWebSources, WebSearchError } =
              tavily;
            const searchKey = readTavilyApiKey();
            if (!searchKey) {
              if (context?.webSearch) {
                return apiErrorResponse(
                  503,
                  "WEB_SEARCH_NOT_CONFIGURED",
                  "Web sources are not configured on this deployment yet.",
                  requestId,
                );
              }
              sourceSearchUnavailable = true;
            }
            if (
              !sourceSearchUnavailable &&
              (lastUserText.trim().length < 1 || lastUserText.length > 500)
            ) {
              if (!context?.webSearch) {
                sourceSearchUnavailable = true;
              } else {
                return apiErrorResponse(
                  400,
                  "INVALID_REQUEST",
                  "Web search queries must be between 1 and 500 characters.",
                  requestId,
                );
              }
            }
            if (
              !sourceSearchUnavailable &&
              (!authContext?.userId || !checkWebSearchRateLimit(authContext.userId))
            ) {
              if (!context?.webSearch) {
                sourceSearchUnavailable = true;
              } else {
                return apiErrorResponse(
                  429,
                  "WEB_SEARCH_RATE_LIMITED",
                  "Web search is limited to 10 requests per minute per account. Please retry shortly.",
                  requestId,
                );
              }
            }
            if (!sourceSearchUnavailable && searchKey) {
              try {
                webSources = await searchWebSources(lastUserText, searchKey, request.signal, {
                  searchDepth: context?.webSearchDepth,
                  maxResults: context?.webSearchResults,
                });
              } catch (searchError) {
                console.warn(
                  JSON.stringify({
                    event: "chat_web_search_failed",
                    requestId,
                    error: searchError instanceof Error ? searchError.message : "unknown",
                  }),
                );
                if (!context?.webSearch) {
                  sourceSearchUnavailable = true;
                } else {
                  const quotaLimited =
                    searchError instanceof WebSearchError &&
                    [429, 432, 433].includes(searchError.status);
                  return apiErrorResponse(
                    quotaLimited ? 429 : 503,
                    quotaLimited ? "WEB_SEARCH_RATE_LIMITED" : "WEB_SEARCH_UNAVAILABLE",
                    searchError instanceof Error
                      ? searchError.message
                      : "Web search is temporarily unavailable. Please retry.",
                    requestId,
                  );
                }
              }
            }
          }
          const webSourceContext = webSources.length
            ? buildResearchInstructions(webSources)
            : shouldSearchWeb
              ? "\n\nWEB SOURCE STATUS\nA live search was attempted but returned no usable results, or page retrieval was unavailable. State that current or external facts could not be verified from accessible web pages. Do not fabricate citations or imply that verification succeeded."
              : "";
          const verifiedPageCount = webSources.filter(
            (source) => source.verification === "page",
          ).length;
          const webResearchStatus: WebResearchStatus | undefined = shouldSearchWeb
            ? {
                status: sourceSearchUnavailable
                  ? "unavailable"
                  : webSources.length === 0
                    ? "no-results"
                    : verifiedPageCount === webSources.length
                      ? "complete"
                      : "partial",
                sourceCount: webSources.length,
                verifiedPageCount,
              }
            : undefined;
          const realityCheckInstructions = wantsRealityCheck
            ? "\n\nLORD REALITY CHECK\nSeparate sourced facts from assumptions, estimates, opinions, and unknowns. Do not claim that code was run, links were opened, or facts were verified unless the verification report has concrete evidence. State uncertainty plainly."
            : "";
          const chatMessages = buildChatContextMessages(contextMessages, {
            systemPrompt: `${LORD_SYSTEM_PROMPT}\n\nRESPONSE STYLE\n${parsed.data.context?.fastReply ? "Fast Reply Mode: answer immediately and concisely, prioritize the direct result, and avoid optional elaboration." : RESPONSE_STYLE_INSTRUCTIONS[(context?.responseStyle as ResponseStyle | undefined) ?? "balanced"]}${webSourceContext}${realityCheckInstructions}`,
            memoryPrompt,
            contextBudgetTokens: Math.floor(contextLimit * 0.7),
            application: {
              page: context?.page,
              workflow: context?.workflow,
              projectId: context?.projectId,
              mode,
              task: taskType,
              provider: selectedModel?.provider ?? "openrouter",
              modelId: selectedCandidates[0],
            },
          });

          if (wantsCouncil) {
            const modelIds = [...CHAT_MODEL_MAP.values()]
              .filter((model) => model.enabled && model.provider === "openrouter")
              .map((model) => model.id);
            const health = await getCouncilProviderHealth(
              readEnvApiKey("OPENROUTER_API_KEY"),
              modelIds,
            );
            const availableIds = health.ok
              ? health.modelIds.filter((modelId) => isModelAvailable(modelId))
              : [];
            const councilEligibleIds = hasMultimodal
              ? availableIds.filter((modelId) => {
                  const model = CHAT_MODEL_MAP.get(modelId);
                  return Boolean(
                    model?.capabilities.supportsVision &&
                    model.limits.maxImagesPerRequest >= imageCount &&
                    model.limits.maxContextTokens >= contextLimit,
                  );
                })
              : availableIds.filter(
                  (modelId) =>
                    (CHAT_MODEL_MAP.get(modelId)?.limits.maxContextTokens ?? 0) >= contextLimit,
                );
            let councilModels = selectCouncilModels(
              councilEligibleIds,
              isPro,
              taskType,
              requestedModelId,
              councilLimits.maxParallelRequests,
            );
            const simpleTask = isSimpleCouncilTask(lastUserText, taskType);
            if (simpleTask) councilModels = councilModels.slice(0, 1);
            const councilInputCharacters = chatMessages.reduce(
              (total, message) =>
                total +
                message.content.length +
                (message.images?.reduce((size, image) => size + image.length, 0) ?? 0) +
                (message.files?.reduce((size, file) => size + file.fileData.length, 0) ?? 0),
              0,
            );

            while (
              councilModels.length > 1 &&
              estimateCouncilCostUsd(
                councilModels,
                councilInputCharacters,
                councilLimits.maxOutputTokens,
                councilLimits.maxRetries,
              ) > councilLimits.maxCostUsd
            ) {
              councilModels = councilModels.slice(0, -1);
            }

            if (councilModels.length > 0) {
              const estimatedCost = estimateCouncilCostUsd(
                councilModels,
                councilInputCharacters,
                councilLimits.maxOutputTokens,
                councilLimits.maxRetries,
              );
              if (estimatedCost > councilLimits.maxCostUsd) {
                return apiErrorResponse(
                  429,
                  "AI_RATE_LIMITED",
                  "This request exceeds the configured LORD Council cost limit. Use standard chat or shorten the prompt.",
                  requestId,
                );
              }
              return streamCouncilResponse(
                chatMessages,
                councilModels,
                taskType,
                request.signal,
                councilLimits,
                requestId,
                webSources,
                webResearchStatus,
              );
            }

            console.warn(
              JSON.stringify({
                event: "council_reduced_fallback",
                requestId,
                reason: health.ok ? "no_eligible_available_models" : health.status,
              }),
            );
          }

          return streamChat(
            chatMessages,
            request.signal,
            selectedCandidates,
            requestId,
            webSources,
            parsed.data.context?.fastReply ? 700 : 1400,
            wantsRealityCheck
              ? {
                  enabled: true,
                  query: lastUserText,
                  sourceSearchUnavailable,
                  verifierUnavailable: realityCheckVerifierUnavailable,
                }
              : undefined,
            webResearchStatus,
          );
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "chat_request_failed",
              requestId,
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            }),
          );
          return apiErrorResponse(
            getGatewayErrorStatus(error),
            getGatewayErrorCode(error),
            getGatewayErrorMessage(error),
            requestId,
          );
        }
      },
    },
  },
});

function summarizeRequestBody(body: unknown) {
  if (!body || typeof body !== "object") return { type: typeof body };
  const value = body as Record<string, unknown>;
  const messages = Array.isArray(value.messages) ? value.messages : [];
  return {
    keys: Object.keys(value),
    messageCount: messages.length,
    messages: messages.map((message) => {
      const item =
        message && typeof message === "object" ? (message as Record<string, unknown>) : {};
      const parts = Array.isArray(item.parts) ? item.parts : [];
      return {
        role: item.role ?? null,
        partTypes: parts.map((part) =>
          part && typeof part === "object"
            ? ((part as Record<string, unknown>).type ?? null)
            : null,
        ),
      };
    }),
  };
}

function getGatewayErrorStatus(error: unknown): number {
  if (isAIConfigurationError(error)) return 503;
  if (isOpenRouterError(error)) {
    if (error.kind === "invalid_api_key") return 401;
    if (error.kind === "rate_limit") return 429;
    if (error.kind === "request") return 400;
  }
  return 503;
}

function getGatewayErrorCode(
  error: unknown,
):
  | "AI_NOT_CONFIGURED"
  | "AI_AUTH_ERROR"
  | "AI_RATE_LIMITED"
  | "AI_BAD_REQUEST"
  | "AI_UPSTREAM_ERROR" {
  if (isAIConfigurationError(error)) return "AI_NOT_CONFIGURED";
  if (error instanceof OpenRouterError) {
    if (error.kind === "invalid_api_key") return "AI_AUTH_ERROR";
    if (error.kind === "rate_limit") return "AI_RATE_LIMITED";
    if (error.kind === "request") return "AI_BAD_REQUEST";
  }
  return "AI_UPSTREAM_ERROR";
}

function getGatewayErrorMessage(error: unknown): string {
  if (isAIConfigurationError(error)) return error.message;
  if (isOpenRouterError(error)) return error.message;
  return "OpenRouter is temporarily unavailable.";
}

function getLastUserText(messages: UIMessage[]): string {
  const message = [...messages].reverse().find((item) => item.role === "user");
  if (!message) return "";
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

interface StoredChatAttachment {
  filename: string;
  mediaType: string;
  storagePath: string;
}

async function restoreChatAttachmentReferences(
  messages: UIMessage[],
  supabase: Parameters<typeof buildMemoryPrompt>[0] | undefined,
  userId: string | undefined,
): Promise<UIMessage[]> {
  if (!supabase || !userId) return messages;
  let remaining = Math.max(
    0,
    4 -
      messages.reduce(
        (total, message) => total + message.parts.filter((part) => part.type === "file").length,
        0,
      ),
  );
  if (!remaining) return messages;
  const restored = messages.slice();
  for (let messageIndex = restored.length - 1; messageIndex >= 0 && remaining > 0; messageIndex--) {
    const message = restored[messageIndex];
    if (message.role !== "user") continue;
    const existingNames = new Set(
      message.parts.flatMap((part) =>
        part.type === "file" && part.filename ? [part.filename] : [],
      ),
    );
    const metadata = message.metadata as { chatAttachments?: unknown } | undefined;
    const references = Array.isArray(metadata?.chatAttachments)
      ? (metadata.chatAttachments as StoredChatAttachment[])
      : [];
    const fileParts: Array<{
      type: "file";
      filename: string;
      mediaType: string;
      url: string;
    }> = [];
    for (const reference of references) {
      if (remaining <= 0) break;
      if (
        !reference ||
        typeof reference.filename !== "string" ||
        typeof reference.mediaType !== "string" ||
        typeof reference.storagePath !== "string" ||
        !reference.storagePath.startsWith(`${userId}/`) ||
        reference.storagePath.split("/").includes("..") ||
        existingNames.has(reference.filename)
      ) {
        continue;
      }
      const { data, error } = await supabase.storage
        .from("chat-attachments")
        .download(reference.storagePath);
      if (error || !data || data.size > 12 * 1024 * 1024) continue;
      const mimeType = data.type || reference.mediaType;
      if (!mimeType.startsWith("image/") && mimeType !== "application/pdf") continue;
      const base64 = Buffer.from(await data.arrayBuffer()).toString("base64");
      fileParts.push({
        type: "file",
        filename: reference.filename,
        mediaType: mimeType,
        url: `data:${mimeType};base64,${base64}`,
      });
      existingNames.add(reference.filename);
      remaining -= 1;
    }
    if (fileParts.length) {
      restored[messageIndex] = { ...message, parts: [...message.parts, ...fileParts] };
    }
  }
  return restored;
}

function keepRecentMultimodalFiles(messages: UIMessage[], maxFiles: number): UIMessage[] {
  let remaining = maxFiles;
  const kept = messages.slice();
  for (let messageIndex = kept.length - 1; messageIndex >= 0; messageIndex--) {
    const message = kept[messageIndex];
    const parts = message.parts.slice();
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex];
      if (part.type !== "file") continue;
      const mediaType = part.mediaType;
      if (!mediaType.startsWith("image/") && mediaType !== "application/pdf") continue;
      if (remaining > 0) remaining -= 1;
      else parts.splice(partIndex, 1);
    }
    kept[messageIndex] = { ...message, parts };
  }
  return kept;
}

async function safelyCheckProEntitlement(user: {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
}): Promise<boolean> {
  try {
    return await hasProEntitlement(user);
  } catch (error) {
    console.error("Chat entitlement verification failed; applying Free access.", error);
    return false;
  }
}
