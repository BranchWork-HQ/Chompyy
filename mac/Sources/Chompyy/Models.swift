import Foundation

/// Mirrors `chompyy state --json` (cli/src/appstate.ts). The app keeps no logic of its own.
struct AppState: Decodable {
    let generatedAt: String
    let quota: Quota
    let gate: Gate
    let cards: [Card]
    let coldStart: ColdStartState?
    /// Rules waiting for your yes, and the ones in force ("What Chompyy heard from you").
    let taste: TasteState?
    /// The nightly read: which workspaces it learns from, and how last night went.
    let dream: DreamState?
    /// Set only after a forced refresh: what the live quota check did.
    let quotaRefresh: QuotaRefresh?
}

struct DreamState: Decodable {
    let on: Bool
    let model: String
    let workspaces: [Workspace]
    let last: Last?
    struct Workspace: Decodable, Identifiable {
        let path: String
        let kind: String
        let sessions: Int
        let lastAt: String
        let ticked: Bool
        var id: String { path }
        var name: String { kind == "desktop" ? path : (path as NSString).abbreviatingWithTildeInPath }
        var kindLabel: String { kind == "repo" ? "coding folder" : kind == "desktop" ? "chats in the desktop app" : "not a git repo" }
    }
    struct Last: Decodable {
        let at: String
        let sessions: Int
        let readTokens: Int
        let signals: Int
        let dropped: Int
        let error: String?
    }
}

struct TasteState: Decodable {
    let waiting: [TasteItem]
    let learned: [TasteItem]
}

struct TasteItem: Decodable, Identifiable {
    let id: String
    let text: String
    let noticed: String
    let scope: String
    let evidence: String
    let receipts: [Receipt]
    let since: String?
    struct Receipt: Decodable, Hashable {
        let at: String
        let card: String?
        let title: String?
        let said: String
    }
}

struct QuotaRefresh: Decodable {
    let ok: Bool
    let message: String
}

struct Quota: Decodable {
    let source: String
    let capturedAt: String?
    let plan: String?
    let note: String?
    /// Live quota waits for your OK to read Claude Code's login from the Keychain (#24).
    let askKeychain: Bool?
    let fiveHour: WindowView
    let sevenDay: WindowView

    var capturedDate: Date? {
        guard let capturedAt else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: capturedAt) ?? ISO8601DateFormatter().date(from: capturedAt)
    }

    /// "just now", "4 min ago", "2 h ago": how old the numbers on screen are.
    func age(now: Date = Date()) -> String? {
        guard let d = capturedDate else { return nil }
        let s = max(0, now.timeIntervalSince(d))
        if s < 90 { return "just now" }
        if s < 3600 { return "\(Int(s / 60)) min ago" }
        return "\(Int(s / 3600)) h ago"
    }
}

struct WindowView: Decodable {
    let known: Bool
    let reason: String?
    let usedPct: Double?
    let leftPct: Double?
    let msLeft: Double?
    let pacePerHour: Double?
    let resetsAt: Double?

    var resetDate: Date? { resetsAt.map { Date(timeIntervalSince1970: $0) } }

    /// The last window has reset and no new one has started: all of it is left, and the next
    /// Claude Code message starts the clock. (Chompyy never sends one just to check.)
    var isFresh: Bool { !known && reason == "stale" }

    /// One line under the % for a fresh window.
    var freshHint: String {
        let at = resetDate.map { " · the last one reset at \($0.formatted(date: .omitted, time: .shortened))" } ?? ""
        return "A new window starts with your next Claude Code message\(at)"
    }
}

struct Gate: Decodable {
    let ok: Bool
    let reasons: [String]
    let notes: [String]
}

struct RunInfo: Decodable {
    let status: String
    let startedAt: String
    let finishedAt: String
    let durationMs: Double
    let workdir: String
    let branch: String?
    let summary: String
    let checks: Checks?
    /// Chompyy's own measurement: the repo's checks on the card vs on the main it started from.
    let verified: Verified?
    /// Exact tokens the agent used, and their value at API prices.
    let tokens: RunTokens?
}

/// Exact tokens of one run, from the run's own log (tokens.ts).
struct RunTokens: Decodable {
    let input: Int
    let output: Int
    let cacheRead: Int
    let cacheWrite: Int
    let costUsd: Double
    let turns: Int

    var total: Int { input + output + cacheRead + cacheWrite }
    static func compact(_ n: Int) -> String {
        n < 1000 ? "\(n)" : n < 1_000_000 ? String(format: n < 10_000 ? "%.1fk" : "%.0fk", Double(n) / 1000) : String(format: "%.1fM", Double(n) / 1_000_000)
    }
    var line: String { "Used \(Self.compact(total)) tokens · $\(String(format: "%.2f", costUsd)) at API prices · \(turns) turns" }
    var breakdown: String { "\(Self.compact(output)) written · \(Self.compact(cacheRead)) read from cache · \(Self.compact(cacheWrite)) written to cache · \(Self.compact(input)) fresh input" }
}

/// Chompyy bringing a card in review up to date after other cards were kept (refresh.ts).
struct Refresh: Decodable {
    let state: String    // waiting | running | done | failed
    let by: String?      // git | agent
    let why: String?
    let files: [String]?
    let at: String
}

struct Checks: Decodable {
    let result: String   // passed | failed | not run
    let why: String
}

struct Rating: Decodable {
    let score: Int
    let reason: String?
    let toFive: [String]?
}

struct Answer: Decodable {
    let at: String
    let text: String
}

struct Card: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let idea: String
    let cwd: String
    /// The branch your folder is on now, which Keep merges into (cards waiting for review only).
    let folderBranch: String?
    let column: String
    let blueprint: String?
    let blueprintError: String?
    let createdAt: String
    let updatedAt: String
    let run: RunInfo?
    let outcome: String?
    let rating: Rating?
    let answers: [Answer]?
    let files: [String]
    let questionsText: String?
    let source: String?
    let why: String?
    let picture: PictureInfo?
    let pictureError: String?
    let drawingAt: String?
    let pictureStale: Bool?
    /** What its run may need beyond the box (ticked when approving), and what you allowed. */
    let permissionPlan: [PlannedPermission]?
    let permissions: [String]?
    /// Files that would clash with main if kept now; Chompyy brings the card up to date by itself.
    let clashFiles: [String]?
    let refresh: Refresh?
    /// You pressed Keep while it clashed: it keeps itself once it's up to date and its checks pass.
    let keepWhenRefreshed: Bool?

    static func == (a: Card, b: Card) -> Bool { a.id == b.id && a.updatedAt == b.updatedAt }
    func hash(into h: inout Hasher) { h.combine(id) }

    var hasQuestions: Bool { !(questionsText ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// Cards that need you: ran and not decided yet.
    var needsYou: Bool { column == "review" && outcome == nil }

    /// Finished, but its own checks didn't pass.
    /// What Chompyy measured after the run (passed / failed), or nil when it couldn't check.
    var measured: String? { run?.verified.flatMap { $0.result == "not run" ? nil : $0.result } }
    var checksNotPassed: Bool { run?.status == "ok" && (run?.checks.map { $0.result != "passed" } ?? false) }

    var clashes: Bool { !(clashFiles ?? []).isEmpty }
    var refreshing: Bool { refresh?.state == "running" }

    var projectName: String { (cwd as NSString).lastPathComponent }
}

struct Project: Decodable, Hashable {
    let path: String
    let name: String
    let lastUsed: String
}

enum Column: String, CaseIterable, Identifiable {
    case suggested, later, approved, running, review, done
    var id: String { rawValue }

    var title: String {
        switch self {
        case .suggested: "Suggested"
        case .later: "Later"
        case .approved: "Approved"
        case .running: "Running"
        case .review: "Review"
        case .done: "Done"
        }
    }

    var symbol: String {
        switch self {
        case .suggested: "lightbulb"
        case .later: "tray"
        case .approved: "checkmark.seal"
        case .running: "gearshape.2"
        case .review: "eyes"
        case .done: "star"
        }
    }

    var hint: String {
        switch self {
        case .suggested: "Ideas Chompyy prepared for you"
        case .later: "Parked ideas. Approve to run"
        case .approved: "Runs when you're away"
        case .running: "Working right now"
        case .review: "Waiting for you"
        case .done: "Kept, undone or rated"
        }
    }
}

/// One item on a card's permission plan (research/away-readiness.md, step 3).
struct PlannedPermission: Decodable, Identifiable, Hashable {
    let id: String
    let kind: String
    let value: String
    let why: String
    let source: String

    var label: String {
        kind == "network" ? "Let the shell reach \(value)" : "Let it run \(value.replacingOccurrences(of: " *", with: ""))"
    }
}

/// What Chompyy measured after the run (research/away-readiness.md, step 4).
struct Verified: Decodable {
    let result: String   // passed | failed | not run
    let why: String
    let command: String?
}

/// Mirrors `chompyy usage --json --app` (cli/src/usage.ts): every Claude Code request on this Mac, deduped and priced.
struct UsageData: Decodable {
    let generatedAt: String
    let days: [Day]
    let today: Tally
    let week: Week
    let unpriced: Int
    /// The chosen period (Today / 7D / 30D / Month), with kinds of work and pull requests.
    let period: String?
    let view: PeriodView?
    let compare: Compare?

    struct KindTotal: Decodable, Identifiable { let kind: String; let total: Tally; var id: String { kind } }
    struct PrCost: Decodable, Identifiable {
        let repo: String
        let number: Int
        let url: String
        let session: String
        let title: String?
        let at: String
        let total: Tally
        var id: String { "\(session)\(url)" }
    }
    struct PeriodView: Decodable {
        let from: String
        let days: [Day]
        let total: Tally
        let byWorkspace: [Project]
        let byModel: [Model]
        let conversations: [Conversation]
        let byKind: [KindTotal]
        let prs: [PrCost]
        var asWeek: Week { Week(days: days, total: total, byWorkspace: byWorkspace, byModel: byModel, conversations: conversations) }
    }
    struct Compare: Decodable {
        let yesterday: Tally
        let avg7: Tally
        let vsYesterdayPct: Int?
        let month: Month
        struct Month: Decodable {
            let toDate: Tally
            let lastMonthSameDays: Tally
            let vsLastMonthPct: Int?
            let projectedUsd: Double
            let plan: Plan?
        }
        struct Plan: Decodable { let label: String; let priceUsd: Double; let multiple: Double; let projectedMultiple: Double }
    }

    struct Tally: Decodable {
        let requests: Int
        let input: Double
        let output: Double
        let cacheRead: Double
        let cacheWrite: Double
        let tokens: Double
        let costUsd: Double
    }
    struct Day: Decodable, Identifiable {
        let day: String
        let total: Tally
        var id: String { day }
        var date: Date? { UsageData.dayFormat.date(from: day) }
    }
    struct Named: Decodable { let total: Tally }
    struct Project: Decodable, Identifiable {
        let workspace: String
        let total: Tally
        var id: String { workspace }
    }
    struct Model: Decodable, Identifiable {
        let model: String
        let total: Tally
        var id: String { model }
    }
    struct Conversation: Decodable, Identifiable {
        let session: String
        let title: String?
        let workspace: String
        let start: String
        let requests: Int
        let tokens: Double
        let costUsd: Double
        let away: Bool
        let `private`: Bool
        var id: String { session }
    }
    struct Week: Decodable {
        let days: [Day]
        let total: Tally
        let byWorkspace: [Project]
        let byModel: [Model]
        let conversations: [Conversation]
    }

    static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
}

enum UsageFormat {
    static func tokens(_ n: Double) -> String {
        if n >= 1e9 { return String(format: "%.1fB", n / 1e9) }
        if n >= 1e6 { return String(format: "%.1fM", n / 1e6) }
        if n >= 1e3 { return "\(Int((n / 1e3).rounded()))k" }
        return "\(Int(n))"
    }
    static func usd(_ n: Double) -> String { n >= 100 ? "$\(Int(n.rounded()))" : String(format: "$%.2f", n) }
}

/// Mirrors `chompyy trace <id> --json` (cli/src/trace.ts): one conversation, turn by turn.
struct Trace: Decodable {
    let session: String
    let title: String?
    let workspace: String
    let start: String
    let end: String
    let costUsd: Double
    let parts: Parts
    let tokens: Double
    let requests: Int
    let cacheHitPct: Int?
    let compactions: Int
    let turns: [Turn]
    let findings: [Finding]
    let promptsHidden: Bool

    struct Parts: Decodable { let input: Double; let output: Double; let cacheRead: Double; let cacheWrite: Double }
    struct Tool: Decodable { let name: String; let label: String; let resultTokens: Double; let isError: Bool }
    struct Request: Decodable { let at: String; let model: String; let costUsd: Double; let context: Double; let tools: [Tool]; let helper: Bool }
    struct Turn: Decodable, Identifiable {
        let i: Int
        let at: String
        let prompt: String?
        let promptKind: String
        let costUsd: Double
        let parts: Parts
        let tokens: Double
        let requests: [Request]
        let contextPeak: Double
        let durationMs: Double
        let compactedBefore: Bool
        var id: Int { i }
    }
    struct Finding: Decodable, Identifiable {
        let kind: String
        let turn: Int
        let tool: String?
        let label: String?
        let tokens: Double
        let laterRequests: Int
        let usd: Double
        var id: String { "\(kind)\(turn)\(label ?? "")\(tokens)" }
    }
}
