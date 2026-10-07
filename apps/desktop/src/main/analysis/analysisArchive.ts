import { execFile } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { throwIfAborted } from './analysisDownloads';
import { extractMacRuntimeArchive } from './analysisMacArchive';

// Paths are passed through environment variables, never interpolated into executable code.
const EXTRACTION_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archivePath = [System.IO.Path]::GetFullPath($env:EASYHUB_ANALYSIS_ARCHIVE)
$destination = [System.IO.Path]::GetFullPath($env:EASYHUB_ANALYSIS_DESTINATION)
$prefix = $destination.TrimEnd('\') + '\'
$limit = [long]$env:EASYHUB_ANALYSIS_UNPACK_LIMIT
$seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$zip = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  if ($zip.Entries.Count -gt 100000) { throw 'ZIP contains too many entries' }
  [long]$total = 0
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('/', '\')
    if ([string]::IsNullOrEmpty($name) -or $name.StartsWith('\') -or $name.Contains(':') -or $name.Contains([char]0)) { throw 'Unsafe ZIP entry path' }
    $parts = $name.TrimEnd('\').Split('\')
    foreach ($part in $parts) {
      if ([string]::IsNullOrEmpty($part) -or $part -eq '.' -or $part -eq '..' -or $part -match '[<>:"|?*\x00-\x1f]' -or $part -match '[. ]$' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Unsafe ZIP entry component' }
    }
    $target = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($destination, $name))
    if (-not $target.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP entry escapes destination' }
    if (-not $seen.Add($target.TrimEnd('\'))) { throw 'ZIP contains duplicate paths' }
    if (($entry.ExternalAttributes -shr 16 -band 61440) -eq 40960) { throw 'ZIP symbolic links are not allowed' }
    if ($entry.Length -lt 0 -or $entry.Length -gt $limit -or $total -gt $limit - $entry.Length) { throw 'ZIP exceeds unpacked size limit' }
    $total += $entry.Length
  }
  # Enforce the limit on bytes actually inflated, even if ZIP headers lie about lengths.
  [long]$written = 0
  $buffer = New-Object byte[] 65536
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('/', '\')
    $target = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($destination, $name))
    if ($name.EndsWith('\')) { [void][System.IO.Directory]::CreateDirectory($target); continue }
    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target))
    $inputStream = $entry.Open()
    try {
      $outputStream = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
      try {
        [long]$fileWritten = 0
        while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
          if ($written -gt $limit - $count -or $fileWritten -gt $entry.Length - $count) { throw 'ZIP inflated content exceeds size limit' }
          $outputStream.Write($buffer, 0, $count)
          $written += $count
          $fileWritten += $count
        }
        if ($fileWritten -ne $entry.Length) { throw 'ZIP entry length mismatch' }
      } finally { $outputStream.Dispose() }
    } finally { $inputStream.Dispose() }
  }
} finally { $zip.Dispose() }
`;

export async function extractRuntimeArchive(
  archive: string, destination: string, maximumUnpackedBytes: number, signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!isAbsolute(archive) || !isAbsolute(destination) || !Number.isSafeInteger(maximumUnpackedBytes) || maximumUnpackedBytes < 1) {
    throw new Error('分析组件解压参数无效');
  }
  const parent = resolve(archive, '..');
  const target = resolve(destination);
  const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target;
  const normalizedParent = process.platform === 'win32' ? parent.toLowerCase() : parent;
  const archivePath = process.platform === 'win32' ? resolve(archive).toLowerCase() : resolve(archive);
  if (!normalizedTarget.startsWith(normalizedParent + sep) || normalizedTarget === archivePath) {
    throw new Error('解压目录必须位于本次安装目录内');
  }
  await mkdir(destination); // must be a newly created directory, never extract over another installation
  const directory = await lstat(destination);
  const canonical = await realpath(destination);
  // Windows packaged processes can virtualize userData into LocalCache without a symlink.
  // Compare against the canonical owned parent, while preserving the relative destination.
  const expected = join(await realpath(parent), relative(parent, target));
  const matches = process.platform === 'win32' ? canonical.toLowerCase() === expected.toLowerCase() : canonical === expected;
  if (!directory.isDirectory() || directory.isSymbolicLink() || !matches) {
    throw new Error('分析组件解压目录不安全');
  }
  const archiveInfo = await lstat(archive);
  if (!archiveInfo.isFile() || archiveInfo.isSymbolicLink()) throw new Error('分析组件归档路径不安全');
  const canonicalArchive = await realpath(archive);
  if (process.platform === 'darwin') {
    await extractMacRuntimeArchive(canonicalArchive, canonical, maximumUnpackedBytes, signal);
    return;
  }
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await new Promise<void>((resolvePromise, reject) => {
    let aborted = false;
    let timedOut = false;
    let launchError: Error | undefined;
    const child = execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', EXTRACTION_SCRIPT], {
      shell: false, windowsHide: true, maxBuffer: 1024 * 1024,
      env: { ...process.env, EASYHUB_ANALYSIS_ARCHIVE: canonicalArchive, EASYHUB_ANALYSIS_DESTINATION: canonical,
        EASYHUB_ANALYSIS_UNPACK_LIMIT: String(maximumUnpackedBytes) },
    });
    let diagnostics = '';
    child.stderr?.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4096); });
    const abort = () => { aborted = true; child.kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 10 * 60_000);
    child.once('error', error => { launchError = error; });
    // Wait for the process to close before the caller removes its own temporary directory.
    child.once('close', code => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (aborted) reject(new DOMException('分析组件安装已取消', 'AbortError'));
      else if (timedOut) reject(new Error('分析组件解压超时'));
      else if (launchError) reject(launchError);
      else if (code !== 0) reject(new Error(`分析组件 ZIP 安全校验或解压失败：${diagnostics.slice(-1000)}`));
      else resolvePromise();
    });
  });
}
