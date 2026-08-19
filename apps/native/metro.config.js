const { getDefaultConfig } = require("expo/metro-config");

// Expo derives the workspace root from the app and lockfile. Its default config
// watches the hoisted dependency tree without making a future shared package a
// prerequisite for the first native bundle.
module.exports = getDefaultConfig(__dirname);
