import "@tanstack/react-start/server-only";

const PHONEPE_SANDBOX_BASE_URL = "https://api-preprod.phonepe.com/apis/pg-sandbox";

type PhonePeCredentials = {
  clientId: string;
  clientSecret: string;
  clientVersion: string;
};

type PhonePeTokenResponse = {
  access_token?: string;
  expires_at?: number;
  error?: string;
  message?: string;
};

export type PhonePeOrderStatus = {
  state?: "COMPLETED" | "FAILED" | "PENDING" | string;
  orderId?: string;
  amount?: number;
  errorCode?: string;
  detailedErrorCode?: string;
};

export function isPhonePeConfigured(): boolean {
  const hasSandboxCredentials = Boolean(
    process.env.PHONEPE_CLIENT_ID &&
    process.env.PHONEPE_CLIENT_SECRET &&
    process.env.PHONEPE_CLIENT_VERSION &&
    (!process.env.PHONEPE_ENV || process.env.PHONEPE_ENV === "sandbox"),
  );
  if (!hasSandboxCredentials) return false;

  try {
    const appUrl = new URL(process.env.APP_BASE_URL ?? "");
    return (
      (appUrl.protocol === "https:" || appUrl.hostname === "localhost") &&
      !appUrl.username &&
      !appUrl.password
    );
  } catch {
    return false;
  }
}

function phonePeCredentials(): PhonePeCredentials {
  const clientId = process.env.PHONEPE_CLIENT_ID;
  const clientSecret = process.env.PHONEPE_CLIENT_SECRET;
  const clientVersion = process.env.PHONEPE_CLIENT_VERSION;
  if (!clientId || !clientSecret || !clientVersion)
    throw new Error("PhonePe sandbox credentials are not configured.");
  if (process.env.PHONEPE_ENV && process.env.PHONEPE_ENV !== "sandbox")
    throw new Error("Only PhonePe sandbox payments are supported.");
  return { clientId, clientSecret, clientVersion };
}

async function phonePeAccessToken(fetcher: typeof fetch): Promise<string> {
  const credentials = phonePeCredentials();
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_version: credentials.clientVersion,
    client_secret: credentials.clientSecret,
    grant_type: "client_credentials",
  });
  const response = await fetcher(`${PHONEPE_SANDBOX_BASE_URL}/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = (await response.json()) as PhonePeTokenResponse;
  if (!response.ok || !result.access_token) {
    throw new Error(result.message ?? result.error ?? "PhonePe authorization failed.");
  }
  return result.access_token;
}

function phonePeApiError(payload: unknown): string {
  if (typeof payload === "object" && payload !== null) {
    const value = payload as { message?: unknown; code?: unknown };
    if (typeof value.message === "string") return value.message;
    if (typeof value.code === "string") return value.code;
  }
  return "PhonePe payment service is unavailable.";
}

export async function createPhonePePayment(input: {
  merchantOrderId: string;
  amount: number;
  message: string;
  redirectUrl: string;
  fetcher?: typeof fetch;
}): Promise<string> {
  const fetcher = input.fetcher ?? fetch;
  const accessToken = await phonePeAccessToken(fetcher);
  const response = await fetcher(`${PHONEPE_SANDBOX_BASE_URL}/checkout/v2/pay`, {
    method: "POST",
    headers: {
      Authorization: `O-Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      merchantOrderId: input.merchantOrderId,
      amount: input.amount,
      expireAfter: 1200,
      metaInfo: { udf1: input.message },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: input.message,
        merchantUrls: { redirectUrl: input.redirectUrl },
      },
    }),
  });
  const result = (await response.json()) as { redirectUrl?: string } & Record<string, unknown>;
  if (!response.ok || !result.redirectUrl) throw new Error(phonePeApiError(result));
  return result.redirectUrl;
}

export async function getPhonePePaymentStatus(
  merchantOrderId: string,
  fetcher: typeof fetch = fetch,
): Promise<PhonePeOrderStatus> {
  const accessToken = await phonePeAccessToken(fetcher);
  const response = await fetcher(
    `${PHONEPE_SANDBOX_BASE_URL}/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status`,
    { headers: { Authorization: `O-Bearer ${accessToken}` } },
  );
  const result = (await response.json()) as PhonePeOrderStatus & Record<string, unknown>;
  if (!response.ok) throw new Error(phonePeApiError(result));
  return result;
}
