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
    /// Cards a Keep or Undo is finishing: shown in the column they're headed for until the CLI confirms.
    @Published var landing: [String: Column] = [:]

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
    func cards(in column: Column) -> [Card] { cards.filter { (landing[$0.id]?.rawValue ?? $0.column) == column.rawValue } }
    var needsYou: [Card] { cards.filter(\.needsYou) }
    var selectedCard: Card? { cards.first { $0.id == selectedCardID } }

    /// How Chompyy feels right now (drives the cookie's face).
    var cookieMood: CookieMood? {
        guard let q = state?.quota.fiveHour else { return nil }
        return CookieMood.from(left: fiveHourLeft, msLeft: q.msLeft, fresh: q.isFresh)
    }

    /// Fraction of the 5-hour window left, 0...1 (nil when unknown).
    var fiveHourLeft: Double? {
        guard let q = state?.quota.fiveHour else { return nil }
        if q.isFresh { return 1 }
        guard q.known, let left = q.leftPct else { return nil }
        return max(0, min(1, left / 100))
    }

    func refresh(forceQuota: Bool = false) async {
        let args = forceQuota ? ["state", "--refresh"] : ["state"]
        if forceQuota { busy.insert("refresh") }
        defer { if forceQuota { busy.remove("refresh") } }
        do {
            let result = try await Task.detached { try CLI.run(args) }.value
            guard result.ok else { error = result.message; if forceQuota { show(result.message) }; return }
            state = try JSONDecoder().decode(AppState.self, from: Data(result.out.utf8))
            error = nil
            // Say what the button did; when the check failed, also say how old the numbers on screen are.
            if forceQuota, let r = state?.quotaRefresh {
                let age = state?.quota.age().map { " Showing numbers from \($0)." } ?? ""
                show(r.ok ? "Quota updated from Anthropic just now." : r.message + age)
            }
            if let p = awayProcess, !p.isRunning { awayProcess = nil }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Run a card action, show its message, then refresh. Returns whether it worked.
    @discardableResult
    func act(_ key: String, _ args: [String], stdin: String? = nil, cwd: String? = nil) async -> Bool {
        busy.insert(key)
        defer { busy.remove(key) }
        var ok = false
        do {
            let result = try await Task.detached { try CLI.run(args, stdin: stdin, cwd: cwd) }.value
            ok = result.ok
            show(result.message)
        } catch {
            show(error.localizedDescription)
        }
        await refresh()
        return ok
    }

    /// Keep, undo and run-again finish with the card: close it so you see it land in its new column.
    /// The card closes at once and moves to `to` while the CLI works; if the action fails it comes back, opened.
    func finish(_ key: String, _ args: [String], card id: String, to: Column? = nil) async {
        if selectedCardID == id { selectedCardID = nil }
        if let to { landing[id] = to }
        let ok = await act(key, args)
        landing[id] = nil
        if !ok, selectedCardID == nil { selectedCardID = id }
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
            let p = try CLI.launch(["away", duration])
            awayProcess = p
            show("Away for \(duration): approved cards run one at a time. Your Mac stays awake until it's done; keep it plugged in with the lid open.")
            // When the run ends, say how it went: it may stop at once (the budget gate), and silence looks broken.
            p.terminationHandler = { _ in
                let summary = Store.awaySummary()
                Task { @MainActor in
                    self.awayProcess = nil
                    self.show(summary)
                    await self.refresh()
                }
            }
        } catch {
            show(error.localizedDescription)
        }
        Task { try? await Task.sleep(for: .seconds(2)); await refresh() }
    }

    /// The line that says how the last away run ended, from ~/.chompyy/app-away.log.
    nonisolated static func awaySummary() -> String {
        let log = CLI.home.appendingPathComponent("app-away.log")
        let lines = ((try? String(contentsOf: log, encoding: .utf8)) ?? "").split(separator: "\n").map(String.init)
        if let stopped = lines.last(where: { $0.hasPrefix("Stopped:") }) {
            let ran = lines.last(where: { $0.hasPrefix("Done.") }) ?? ""
            return "Away run stopped: \(stopped.dropFirst("Stopped: ".count))" + (ran.contains(" 0 card") || ran.isEmpty ? "" : " \(ran)")
        }
        if lines.contains(where: { $0.contains("No approved cards") }) { return "Nothing to run: approve a card first." }
        if let done = lines.last(where: { $0.hasPrefix("Done.") }) { return "Away run finished. \(done.dropFirst("Done. ".count))" }
        if let err = lines.last(where: { $0.lowercased().contains("error") }) { return "Away run failed: \(err)" }
        return "Away run ended."
    }

    func stopAway() {
        awayProcess?.interrupt() // SIGINT: the CLI stops the running card's whole process group
        show("Stopping the away run…")
    }
}
