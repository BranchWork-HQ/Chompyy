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
    static func post(_ c: GoingCold) { post(id: "cold-\(c.id)", title: c.title, body: c.body) }

    static func post(id: String, title: String, body: String) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }
}

/// `chompyy nudge --json`: the measured trend in cold returns and what the nudges saved.
struct NudgeImpact: Decodable {
    let on: Bool
    let saved: Int
    let line: String
    /// Did the nudge work? (`chompyy worked`): cold returns a week since it was turned on.
    let verdict: Verdict?

    struct Verdict: Decodable {
        let verdict: String   // too-early | worked | short | no-change | worse | cant-tell
        let line: String
    }
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
            if let v = i.verdict {
                let look: (String, Color) = switch v.verdict {
                case "worked": ("checkmark.seal.fill", Brand.ok)
                case "short", "worse": ("exclamationmark.triangle", Brand.warn)
                case "too-early": ("hourglass", .secondary)
                default: ("questionmark.circle", .secondary)
                }
                Label("Did the nudge work? \(v.line)", systemImage: look.0)
                    .font(.caption).foregroundStyle(look.1).fixedSize(horizontal: false, vertical: true)
                    .help("Cold returns a week since you turned live suggestions on, against the week before. It worked if week two has a third fewer. Details: chompyy worked")
            }
        }
    }
}
