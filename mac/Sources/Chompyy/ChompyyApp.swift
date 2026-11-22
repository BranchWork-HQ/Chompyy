import SwiftUI
import AppKit
import ServiceManagement

/// Opening Chompyy like any Mac app (Launchpad, Spotlight, the Dock, Finder) shows the board. It's a menu bar
/// app with no Dock icon, so otherwise opening it looks like nothing happened. Starting at login or restarting
/// after an update (`--updated`) stays quietly in the menu bar.
final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Set by the menu bar icon, which can open windows.
    static var openBoard: (() -> Void)?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let event = NSAppleEventManager.shared().currentAppleEvent
        let atLogin = event?.paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue == keyAELaunchedAsLogInItem
        let updated = CommandLine.arguments.contains("--updated")
        if !atLogin && !updated {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { AppDelegate.openBoard?() }
        }
    }

    /// Opened again while already running (clicked in Launchpad or Spotlight): show the board.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        AppDelegate.openBoard?()
        return true
    }
}

/// "Open Chompyy at login", through macOS's own login items (System Settings › General › Login Items).
enum LoginItem {
    static var isOn: Bool { SMAppService.mainApp.status == .enabled }

    /// Turn it on or off; returns what to tell you when macOS wants your approval or says no.
    static func set(_ on: Bool) -> String? {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            return "Couldn't change it: \(error.localizedDescription)"
        }
        if on && SMAppService.mainApp.status == .requiresApproval {
            return "macOS needs your OK: System Settings › General › Login Items, then allow Chompyy."
        }
        return on ? "Chompyy will open when you log in." : "Chompyy won't open at login."
    }
}

@main
struct ChompyyApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var store = Store()

    init() {
        if let path = ProcessInfo.processInfo.environment["CHOMPYY_RENDER_COOKIES"] {
            renderCookieSheet(to: path)
            exit(0)
        }
        if let path = ProcessInfo.processInfo.environment["CHOMPYY_RENDER_TRACE"], let id = ProcessInfo.processInfo.environment["CHOMPYY_TRACE_SESSION"] {
            renderTraceSheet(to: path, session: id)
            exit(0)
        }
        if let path = ProcessInfo.processInfo.environment["CHOMPYY_RENDER_USAGE"] {
            renderUsageSheet(to: path)
            exit(0)
        }
        if let dir = ProcessInfo.processInfo.environment["CHOMPYY_RENDER_FRAMES"] {
            renderCookieFrames(to: dir)
            exit(0)
        }
    }

    var body: some Scene {
        MenuBarExtra {
            MenuPanel().environmentObject(store)
        } label: {
            MenuBarIcon(left: store.fiveHourLeft, today: store.usage?.today)
        }
        .menuBarExtraStyle(.window)

        Window("Chompyy", id: "board") {
            BoardView().environmentObject(store)
        }
        .defaultSize(width: 1280, height: 760)

        Window("Usage", id: "usage") {
            UsageWindow().environmentObject(store)
        }
        .defaultSize(width: 1100, height: 760)
    }
}

/// The cookie in the menu bar, with the 5-hour window's percent left beside it (like a battery).
/// With CHOMPYY_OPEN_BOARD=1 the board opens at launch (for testing).
struct MenuBarIcon: View {
    let left: Double?
    let today: UsageData.Tally?
    /// What sits beside the cookie: the window's % left (default), today's tokens, or today's API value.
    @AppStorage("menuBarShows") private var shows = "left"
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        HStack(spacing: 4) {
            Image(nsImage: cookieMenuImage(left: left))
            Text(title)
        }
        .task {
            AppDelegate.openBoard = {
                openWindow(id: "board")
                NSApp.activate(ignoringOtherApps: true)
            }
            if ProcessInfo.processInfo.environment["CHOMPYY_OPEN_BOARD"] == "1" {
                openWindow(id: "board")
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }
}

extension MenuBarIcon {
    var title: String {
        switch shows {
        case "tokens": today.map { UsageFormat.tokens($0.tokens) } ?? menuBarTitle(left: left)
        case "value": today.map { UsageFormat.usd($0.costUsd) } ?? menuBarTitle(left: left)
        default: menuBarTitle(left: left)
        }
    }
}

/// The popover from the menu bar: the cookie, what needs you, and two buttons.
struct MenuPanel: View {
    @EnvironmentObject var store: Store
    @AppStorage("menuBarShows") private var menuBarShows = "left"
    @State private var loginItem = LoginItem.isOn
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                CookieView(left: store.fiveHourLeft, size: 64, mood: store.cookieMood)
                VStack(alignment: .leading, spacing: 3) {
                    if let five = store.state?.quota.fiveHour, five.known, let left = five.leftPct {
                        Text("\(Int(left.rounded()))% left").font(.title2.weight(.semibold))
                        if let reset = five.resetDate {
                            Text("Resets at \(reset.formatted(date: .omitted, time: .shortened))").foregroundStyle(.secondary)
                        }
                    } else if let five = store.state?.quota.fiveHour, five.isFresh {
                        Text("100% left").font(.title2.weight(.semibold))
                        Text(five.freshHint).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                    } else {
                        Text("Window unknown").font(.title3.weight(.semibold))
                        Text(store.state?.quota.note ?? store.error ?? "Reading quota…")
                            .font(.caption).foregroundStyle(.secondary).lineLimit(3)
                    }
                    if let plan = store.state?.quota.plan { Text(plan).font(.caption).foregroundStyle(.tertiary) }
                }
            }
            if let week = store.state?.quota.sevenDay, week.known, let used = week.usedPct, let ms = week.msLeft {
                WeekPace(usedPct: used, elapsedPct: max(0, min(100, (1 - ms / (7 * 24 * 3600 * 1000)) * 100)))
            }
            Divider()
            if let t = store.usage?.today { UsageToday(today: t) }
            UsageInsights(compact: true)
            HStack(spacing: 14) {
                Button { openUsage(.conversations) } label: { Label("Conversations", systemImage: "list.bullet.rectangle") }
                Button { openUsage(.overview) } label: { Label("All usage", systemImage: "chart.bar.xaxis") }
            }
            .buttonStyle(.link).font(.caption)
            .help("Open the Usage window: click a conversation to see it turn by turn")
            Divider()
            let needs = store.needsYou
            if needs.isEmpty {
                let approved = store.cards(in: .approved).count
                Label(approved > 0 ? "\(approved) card\(approved == 1 ? "" : "s") ready for your next away run" : "Nothing waiting for you",
                      systemImage: approved > 0 ? "checkmark.seal" : "cup.and.saucer")
                    .foregroundStyle(.secondary)
            } else {
                Text("\(needs.count) card\(needs.count == 1 ? "" : "s") waiting for you").font(.headline)
                ForEach(needs.prefix(3)) { card in
                    Button {
                        store.selectedCardID = card.id
                        openBoard()
                    } label: {
                        HStack {
                            Image(systemName: card.hasQuestions ? "questionmark.bubble.fill" : "eyes")
                                .foregroundStyle(card.hasQuestions ? Brand.warn : Brand.doughEdge)
                            Text(card.title).lineLimit(1)
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            Divider()
            HStack {
                Button { openBoard() } label: { Label("Open board", systemImage: "rectangle.split.3x1") }
                    .buttonStyle(.borderedProminent).tint(Brand.chocolate)
                Spacer()
                AwayMenu()
                Menu {
                    Button("Refresh now") { Task { await store.refresh(forceQuota: true); await store.loadUsage(force: true) } }
                    Toggle("Open Chompyy at login", isOn: Binding(get: { loginItem }, set: { on in
                        if let message = LoginItem.set(on) { store.show(message) }
                        loginItem = LoginItem.isOn
                    }))
                    Picker("Menu bar shows", selection: $menuBarShows) {
                        Text("% of the window left").tag("left")
                        Text("Today's tokens").tag("tokens")
                        Text("Today's API value").tag("value")
                    }
                    Divider()
                    Button("Quit Chompyy") { NSApp.terminate(nil) }
                } label: { Image(systemName: "ellipsis.circle") }
                .menuStyle(.borderlessButton)
                .fixedSize()
            }
        }
        .padding(16)
        .frame(width: 340)
        .overlay(alignment: .bottom) { Toast() }
    }

    private func openUsage(_ section: UsageSection) {
        UserDefaults.standard.set(section.rawValue, forKey: "usageSection")
        openWindow(id: "usage")
        NSApp.activate(ignoringOtherApps: true)
    }

    private func openBoard() {
        openWindow(id: "board")
        NSApp.activate(ignoringOtherApps: true)
    }
}
