# Objet Coin iOS

A hybrid SwiftUI app for `/coin`. It opens the coin full-screen in `WKWebView`, hides site navigation, wraps the instrument in native controls, and bridges the page's haptic calls into native iPhone impact feedback.

The project includes generated app icons, a launch image, a privacy manifest, persisted native settings, and archive/export configuration for App Store Connect uploads.

## Native shell

The Swift side owns the app chrome around the web instrument:

- Native reload, share, and settings controls
- Live/local/custom source switching
- Persisted native haptics and keep-awake preferences
- Native error recovery with browser fallback
- Launch-argument override support for Xcode development

## Run

Open `ObjetCoin.xcodeproj` in Xcode and run the `ObjetCoin` scheme on an iPhone simulator or device.

By default the app loads:

```text
https://objetdart-production.up.railway.app/coin?app=ios
```

To point it at a local Next dev server, edit the scheme's launch arguments in Xcode and add:

```text
-CoinURL http://localhost:3000/coin?app=ios
```

You can also switch between Live, Local, and Custom from the native settings sheet. The plist allows local networking so simulator builds can hit localhost during development.

## Assets

The icon and launch coin are generated from `Tools/make-assets.swift`:

```bash
cd ios/ObjetCoin
swiftc Tools/make-assets.swift -o /tmp/objetcoin-make-assets
/tmp/objetcoin-make-assets
```

The generated PNGs live in `ObjetCoin/Resources/Assets.xcassets`.

## Signing

`Config/Signing.xcconfig` keeps the default bundle identifier and leaves the Apple team blank. Set these in Xcode, or pass them to `xcodebuild`:

```bash
OBJET_COIN_DEVELOPMENT_TEAM=ABCDE12345
OBJET_COIN_BUNDLE_IDENTIFIER=com.yourcompany.objetcoin
```

## Archive

With a valid Apple Developer team configured:

```bash
cd ios/ObjetCoin
xcodebuild \
  -project ObjetCoin.xcodeproj \
  -scheme ObjetCoin \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/ObjetCoin.xcarchive \
  OBJET_COIN_DEVELOPMENT_TEAM=ABCDE12345 \
  OBJET_COIN_BUNDLE_IDENTIFIER=com.yourcompany.objetcoin \
  archive
```

Then export for App Store Connect:

```bash
xcodebuild \
  -exportArchive \
  -archivePath build/ObjetCoin.xcarchive \
  -exportPath build/AppStore \
  -exportOptionsPlist AppStore/ExportOptions.plist
```
