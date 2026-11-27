import Foundation
import SwiftUI
import UserNotifications

/// A conversation about to go cold (`chompyy nudge due --json`): 45-60 minutes into a pause, so /compact is still
/// cheap. The CLI reports each break once; the app notifies and shows it in the menu panel until it goes cold.
struct GoingCold: Decodable, Identifiable {
    let session: String
    let project: String
    let context: Int
    let coldAt: String
    let title: String
    let body: String
    var id: String { session + coldAt }
    var coldDate: Date? { ISO8601DateFormatter.withFractions.date(from: coldAt) ?? ISO8601DateFormatter().date(from: coldAt) }
}

extension ISO8601DateFormatter {
    static let withFractions: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

/// macOS notifications for live suggestions. Asks once; if you say no, the menu panel still shows them.
enum Notifier {
    static func post(_ c: GoingCold) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = c.title
            content.body = c.body
            content.sound = .default
            center.add(UNNotificationRequest(identifier: "cold-\(c.id)", content: content, trigger: nil))
        }
    }
}

/// `chompyy nudge --json`: the measured trend in cold returns and what the nudges saved.
struct NudgeImpact: Decodable {
    let on: Bool
    let saved: Int
    let line: String
}

/// The menu panel's line for each conversation going cold, until it does.
struct GoingColdRows: View {
    @EnvironmentObject var store: Store

    var body: some View {
        let live = store.goingCold.filter { ($0.coldDate ?? .distantPast) > Date() }
        if !live.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(live) { c in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "snowflake").foregroundStyle(.blue)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.title).font(.callout.weight(.semibold)).lineLimit(2)
                            Text(c.body).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            Divider()
        }
        if let i = store.nudgeImpact, i.on {
            Label(i.line, systemImage: i.saved > 0 ? "leaf.fill" : "snowflake")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                .help("Live suggestions (chompyy nudge). Cold return: coming back to a conversation after its cache expired, so all of it was written again.")
        }
    }
}
