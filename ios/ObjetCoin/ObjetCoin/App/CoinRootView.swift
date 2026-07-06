import Foundation
import SwiftUI
import UIKit

@MainActor
final class CoinWebViewModel: ObservableObject {
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var reloadToken = UUID()
    @Published private(set) var settings: CoinNativeSettings
    @Published private(set) var latestCommand: CoinWebCommand?

    private let launchOverrideURL: URL?

    init(
        settings: CoinNativeSettings = .load(),
        launchOverrideURL: URL? = CoinAppConfig.launchOverrideURL
    ) {
        self.settings = settings
        self.launchOverrideURL = launchOverrideURL?.withCoinAppMode
    }

    var url: URL {
        (launchOverrideURL ?? settings.resolvedURL).withCoinAppMode
    }

    var hasLaunchOverride: Bool {
        launchOverrideURL != nil
    }

    var sourceLabel: String {
        hasLaunchOverride ? "launch" : settings.source.displayName
    }

    var sourceSystemImage: String {
        hasLaunchOverride ? "terminal" : settings.source.systemImage
    }

    var nativeHapticsEnabled: Bool {
        settings.nativeHapticsEnabled
    }

    var keepScreenAwake: Bool {
        settings.keepScreenAwake
    }

    func reload() {
        isLoading = true
        errorMessage = nil
        reloadToken = UUID()
    }

    func flipCoin() {
        latestCommand = CoinWebCommand(action: .flip)
    }

    func resetCoinProgress() {
        isLoading = true
        errorMessage = nil
        latestCommand = CoinWebCommand(action: .resetAventurine)
    }

    func previewHaptics() {
        guard nativeHapticsEnabled else {
            return
        }
        CoinNativeHaptics.shared.play([10, 28, 26])
    }

    func setSource(_ source: CoinNativeSettings.Source) {
        var next = settings
        next.source = source
        apply(next)
    }

    func apply(_ nextSettings: CoinNativeSettings) {
        let previousURL = url
        settings = nextSettings.normalized()
        settings.save()

        if url != previousURL {
            reload()
        }
    }
}

struct CoinWebCommand: Equatable {
    enum Action: Equatable {
        case flip
        case resetAventurine
    }

    let id = UUID()
    let action: Action
}

struct CoinRootView: View {
    @StateObject private var model = CoinWebViewModel()
    @State private var showingSettings = false
    @State private var showingShare = false

    var body: some View {
        ZStack {
            CoinWebView(model: model)
                .ignoresSafeArea()

            nativeOverlay

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
        .sheet(isPresented: $showingSettings) {
            CoinSettingsView(model: model)
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showingShare) {
            ShareSheet(items: [model.url])
                .ignoresSafeArea()
        }
        .onAppear {
            updateIdleTimer()
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
        }
        .onChange(of: model.keepScreenAwake) { _ in
            updateIdleTimer()
        }
    }

    private var nativeOverlay: some View {
        VStack(spacing: 0) {
            topBar

            Spacer()

            commandDock
                .padding(.bottom, 8)

            sourceDock
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 10)
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "circle.fill")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Color(red: 0.93, green: 0.70, blue: 0.23))

                Text("COIN")
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.white)
            }

            Label(model.sourceLabel, systemImage: model.sourceSystemImage)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(.white.opacity(0.68))
                .lineLimit(1)

            Spacer(minLength: 8)

            CoinIconButton(systemName: "arrow.clockwise", label: "Reload") {
                model.reload()
            }

            CoinIconButton(systemName: "square.and.arrow.up", label: "Share") {
                showingShare = true
            }

            CoinIconButton(systemName: "slider.horizontal.3", label: "Settings") {
                showingSettings = true
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 46)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(.white.opacity(0.14), lineWidth: 1)
        }
    }

    private var commandDock: some View {
        HStack(spacing: 14) {
            CoinIconButton(systemName: "arrow.triangle.2.circlepath", label: "Flip coin") {
                model.flipCoin()
            }

            CoinIconButton(systemName: "sparkles", label: "Reset saved shine") {
                model.resetCoinProgress()
            }

            CoinIconButton(
                systemName: "waveform.path.ecg",
                label: "Preview haptics",
                isDisabled: !model.nativeHapticsEnabled
            ) {
                model.previewHaptics()
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 44)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(.white.opacity(0.12), lineWidth: 1)
        }
    }

    private var sourceDock: some View {
        HStack(spacing: 10) {
            if model.hasLaunchOverride {
                Label("launch override", systemImage: "terminal")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.76))
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Picker("Source", selection: Binding(
                    get: { model.settings.source },
                    set: { model.setSource($0) }
                )) {
                    ForEach(CoinNativeSettings.Source.allCases) { source in
                        Text(source.pickerTitle).tag(source)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            if model.isLoading {
                ProgressView()
                    .controlSize(.small)
                    .tint(.white)
            }
        }
        .padding(8)
        .frame(minHeight: 48)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(.white.opacity(0.12), lineWidth: 1)
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

            Button {
                UIApplication.shared.open(model.url)
            } label: {
                Label("open in browser", systemImage: "safari")
                    .font(.system(.footnote, design: .monospaced))
            }
            .buttonStyle(.borderless)
            .foregroundStyle(.white.opacity(0.78))
        }
        .padding(22)
        .frame(maxWidth: 320)
        .background(.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding()
    }

    private func updateIdleTimer() {
        UIApplication.shared.isIdleTimerDisabled = model.keepScreenAwake
    }
}

private enum CoinAppConfig {
    static var launchOverrideURL: URL? {
        if let override = UserDefaults.standard.string(forKey: "CoinURL"),
           let url = URL(string: override) {
            return url
        }

        if let bundled = Bundle.main.object(forInfoDictionaryKey: "CoinURL") as? String,
           let url = URL(string: bundled) {
            return url
        }

        return nil
    }
}

struct CoinNativeSettings: Equatable {
    enum Source: String, CaseIterable, Identifiable {
        case production
        case local
        case custom

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .production:
                return "live"
            case .local:
                return "local"
            case .custom:
                return "custom"
            }
        }

        var pickerTitle: String {
            switch self {
            case .production:
                return "Live"
            case .local:
                return "Local"
            case .custom:
                return "Custom"
            }
        }

        var systemImage: String {
            switch self {
            case .production:
                return "antenna.radiowaves.left.and.right"
            case .local:
                return "desktopcomputer"
            case .custom:
                return "link"
            }
        }
    }

    var source: Source = .production
    var customURLString = ""
    var nativeHapticsEnabled = true
    var keepScreenAwake = true

    static let standard = CoinNativeSettings()
    static let productionURL = URL(string: "https://objetdart-production.up.railway.app/coin?app=ios")!
    static let localURL = URL(string: "http://localhost:3000/coin?app=ios")!

    var customURL: URL? {
        let trimmed = customURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }

        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil else {
            return nil
        }

        return url
    }

    var resolvedURL: URL {
        switch source {
        case .production:
            return Self.productionURL
        case .local:
            return Self.localURL
        case .custom:
            return customURL ?? Self.productionURL
        }
    }

    var hasValidCustomURL: Bool {
        source != .custom || customURL != nil
    }

    static func load(defaults: UserDefaults = .standard) -> CoinNativeSettings {
        var settings = CoinNativeSettings()

        if let rawSource = defaults.string(forKey: CoinSettingsKeys.source),
           let source = Source(rawValue: rawSource) {
            settings.source = source
        }

        settings.customURLString = defaults.string(forKey: CoinSettingsKeys.customURL) ?? ""

        if defaults.object(forKey: CoinSettingsKeys.nativeHaptics) != nil {
            settings.nativeHapticsEnabled = defaults.bool(forKey: CoinSettingsKeys.nativeHaptics)
        }

        if defaults.object(forKey: CoinSettingsKeys.keepAwake) != nil {
            settings.keepScreenAwake = defaults.bool(forKey: CoinSettingsKeys.keepAwake)
        }

        return settings.normalized()
    }

    func normalized() -> CoinNativeSettings {
        var settings = self
        settings.customURLString = customURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        if settings.source == .custom, settings.customURL == nil {
            settings.source = .production
        }
        return settings
    }

    func save(defaults: UserDefaults = .standard) {
        let settings = normalized()
        defaults.set(settings.source.rawValue, forKey: CoinSettingsKeys.source)
        defaults.set(settings.customURLString, forKey: CoinSettingsKeys.customURL)
        defaults.set(settings.nativeHapticsEnabled, forKey: CoinSettingsKeys.nativeHaptics)
        defaults.set(settings.keepScreenAwake, forKey: CoinSettingsKeys.keepAwake)
    }
}

private enum CoinSettingsKeys {
    static let source = "ObjetCoin.source"
    static let customURL = "ObjetCoin.customURL"
    static let nativeHaptics = "ObjetCoin.nativeHaptics"
    static let keepAwake = "ObjetCoin.keepAwake"
}

private struct CoinIconButton: View {
    let systemName: String
    let label: String
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.white.opacity(isDisabled ? 0.34 : 1))
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .accessibilityLabel(label)
    }
}

private struct CoinSettingsView: View {
    @ObservedObject var model: CoinWebViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft: CoinNativeSettings

    init(model: CoinWebViewModel) {
        self.model = model
        _draft = State(initialValue: model.settings)
    }

    var body: some View {
        NavigationStack {
            Form {
                if model.hasLaunchOverride {
                    Section("Launch") {
                        LabeledContent("Override", value: model.url.absoluteString)
                    }
                }

                Section("Source") {
                    Picker("Route", selection: $draft.source) {
                        ForEach(CoinNativeSettings.Source.allCases) { source in
                            Label(source.pickerTitle, systemImage: source.systemImage)
                                .tag(source)
                        }
                    }

                    if draft.source == .custom {
                        TextField("https://example.com/coin", text: $draft.customURLString)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .submitLabel(.done)

                        if !draft.hasValidCustomURL {
                            Label("Enter a valid URL", systemImage: "exclamationmark.triangle")
                                .font(.footnote)
                                .foregroundStyle(.orange)
                        }
                    }

                    LabeledContent("Active", value: previewURL.host ?? previewURL.absoluteString)
                }

                Section("Native") {
                    Toggle("Native haptics", isOn: $draft.nativeHapticsEnabled)
                    Toggle("Keep screen awake", isOn: $draft.keepScreenAwake)
                }

                Section("Actions") {
                    Button {
                        model.flipCoin()
                    } label: {
                        Label("Flip coin", systemImage: "arrow.triangle.2.circlepath")
                    }

                    Button {
                        guard draft.nativeHapticsEnabled else {
                            return
                        }
                        CoinNativeHaptics.shared.play([10, 28, 26])
                    } label: {
                        Label("Preview haptics", systemImage: "waveform.path.ecg")
                    }
                    .disabled(!draft.nativeHapticsEnabled)

                    Button(role: .destructive) {
                        model.resetCoinProgress()
                    } label: {
                        Label("Reset saved shine", systemImage: "sparkles")
                    }
                }

                Section {
                    Button(role: .destructive) {
                        draft = .standard
                        model.apply(draft)
                    } label: {
                        Label("Reset settings", systemImage: "arrow.counterclockwise")
                    }
                }
            }
            .navigationTitle("Coin")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        model.apply(draft)
                        dismiss()
                    }
                    .disabled(!draft.hasValidCustomURL)
                }
            }
        }
    }

    private var previewURL: URL {
        model.hasLaunchOverride ? model.url : draft.resolvedURL.withCoinAppMode
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
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
