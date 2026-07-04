import SwiftUI
import UIKit
import WebKit

struct CoinWebView: UIViewRepresentable {
    @ObservedObject var model: CoinWebViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: Coordinator.hapticMessageName)
        contentController.addUserScript(WKUserScript(
            source: Self.bootstrapScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        ))

        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.backgroundColor = .black
        webView.isOpaque = false
        webView.navigationDelegate = context.coordinator
        webView.scrollView.backgroundColor = .black
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.isScrollEnabled = false
        webView.uiDelegate = context.coordinator

        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        context.coordinator.load(webView, token: model.reloadToken)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.reloadToken != model.reloadToken else {
            return
        }

        context.coordinator.load(webView, token: model.reloadToken)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.hapticMessageName)
    }

    private static let bootstrapScript = """
    (() => {
      const messageName = 'coinHaptic';
      const post = (body) => {
        try { window.webkit?.messageHandlers?.[messageName]?.postMessage(body); } catch (_) {}
      };
      const haptic = (pattern) => {
        post({ type: 'haptic', pattern });
        return true;
      };

      try {
        window.__objetCoinNative = Object.assign(window.__objetCoinNative || {}, {
          ready: true,
          haptic
        });
      } catch (_) {}

      try {
        const original = typeof navigator.vibrate === 'function' ? navigator.vibrate.bind(navigator) : null;
        Object.defineProperty(navigator, 'vibrate', {
          configurable: true,
          value: (pattern) => {
            haptic(pattern);
            return original ? original(pattern) : true;
          }
        });
      } catch (_) {
        try {
          navigator.vibrate = (pattern) => haptic(pattern);
        } catch (_) {}
      }

      const installAppChrome = () => {
        if (document.getElementById('objet-coin-ios-style')) return;
        const style = document.createElement('style');
        style.id = 'objet-coin-ios-style';
        style.textContent = `
          html, body { background: #000 !important; overscroll-behavior: none !important; }
          .oda-site-header { display: none !important; }
          .coin-hud { padding-top: calc(34px + env(safe-area-inset-top, 0px)) !important; }
        `;
        document.head.appendChild(style);
      };

      if (document.head) installAppChrome();
      else document.addEventListener('DOMContentLoaded', installAppChrome, { once: true });
    })();
    """

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        static let hapticMessageName = "coinHaptic"

        let model: CoinWebViewModel
        var reloadToken: UUID?

        init(model: CoinWebViewModel) {
            self.model = model
        }

        func load(_ webView: WKWebView, token: UUID) {
            reloadToken = token
            var request = URLRequest(url: model.url)
            request.cachePolicy = .reloadRevalidatingCacheData
            request.timeoutInterval = 30
            webView.load(request)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == Self.hapticMessageName else {
                return
            }

            Task { @MainActor in
                CoinNativeHaptics.shared.play(message.body)
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            model.isLoading = true
            model.errorMessage = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            model.isLoading = false
            model.errorMessage = nil
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            fail(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            fail(error)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
                decisionHandler(.cancel)
                return
            }

            guard shouldOpenInApp(url) else {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
            }
            return nil
        }

        private func fail(_ error: Error) {
            let nsError = error as NSError
            guard nsError.code != NSURLErrorCancelled else {
                return
            }

            model.isLoading = false
            model.errorMessage = error.localizedDescription
        }

        private func shouldOpenInApp(_ url: URL) -> Bool {
            guard let scheme = url.scheme?.lowercased() else {
                return true
            }

            if scheme == "about" || scheme == "blob" {
                return true
            }

            guard scheme == "http" || scheme == "https" else {
                return false
            }

            let allowedHosts = Set([
                model.url.host,
                "objetdart-production.up.railway.app",
                "localhost",
                "127.0.0.1"
            ].compactMap { $0?.lowercased() })

            return url.host.map { allowedHosts.contains($0.lowercased()) } ?? false
        }
    }
}

@MainActor
private final class CoinNativeHaptics {
    static let shared = CoinNativeHaptics()

    private let light = UIImpactFeedbackGenerator(style: .light)
    private let medium = UIImpactFeedbackGenerator(style: .medium)
    private let heavy = UIImpactFeedbackGenerator(style: .heavy)
    private var scheduled = [DispatchWorkItem]()

    private init() {
        light.prepare()
        medium.prepare()
        heavy.prepare()
    }

    func play(_ body: Any) {
        let pattern = extractPattern(from: body)

        if pattern.count == 1, pattern[0] <= 0 {
            cancelScheduled()
            return
        }

        if pattern.count <= 1 {
            impact(durationMs: pattern.first ?? 10)
            return
        }

        cancelScheduled()
        var delayMs: Double = 0

        for (index, value) in pattern.enumerated() {
            if index.isMultiple(of: 2), value > 0 {
                let item = DispatchWorkItem { [weak self] in
                    Task { @MainActor in
                        self?.impact(durationMs: value)
                    }
                }
                scheduled.append(item)
                DispatchQueue.main.asyncAfter(deadline: .now() + delayMs / 1000, execute: item)
            }
            delayMs += value
        }
    }

    private func extractPattern(from body: Any) -> [Double] {
        if let dictionary = body as? [String: Any] {
            return extractPattern(from: dictionary["pattern"] ?? dictionary["value"] ?? 10)
        }

        if let array = body as? [Any] {
            return array.compactMap { numberValue($0) }
        }

        return [numberValue(body) ?? 10]
    }

    private func numberValue(_ value: Any) -> Double? {
        if let number = value as? NSNumber {
            return number.doubleValue
        }

        if let string = value as? String {
            return Double(string)
        }

        return nil
    }

    private func impact(durationMs: Double) {
        let intensity = CGFloat(max(0.25, min(1.0, durationMs / 60)))

        switch durationMs {
        case ..<12:
            light.impactOccurred(intensity: intensity)
            light.prepare()
        case ..<32:
            medium.impactOccurred(intensity: intensity)
            medium.prepare()
        default:
            heavy.impactOccurred(intensity: intensity)
            heavy.prepare()
        }
    }

    private func cancelScheduled() {
        scheduled.forEach { $0.cancel() }
        scheduled.removeAll()
    }
}
