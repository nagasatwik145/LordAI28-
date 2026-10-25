import { createFileRoute } from "@tanstack/react-router";

const entries = [
  "/",
  "/privacy-policy",
  "/chat",
  "/study",
  "/productivity",
  "/research",
  "/memory",
  "/documents",
  "/settings",
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const baseUrl = new URL(request.url).origin;
        const urls = entries.map((path) => `  <url>\n    <loc>${baseUrl}${path}</loc>\n  </url>`);
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`,
          {
            headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
          },
        );
      },
    },
  },
});
