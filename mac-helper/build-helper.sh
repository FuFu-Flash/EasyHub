#!/bin/bash
set -euo pipefail
helper_directory="$(cd -- "$(dirname -- "$0")" && pwd)"
source_root="$(cd -- "$helper_directory/../.." && pwd)"
helper_output="${1:-$helper_directory/../apps/desktop/resources/easyhub-proxy-helper}"
compiler_flags=(-O)
if [[ "${2:-}" == "--debug" ]]; then compiler_flags=(-Onone -g -D DEBUG); fi
mkdir -p -- "$(dirname -- "$helper_output")"
xcrun swiftc -parse-as-library -swift-version 6 -target arm64-apple-macos27.0 \
  "${compiler_flags[@]}" \
  "$source_root/Shared/SteamToolsRules.swift" \
  "$source_root/Shared/SteamToolsResolver.swift" \
  "$source_root/Shared/TunnelPackets.swift" \
  "$source_root/GitHubTunnel/LocalSOCKSProxy.swift" \
  "$source_root/EasyHubMac/Proxy/MacProxyPACServer.swift" \
  "$source_root/EasyHubMac/Proxy/MacSteamToolsProxyController.swift" \
  "$helper_directory/ProxyTypes.swift" \
  "$helper_directory/ProxyHelperMain.swift" \
  -o "$helper_output"
/usr/bin/codesign --force --sign - "$helper_output"
