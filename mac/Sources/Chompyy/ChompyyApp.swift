import SwiftUI
import AppKit

@main
struct ChompyyApp: App {
    @StateObject private var store = Store()

    init() {
        if let path = ProcessInfo.processInfo.environment["CHOMPYY_RENDER_COOKIES"] {
            renderCookieSheet(to: path)
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
            MenuBarIcon(left: store.fiveHourLeft)
        }
        .menuBarExtraStyle(.window)

        Window("Chompyy", id: "board") {
            BoardView().environmentObject(store)
        }
        .defaultSize(width: 1280, height: 760)
    }
}

/// The cookie in the menu bar, with the 5-hour window's percent left beside it (like a battery).
/// With CHOMPYY_OPEN_BOARD=1 the board opens at launch (for testing).
struct MenuBarIcon: View {
    let left: Double?
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        HStack(spacing: 4) {
            Image(nsImage: cookieMenuImage(left: left))
            Text(menuBarTitle(left: left))
        }
        .task {
            if ProcessInfo.processInfo.environment["CHOMPYY_OPEN_BOARD"] == "1" {
                openWindow(id: "board")
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }
}

/// The popover from the menu bar: the cookie, what needs you, and two buttons.
struct MenuPanel: View {
    @EnvironmentObject var store: Store
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
                    Button("Refresh now") { Task { await store.refresh(forceQuota: true) } }
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

    private func openBoard() {
        openWindow(id: "board")
        NSApp.activate(ignoringOtherApps: true)
    }
}
