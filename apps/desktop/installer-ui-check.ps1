param([string]$Installer)

$ErrorActionPreference = 'Stop'
if (-not $Installer) {
  $version = (Get-Content (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
  $Installer = Join-Path $PSScriptRoot "release/EasyHub-$version-setup.exe"
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class InstallerWindowMessage {
  [DllImport("user32.dll", CharSet=CharSet.Auto)]
  public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr processId);
  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);
}
'@

$process = [System.Diagnostics.Process]::Start((Resolve-Path -LiteralPath $Installer).Path)
try {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id
  )
  $window = $null
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    $window = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    if ($window) { break }
  }
  if (-not $window) { throw 'Installer window did not open.' }

  $shortcutLabel = -join ([char[]]@(0x521B, 0x5EFA, 0x684C, 0x9762, 0x5FEB, 0x6377, 0x65B9, 0x5F0F))
  for ($step = 0; $step -lt 5; $step++) {
    $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $checkbox = $null
    $next = $null
    foreach ($element in $elements) {
      $name = $element.Current.Name
      if ($name -eq $shortcutLabel) { $checkbox = $element }
      if ($name -match '\(N\)|^Next' -and $element.Current.IsEnabled) { $next = $element }
    }
    if ($checkbox) {
      $checked = [InstallerWindowMessage]::SendMessage(
        [IntPtr]$checkbox.Current.NativeWindowHandle, 0x00F0, [IntPtr]::Zero, [IntPtr]::Zero
      )
      if ($checked.ToInt32() -ne 1) { throw 'Desktop shortcut option was not checked by default.' }
      Write-Output 'Installer shortcut option is visible and checked by default.'
      exit 0
    }
    if (-not $next) { throw "Shortcut option not found; no safe Next button on page $step." }

    $foreground = [InstallerWindowMessage]::GetForegroundWindow()
    $foregroundThread = [InstallerWindowMessage]::GetWindowThreadProcessId($foreground, [IntPtr]::Zero)
    $currentThread = [InstallerWindowMessage]::GetCurrentThreadId()
    [void][InstallerWindowMessage]::AttachThreadInput($currentThread, $foregroundThread, $true)
    try { [void][InstallerWindowMessage]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle) }
    finally { [void][InstallerWindowMessage]::AttachThreadInput($currentThread, $foregroundThread, $false) }
    [System.Windows.Forms.SendKeys]::SendWait('%n')
    Start-Sleep -Milliseconds 500
  }
  throw 'Shortcut option was not found in the installer wizard.'
} finally {
  if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
}
