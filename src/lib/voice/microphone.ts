export type VoiceMicrophonePermission = "granted" | "denied" | "prompt" | "unknown";

export async function getVoiceMicrophonePermission(): Promise<VoiceMicrophonePermission> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

export async function requestVoiceMicrophonePermission(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is unavailable in this browser.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

export function microphonePermissionError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone permission was denied. Allow access in device or browser settings, then retry.";
    }
    if (error.name === "NotFoundError") {
      return "No microphone is available on this device. You can still use text chat.";
    }
    if (error.name === "NotReadableError" || error.name === "AbortError") {
      return "The microphone is busy or unavailable. Close other recording apps and retry.";
    }
  }
  return error instanceof Error ? error.message : "Microphone access failed.";
}
