import { describe, expect, it } from "vitest";
import { deduplicateResearchSources } from "./deep-research.server";

describe("deep research source handling", () => {
  it("deduplicates normalized URLs and keeps the page retrieved evidence", () => {
    const result = deduplicateResearchSources([
      {
        title: "Snippet",
        url: "https://example.com/a#top",
        content: "snippet",
        verification: "snippet",
      },
      {
        title: "Page",
        url: "https://example.com/a",
        content: "Retrieved evidence",
        verification: "page",
      },
      { title: "Bad", url: "javascript:alert(1)", content: "", verification: "page" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "Page",
      verification: "page",
      url: "https://example.com/a",
    });
  });

  it("limits the number of evidence records", () => {
    const result = deduplicateResearchSources(
      Array.from({ length: 20 }, (_, index) => ({
        title: `Source ${index}`,
        url: `https://example.com/${index}`,
        content: "source text",
        verification: "page" as const,
      })),
    );
    expect(result).toHaveLength(12);
  });
});
