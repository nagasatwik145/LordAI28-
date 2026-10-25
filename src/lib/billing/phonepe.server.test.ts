import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPhonePePayment,
  getPhonePePaymentStatus,
  isPhonePeConfigured,
} from "./phonepe.server";

const originalEnv = {
  clientId: process.env.PHONEPE_CLIENT_ID,
  clientSecret: process.env.PHONEPE_CLIENT_SECRET,
  clientVersion: process.env.PHONEPE_CLIENT_VERSION,
  environment: process.env.PHONEPE_ENV,
  appBaseUrl: process.env.APP_BASE_URL,
};

function configureSandbox() {
  process.env.PHONEPE_CLIENT_ID = "sandbox-client";
  process.env.PHONEPE_CLIENT_SECRET = "sandbox-secret";
  process.env.PHONEPE_CLIENT_VERSION = "1";
  process.env.PHONEPE_ENV = "sandbox";
  process.env.APP_BASE_URL = "https://lord.example";
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, value] of Object.entries({
    PHONEPE_CLIENT_ID: originalEnv.clientId,
    PHONEPE_CLIENT_SECRET: originalEnv.clientSecret,
    PHONEPE_CLIENT_VERSION: originalEnv.clientVersion,
    PHONEPE_ENV: originalEnv.environment,
    APP_BASE_URL: originalEnv.appBaseUrl,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("PhonePe sandbox checkout", () => {
  it("creates a hosted checkout with the authenticated sandbox API", async () => {
    configureSandbox();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "sandbox-token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ redirectUrl: "https://checkout.phonepe.test/order" }), {
          status: 200,
        }),
      );

    const checkoutUrl = await createPhonePePayment({
      merchantOrderId: "lordpro_12345678-1234-4234-8234-123456789abc",
      amount: 9900,
      message: "LORD Pro monthly",
      redirectUrl: "https://lord.example/upgrade?phonepeOrder=order",
      fetcher,
    });

    expect(checkoutUrl).toBe("https://checkout.phonepe.test/order");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay",
    );
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "O-Bearer sandbox-token",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      merchantOrderId: "lordpro_12345678-1234-4234-8234-123456789abc",
      amount: 9900,
      paymentFlow: {
        type: "PG_CHECKOUT",
        merchantUrls: { redirectUrl: "https://lord.example/upgrade?phonepeOrder=order" },
      },
    });
  });

  it("checks an encoded merchant order status through the sandbox API", async () => {
    configureSandbox();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "sandbox-token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ state: "COMPLETED", amount: 9900 }), { status: 200 }),
      );

    await expect(getPhonePePaymentStatus("lordpro/order", fetcher)).resolves.toMatchObject({
      state: "COMPLETED",
      amount: 9900,
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order/lordpro%2Forder/status",
    );
  });

  it("does not allow production gateway credentials", async () => {
    configureSandbox();
    process.env.PHONEPE_ENV = "production";
    expect(isPhonePeConfigured()).toBe(false);
    await expect(
      createPhonePePayment({
        merchantOrderId: "lordpro_order",
        amount: 9900,
        message: "LORD Pro",
        redirectUrl: "https://lord.example/upgrade",
        fetcher: vi.fn<typeof fetch>(),
      }),
    ).rejects.toThrow("Only PhonePe sandbox payments are supported.");
  });

  it("reports availability only when sandbox credentials and a secure return URL are configured", () => {
    configureSandbox();
    expect(isPhonePeConfigured()).toBe(true);

    process.env.APP_BASE_URL = "http://lord.example";
    expect(isPhonePeConfigured()).toBe(false);
  });
});
