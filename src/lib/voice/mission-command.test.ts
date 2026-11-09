import { describe, expect, it } from "vitest";
import { parseVoiceMissionCommand } from "./mission-command";

describe("parseVoiceMissionCommand", () => {
  it.each([
    ["check mission progress", { action: "progress" }],
    ["Show the mission status.", { action: "progress" }],
    ["pause active mission", { action: "pause" }],
    ["resume the mission", { action: "resume" }],
    ["cancel mission", { action: "cancel" }],
    [
      "please start mission to prepare a biology revision plan",
      {
        action: "start",
        goal: "prepare a biology revision plan",
      },
    ],
  ])("recognizes an exact command: %s", (input, expected) => {
    expect(parseVoiceMissionCommand(input)).toEqual(expected);
  });

  it.each([
    "maybe cancel the mission",
    "cancel mission and delete everything",
    "start mission",
    "pause the current project",
    "I want to check mission progress",
  ])("does not interpret ambiguous or unsupported phrasing: %s", (input) => {
    expect(parseVoiceMissionCommand(input)).toBeNull();
  });
});
