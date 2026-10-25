import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Device } from "@capacitor/device";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Keyboard } from "@capacitor/keyboard";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Network } from "@capacitor/network";
import { Share } from "@capacitor/share";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

export const isNativeMobile = () => Capacitor.isNativePlatform();

export async function initializeMobileRuntime() {
  if (!isNativeMobile()) return;
  await Promise.allSettled([
    StatusBar.setStyle({ style: Style.Dark }),
    StatusBar.setBackgroundColor({ color: "#0a0e1a" }),
    StatusBar.setOverlaysWebView({ overlay: true }),
    Keyboard.setAccessoryBarVisible({ isVisible: false }),
    SplashScreen.hide(),
  ]);
}

export const mobileDevice = {
  info: () => Device.getInfo(),
  id: () => Device.getId(),
  battery: () => Device.getBatteryInfo(),
};

export const mobileCamera = {
  takePhoto: async () => {
    const photo = await Camera.getPhoto({
      quality: 82,
      width: 2200,
      height: 2200,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
      saveToGallery: false,
    });
    if (!photo.webPath) throw new Error("The camera did not return an image.");
    const response = await fetch(photo.webPath);
    if (!response.ok) throw new Error("Could not read the captured image.");
    const blob = await response.blob();
    const mimeType = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
    const extension = mimeType === "image/png" ? "png" : "jpg";
    return new File([blob], `lord-capture-${Date.now()}.${extension}`, { type: mimeType });
  },
  pickImage: () =>
    Camera.getPhoto({
      quality: 82,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: CameraSource.Photos,
    }),
};

export const mobileFiles = {
  writeText: (path: string, data: string) =>
    Filesystem.writeFile({ path, data, directory: Directory.Documents, encoding: Encoding.UTF8 }),
  readText: (path: string) =>
    Filesystem.readFile({ path, directory: Directory.Documents, encoding: Encoding.UTF8 }),
  listDocuments: (path = "") => Filesystem.readdir({ path, directory: Directory.Documents }),
};

export const mobileNotifications = {
  requestPermissions: () => LocalNotifications.requestPermissions(),
  scheduleReminder: async (
    title: string,
    body: string,
    at: Date,
    route = "/study",
    id = Date.now() % 2147483647,
    repeats = false,
  ) => {
    const permission = await LocalNotifications.requestPermissions();
    if (permission.display !== "granted") return { scheduled: false as const, id };
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          schedule: { at, repeats },
          extra: { route: safeInternalRoute(route) ?? "/study" },
        },
      ],
    });
    return { scheduled: true as const, id };
  },
  cancel: (id: number) => LocalNotifications.cancel({ notifications: [{ id }] }),
};

export function safeInternalRoute(value: string | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }
  try {
    const url = new URL(value, "https://lordai.invalid");
    if (url.origin !== "https://lordai.invalid") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function routeFromAppUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "lordai:" || url.hostname !== "open") return null;
    return safeInternalRoute(`${url.pathname}${url.search}${url.hash}`);
  } catch {
    return null;
  }
}

export async function registerMobileNavigation(
  onNavigate: (route: string) => void,
  onAppActiveChange?: (active: boolean) => void,
) {
  if (!isNativeMobile()) return () => undefined;
  let active = true;
  const handles = await Promise.all([
    App.addListener("appUrlOpen", ({ url }) => {
      if (!active) return;
      const route = routeFromAppUrl(url);
      if (route) onNavigate(route);
    }),
    LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => {
      if (!active) return;
      const route = safeInternalRoute(notification.extra?.route as string | undefined);
      if (route) onNavigate(route);
    }),
    App.addListener("appStateChange", ({ isActive }) => {
      if (active) onAppActiveChange?.(isActive);
    }),
  ]);
  const appState = await App.getState().catch(() => ({ isActive: false }));
  if (active) onAppActiveChange?.(appState.isActive);
  const launch = await App.getLaunchUrl().catch(() => undefined);
  if (active && launch?.url) {
    const route = routeFromAppUrl(launch.url);
    if (route) onNavigate(route);
  }
  return () => {
    active = false;
    handles.forEach((handle) => void handle.remove());
  };
}

export const mobileHaptics = {
  light: () =>
    isNativeMobile() && Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined),
  success: () =>
    isNativeMobile() &&
    Haptics.notification({ type: NotificationType.Success }).catch(() => undefined),
  error: () =>
    isNativeMobile() &&
    Haptics.notification({ type: NotificationType.Error }).catch(() => undefined),
};

export const mobileNetwork = {
  status: () => Network.getStatus(),
  listen: (callback: Parameters<typeof Network.addListener>[1]) =>
    Network.addListener("networkStatusChange", callback),
};

export const mobileShare = {
  shareText: (title: string, text: string, url?: string) => Share.share({ title, text, url }),
};

export const mobileApp = {
  getState: () => App.getState(),
  getInfo: () => App.getInfo(),
};
