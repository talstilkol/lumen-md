// LAN discovery on iOS (plan W2.19 step 1, W10.E45): the native half of
// src/sync/e2ee/lan/nativeDiscovery.ts, as the Capacitor plugin `LumenLan`.
// Network.framework announces and finds `_lumen-lan._tcp` over Bonjour
// (multicast DNS / DNS-SD, which the desktop's src-tauri/lan-mdns also speaks)
// and serves the LUMEN-LAN/1 rendezvous on the advertised port:
//
//   → LUMEN-LAN/1 OFFER                   ← OK <token> <offer code>     | ERR used
//   → LUMEN-LAN/1 ANSWER <token> <code>   ← OK                          | ERR token | ERR used | ERR bad
//
// Only the pairing code and its token pass here; the link itself is WebRTC,
// made in the WebView (lan/link.ts). Info.plist declares the service
// (NSBonjourServices) and says why the app looks at the local network
// (NSLocalNetworkUsageDescription), which iOS asks the user about once.

import Capacitor
import Foundation
import Network
import Security

enum LanProtocol {
    static let name = "LUMEN-LAN/1"
    static let service = "_lumen-lan._tcp"
    static let codePrefix = "lumen-lan:1:"
    static let maxLine = 64 * 1024
    static let offerTTL: TimeInterval = 5 * 60
    static let maxConnections = 8
    private static let alphabet = Array("ABCDEFGHJKMNPQRSTVWXYZ23456789")

    static func isCode(_ s: String?) -> Bool {
        guard let s, s.hasPrefix(codePrefix), s.count < 60_000 else { return false }
        let rest = s.dropFirst(codePrefix.count)
        return !rest.isEmpty && rest.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }

    static func label() -> String {
        "Lumen-" + String((0..<4).map { _ in alphabet[Int.random(in: 0..<alphabet.count)] })
    }

    static func token() -> String {
        var b = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, b.count, &b)
        return b.map { String(format: "%02x", $0) }.joined()
    }

    /// Private, link-local or loopback: the only peers spoken to. The same rule as
    /// src/sync/e2ee/lan/address.ts and src-tauri/lan-mdns (net::is_lan_ip): IPv4 10/8,
    /// 172.16/12, 192.168/16, 169.254/16, 127/8; IPv6 ::1, fe80::/10, fc00::/7, and an
    /// IPv4-mapped address by its IPv4 rule. Carrier-grade NAT (100.64/10) is refused,
    /// as on the desktop: it is a carrier's network, not the user's.
    static func isLan(_ host: NWEndpoint.Host) -> Bool {
        switch host {
        case .ipv4(let a):
            return isLanV4([UInt8](a.rawValue))
        case .ipv6(let a):
            let b = [UInt8](a.rawValue)
            if b.count == 16 && b[0..<10].allSatisfy({ $0 == 0 }) && b[10] == 0xff && b[11] == 0xff {
                return isLanV4(Array(b[12..<16])) // ::ffff:a.b.c.d
            }
            return a.isLoopback || (b[0] == 0xfe && (b[1] & 0xc0) == 0x80) || (b[0] & 0xfe) == 0xfc
        default:
            return false
        }
    }

    /// The IPv4 half of the rule, on the four bytes of the address.
    static func isLanV4(_ b: [UInt8]) -> Bool {
        guard b.count == 4 else { return false }
        return b[0] == 10 || b[0] == 127 || (b[0] == 172 && (b[1] & 0xf0) == 16) || (b[0] == 192 && b[1] == 168) || (b[0] == 169 && b[1] == 254)
    }
}

/// One pairing at a time: the first good answer uses the offer up; it lapses after five minutes.
final class LanRendezvous {
    let token = LanProtocol.token()
    private let offer: String
    private let started = Date()
    private var answer: String?
    private var used = false
    private let lock = NSLock()

    init(offer: String) { self.offer = offer }

    var expired: Bool { Date().timeIntervalSince(started) > LanProtocol.offerTTL }

    func takeAnswer() -> String? {
        lock.lock(); defer { lock.unlock() }
        let a = answer
        answer = nil
        return a
    }

    func handle(_ raw: String) -> String {
        lock.lock(); defer { lock.unlock() }
        let p = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\r\n")).components(separatedBy: " ")
        guard p.first == LanProtocol.name else { return "ERR bad" }
        if p.count == 2 && p[1] == "OFFER" { return used || expired ? "ERR used" : "OK \(token) \(offer)" }
        if p.count == 4 && p[1] == "ANSWER" {
            if used || expired { return "ERR used" }
            guard constantTimeEqual(p[2], token) else { return "ERR token" }
            guard LanProtocol.isCode(p[3]) else { return "ERR bad" }
            answer = p[3]
            used = true
            return "OK"
        }
        return "ERR bad"
    }

    private func constantTimeEqual(_ a: String, _ b: String) -> Bool {
        let x = Array(a.utf8), y = Array(b.utf8)
        guard x.count == y.count else { return false }
        return zip(x, y).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
    }
}

/// One line out, one line back, over TCP, within `timeout`.
private func exchange(_ conn: NWConnection, _ line: String, timeout: TimeInterval, queue: DispatchQueue, done: @escaping (Result<String, Error>) -> Void) {
    var finished = false
    let finish: (Result<String, Error>) -> Void = { r in
        guard !finished else { return }
        finished = true
        conn.cancel()
        done(r)
    }
    queue.asyncAfter(deadline: .now() + timeout) { finish(.failure(NSError(domain: "LumenLan", code: 1, userInfo: [NSLocalizedDescriptionKey: "failed"]))) }
    conn.stateUpdateHandler = { state in
        switch state {
        case .ready:
            conn.send(content: (line + "\n").data(using: .utf8), completion: .contentProcessed { _ in })
            readLine(conn) { finish($0) }
        case .failed(let e), .waiting(let e):
            finish(.failure(e))
        default:
            break
        }
    }
    conn.start(queue: queue)
}

private func readLine(_ conn: NWConnection, buffer: Data = Data(), done: @escaping (Result<String, Error>) -> Void) {
    conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, isComplete, error in
        var buf = buffer
        if let data { buf.append(data) }
        if let nl = buf.firstIndex(of: 0x0a) {
            return done(.success(String(decoding: buf[buf.startIndex..<nl], as: UTF8.self)))
        }
        if buf.count > LanProtocol.maxLine || isComplete || error != nil {
            return done(error.map { .failure($0) } ?? .success(String(decoding: buf, as: UTF8.self)))
        }
        readLine(conn, buffer: buf, done: done)
    }
}

public class LumenLanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LumenLanPlugin"
    public let jsName = "LumenLan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "host", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "answer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "browse", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchOffer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendAnswer", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "lumen.lan")
    private var listener: NWListener?
    private var rendezvous: LanRendezvous?
    private var open = 0

    @objc func host(_ call: CAPPluginCall) {
        guard let offer = call.getString("offer"), LanProtocol.isCode(offer) else { return call.reject("bad") }
        stopHosting()
        let label = LanProtocol.label()
        let r = LanRendezvous(offer: offer)
        do {
            let l = try NWListener(using: .tcp)
            l.service = NWListener.Service(name: label, type: LanProtocol.service)
            l.newConnectionHandler = { [weak self] conn in self?.serve(conn, r) }
            var answered = false
            l.stateUpdateHandler = { state in
                guard !answered else { return }
                switch state {
                case .ready:
                    answered = true
                    call.resolve(["name": label])
                case .failed(let e):
                    answered = true
                    call.reject("failed: \(e)")
                default:
                    break
                }
            }
            listener = l
            rendezvous = r
            l.start(queue: queue)
        } catch {
            call.reject("failed: \(error)")
        }
    }

    private func serve(_ conn: NWConnection, _ r: LanRendezvous) {
        if case .hostPort(let host, _) = conn.endpoint, !LanProtocol.isLan(host) { return conn.cancel() }
        guard open < LanProtocol.maxConnections else { return conn.cancel() }
        open += 1
        conn.start(queue: queue)
        readLine(conn) { [weak self] result in
            let reply = (try? result.get()).map { r.handle($0) } ?? "ERR bad"
            conn.send(content: (reply + "\n").data(using: .utf8), completion: .contentProcessed { _ in
                conn.cancel()
                self?.queue.async { self?.open -= 1 }
            })
        }
    }

    @objc func answer(_ call: CAPPluginCall) {
        queue.async {
            guard let r = self.rendezvous else { return call.resolve(["answer": NSNull()]) }
            if r.expired {
                self.stopHosting()
                return call.resolve(["answer": NSNull(), "expired": true])
            }
            let a = r.takeAnswer()
            if a != nil { self.stopHosting() }
            call.resolve(["answer": a ?? NSNull()])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        queue.async {
            self.stopHosting()
            call.resolve()
        }
    }

    private func stopHosting() {
        listener?.cancel()
        listener = nil
        rendezvous = nil
    }

    @objc func browse(_ call: CAPPluginCall) {
        let ms = max(500, min(10_000, call.getInt("ms") ?? 2500))
        let browser = NWBrowser(for: .bonjour(type: LanProtocol.service, domain: nil), using: .tcp)
        var found: [[String: Any]] = []
        var done = false
        let finish = {
            guard !done else { return }
            done = true
            browser.cancel()
            call.resolve(["devices": found])
        }
        browser.browseResultsChangedHandler = { results, _ in
            for res in results {
                guard case .service(let name, _, _, _) = res.endpoint, name.range(of: "^Lumen-[A-Z0-9]{4}$", options: .regularExpression) != nil else { continue }
                // Resolve the service to an address: connect, read where the path goes, close.
                let conn = NWConnection(to: res.endpoint, using: .tcp)
                conn.stateUpdateHandler = { state in
                    switch state {
                    case .ready:
                        if case .hostPort(let host, let port) = conn.currentPath?.remoteEndpoint, LanProtocol.isLan(host) {
                            var h = "\(host)"
                            if let i = h.firstIndex(of: "%") { h = String(h[..<i]) }
                            if !found.contains(where: { ($0["name"] as? String) == name && ($0["host"] as? String) == h }) {
                                found.append(["name": name, "host": h, "port": Int(port.rawValue)])
                            }
                        }
                        conn.cancel()
                    default:
                        break
                    }
                }
                conn.start(queue: self.queue)
            }
        }
        browser.start(queue: queue)
        queue.asyncAfter(deadline: .now() + .milliseconds(ms)) { finish() }
    }

    private func connection(_ call: CAPPluginCall) -> NWConnection? {
        guard let host = call.getString("host"), let p = call.getInt("port"), let port = NWEndpoint.Port(rawValue: UInt16(clamping: p)) else {
            call.reject("bad")
            return nil
        }
        let h = NWEndpoint.Host(host)
        guard LanProtocol.isLan(h) else {
            call.reject("not-lan")
            return nil
        }
        return NWConnection(host: h, port: port, using: .tcp)
    }

    private static func refused(_ reply: String) -> String { reply.hasPrefix("ERR ") ? String(reply.dropFirst(4)) : "failed" }

    @objc func fetchOffer(_ call: CAPPluginCall) {
        guard let conn = connection(call) else { return }
        exchange(conn, "\(LanProtocol.name) OFFER", timeout: 3, queue: queue) { result in
            switch result {
            case .success(let reply):
                let p = reply.split(separator: " ", maxSplits: 2).map(String.init)
                if p.count == 3, p[0] == "OK", LanProtocol.isCode(p[2]) { call.resolve(["token": p[1], "offer": p[2]]) } else { call.reject(Self.refused(reply)) }
            case .failure:
                call.reject("failed")
            }
        }
    }

    @objc func sendAnswer(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.contains(" "), let answer = call.getString("answer"), LanProtocol.isCode(answer) else { return call.reject("bad") }
        guard let conn = connection(call) else { return }
        exchange(conn, "\(LanProtocol.name) ANSWER \(token) \(answer)", timeout: 3, queue: queue) { result in
            switch result {
            case .success(let reply):
                if reply == "OK" { call.resolve() } else { call.reject(Self.refused(reply)) }
            case .failure:
                call.reject("failed")
            }
        }
    }
}
