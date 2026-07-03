import Foundation
import SwiftUI
import UIKit

@MainActor
final class CoinWebViewModel: ObservableObject {
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var reloadToken = UUID()

    let url: URL = CoinAppConfig.coinURL

    func reload() {
        isLoading = true
        errorMessage = nil
        reloadToken = UUID()
    }
}

struct CoinRootView: View {
    @StateObject private var model = CoinWebViewModel()

    var body: some View {
        ZStack {
            CoinWebView(model: model)
                .ignoresSafeArea()

            if model.isLoading {
                loadingView
                    .transition(.opacity)
            }

            if let errorMessage = model.errorMessage {
                errorView(errorMessage)
                    .transition(.opacity)
            }
        }
        .background(Color.black)
        .statusBarHidden(true)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    private var loadingView: some View {
        VStack(spacing: 14) {
            ProgressView()
                .tint(.white)
                .controlSize(.large)

            Text("coin")
                .font(.system(.caption, design: .monospaced))
                .kerning(2)
                .foregroundStyle(.white.opacity(0.56))
        }
        .padding(22)
        .background(.black.opacity(0.52), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 14) {
            Text("coin could not open")
                .font(.headline)
                .foregroundStyle(.white)

            Text(message)
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(.white.opacity(0.68))
                .lineLimit(4)

            Button(action: model.reload) {
                Label("reload", systemImage: "arrow.clockwise")
                    .font(.system(.callout, design: .monospaced))
            }
            .buttonStyle(.borderedProminent)
            .tint(.white)
            .foregroundStyle(.black)
        }
        .padding(22)
        .frame(maxWidth: 320)
        .background(.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding()
    }
}

private enum CoinAppConfig {
    static var coinURL: URL {
        if let override = UserDefaults.standard.string(forKey: "CoinURL"),
           let url = URL(string: override) {
            return url.withCoinAppMode
        }

        if let bundled = Bundle.main.object(forInfoDictionaryKey: "CoinURL") as? String,
           let url = URL(string: bundled) {
            return url.withCoinAppMode
        }

        return URL(string: "https://objetdart-production.up.railway.app/coin?app=ios")!
    }
}

private extension URL {
    var withCoinAppMode: URL {
        guard var components = URLComponents(url: self, resolvingAgainstBaseURL: false) else {
            return self
        }

        var items = components.queryItems ?? []
        if !items.contains(where: { $0.name == "app" }) {
            items.append(URLQueryItem(name: "app", value: "ios"))
        }
        components.queryItems = items
        return components.url ?? self
    }
}
