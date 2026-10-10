import Foundation
import Network
import Darwin

private struct HelperRequest: Decodable, Sendable {
    let id: String
    let method: String
}

private struct HelperSnapshot: Codable, Sendable {
    var status = "disconnected"
    var pacURL = "http://127.0.0.1:8869/github.pac"
    var socksPort = 8868
    var lastProbe: String?
    var error: String?
    var domains: Int?
}

private struct HelperMessage: Encodable {
    var id: String?
    var event: String?
    var ok: Bool?
    var result: HelperSnapshot?
    var error: String?
}

private enum HelperError: LocalizedError {
    case invalidRequest, inactive, probeHTTP(Int)
    var errorDescription: String? {
        switch self {
        case .invalidRequest: "无效的代理控制请求。"
        case .inactive: "请先开启 GitHub 代理再测试连接。"
        case .probeHTTP(let status): "GitHub 连接测试返回 HTTP \(status)。"
        }
    }
}

@MainActor private final class ProxyHelperHost {
    private let controller = MacSteamToolsProxyController()
    private var snapshot = HelperSnapshot()
    private var revision = UUID()
    private var startup: Task<GitHubProxySystemState, any Error>?
    private var probeTask: Task<String, any Error>?
    private var shuttingDown = false
    private let fixtureMode: Bool

    init(fixtureMode: Bool) {
        self.fixtureMode = fixtureMode
        controller.onChange = { [weak self] state in
            guard let self, !self.shuttingDown else { return }
            if self.snapshot.status == "disconnecting", state.status == .disconnected { return }
            self.apply(state)
            self.emit(.init(event: "status", result: self.snapshot))
        }
        emit(.init(event: "ready", result: snapshot))
    }

    func handle(_ data: Data) async {
        guard !shuttingDown else { return }
        guard let request = try? JSONDecoder().decode(HelperRequest.self, from: data),
              !request.id.isEmpty, request.id.utf8.count <= 128 else {
            emit(.init(event: "protocol-error", error: HelperError.invalidRequest.localizedDescription))
            return
        }
        do {
            switch request.method {
            case "status": break
            case "start": try await start()
            case "stop": await stop()
            case "probe": try await probe()
            case "shutdown":
                await stop()
                emit(.init(id: request.id, ok: true, result: snapshot))
                await shutdown()
                return
            default: throw HelperError.invalidRequest
            }
            emit(.init(id: request.id, ok: true, result: snapshot))
        } catch {
            if !(error is CancellationError) { snapshot.error = error.localizedDescription }
            emit(.init(id: request.id, ok: false, result: snapshot, error: error.localizedDescription))
        }
    }

    func shutdown() async {
        guard !shuttingDown else { return }
        shuttingDown = true
        await stop()
        exit(0)
    }

    private func start() async throws {
        if snapshot.status == "connected" { return }
        guard startup == nil, snapshot.status != "disconnecting" else { throw GitHubProxyError.activeConfiguration }
        revision = UUID()
        let key = revision
        snapshot.status = "connecting"; snapshot.error = nil; snapshot.lastProbe = nil
        emit(.init(event: "status", result: snapshot))
        let fixture = fixtureMode
        let task = Task { [controller] in
            let resolved: SteamToolsSnapshot
            #if DEBUG
            if fixture { resolved = try Self.fixtureSnapshot() }
            else { resolved = try await SteamToolsResolver().resolve(snapshot: SteamToolsRulesClient().fetch()) }
            #else
            _ = fixture
            resolved = try await SteamToolsResolver().resolve(snapshot: SteamToolsRulesClient().fetch())
            #endif
            try Task.checkCancellation()
            return try await controller.start(snapshot: resolved)
        }
        startup = task
        do {
            let state = try await task.value
            try Task.checkCancellation()
            guard revision == key else { throw CancellationError() }
            startup = nil
            apply(state)
        } catch {
            if revision == key {
                startup = nil
                controller.stop()
                snapshot.status = "disconnected"
            }
            throw error
        }
    }

    private func stop() async {
        revision = UUID()
        let key = revision
        let pending = startup
        snapshot.status = "disconnecting"
        emit(.init(event: "status", result: snapshot))
        pending?.cancel(); probeTask?.cancel()
        controller.stop()
        _ = await pending?.result
        _ = await probeTask?.result
        guard revision == key else { return }
        startup = nil; probeTask = nil
        snapshot.status = "disconnected"; snapshot.error = nil; snapshot.lastProbe = nil; snapshot.domains = nil
        emit(.init(event: "status", result: snapshot))
    }

    private func probe() async throws {
        guard snapshot.status == "connected", let port = (try await controller.load()).localSOCKSPort else { throw HelperError.inactive }
        guard probeTask == nil else { throw GitHubProxyError.activeConfiguration }
        let key = revision
        let fixture = fixtureMode
        let task = Task { try await Self.probeConnection(port: port, fixtureMode: fixture) }
        probeTask = task
        defer { if revision == key { probeTask = nil } }
        let result = try await task.value
        guard revision == key, snapshot.status == "connected" else { throw CancellationError() }
        snapshot.lastProbe = result; snapshot.error = nil
    }

    private func apply(_ state: GitHubProxySystemState) {
        switch state.status {
        case .connected: snapshot.status = "connected"
        case .connecting, .reasserting: snapshot.status = "connecting"
        case .disconnecting: snapshot.status = "disconnecting"
        case .unavailable: snapshot.status = "unavailable"
        case .unconfigured, .disconnected: snapshot.status = "disconnected"
        }
        if let url = state.pacURL { snapshot.pacURL = url.absoluteString }
        if let port = state.localSOCKSPort { snapshot.socksPort = Int(port) }
        snapshot.domains = state.activeSnapshot?.routes.count
        snapshot.error = state.disconnectError
    }

    private func emit(_ message: HelperMessage) {
        guard let data = try? JSONEncoder().encode(message) else { return }
        var line = data; line.append(10)
        do { try FileHandle.standardOutput.write(contentsOf: line) }
        catch { controller.stop(); exit(0) }
    }

    private static func probeConnection(port: UInt16, fixtureMode: Bool) async throws -> String {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 15; configuration.timeoutIntervalForResource = 20
        var proxy = ProxyConfiguration(socksv5Proxy: .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!))
        proxy.allowFailover = false
        configuration.proxyConfigurations = [proxy]
        #if DEBUG
        if fixtureMode { configuration.protocolClasses = [HelperProbeFixture.self] }
        #else
        _ = fixtureMode
        #endif
        let session = URLSession(configuration: configuration, delegate: SteamToolsNoRedirectDelegate(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: URL(string: "https://api.github.com/rate_limit")!)
        request.setValue("EasyHub-Mac-Proxy-Check", forHTTPHeaderField: "User-Agent")
        let started = ContinuousClock.now
        let (_, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let response = response as? HTTPURLResponse, response.url == request.url, response.statusCode == 200 else {
            throw HelperError.probeHTTP((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        let duration = started.duration(to: .now).components
        let milliseconds = duration.seconds * 1_000 + duration.attoseconds / 1_000_000_000_000_000
        return "GitHub HTTP 200 · \(milliseconds) ms"
    }

    #if DEBUG
    private static func fixtureSnapshot() throws -> SteamToolsSnapshot {
        let data = Data("{\"MatchDomainNames\":\"api.github.com\",\"ForwardDomainNames\":\"8.8.8.8\",\"Port\":443,\"ProxyType\":0}".utf8)
        var snapshot = try SteamToolsRuleParser.parse(data)
        snapshot.rules = snapshot.rules.filter { $0.patterns.allSatisfy { $0.host == "api.github.com" } }
        for index in snapshot.rules.indices { snapshot.rules[index].destinationIPv4 = ["8.8.8.8"] }
        snapshot.resolvedAt = Date()
        try snapshot.validate()
        return snapshot
    }
    #endif
}

#if DEBUG
private final class HelperProbeFixture: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard request.url?.absoluteString == "https://api.github.com/rate_limit",
              let url = request.url, let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{\"rate\":{\"remaining\":60}}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
#endif

@main struct EasyHubProxyHelper {
    @MainActor static func main() async {
        signal(SIGPIPE, SIG_IGN)
        signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN)
        #if DEBUG
        let fixture = CommandLine.arguments.contains("--test-fixture")
        #else
        let fixture = false
        #endif
        let host = ProxyHelperHost(fixtureMode: fixture)
        let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
        let interruption = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
        termination.setEventHandler(handler: shutdownHandler(for: host))
        interruption.setEventHandler(handler: shutdownHandler(for: host))
        termination.resume(); interruption.resume()
        await Task.detached {
            var buffered = Data()
            var bytes = [UInt8](repeating: 0, count: 4_096)
            while true {
                let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { break }
                buffered.append(contentsOf: bytes.prefix(count))
                while let boundary = buffered.firstIndex(of: 10) {
                    let line = Data(buffered[..<boundary])
                    buffered.removeSubrange(...boundary)
                    guard line.count <= 8_192 else { await host.shutdown(); return }
                    if !line.isEmpty { Task { @MainActor in await host.handle(line) } }
                }
                if buffered.count > 8_192 { break }
            }
            await host.shutdown()
        }.value
        withExtendedLifetime((termination, interruption)) {}
    }

    // Dispatch callbacks execute off the main actor. Constructing the closure
    // here prevents inherited actor isolation from trapping on SIGTERM.
    nonisolated private static func shutdownHandler(for host: ProxyHelperHost) -> @Sendable () -> Void {
        { Task { @MainActor in await host.shutdown() } }
    }
}
