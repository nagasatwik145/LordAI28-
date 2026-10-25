import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrivacyPolicyPage } from "./privacy-policy";

describe("privacy policy route", () => {
  it("renders as a public, self-contained policy page", () => {
    const html = renderToStaticMarkup(<PrivacyPolicyPage />);

    expect(html).toContain("LORD AI Privacy Policy");
    expect(html).toContain("Effective date: October 25, 2026");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="mailto:nagasatwik145@gmail.com"');
    expect(html).toContain("AI and service providers");
    expect(html).toContain("13 months");
    expect(html).not.toContain("OPENAI_API_KEY");
    expect(html).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
