import { describe, expect, it } from "vitest";
import { APP_NAVIGATION, PRIMARY_NAVIGATION, SECONDARY_NAVIGATION } from "./app-navigation";

describe("app navigation", () => {
  it("uses unique destinations and sends Tasks to the unified task center", () => {
    const destinations = APP_NAVIGATION.map(({ to }) => to);
    expect(new Set(destinations).size).toBe(destinations.length);
    expect(APP_NAVIGATION.find(({ label }) => label === "Tasks & Notifications")?.to).toBe(
      "/tasks",
    );
    expect(APP_NAVIGATION.find(({ label }) => label === "Health Center")?.to).toBe(
      "/observability",
    );
  });

  it("keeps four primary destinations and exposes every other destination as secondary", () => {
    expect(PRIMARY_NAVIGATION).toHaveLength(4);
    expect(PRIMARY_NAVIGATION.map(({ to }) => to)).toEqual(["/", "/chat", "/voice", "/study"]);

    const allDestinations = [
      ...PRIMARY_NAVIGATION.map(({ to }) => to),
      ...SECONDARY_NAVIGATION.map(({ to }) => to),
    ];
    expect(new Set(allDestinations)).toEqual(new Set(APP_NAVIGATION.map(({ to }) => to)));
  });
});
