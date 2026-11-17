import Foundation
import SwiftUI

/// Holds the latest `chompyy state` and runs card actions through the CLI.
@MainActor
final class Store: ObservableObject {
    @Published var state: AppState?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy: Set<String> = []
    @Published var awayProcess: Process?
    @Published var selectedCardID: String?

    private var timer: Timer?

    init() {
        selectedCardID = ProcessInfo.processInfo.environment["CHOMPYY_SELECT"] // for testing
        Task { await refresh() }
        // Board changes come from away runs and background blueprints: look again every 15 s.
        // The CLI itself limits live quota requests to one per 5 minutes.
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
    }

    var cards: [Card] { state?.cards ?? [] }
    func cards(in column: Column) -> [Card] { cards.filter { $0.column == column.rawValue } }
    var needsYou: [Card] { cards.filter(\.needsYou) }
    var selectedCard: Card? { cards.first { $0.id == selectedCardID } }

    /// Fraction of the 5-hour window left, 0...1 (nil when unknown).
    var fiveHourLeft: Double? {
        guard let q = state?.quota.fiveHour, q.known, let left = q.leftPct else { return nil }
        return max(0, min(1, left / 100))
    }

    func refresh(forceQuota: Bool = false) async {
        let args = forceQuota ? ["state", "--refresh"] : ["state"]
        do {
            let result = try await Task.detached { try CLI.run(args) }.value
            guard result.ok else { error = result.message; return }
            state = try JSONDecoder().decode(AppState.self, from: Data(result.out.utf8))
            error = nil
            if let p = awayProcess, !p.isRunning { awayProcess = nil }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Run a card action, show its message, then refresh.
    func act(_ key: String, _ args: [String], stdin: String? = nil, cwd: String? = nil) async {
        busy.insert(key)
        defer { busy.remove(key) }
        do {
            let result = try await Task.detached { try CLI.run(args, stdin: stdin, cwd: cwd) }.value
            show(result.message)
        } catch {
            show(error.localizedDescription)
        }
        await refresh()
    }

    func show(_ message: String) {
        toast = message
        let shown = message
        Task {
            try? await Task.sleep(for: .seconds(5))
            if toast == shown { toast = nil }
        }
    }

    func startAway(_ duration: String) {
        guard awayProcess == nil else { return }
        do {
            awayProcess = try CLI.launch(["away", duration])
            show("Away for \(duration): approved cards run one at a time. Your Mac stays awake until it's done; keep it plugged in with the lid open.")
        } catch {
            show(error.localizedDescription)
        }
        Task { try? await Task.sleep(for: .seconds(2)); await refresh() }
    }

    func stopAway() {
        awayProcess?.interrupt() // SIGINT: the CLI stops the running card's whole process group
        show("Stopping the away run…")
    }
}
