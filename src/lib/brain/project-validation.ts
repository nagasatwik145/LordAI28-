export const PROJECT_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const PROJECT_FILE_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function validateProjectFile(file: Pick<File, "type" | "size">): string | null {
  if (!PROJECT_FILE_TYPES.has(file.type)) {
    return "Use PDF, text, Markdown, PNG, JPEG, or WebP files.";
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return "Choose a non-empty file.";
  if (file.size > PROJECT_FILE_MAX_BYTES) return "Files must be 20 MB or smaller.";
  return null;
}
