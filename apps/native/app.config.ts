import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "objet d'art",
  slug: "objet-universe",
  owner: "jawauntb",
  scheme: "objet",
  version: "0.1.0",
  icon: "./assets/icon.png",
  orientation: "default",
  userInterfaceStyle: "dark",
  backgroundColor: "#000000",
  platforms: ["ios"],
  extra: {
    eas: {
      projectId: "e1f3cd9b-a6b4-4152-8764-015f24d36cdd",
    },
  },
  ios: {
    bundleIdentifier: "com.objetdart.universe",
    buildNumber: "1",
    deploymentTarget: "17.0",
    supportsTablet: true,
    requireFullScreen: false,
    backgroundColor: "#000000",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSMotionUsageDescription: "The universe responds to tilt, motion, and orientation.",
      UIApplicationSupportsIndirectInputEvents: true,
      UIStatusBarHidden: true,
    },
  },
  experiments: {
    typedRoutes: true,
  },
  plugins: [
    "expo-router",
    "expo-dev-client",
    [
      "expo-build-properties",
      {
        ios: {
          deploymentTarget: "17.0",
        },
      },
    ],
    "./plugins/withObjetUniverse",
  ],
};

export default config;
