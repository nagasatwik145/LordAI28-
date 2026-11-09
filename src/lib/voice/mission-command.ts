export type VoiceMissionCommand =
  | { action: "start"; goal: string }
  | { action: "pause" }
  | { action: "resume" }
  | { action: "cancel" }
  | { action: "progress" };

export function parseVoiceMissionCommand(text: string): VoiceMissionCommand | null {
  const command = text
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (/^(?:please )?(?:check|show) (?:the )?mission (?:progress|status)$/.test(command)) {
    return { action: "progress" };
  }
  if (/^(?:please )?pause (?:the )?(?:active )?mission$/.test(command)) {
    return { action: "pause" };
  }
  if (/^(?:please )?resume (?:the )?(?:active )?mission$/.test(command)) {
    return { action: "resume" };
  }
  if (/^(?:please )?cancel (?:the )?(?:active )?mission$/.test(command)) {
    return { action: "cancel" };
  }

  const startMatch = /^(?:please )?start mission to (.{3,2000})$/i.exec(text.trim());
  if (startMatch) return { action: "start", goal: startMatch[1].trim() };
  return null;
}
