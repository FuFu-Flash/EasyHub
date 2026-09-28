using System;
using System.IO;
using System.Reflection;

internal static class SmokeHarness
{
    private static int Main(string[] args)
    {
        var assembly = Assembly.LoadFrom(args[0]);
        var window = assembly.GetType("EasyHubInstaller.InstallerWindow", true);
        var flags = BindingFlags.NonPublic | BindingFlags.Static;
        var target = window.GetMethod("TargetPath", flags);
        if ((string)target.Invoke(null, new object[] { @"D:\Projects", "" }) != @"D:\Projects\EasyHub") return 2;
        if ((string)target.Invoke(null, new object[] { @"D:\Custom", @"D:\Custom" }) != @"D:\Custom") return 3;
        try { target.Invoke(null, new object[] { @"D:\", "" }); return 4; }
        catch (TargetInvocationException) { /* Installing into a drive root must be refused. */ }

        var install = window.GetMethod("InstallCore", flags);
        install.Invoke(null, new object[] { args[1], false });
        if (!File.Exists(Path.Combine(args[1], "EasyHub.exe"))) return 5;
        var arguments = File.ReadAllText(Path.Combine(args[1], "arguments.txt"));
        if (!arguments.Contains("/NO_DESKTOP_SHORTCUT=1") || !arguments.Contains("/D=" + args[1])) return 6;
        return 0;
    }
}
