import Foundation

// Helper-only declarations. Keep the original iOS/native application untouched.
enum GitHubProxyStatus: String, Sendable {
    case unavailable, unconfigured, disconnected, connecting, connected, reasserting, disconnecting
    var isActive: Bool { [.connecting, .connected, .reasserting, .disconnecting].contains(self) }
}

struct GitHubProxySystemState: Sendable {
    var status: GitHubProxyStatus
    var activeSnapshot: SteamToolsSnapshot? = nil
    var disconnectError: String? = nil
    var localSOCKSPort: UInt16? = nil
    var pacURL: URL? = nil
}

@MainActor protocol GitHubProxyControlling: AnyObject {
    var isAvailable: Bool { get }
    var onChange: ((GitHubProxySystemState) -> Void)? { get set }
    func load() async throws -> GitHubProxySystemState
    func start(snapshot: SteamToolsSnapshot) async throws -> GitHubProxySystemState
    func stop()
    func remove() async throws
}

enum GitHubProxyError: LocalizedError {
    case deviceRequired, activeConfiguration, invalidSnapshot
    var errorDescription: String? {
        switch self {
        case .deviceRequired: "此版本仅支持本地 SOCKS5/PAC 代理。"
        case .activeConfiguration: "请先断开 GitHub 代理，再更新配置。"
        case .invalidSnapshot: "SteamTools 规则尚未解析到有效地址，无法启动代理。"
        }
    }
}
