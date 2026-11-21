import SwiftUI

/// Every pop-up in the app: a panel over a dimmed backdrop. Click the dimmed area, press Esc, or use the
/// panel's own Done/Close button to close it. macOS sheets ignore clicks outside them, so the app uses this
/// instead of `.sheet`.
///
/// Inside the panel, `@Environment(\.closePopup)` closes it (use it instead of `\.dismiss`, which would close
/// the whole window here). Pop-ups can nest (the diff inside a card): Esc closes only the top one. While a
/// pop-up is open, the view under it (toolbar included, if it's attached there) is disabled.
extension View {
    func dismissOnOutsideClick<Panel: View>(isPresented: Binding<Bool>, width: CGFloat, height: CGFloat,
                                           @ViewBuilder content: @escaping () -> Panel) -> some View {
        modifier(OutsideClickPopup(isPresented: isPresented, width: width, height: height, panel: content))
    }

    /// Same, shown while `item` is non-nil; closing sets it back to nil.
    func dismissOnOutsideClick<Item, Panel: View>(item: Binding<Item?>, width: CGFloat, height: CGFloat,
                                                 @ViewBuilder content: @escaping (Item) -> Panel) -> some View {
        let shown = Binding(get: { item.wrappedValue != nil }, set: { if !$0 { item.wrappedValue = nil } })
        return dismissOnOutsideClick(isPresented: shown, width: width, height: height) {
            if let value = item.wrappedValue { content(value) }
        }
    }
}

/// Closes the pop-up the view is in. Call it like a function: `closePopup()`.
struct ClosePopupAction {
    var action: () -> Void = {}
    func callAsFunction() { action() }
}

private struct ClosePopupKey: EnvironmentKey {
    static let defaultValue = ClosePopupAction()
}

extension EnvironmentValues {
    var closePopup: ClosePopupAction {
        get { self[ClosePopupKey.self] }
        set { self[ClosePopupKey.self] = newValue }
    }
}

/// True when some pop-up further down the tree is open, so the outer one leaves Esc to it.
private struct PopupOpenKey: PreferenceKey {
    static let defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

private struct OutsideClickPopup<Panel: View>: ViewModifier {
    @Binding var isPresented: Bool
    let width: CGFloat
    let height: CGFloat
    let panel: () -> Panel
    @State private var innerOpen = false

    func body(content: Content) -> some View {
        content
            // What's under the backdrop can't be clicked anyway; disabling it also stops its keyboard
            // shortcuts (a Done button's Return) from firing while the pop-up is on top.
            .disabled(isPresented)
            .overlay {
                GeometryReader { geo in
                    if isPresented {
                        ZStack {
                            Color.black.opacity(0.35)
                                .contentShape(Rectangle())
                                .onTapGesture { close() }
                            panel()
                                .environment(\.closePopup, ClosePopupAction(action: close))
                                .frame(width: max(0, min(width, geo.size.width - 64)),
                                       height: max(0, min(height, geo.size.height - 48)))
                                .background(Color(nsColor: .windowBackgroundColor))
                                .clipShape(RoundedRectangle(cornerRadius: 14))
                                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.primary.opacity(0.1)))
                                .shadow(color: .black.opacity(0.35), radius: 24, y: 8)
                                .onPreferenceChange(PopupOpenKey.self) { innerOpen = $0 }
                            if !innerOpen {
                                // Esc. Hidden, and only on the top pop-up so one press closes one panel.
                                Button("Close", action: close)
                                    .keyboardShortcut(.cancelAction)
                                    .opacity(0)
                                    .frame(width: 0, height: 0)
                                    .accessibilityHidden(true)
                            }
                        }
                        .transition(.opacity)
                    }
                }
                .animation(.easeOut(duration: 0.15), value: isPresented)
            }
            .transformPreference(PopupOpenKey.self) { $0 = $0 || isPresented }
            .onChange(of: isPresented) { _, shown in if !shown { innerOpen = false } }
    }

    private func close() { isPresented = false }
}
