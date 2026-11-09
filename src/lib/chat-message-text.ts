import type { ChatSubmitPayload } from "@/components/lord/chat/input/types";
import { getToolDef } from "@/components/lord/chat/input/tools";

/**
 * Build the final text payload for a chat message, shared by the authenticated
 * and guest chat paths so both behave identically for attachments and tools.
 *
 * Text-like attachments are inlined up to 32 KB; multimodal (image/PDF)
 * attachments are handled separately as file parts by the caller.
 */
export async function buildMessageText(payload: ChatSubmitPayload): Promise<string> {
  let text = payload.text;
  if (payload.tool) {
    const tool = getToolDef(payload.tool);
    if (tool) text = `[${tool.label}] ${text}`;
  }
  const notes: string[] = [];
  const blocks: string[] = [];
  for (const att of payload.attachments) {
    notes.push(`- ${att.name} (${att.kind}, ${(att.size / 1024).toFixed(0)} KB)`);
    const isTextLike =
      att.kind === "file" &&
      (att.file.type.startsWith("text/") ||
        /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|py|css|html|log|yml|yaml)$/i.test(att.name));
    if (isTextLike && att.size <= 32 * 1024) {
      try {
        const content = await att.file.text();
        blocks.push(`\n\n--- ${att.name} ---\n${content.slice(0, 8000)}`);
      } catch {
        /* ignore unreadable files */
      }
    }
  }
  if (notes.length) text += `\n\nAttached files:\n${notes.join("\n")}`;
  if (blocks.length) text += blocks.join("");
  return text;
}

/** Attachments that the chat endpoint processes as inline multimodal file parts. */
export function multimodalAttachmentsOf(payload: ChatSubmitPayload) {
  return payload.attachments.filter(
    (attachment) => attachment.kind === "image" || attachment.kind === "pdf",
  );
}
