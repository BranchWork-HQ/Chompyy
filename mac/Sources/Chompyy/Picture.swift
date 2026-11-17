import SwiftUI
import WebKit

/// Mirrors PictureInfo in cli/src/picture.ts.
struct PictureInfo: Decodable, Hashable {
    let path: String
    let darkPath: String
    let at: String
    let blueprintHash: String
    let check: String?
    /// The visual type drawn and the drawing agent's reason; what the card's text suggested.
    let type: String?
    let why: String?
    let suggested: [TypeSuggestion]?

    /// "State machine · the card is about statuses" (and the suggestion, when the agent chose differently).
    var typeLine: String? {
        guard let type else { return nil }
        var line = type + (why.map { " · \($0)" } ?? "")
        if let top = suggested?.first, top.type.lowercased() != type.lowercased() { line += " (suggested: \(top.type))" }
        return line
    }
}

struct TypeSuggestion: Decodable, Hashable {
    let type: String
    let evidence: [String]
}

/// The card's picture: a diagram-design HTML file drawn for this card, shown light or dark to match the app.
struct PictureView: View {
    let picture: PictureInfo
    @Environment(\.colorScheme) private var scheme
    @State private var height: CGFloat = 360

    var body: some View {
        let file = scheme == .dark ? picture.darkPath : picture.path
        PictureWeb(file: URL(fileURLWithPath: file), height: $height)
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.08)))
            .id(file)
    }
}

/// A WKWebView sized to its content. The diagram scales to the card's width instead of scrolling.
struct PictureWeb: NSViewRepresentable {
    let file: URL
    @Binding var height: CGFloat

    // Fit the skill's page layout into a card: no full-window centering, the SVG scales down to fit.
    private static let fit = """
    body { min-height: 0 !important; padding: 20px 24px 16px !important; display: block !important; }
    .frame { max-width: none !important; }
    svg { min-width: 0 !important; height: auto; }
    .diagram-container { overflow: visible !important; }
    """

    // Trim the SVG canvas to what's drawn on it (plus a margin), ignoring full-canvas background rects.
    private static let crop = """
    (function(){var svg=document.querySelector('svg');if(!svg||!svg.viewBox||!svg.viewBox.baseVal)return;
    var vb=svg.viewBox.baseVal,x1=1e9,y1=1e9,x2=-1e9,y2=-1e9;
    Array.prototype.forEach.call(svg.children,function(el){var t=el.tagName.toLowerCase();
    if(t==='defs'||t==='title'||t==='desc'||t==='style')return;
    if(t==='rect'&&(el.getAttribute('width')==='100%'||+el.getAttribute('width')>=vb.width))return;
    try{var b=el.getBBox();if(!b.width&&!b.height)return;x1=Math.min(x1,b.x);y1=Math.min(y1,b.y);x2=Math.max(x2,b.x+b.width);y2=Math.max(y2,b.y+b.height);}catch(e){}});
    if(x2<=x1||y2<=y1)return;var m=24;x1=Math.max(vb.x,x1-m);y1=Math.max(vb.y,y1-m);x2=Math.min(vb.x+vb.width,x2+m);y2=Math.min(vb.y+vb.height,y2+m);
    svg.setAttribute('viewBox',[x1,y1,x2-x1,y2-y1].join(' '));})();
    """

    func makeCoordinator() -> Coordinator { Coordinator(height: $height) }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let css = Self.fit.replacingOccurrences(of: "\n", with: " ")
        let script = WKUserScript(
            source: "var s=document.createElement('style');s.textContent=`\(css)`;document.head.appendChild(s);" + Self.crop,
            injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        config.userContentController.addUserScript(script)
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.setValue(false, forKey: "drawsBackground")
        web.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
        context.coordinator.loaded = file
        return web
    }

    func updateNSView(_ web: WKWebView, context: Context) {
        if context.coordinator.loaded != file {
            context.coordinator.loaded = file
            web.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var height: Binding<CGFloat>
        var loaded: URL?
        init(height: Binding<CGFloat>) { self.height = height }

        func webView(_ web: WKWebView, didFinish navigation: WKNavigation!) {
            web.evaluateJavaScript("document.body.scrollHeight") { value, _ in
                if let h = value as? CGFloat, h > 40 { DispatchQueue.main.async { self.height.wrappedValue = min(h, 900) } }
            }
        }

        /// Links in a picture open in the browser, never inside the card.
        func webView(_ web: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if action.navigationType == .linkActivated, let url = action.request.url {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }
    }
}
