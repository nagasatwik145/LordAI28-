import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = (path: string) =>
  readFileSync(resolve(process.cwd(), "src/routes/api", path), "utf8");

describe("authenticated workspace database routes", () => {
  it("uses the verified request Supabase client instead of a server singleton", () => {
    for (const path of [
      "projects/index.ts",
      "projects/$id.ts",
      "knowledge/index.ts",
      "knowledge/$id.ts",
      "knowledge/upload.ts",
    ]) {
      const source = routeSource(path);
      expect(source).toContain("requireSupabaseRequestAuth");
      expect(source).toMatch(/context as \{[\s\S]*?supabase:/);
      expect(source).not.toContain('from "@/integrations/supabase/client"');
    }
  });

  it("checks that an attached project belongs to the authenticated user", () => {
    const source = routeSource("knowledge/upload.ts");
    expect(source).toContain('.eq("id", parsed.data.projectId)');
    expect(source).toContain('.eq("user_id", userId)');
    expect(source).toContain('"Project not found"');
  });
});
