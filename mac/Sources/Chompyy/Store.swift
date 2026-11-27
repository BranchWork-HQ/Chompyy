import AppKit
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
    /// The sidebar's "Suggest tasks" popover, also opened from the menu panel's weekly forecast.
    @Published var showSuggest = false
    /// Tokens and API value from the usage ledger; loaded when a usage view shows (and kept fresh for the menu bar).
    @Published var usage: UsageData?
    private var usageLoadedAt: Date?
    /// Cards a Keep or Undo is finishing: shown in the column they're headed for until the CLI confirms.
    @Published var landing: [String: Column] = [:]
    /// Conversations about to go cold (live suggestions, `chompyy nudge`), newest last.
    @Published var goingCold: [GoingCold] = []
    private var ticks = 0
    /// What the live suggestions saved, and the cold-return trend (every 10 minutes; a 14-day scan takes ~1 s).
    @Published var nudgeImpact: NudgeImpact?

    private var timer: Timer?

    init() {
        selectedCardID = ProcessInfo.processInfo.environment["CHOMPYY_SELECT"] // for testing
        Task { await refresh() }
        // Board changes come from away runs and background blueprints: look again every 15 s.
        // The CLI itself limits live quota requests to one per 5 minutes.
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.refresh()
                // Live suggestions: every minute, ask which conversations are about to go cold (~0.1 s).
                self?.ticks += 1
                if (self?.ticks ?? 0) % 4 == 1 {
                    await self?.checkGoingCold()
                    // Approved settings advice goes in once no Claude Code session is active (the CLI checks).
                    if self?.cards.contains(where: { $0.advice?.state == "waiting" }) == true {
                        _ = try? await Task.detached(operation: { try CLI.run(["advise", "apply"]) }).value
                    }
                }
                if (self?.ticks ?? 0) % 40 == 1 {
                    await self?.loadImpact()
                    // Did it work? Re-measure applied or tried advice every 10 minutes (a transcript scan).
                    if self?.cards.contains(where: { ["applied", "trying", "done"].contains($0.advice?.state ?? "") }) == true {
                        _ = try? await Task.detached(operation: { try CLI.run(["worked", "--json"]) }).value
                    }
                }
                // Usage changes slowly and costs a file scan: every 2 minutes, once something has shown it.
                if self?.usage != nil || UserDefaults.standard.string(forKey: "menuBarShows") ?? "left" != "left" { await self?.loadUsage() }
            }
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

    /// Read the usage ledger, at most every 2 minutes unless forced. A cached scan takes ~0.1 s.
    func loadUsage(force: Bool = false) async {
        if !force, let at = usageLoadedAt, Date().timeIntervalSince(at) < 120 { return }
        usageLoadedAt = Date()
        let period = UserDefaults.standard.string(forKey: "usagePeriod") ?? "7d"
        guard let r = try? await Task.detached(operation: { try CLI.run(["usage", "--json", "--app", "--period", period]) }).value, r.ok,
              let data = try? JSONDecoder().decode(UsageData.self, from: Data(r.out.utf8)) else { return }
        usage = data
    }

    func loadImpact() async {
        guard let r = try? await Task.detached(operation: { try CLI.run(["nudge", "--json"]) }).value, r.ok,
              let i = try? JSONDecoder().decode(NudgeImpact.self, from: Data(r.out.utf8)) else { return }
        nudgeImpact = i
    }

    func checkGoingCold() async {
        guard let r = try? await Task.detached(operation: { try CLI.run(["nudge", "due", "--json"]) }).value, r.ok,
              let due = try? JSONDecoder().decode([GoingCold].self, from: Data(r.out.utf8)) else { return }
        goingCold = goingCold.filter { ($0.coldDate ?? .distantPast) > Date() } + due
        due.forEach(Notifier.post)
    }

    func refresh(forceQuota: Bool = false) async {
        let args = forceQuota ? ["state", "--refresh"] : ["state"]
        if forceQuota { busy.insert("refresh") }
        defer { if forceQuota { busy.remove("refresh") } }
        do {
            let result = try await Task.detached { try CLI.run(args) }.value
            guard result.ok else { error = result.message; if forceQuota { show(result.message) }; return }
            state = try JSONDecoder().decode(AppState.self, from: Data(result.out.utf8))
            notifySpareWeek()
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

    /// Share results: `chompyy worked --share` on the clipboard, ready to paste on the tester issue (no names in it).
    func copyShare() async {
        busy.insert("share")
        defer { busy.remove("share") }
        guard let r = try? await Task.detached(operation: { try CLI.run(["worked", "--share"]) }).value, r.ok else {
            show("Couldn't build the summary. Try again in a minute.")
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(r.out.trimmingCharacters(in: .whitespacesAndNewlines), forType: .string)
        show("Copied. Paste it on the tester issue (#24).")
    }

    /// Once a day at most, between 9:00 and 21:00: when 2+ full 5-hour windows of the week are forecast to go unused.
    func notifySpareWeek() {
        guard let w = state?.quota.pacing?.week, let spare = w.spareWindows, spare >= 2 else { return }
        let now = Date()
        let hour = Calendar.current.component(.hour, from: now)
        guard (9..<21).contains(hour) else { return }
        let today = now.formatted(.iso8601.year().month().day())
        guard UserDefaults.standard.string(forKey: "spareWeekNotified") != today else { return }
        UserDefaults.standard.set(today, forKey: "spareWeekNotified")
        let reset = Date(timeIntervalSince1970: w.resetsAt)
        Notifier.post(id: "week-\(today)", title: "~\(Int(w.unusedPct.rounded()))% of your week will reset unused",
                      body: "About \(Int(spare)) full 5-hour windows spare before \(reset.formatted(.dateTime.weekday(.abbreviated).hour().minute())). Board → Suggest tasks.")
    }

    /// Live suggestions on or off (`chompyy nudge on|off`: a Claude Code hook), then the panel's line again.
    func setNudge(_ on: Bool) async {
        _ = await act("nudge", ["nudge", on ? "on" : "off"])
        await loadImpact()
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
