using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

internal static class SmokeHarness
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--visual")
            return CheckVisuals(args[1], args[2], args[3], args[4]);
        if (args.Length > 0 && args[0] == "--animation")
            return CheckAnimation(args[1], args[2]);

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

    private static int CheckAnimation(string executable, string destination)
    {
        var application = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        Window window = null;
        try
        {
            var type = Assembly.LoadFrom(executable).GetType("EasyHubInstaller.InstallerWindow", true);
            var flags = BindingFlags.NonPublic | BindingFlags.Instance;
            window = (Window)Activator.CreateInstance(type, true);
            window.ShowActivated = false;
            window.ShowInTaskbar = false;
            window.WindowStartupLocation = WindowStartupLocation.Manual;
            window.Left = -10000;
            window.Top = -10000;
            window.Show();
            window.Dispatcher.Invoke(DispatcherPriority.ApplicationIdle, new Action(delegate { }));
            SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(window.Dispatcher));
            ((TextBox)type.GetField("pathInput", flags).GetValue(window)).Text = destination;
            type.GetMethod("InstallClick", flags).Invoke(window, new object[] { null, new RoutedEventArgs() });
            var transform = (TranslateTransform)type.GetField("progressTransform", flags).GetValue(window);
            if (!transform.HasAnimatedProperties)
                throw new InvalidOperationException("Starting a real mock installation did not activate the progress animation.");
            if (((Canvas)type.GetField("progress", flags).GetValue(window)).Visibility != Visibility.Visible)
                throw new InvalidOperationException("Starting a real mock installation did not show progress.");

            // Seek the production timeline to its endpoints and both directions, checking actual rendered clipping.
            var animation = (DoubleAnimationUsingKeyFrames)type.GetField("progressAnimation", flags).GetValue(window);
            var clock = (AnimationClock)animation.CreateClock(true);
            transform.ApplyAnimationClock(TranslateTransform.XProperty, clock);
            clock.Controller.Begin();
            double minimum = double.MaxValue, maximum = double.MinValue;
            foreach (var milliseconds in new[] { 0, 425, 850, 1275, 1700, 2125, 2550, 2975 })
            {
                clock.Controller.SeekAlignedToLastTick(TimeSpan.FromMilliseconds(milliseconds), TimeSeekOrigin.BeginTime);
                minimum = Math.Min(minimum, transform.X);
                maximum = Math.Max(maximum, transform.X);
                window.UpdateLayout();
                var bitmap = new RenderTargetBitmap(900, 620, 96, 96, PixelFormats.Pbgra32);
                bitmap.Render((Visual)window.Content);
                var pixels = new byte[900 * 620 * 4];
                bitmap.CopyPixels(pixels, 900 * 4, 0);
                for (var y = 459; y < 473; y++)
                    for (var x = 255; x < 900; x++)
                        if (IsColor(pixels, x, y, 0x28, 0x7A, 0xF0) && (x < 425 || x >= 847 || y < 462 || y >= 470))
                            throw new InvalidOperationException("Animated progress escapes the track at " + milliseconds + "ms: " + x + "," + y + ".");
            }
            if (minimum > -80 || maximum < 350)
                throw new InvalidOperationException("Progress animation does not travel through the Web installer's clipped endpoints.");

            var installing = type.GetField("installing", flags);
            var deadline = Stopwatch.StartNew();
            while ((bool)installing.GetValue(window) && deadline.ElapsedMilliseconds < 5000)
            {
                var frame = new DispatcherFrame();
                var timer = new DispatcherTimer(DispatcherPriority.Background) { Interval = TimeSpan.FromMilliseconds(20) };
                timer.Tick += (sender, args) => { timer.Stop(); frame.Continue = false; };
                timer.Start();
                Dispatcher.PushFrame(frame);
            }
            if ((bool)installing.GetValue(window) || !File.Exists(Path.Combine(destination, "EasyHub.exe")))
                throw new InvalidOperationException("Animated mock installation did not finish.");
            if (transform.HasAnimatedProperties)
                throw new InvalidOperationException("Finished installation kept the progress animation active.");
            Console.WriteLine("Install click activates animation; eight rendered frames stay clipped; completion stops it.");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.GetBaseException().Message);
            return 11;
        }
        finally
        {
            if (window != null) window.Close();
            application.Shutdown();
        }
    }

    private static int CheckVisuals(string executable, string formScreenshot, string progressScreenshot, string nativeScreenshot)
    {
        var failures = new List<string>();
        var application = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        Window window = null;
        try
        {
            // Instantiate the production installer so SourceInitialized and HWND setup really run.
            var assembly = Assembly.LoadFrom(executable);
            var type = assembly.GetType("EasyHubInstaller.InstallerWindow", true);
            window = (Window)Activator.CreateInstance(type, true);
            window.ShowActivated = false;
            window.ShowInTaskbar = false;
            window.WindowStartupLocation = WindowStartupLocation.Manual;
            window.Left = -10000;
            window.Top = -10000;
            window.Show();
            window.Dispatcher.Invoke(DispatcherPriority.ApplicationIdle, new Action(delegate { }));
            CheckNativeCorners(window, failures);
            CheckNativeScreenshot(window, nativeScreenshot, failures);
            CheckScreenshot(formScreenshot, false, failures);
            CheckScreenshot(progressScreenshot, true, failures);
        }
        catch (Exception error)
        {
            failures.Add(error.GetBaseException().Message);
        }
        finally
        {
            if (window != null) window.Close();
            application.Shutdown();
        }
        foreach (var failure in failures) Console.Error.WriteLine(failure);
        if (failures.Count > 0) return 10;
        Console.WriteLine("Production HWND rounding and complete installer screenshots passed.");
        return 0;
    }

    private static void CheckNativeScreenshot(Window window, string filename, List<string> failures)
    {
        var composition = PresentationSource.FromVisual(window).CompositionTarget;
        var scale = composition.TransformToDevice;
        var workArea = System.Windows.Forms.Screen.PrimaryScreen.WorkingArea;
        if (workArea.Width < (window.Width + 40) * scale.M11 || workArea.Height < (window.Height + 40) * scale.M22)
            throw new InvalidOperationException("Native corner screenshot requires enough screen space for the installer and its test background.");
        var left = (workArea.Left + (workArea.Width - window.Width * scale.M11) / 2) / scale.M11;
        var top = (workArea.Top + (workArea.Height - window.Height * scale.M22) / 2) / scale.M22;
        var background = new Window
        {
            Width = window.Width + 40, Height = window.Height + 40,
            Left = left - 20, Top = top - 20, WindowStartupLocation = WindowStartupLocation.Manual,
            WindowStyle = WindowStyle.None, ResizeMode = ResizeMode.NoResize,
            Background = Brushes.Lime, ShowInTaskbar = false, ShowActivated = false, Topmost = true
        };
        try
        {
            // A task-owned opaque green backdrop ensures no other desktop contents enter the screenshot.
            background.Show();
            window.Owner = background;
            window.Topmost = true;
            window.Left = left;
            window.Top = top;
            window.Dispatcher.Invoke(DispatcherPriority.ApplicationIdle, new Action(delegate { }));
            var frame = new DispatcherFrame();
            var timer = new DispatcherTimer(DispatcherPriority.Background) { Interval = TimeSpan.FromMilliseconds(250) };
            timer.Tick += (sender, args) => { timer.Stop(); frame.Continue = false; };
            timer.Start();
            Dispatcher.PushFrame(frame);
            DwmFlush();
            NativeRect bounds;
            if (!GetWindowRect(new WindowInteropHelper(window).Handle, out bounds))
                throw new InvalidOperationException("Cannot capture native installer bounds.");
            using (var bitmap = new System.Drawing.Bitmap(bounds.Right - bounds.Left, bounds.Bottom - bounds.Top))
            {
                using (var graphics = System.Drawing.Graphics.FromImage(bitmap))
                    graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bitmap.Size);
                bitmap.Save(filename, System.Drawing.Imaging.ImageFormat.Png);
                foreach (var corner in new[] { new System.Drawing.Point(0, 0), new System.Drawing.Point(bitmap.Width - 1, 0),
                    new System.Drawing.Point(0, bitmap.Height - 1), new System.Drawing.Point(bitmap.Width - 1, bitmap.Height - 1) })
                {
                    var pixel = bitmap.GetPixel(corner.X, corner.Y);
                    if (pixel.G < 100 || pixel.G < pixel.R * 3 || pixel.G < pixel.B * 3)
                        failures.Add("Actual native window corner at " + corner + " does not expose the green test background (RGB " + pixel.R + "," + pixel.G + "," + pixel.B + ").");
                }
                var center = bitmap.GetPixel(bitmap.Width / 2, bitmap.Height / 2);
                if (center.G > 100 && center.R < 20 && center.B < 20)
                    failures.Add("Native screenshot did not capture the installer foreground.");
            }
        }
        finally
        {
            window.Left = -10000;
            window.Top = -10000;
            window.Topmost = false;
            window.Owner = null;
            background.Close();
        }
    }

    private static void CheckNativeCorners(Window window, List<string> failures)
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        var version = new OsVersionInfo { Size = Marshal.SizeOf(typeof(OsVersionInfo)) };
        if (RtlGetVersion(ref version) != 0) throw new InvalidOperationException("Cannot read native Windows version.");
        if (version.Build >= 22000)
        {
            int preference;
            var result = DwmGetWindowAttribute(hwnd, 33, out preference, sizeof(int));
            if (result != 0 || preference != 2)
                failures.Add("Production HWND DWM corner preference is " + preference + " (HRESULT " + result + "), expected 2.");
        }
        else
        {
            // Older Windows must clip the native window too, rather than only rounding its WPF content.
            var region = CreateRectRgn(0, 0, 0, 0);
            try
            {
                NativeRect bounds;
                if (!GetWindowRect(hwnd, out bounds)) throw new InvalidOperationException("Cannot read native window bounds.");
                var width = bounds.Right - bounds.Left;
                var height = bounds.Bottom - bounds.Top;
                if (GetWindowRgn(hwnd, region) <= 1 || PtInRegion(region, 0, 0) ||
                    PtInRegion(region, width - 1, height - 1) || !PtInRegion(region, width / 2, height / 2))
                    failures.Add("Production HWND does not have a rounded fallback window region.");
            }
            finally { DeleteObject(region); }
        }
    }

    private static void CheckScreenshot(string filename, bool isProgress, List<string> failures)
    {
        BitmapSource bitmap;
        using (var file = File.OpenRead(filename))
        {
            var decoder = BitmapDecoder.Create(file, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
            bitmap = new FormatConvertedBitmap(decoder.Frames[0], PixelFormats.Bgra32, null, 0);
        }
        if (bitmap.PixelWidth != 900 || bitmap.PixelHeight != 620)
        {
            failures.Add(Path.GetFileName(filename) + " is " + bitmap.PixelWidth + "x" + bitmap.PixelHeight + ", expected complete 900x620 shell.");
            return;
        }
        var pixels = new byte[900 * 620 * 4];
        bitmap.CopyPixels(pixels, 900 * 4, 0);
        foreach (var corner in new[] { new Point(0, 0), new Point(899, 0), new Point(0, 619), new Point(899, 619) })
            if (pixels[((int)corner.Y * 900 + (int)corner.X) * 4 + 3] != 0)
                failures.Add(Path.GetFileName(filename) + " has an opaque square window corner at " + corner + ".");
        if (pixels[(310 * 900 + 450) * 4 + 3] != 255)
            failures.Add(Path.GetFileName(filename) + " has transparent pixels inside the window.");
        if (isProgress) CheckProgressPixels(pixels, failures);
    }

    private static void CheckProgressPixels(byte[] pixels, List<string> failures)
    {
        // Coordinates include the shell's 1px border. Reference: the original Web installer capsule.
        const int left = 425, top = 462, width = 422, height = 8;
        int blueCount = 0, trackCount = 0, blueLeft = 900, blueRight = -1;
        for (var y = top - 3; y < top + height + 3; y++)
        {
            for (var x = left - 4; x < left + width + 4; x++)
            {
                var blue = IsColor(pixels, x, y, 0x28, 0x7A, 0xF0);
                var track = IsColor(pixels, x, y, 0xE9, 0xF0, 0xFA);
                if (!blue && !track) continue;
                if (x < left || x >= left + width || y < top || y >= top + height)
                    failures.Add("Progress paint escapes the 422x8 track at " + x + "," + y + ".");
                if (blue)
                {
                    blueCount++;
                    blueLeft = Math.Min(blueLeft, x);
                    blueRight = Math.Max(blueRight, x);
                }
                if (track) trackCount++;
            }
        }
        if (blueCount < 700 || trackCount < 1500)
            failures.Add("Progress screenshot must show #287AF0 fill and #E9F0FA track.");
        if (blueRight - blueLeft + 1 < 140 || blueRight - blueLeft + 1 > 149)
            failures.Add("Progress fill does not match the Web installer's 35% capsule width.");
        if (Math.Abs((blueLeft + blueRight) / 2.0 - (left + (width - 1) / 2.0)) > 2)
            failures.Add("Progress screenshot must freeze a centered, visible animation frame.");
        if (IsColor(pixels, left, top, 0xE9, 0xF0, 0xFA) ||
            IsColor(pixels, left + width - 1, top, 0xE9, 0xF0, 0xFA) ||
            IsColor(pixels, blueLeft, top, 0x28, 0x7A, 0xF0) ||
            IsColor(pixels, blueRight, top, 0x28, 0x7A, 0xF0))
            failures.Add("Progress track and fill must have rounded capsule ends.");
    }

    private static bool IsColor(byte[] pixels, int x, int y, byte red, byte green, byte blue)
    {
        var index = (y * 900 + x) * 4;
        return pixels[index] == blue && pixels[index + 1] == green && pixels[index + 2] == red && pixels[index + 3] == 255;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct OsVersionInfo
    {
        public int Size;
        public uint Major, Minor, Build, Platform;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string ServicePack;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left, Top, Right, Bottom; }

    [DllImport("ntdll.dll", CharSet = CharSet.Unicode)] private static extern int RtlGetVersion(ref OsVersionInfo version);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
    [DllImport("dwmapi.dll")] private static extern int DwmFlush();
    [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("user32.dll")] private static extern int GetWindowRgn(IntPtr hwnd, IntPtr region);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out NativeRect bounds);
    [DllImport("gdi32.dll")] private static extern bool PtInRegion(IntPtr region, int x, int y);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);
}
