using System;
using System.IO;

internal static class MockCore
{
    private static int Main()
    {
        var command = Environment.CommandLine;
        var marker = command.LastIndexOf(" /D=", StringComparison.OrdinalIgnoreCase);
        if (marker < 0) return 2;
        var destination = command.Substring(marker + 4).Trim().Trim('"');
        Directory.CreateDirectory(destination);
        File.WriteAllText(Path.Combine(destination, "EasyHub.exe"), "installer smoke test");
        File.WriteAllText(Path.Combine(destination, "arguments.txt"), command);
        return 0;
    }
}
