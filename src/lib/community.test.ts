import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20261025050000_lord_community.sql", "utf8");
const api = readFileSync("src/routes/api/community.ts", "utf8");
const publicApi = readFileSync("src/routes/api/community/public/$slug.ts", "utf8");

describe("LORD Community security contract", () => {
  it("keeps drafts owner-only and limits public reads to approved publications", () => {
    expect(migration).toContain("status = 'published' and moderation_status = 'approved'");
    expect(migration).toContain("auth.uid() = creator_id");
    expect(api).toContain('.eq("creator_id", userId)');
  });
  it("validates selected source games and their structured format before publishing", () => {
    expect(api).toContain('.eq("user_id", userId).maybeSingle()');
    expect(api).toContain("!validateGameSpec(game.spec)");
  });
  it("prevents creators from moderating their own items and gates moderator actions", () => {
    expect(migration).toContain("moderation_status text not null default 'pending'");
    expect(api).toContain('input.action === "moderate" && !moderators.includes(userId)');
    expect(api).toContain('patch.moderation_status = "pending"');
  });
  it("supports reports, report rate limits, and moderator review queues", () => {
    expect(migration).toContain("lord_community_reports");
    expect(api).toContain("Report limit reached");
    expect(api).toContain('url.searchParams.get("moderation") === "1"');
  });
  it("prevents duplicate votes with a database uniqueness constraint", () => {
    expect(migration).toContain("primary key (creation_id, user_id)");
    expect(api).toContain('input.action === "vote"');
  });
  it("provides public links only for published and approved records", () => {
    expect(publicApi).toContain('.eq("status", "published")');
    expect(publicApi).toContain('.eq("moderation_status", "approved")');
    expect(publicApi).toContain('"Cache-Control": "public, max-age=60');
  });
  it("checks ownership before editing, unpublishing, or deleting a creation", () => {
    expect(api).toContain('.eq("id", input.id).eq("creator_id", userId)');
    expect(api).toContain('input.action === "unpublish"');
    expect(api).toContain('input.action === "delete"');
  });
  it("rejects invalid or unowned game assets rather than publishing arbitrary uploads", () => {
    expect(api).toContain("That saved game is unavailable or invalid.");
    expect(api).not.toContain("upload(");
  });
  it("requires authenticated request middleware for privileged community actions", () => {
    expect(api).toContain("middleware: [requireSupabaseRequestAuth]");
    expect(api).toContain('if (!parsed.success)');
  });
});
