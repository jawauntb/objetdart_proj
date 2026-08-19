import {
  createRunOncePlugin,
  type ConfigPlugin,
} from "expo/config-plugins";

const PLUGIN_NAME = "with-objet-universe";
const PLUGIN_VERSION = "1.0.0";

const nativeRoots = {
  expoModule: "modules/objet-universe",
  swiftPackage: "../../packages/objet-universe-kit",
  privacyManifest: "PrivacyInfo.xcprivacy",
  uiTests: "native-tests/ObjetNativeUITests",
} as const;

/**
 * Reserves the source roots that a clean Expo prebuild must know about.
 *
 * U3 fills these roots with the native view and Swift package. Keeping the
 * roots in this source-controlled plugin, rather than under apps/native/ios,
 * makes the generated Xcode tree disposable and gives U3 one place to attach
 * the source, test, package, and privacy resources once they exist.
 */
const withObjetUniverse: ConfigPlugin = (config) => {
  config.extra = {
    ...config.extra,
    objetUniverse: {
      ...nativeRoots,
    },
  };

  return config;
};

export default createRunOncePlugin(withObjetUniverse, PLUGIN_NAME, PLUGIN_VERSION);
