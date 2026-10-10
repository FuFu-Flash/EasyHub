param([string]$Installer)

$ErrorActionPreference = 'Stop'
if (-not $Installer) {
  $version = (Get-Content (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
  $Installer = Join-Path $PSScriptRoot "release/EasyHub-$version-setup.exe"
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class InstallerVisualCheck {
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
}
'@

$process = Start-Process -FilePath (Resolve-Path -LiteralPath $Installer).Path -PassThru
try {
  $title = -join ([char[]]@(0x5B89, 0x88C5, 0x20, 0x45, 0x61, 0x73, 0x79, 0x48, 0x75, 0x62))
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $window = $null
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    Start-Sleep -Milliseconds 250
    $processes = @(Get-CimInstance Win32_Process)
    $tree = @($process.Id)
    for ($depth = 0; $depth -lt 5; $depth++) {
      $children = @($processes | Where-Object { $tree -contains $_.ParentProcessId -and $tree -notcontains $_.ProcessId } |
        Select-Object -ExpandProperty ProcessId)
      if (-not $children.Count) { break }
      $tree += $children
    }
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($candidate in $windows) {
      if ($candidate.Current.Name -eq $title -and $tree -contains $candidate.Current.ProcessId) {
        $window = $candidate; break
      }
    }
    if ($window) { break }
  }
  if (-not $window) { throw 'The custom EasyHub installer window did not appear.' }
  $handle = [IntPtr]$window.Current.NativeWindowHandle
  [void][InstallerVisualCheck]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, 3)
  Start-Sleep -Milliseconds 300
  $bounds = $window.Current.BoundingRectangle
  $bitmap = [System.Drawing.Bitmap]::new([int]$bounds.Width, [int]$bounds.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen([int]$bounds.X, [int]$bounds.Y, 0, 0, $bitmap.Size)
    $bitmap.Save((Join-Path $PSScriptRoot 'out/installer-setup.png'))
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
  [void][InstallerVisualCheck]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, 3)
  Write-Output 'Custom setup executable opened; screenshot saved.'
} finally {
  $all = @(Get-CimInstance Win32_Process)
  $tree = @($process.Id)
  for ($depth = 0; $depth -lt 5; $depth++) {
    $children = @($all | Where-Object { $tree -contains $_.ParentProcessId -and $tree -notcontains $_.ProcessId } |
      Select-Object -ExpandProperty ProcessId)
    if (-not $children.Count) { break }
    $tree += $children
  }
  if ($tree.Count -gt 1) { Stop-Process -Id @($tree | Where-Object { $_ -ne $process.Id }) -Force -ErrorAction SilentlyContinue }
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
}
