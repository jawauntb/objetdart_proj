import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "objet d'art",
  slug: "objet-universe",
  scheme: "objet",
  version: "0.1.0",
  orientation: "default",
  userInterfaceStyle: "dark",
  backgroundColor: "#000000",
  platforms: ["ios"],
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
