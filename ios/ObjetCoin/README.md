# Objet Coin iOS

A small SwiftUI shell for `/coin`. It opens the coin full-screen in `WKWebView`, hides site navigation, keeps the screen awake while the instrument is open, and bridges the page's haptic calls into native iPhone impact feedback.

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

The plist allows local networking so simulator builds can hit localhost during development.
