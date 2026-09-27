param([Parameter(Mandatory = $true)][string] $PayloadPath)
$ErrorActionPreference = 'Stop'
$resultPath = $null
try {
  $payload = Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $resultPath = [string] $payload.resultPath
  $systemRoot = [Environment]::GetFolderPath('Windows')
  $hostsPath = Join-Path $systemRoot 'System32\drivers\etc\hosts'
  $current = [IO.File]::ReadAllBytes($hostsPath)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { $actualHash = [BitConverter]::ToString($hash.ComputeHash($current)).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose() }
  if ($actualHash -ne [string] $payload.expected) { throw '系统 Hosts 在操作期间发生变化，未覆盖其他修改。' }
  $content = [Convert]::FromBase64String([string] $payload.content)
  if ($content.Length -gt 131072) { throw 'Hosts 内容过大，未修改系统文件。' }
  $backup = Join-Path (Split-Path -Parent $PayloadPath) ('hosts-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.txt')
  [IO.File]::WriteAllBytes($backup, $current)
  $temporary = Join-Path (Split-Path -Parent $hostsPath) ('easyhub-hosts-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  $swapBackup = Join-Path (Split-Path -Parent $hostsPath) ('easyhub-hosts-backup-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [IO.File]::WriteAllBytes($temporary, $content)
    [IO.File]::Replace($temporary, $hostsPath, $swapBackup)
    try { & ipconfig.exe /flushdns | Out-Null } catch { }
  } finally {
    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    if ([IO.File]::Exists($swapBackup)) { [IO.File]::Delete($swapBackup) }
  }
  @{ ok = $true } | ConvertTo-Json -Compress | Set-Content -LiteralPath $resultPath -Encoding UTF8
} catch {
  if ($resultPath) {
    @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress | Set-Content -LiteralPath $resultPath -Encoding UTF8
  }
  exit 1
}
