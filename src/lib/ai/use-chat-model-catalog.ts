import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import type { ChatModelCatalogItem } from "./chat-model-catalog";

export interface ChatModelCatalogResponse {
  isPro: boolean;
  models: ChatModelCatalogItem[];
}

export function useChatModelCatalog({ enabled = true }: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["chat-model-catalog"],
    enabled,
    queryFn: async (): Promise<ChatModelCatalogResponse> => {
      const response = await authenticatedFetch("/api/models");
      if (!response.ok) throw new Error("Could not load configured AI models.");
      return (await response.json()) as ChatModelCatalogResponse;
    },
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });

  const retryAvailability = async () => {
    const response = await authenticatedFetch("/api/models?refresh=1");
    if (!response.ok) throw new Error("Could not refresh AI model availability.");
    const data = (await response.json()) as ChatModelCatalogResponse;
    queryClient.setQueryData(["chat-model-catalog"], data);
    return data;
  };

  return { ...query, retryAvailability };
}
