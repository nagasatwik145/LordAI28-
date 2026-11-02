import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";

const config: CapacitorConfig = {
  appId: "com.nagasatwik145.lordai",
  appName: "Lord AI",
  webDir: "dist/client",
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 8000,
      launchAutoHide: true,
      launchFadeOutDuration: 180,
      backgroundColor: "#0a0e1a",
      androidSplashResourceName: "splash",
      androidScaleType: "FIT_CENTER",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0a0e1a",
      overlaysWebView: true,
    },
    Keyboard: {
      resize: KeyboardResize.Body,
      style: KeyboardStyle.Dark,
      resizeOnFullScreen: true,
    },
    LocalNotifications: {
      presentationOptions: ["badge", "sound"],
    },
  },
};

export default config;
