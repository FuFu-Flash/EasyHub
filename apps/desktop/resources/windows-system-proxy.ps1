$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# Fixed WinINet operations for the current user's default/LAN connection. No elevation,
# registry shell commands, or machine-wide WinHTTP writes are used here.
# https://learn.microsoft.com/windows/win32/api/wininet/ns-wininet-internet_per_conn_optionw
# https://learn.microsoft.com/windows/win32/wininet/option-flags
# https://learn.microsoft.com/en-us/windows/win32/api/winhttp/nf-winhttp-winhttpdetectautoproxyconfigurl
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public sealed class EasyHubProxySettings {
    public uint flags;
    public string proxyServer;
    public string proxyBypass;
    public string autoConfigUrl;
}

public static class EasyHubWinInetProxy {
    [StructLayout(LayoutKind.Explicit)]
    private struct OptionValue {
        [FieldOffset(0)] public uint Number;
        [FieldOffset(0)] public IntPtr Text;
        [FieldOffset(0)] public System.Runtime.InteropServices.ComTypes.FILETIME Time;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Option { public uint Id; public OptionValue Value; }
    [StructLayout(LayoutKind.Sequential)]
    private struct OptionList {
        public uint Size;
        public IntPtr Connection;
        public uint Count;
        public uint Error;
        public IntPtr Options;
    }
    [DllImport("wininet.dll", EntryPoint="InternetQueryOptionW", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Query(IntPtr handle, uint option, ref OptionList buffer, ref uint length);
    [DllImport("wininet.dll", EntryPoint="InternetSetOptionW", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Set(IntPtr handle, uint option, ref OptionList buffer, uint length);
    [DllImport("wininet.dll", EntryPoint="InternetSetOptionW", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Notify(IntPtr handle, uint option, IntPtr buffer, uint length);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GlobalFree(IntPtr pointer);
    [DllImport("winhttp.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WinHttpDetectAutoProxyConfigUrl(uint flags, out IntPtr url);

    public static bool DetectAutomaticProxy() {
        IntPtr url=IntPtr.Zero;
        try {
            // DHCP (1) followed by DNS (2). Discover only; never download the PAC.
            if (WinHttpDetectAutoProxyConfigUrl(3, out url)) return true;
            int error=Marshal.GetLastWin32Error();
            if (error==12180) return false; // ERROR_WINHTTP_AUTODETECTION_FAILED: no PAC URL discovered.
            throw new Win32Exception(error); // Timeout/service/internal failures remain uncertain.
        } finally { if (url!=IntPtr.Zero) GlobalFree(url); }
    }

    private static OptionList List(IntPtr options) {
        return new OptionList { Size=(uint)Marshal.SizeOf(typeof(OptionList)),
            Connection=IntPtr.Zero, Count=4, Options=options };
    }
    private static IntPtr At(IntPtr pointer, int index) {
        return IntPtr.Add(pointer, index * Marshal.SizeOf(typeof(Option)));
    }
    private static Option Get(IntPtr pointer, int index) {
        return (Option)Marshal.PtrToStructure(At(pointer, index), typeof(Option));
    }
    private static string Text(IntPtr pointer, int index) {
        IntPtr value=Get(pointer, index).Value.Text;
        return value==IntPtr.Zero ? "" : Marshal.PtrToStringUni(value);
    }
    private static EasyHubProxySettings ReadWithFlags(uint flagsId) {
        int size=Marshal.SizeOf(typeof(Option));
        IntPtr block=Marshal.AllocHGlobal(size * 4);
        uint[] ids={flagsId, 2, 3, 4};
        try {
            for (int index=0; index<4; index++)
                Marshal.StructureToPtr(new Option { Id=ids[index] }, At(block, index), false);
            OptionList list=List(block);
            uint length=list.Size;
            if (!Query(IntPtr.Zero, 75, ref list, ref length)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return new EasyHubProxySettings { flags=Get(block, 0).Value.Number,
                proxyServer=Text(block, 1), proxyBypass=Text(block, 2), autoConfigUrl=Text(block, 3) };
        } finally {
            // InternetQueryOption owns its returned strings until the caller GlobalFree's them.
            for (int index=1; index<4; index++) {
                IntPtr text=Get(block, index).Value.Text;
                if (text!=IntPtr.Zero) GlobalFree(text);
            }
            Marshal.FreeHGlobal(block);
        }
    }
    public static EasyHubProxySettings Read() {
        // FLAGS_UI reports saved user choices; FLAGS can include transient auto-discovery results.
        try { return ReadWithFlags(10); } catch (Win32Exception) { return ReadWithFlags(1); }
    }
    public static bool Equal(EasyHubProxySettings left, EasyHubProxySettings right) {
        return left.flags==right.flags && left.proxyServer==right.proxyServer &&
            left.proxyBypass==right.proxyBypass && left.autoConfigUrl==right.autoConfigUrl;
    }
    private static void Write(EasyHubProxySettings settings) {
        IntPtr block=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Option)) * 4);
        IntPtr[] strings=new IntPtr[3];
        try {
            // Microsoft specifies FLAGS (1), not FLAGS_UI (10), when restoring choices.
            Marshal.StructureToPtr(new Option { Id=1, Value=new OptionValue { Number=settings.flags } }, At(block, 0), false);
            string[] text={settings.proxyServer, settings.proxyBypass, settings.autoConfigUrl};
            for (int index=0; index<3; index++) {
                strings[index]=Marshal.StringToHGlobalUni(text[index]);
                Marshal.StructureToPtr(new Option { Id=(uint)(index+2), Value=new OptionValue { Text=strings[index] } }, At(block, index+1), false);
            }
            OptionList list=List(block);
            if (!Set(IntPtr.Zero, 75, ref list, list.Size)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!Notify(IntPtr.Zero, 39, IntPtr.Zero, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!Notify(IntPtr.Zero, 37, IntPtr.Zero, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            foreach (IntPtr text in strings) if (text!=IntPtr.Zero) Marshal.FreeHGlobal(text);
            Marshal.FreeHGlobal(block);
        }
    }
    public static bool CompareAndSet(EasyHubProxySettings expected, EasyHubProxySettings replacement) {
        if (!Equal(Read(), expected)) return false;
        // WinINet has no atomic comparison API across applications. Recheck immediately
        // before Set and use the saved values only while they still match.
        if (!Equal(Read(), expected)) return false;
        Write(replacement);
        return true;
    }
}
'@

function Convert-ProxySettings($value) {
    if ($null -eq $value -or $null -eq $value.flags -or
        $value.flags -lt 0 -or $value.flags -gt [uint32]::MaxValue) { throw 'Invalid settings.' }
    $result = [EasyHubProxySettings]::new()
    $result.flags = [uint32]$value.flags
    foreach ($key in @('proxyServer', 'proxyBypass', 'autoConfigUrl')) {
        if ($value.$key -isnot [string] -or $value.$key.Length -gt 32768 -or $value.$key.Contains([char]0)) {
            throw 'Invalid settings.'
        }
        $result.$key = $value.$key
    }
    return $result
}

function Get-LeaseHash([byte[]]$bytes) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hasher.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}

function Test-LeaseHash([string]$path, [string]$expectedHash) {
    try { return (Get-LeaseHash ([IO.File]::ReadAllBytes($path))) -ceq $expectedHash }
    catch { return $false }
}

function Restore-SavedLease([string]$path, [string]$expectedHash) {
    if (-not (Test-LeaseHash $path $expectedHash)) { return }
    $bytes = [IO.File]::ReadAllBytes($path)
    if ((Get-LeaseHash $bytes) -cne $expectedHash) { return }
    $file = [Text.Encoding]::UTF8.GetString($bytes)
    if ($file.Length -gt 65536) { throw 'Invalid lease.' }
    $saved = $file | ConvertFrom-Json
    if ($saved.version -ne 1) { throw 'Invalid lease.' }
    $previous = Convert-ProxySettings $saved.previous
    $applied = Convert-ProxySettings $saved.applied
    $uri = [Uri]$applied.autoConfigUrl
    if ($uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1' -or $uri.Port -le 0 -or
        $uri.UserInfo -or $uri.Fragment -or -not ($applied.flags -band 4) -or
        $previous.proxyServer -cne $applied.proxyServer -or $previous.proxyBypass -cne $applied.proxyBypass) {
        throw 'Invalid lease.'
    }
    $current = [EasyHubWinInetProxy]::Read()
    if (-not (Test-LeaseHash $path $expectedHash)) { return }
    if ([EasyHubWinInetProxy]::Equal($current, $applied)) {
        if (-not [EasyHubWinInetProxy]::CompareAndSet($applied, $previous)) { return }
    } elseif ($current.autoConfigUrl -ceq $applied.autoConfigUrl) {
        $replacement = Convert-ProxySettings $current
        $replacement.autoConfigUrl = $previous.autoConfigUrl
        $replacement.flags = ($current.flags -band ([uint32]::MaxValue -bxor 4)) -bor ($previous.flags -band 4)
        if (-not [EasyHubWinInetProxy]::CompareAndSet($current, $replacement)) { return }
    }
    # Retain a concurrently replaced lease. The next start can retry any failed restoration.
    if (Test-LeaseHash $path $expectedHash) {
        [IO.File]::Delete($path)
    }
}

try {
    $inputJson = [Console]::In.ReadToEnd()
    if ($inputJson.Length -gt 65536) { throw 'Invalid request.' }
    $request = $inputJson | ConvertFrom-Json
    switch ($request.operation) {
        'read' { [EasyHubWinInetProxy]::Read() | ConvertTo-Json -Compress }
        'detectAutomaticProxy' { @{ detected = [EasyHubWinInetProxy]::DetectAutomaticProxy() } | ConvertTo-Json -Compress }
        'compareAndSet' {
            $expected = Convert-ProxySettings $request.expected
            $replacement = Convert-ProxySettings $request.replacement
            @{ changed = [EasyHubWinInetProxy]::CompareAndSet($expected, $replacement) } | ConvertTo-Json -Compress
        }
        'watch' {
            $leasePath = [string]$request.leasePath
            $expectedLeaseHash = [string]$request.expectedLeaseHash
            if (-not [IO.Path]::IsPathRooted($leasePath) -or $request.ownerPid -le 0 -or
                $expectedLeaseHash -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid recovery request.' }
            if (-not (Test-LeaseHash $leasePath $expectedLeaseHash)) { exit 0 }
            $owner = $null
            try {
                $owner = [Diagnostics.Process]::GetProcessById([int]$request.ownerPid)
                # Open and retain the original process handle now so a reused PID
                # cannot extend this guardian's ownership to a different process.
                $null = $owner.Handle
            } catch {
                if ($null -ne $owner) { $owner.Dispose(); $owner = $null }
            }
            [Console]::Out.WriteLine('ready')
            [Console]::Out.Flush()
            if ($null -ne $owner) {
                try {
                    while (-not $owner.HasExited) {
                        if (-not (Test-LeaseHash $leasePath $expectedLeaseHash)) { exit 0 }
                        Start-Sleep -Milliseconds 1000
                        $owner.Refresh()
                    }
                } finally { $owner.Dispose() }
            }
            # Temporary WinINet errors or a comparison race should not strand the
            # PAC after its owner exits. Every retry remains bound to this lease.
            for ($recoveryAttempt = 0; $recoveryAttempt -lt 5; $recoveryAttempt++) {
                if (-not (Test-LeaseHash $leasePath $expectedLeaseHash)) { exit 0 }
                try { Restore-SavedLease $leasePath $expectedLeaseHash }
                catch { if ($recoveryAttempt -eq 4) { throw } }
                if (-not (Test-LeaseHash $leasePath $expectedLeaseHash)) { exit 0 }
                if ($recoveryAttempt -lt 4) { Start-Sleep -Milliseconds 1000 }
            }
        }
        default { throw 'Invalid operation.' }
    }
} catch {
    # Native details can contain proxy credentials; return only a fixed failure indication.
    [Console]::Error.WriteLine('System proxy operation failed.')
    exit 1
}
