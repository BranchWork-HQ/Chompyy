import Foundation

/// Runs the `chompyy` CLI. The CLI writes ~/.chompyy/cli.json (node + script paths) each time it runs,
/// so the app works even though apps don't get your shell's PATH (nvm etc.).
enum CLI {
    struct Result {
        let status: Int32
        let out: String
        let err: String
        var ok: Bool { status == 0 }
        /// The most useful line to show a person.
        var message: String {
            let text = ok ? out : (err.isEmpty ? out : err)
            return text.replacingOccurrences(of: "chompyy: ", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    enum Failure: LocalizedError {
        case notFound
        var errorDescription: String? {
            "Couldn't find the chompyy CLI. Run any `chompyy` command in Terminal once (for example `chompyy status`), then reopen the app."
        }
    }

    static var home: URL {
        if let custom = ProcessInfo.processInfo.environment["CHOMPYY_HOME"] { return URL(fileURLWithPath: custom) }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".chompyy")
    }

    private struct Location: Decodable { let node: String; let script: String }

    /// Where the CLI is: the one you installed (it records itself in ~/.chompyy/cli.json each time it runs), else
    /// the copy bundled inside the app (Contents/Resources/node + cli/), so a downloaded app works on its own.
    private static func location() throws -> Location {
        let fm = FileManager.default
        let url = home.appendingPathComponent("cli.json")
        if let data = try? Data(contentsOf: url),
           let loc = try? JSONDecoder().decode(Location.self, from: data),
           fm.fileExists(atPath: loc.node), fm.fileExists(atPath: loc.script) {
            return loc
        }
        if let res = Bundle.main.resourceURL {
            let node = res.appendingPathComponent("node").path
            let script = res.appendingPathComponent("cli/dist/cli.js").path
            if fm.isExecutableFile(atPath: node), fm.fileExists(atPath: script) { return Location(node: node, script: script) }
        }
        throw Failure.notFound
    }

    /// Run a command and wait for it. Call off the main thread.
    static func run(_ args: [String], stdin: String? = nil, cwd: String? = nil) throws -> Result {
        let loc = try location()
        let p = Process()
        p.executableURL = URL(fileURLWithPath: loc.node)
        p.arguments = [loc.script] + args
        var env = ProcessInfo.processInfo.environment
        // The CLI calls `claude` and `git`; give it a PATH that finds them.
        let nodeDir = (loc.node as NSString).deletingLastPathComponent
        let extra = [nodeDir, "/opt/homebrew/bin", "/usr/local/bin", "\(NSHomeDirectory())/.local/bin", "\(NSHomeDirectory())/.claude/local"]
        env["PATH"] = (extra + [env["PATH"] ?? "/usr/bin:/bin"]).joined(separator: ":")
        p.environment = env
        if let cwd { p.currentDirectoryURL = URL(fileURLWithPath: cwd) }
        let outPipe = Pipe(), errPipe = Pipe(), inPipe = Pipe()
        p.standardOutput = outPipe
        p.standardError = errPipe
        p.standardInput = inPipe
        try p.run()
        if let stdin { inPipe.fileHandleForWriting.write(Data(stdin.utf8)) }
        try? inPipe.fileHandleForWriting.close()
        // Read before waiting so a large output can't fill the pipe and block.
        let out = outPipe.fileHandleForReading.readDataToEndOfFile()
        let err = errPipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return Result(status: p.terminationStatus,
                      out: String(decoding: out, as: UTF8.self),
                      err: String(decoding: err, as: UTF8.self))
    }

    /// Start a long command (an away run) without waiting. Output goes to ~/.chompyy/app-away.log.
    static func launch(_ args: [String]) throws -> Process {
        let loc = try location()
        let p = Process()
        p.executableURL = URL(fileURLWithPath: loc.node)
        p.arguments = [loc.script] + args
        var env = ProcessInfo.processInfo.environment
        let nodeDir = (loc.node as NSString).deletingLastPathComponent
        env["PATH"] = ([nodeDir, "/opt/homebrew/bin", "/usr/local/bin", "\(NSHomeDirectory())/.local/bin"] + [env["PATH"] ?? "/usr/bin:/bin"]).joined(separator: ":")
        p.environment = env
        let log = home.appendingPathComponent("app-away.log")
        FileManager.default.createFile(atPath: log.path, contents: nil)
        let handle = try FileHandle(forWritingTo: log)
        p.standardOutput = handle
        p.standardError = handle
        try p.run()
        // Keep the Mac awake (not the screen) for as long as the away run lives, so it isn't paused by sleep.
        let awake = Process()
        awake.executableURL = URL(fileURLWithPath: "/usr/bin/caffeinate")
        awake.arguments = ["-i", "-w", String(p.processIdentifier)]
        try? awake.run()
        return p
    }
}
