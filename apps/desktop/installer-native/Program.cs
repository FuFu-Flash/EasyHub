using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using Microsoft.Win32;

namespace EasyHubInstaller
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                var application = new Application();
                var window = new InstallerWindow();
                if (args.Length == 2 && args[0] == "--screenshot")
                {
                    window.SaveScreenshot(args[1]);
                    return 0;
                }
                application.Run(window);
                return 0;
            }
            catch (Exception)
            {
                MessageBox.Show("安装程序无法启动，请重新下载安装文件。", "EasyHub", MessageBoxButton.OK, MessageBoxImage.Error);
                return 1;
            }
        }
    }

    internal sealed class InstallerWindow : Window
    {
        private const string RegistryKey = @"Software\ebd6f51a-0651-5201-90c0-182908705a0a";
        private static readonly Brush Ink = ColorBrush("#172743");
        private static readonly Brush Muted = ColorBrush("#71829C");
        private static readonly Brush Blue = ColorBrush("#287AF0");
        private static readonly Brush PaleBlue = ColorBrush("#EAF3FF");
        private readonly Canvas root = new Canvas();
        private readonly Canvas form = new Canvas();
        private readonly Canvas progress = new Canvas();
        private readonly Canvas done = new Canvas();
        private readonly TextBox pathInput = new TextBox();
        private readonly TextBlock pathHint = new TextBlock();
        private readonly TextBlock errorText = new TextBlock();
        private readonly TextBlock progressText = new TextBlock();
        private readonly TextBlock installedPath = new TextBlock();
        private readonly Border shortcutBox = new Border();
        private readonly TextBlock shortcutMark = new TextBlock();
        private readonly string previousPath;
        private string chosenPath = "";
        private bool shortcutChecked = true;
        private bool installing;

        internal InstallerWindow()
        {
            Width = 900;
            Height = 620;
            MinWidth = 900;
            MinHeight = 620;
            ResizeMode = ResizeMode.NoResize;
            WindowStyle = WindowStyle.None;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            Background = Brushes.White;
            Title = "安装 EasyHub";
            UseLayoutRounding = true;
            SnapsToDevicePixels = true;
            ShowInTaskbar = true;
            previousPath = PreviousPath();
            Icon = EmbeddedIcon();
            BuildWindow();
            Closing += (sender, eventArgs) => { if (installing) eventArgs.Cancel = true; };
        }

        private static Brush ColorBrush(string hex)
        {
            var brush = (Brush)new BrushConverter().ConvertFromString(hex);
            brush.Freeze();
            return brush;
        }

        private static ImageSource EmbeddedIcon()
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("EasyHub.Icon"))
            {
                if (stream == null) throw new InvalidOperationException("Missing EasyHub icon");
                var decoder = BitmapDecoder.Create(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
                var icon = decoder.Frames[decoder.Frames.Count - 1];
                icon.Freeze();
                return icon;
            }
        }

        private static T Add<T>(Canvas parent, T child, double x, double y) where T : UIElement
        {
            Canvas.SetLeft(child, x);
            Canvas.SetTop(child, y);
            parent.Children.Add(child);
            return child;
        }

        private static Border Panel(double width, double height, string background, double radius)
        {
            return new Border { Width = width, Height = height, CornerRadius = new CornerRadius(radius),
                Background = ColorBrush(background) };
        }

        private static TextBlock Text(string content, double size, Brush color, FontWeight weight, double width)
        {
            return new TextBlock { Text = content, FontFamily = new FontFamily("Microsoft YaHei UI"), FontSize = size,
                FontWeight = weight, Foreground = color, Width = width, TextWrapping = TextWrapping.Wrap };
        }

        private static Button Action(string label, double width, double height, string background, string foreground, double size)
        {
            var button = new Button { Width = width, Height = height, Content = label,
                Background = ColorBrush(background), Foreground = ColorBrush(foreground),
                FontFamily = new FontFamily("Microsoft YaHei UI"), FontWeight = FontWeights.SemiBold,
                FontSize = size, BorderThickness = new Thickness(0), Cursor = Cursors.Hand };
            var border = new FrameworkElementFactory(typeof(Border));
            border.SetValue(Border.CornerRadiusProperty, new CornerRadius(10));
            border.SetBinding(Border.BackgroundProperty, new Binding("Background") { RelativeSource = RelativeSource.TemplatedParent });
            var content = new FrameworkElementFactory(typeof(ContentPresenter));
            content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            content.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            border.AppendChild(content);
            button.Template = new ControlTemplate(typeof(Button)) { VisualTree = border };
            return button;
        }

        private void BuildWindow()
        {
            var shell = new Border { Width = 900, Height = 620, BorderThickness = new Thickness(1),
                BorderBrush = ColorBrush("#D6E2F3"), Child = root, Background = Brushes.White };
            Content = shell;
            root.Width = 898;
            root.Height = 618;
            root.Background = Brushes.White;
            BuildHeader();
            BuildIllustration();
            BuildForm();
            BuildProgress();
            BuildDone();
            progress.Visibility = Visibility.Collapsed;
            done.Visibility = Visibility.Collapsed;
        }

        private void BuildHeader()
        {
            var header = Add(root, new Canvas { Width = 898, Height = 67, Background = Brushes.White }, 0, 0);
            Add(header, new Border { Width = 898, Height = 1, Background = ColorBrush("#E6EDF7") }, 0, 66);
            Add(header, new Image { Width = 34, Height = 34, Source = Icon }, 25, 16);
            Add(header, Text("EasyHub", 21, Ink, FontWeights.Bold, 125), 71, 18);
            Add(header, new Border { Width = 1, Height = 22, Background = ColorBrush("#D9E3EF") }, 198, 23);
            Add(header, Text("安装程序", 13, ColorBrush("#526989"), FontWeights.SemiBold, 85), 215, 26);
            var minimize = Add(header, Action("—", 34, 34, "#FFFFFF", "#526989", 17), 815, 16);
            var close = Add(header, Action("×", 34, 34, "#FFFFFF", "#526989", 22), 855, 16);
            minimize.Click += (sender, args) => WindowState = WindowState.Minimized;
            close.Click += (sender, args) => { if (!installing) Close(); };
            header.MouseLeftButtonDown += (sender, args) =>
            {
                if (args.ClickCount == 1 && args.OriginalSource == header) DragMove();
            };
        }

        private void BuildIllustration()
        {
            var left = Add(root, new Canvas { Width = 370, Height = 551, ClipToBounds = true }, 0, 67);
            var gradient = new LinearGradientBrush { StartPoint = new Point(0, 0), EndPoint = new Point(1, 1) };
            gradient.GradientStops.Add(new GradientStop((Color)ColorConverter.ConvertFromString("#102C55"), 0));
            gradient.GradientStops.Add(new GradientStop((Color)ColorConverter.ConvertFromString("#2361AC"), 1));
            left.Background = gradient;
            Add(left, new System.Windows.Shapes.Ellipse { Width = 370, Height = 370,
                Stroke = ColorBrush("#315483"), StrokeThickness = 1 }, 166, -188);
            Add(left, new System.Windows.Shapes.Ellipse { Width = 290, Height = 290,
                Stroke = ColorBrush("#315483"), StrokeThickness = 1 }, 235, -115);
            Add(left, Text("WELCOME TO EASYHUB", 11, ColorBrush("#91C7FF"), FontWeights.Bold, 300), 34, 54);
            Add(left, Text("让创作，\n轻松开始。", 42, Brushes.White, FontWeights.Bold, 320), 34, 108);
            Add(left, Text("把项目和灵感带到 GitHub，\n无需记住复杂的命令。", 14,
                ColorBrush("#C9DEF9"), FontWeights.Normal, 306), 34, 237);

            var projectCard = Panel(295, 120, "#EAF3FF", 16);
            projectCard.RenderTransform = new RotateTransform(-4, 148, 60);
            Add(left, projectCard, 35, 342);
            var card = new Canvas { Width = 295, Height = 120 };
            projectCard.Child = card;
            Add(card, new Border { Width = 295, Height = 1, Background = ColorBrush("#CEDFF0") }, 0, 24);
            Add(card, Text("●  ●  ●", 8, ColorBrush("#BED3E9"), FontWeights.Normal, 80), 12, 5);
            Add(card, new Image { Width = 44, Height = 44, Source = Icon }, 18, 48);
            Add(card, Text("EasyHub", 17, Ink, FontWeights.Bold, 130), 74, 49);
            Add(card, Text("你的项目空间", 11, ColorBrush("#758BAA"), FontWeights.Normal, 130), 74, 75);
            var tick = Panel(27, 27, "#E0F8EA", 14);
            tick.Child = new TextBlock { Text = "✓", FontSize = 21, FontWeight = FontWeights.Bold,
                Foreground = ColorBrush("#18A568"), TextAlignment = TextAlignment.Center };
            Add(card, tick, 244, 55);
            Add(left, Text("01   ───   02   ───   03", 10, ColorBrush("#91C7FF"), FontWeights.Bold, 180), 34, 518);
            Add(left, Text("选择位置  ·  安装  ·  开始创作", 10,
                ColorBrush("#ABC9ED"), FontWeights.Normal, 180), 188, 518);
        }

        private void AddRightCanvas(Canvas canvas)
        {
            canvas.Width = 528;
            canvas.Height = 551;
            Add(root, canvas, 370, 67);
        }

        private void BuildForm()
        {
            AddRightCanvas(form);
            Add(form, Text("01 / 03 · 准备安装", 11, Blue, FontWeights.Bold, 350), 54, 59);
            Add(form, Text("安装 EasyHub", 32, Ink, FontWeights.Bold, 420), 54, 89);
            Add(form, Text("选择保存位置，剩下的交给 EasyHub。", 14, Muted, FontWeights.Normal, 422), 54, 149);
            Add(form, Text("安装位置", 13, ColorBrush("#2C4261"), FontWeights.Bold, 300), 54, 211);
            var pathBox = Panel(422, 50, "#FBFDFF", 12);
            pathBox.BorderBrush = ColorBrush("#D4E0EE");
            pathBox.BorderThickness = new Thickness(1);
            Add(form, pathBox, 54, 238);
            pathInput.Width = 307;
            pathInput.Height = 35;
            pathInput.BorderThickness = new Thickness(0);
            pathInput.Background = Brushes.Transparent;
            pathInput.FontFamily = new FontFamily("Microsoft YaHei UI");
            pathInput.FontSize = 13;
            pathInput.Foreground = ColorBrush("#1D3554");
            pathInput.VerticalContentAlignment = VerticalAlignment.Center;
            Add(form, pathInput, 67, 245);
            var browse = Add(form, Action("选择文件夹", 91, 35, "#EAF3FF", "#246CCE", 12), 378, 245);
            browse.Click += BrowseClick;
            pathInput.Text = string.IsNullOrEmpty(previousPath) ? PreferredPath() : previousPath;
            pathHint.Text = string.IsNullOrEmpty(previousPath)
                ? "首次安装优先选择其他固定磁盘，安装时会自动创建 EasyHub 文件夹。"
                : "已找到之前的安装位置，将继续安装到同一位置。";
            pathHint.FontSize = 11;
            pathHint.Foreground = ColorBrush("#8B9AB0");
            pathHint.Width = 422;
            Add(form, pathHint, 54, 298);

            shortcutBox.Width = 422;
            shortcutBox.Height = 72;
            shortcutBox.CornerRadius = new CornerRadius(13);
            shortcutBox.BorderThickness = new Thickness(1);
            shortcutBox.BorderBrush = ColorBrush("#A9C9F3");
            shortcutBox.Background = ColorBrush("#FBFDFF");
            shortcutBox.Cursor = Cursors.Hand;
            shortcutBox.Focusable = true;
            var shortcutContent = new Canvas { Width = 420, Height = 70 };
            shortcutBox.Child = shortcutContent;
            var box = Panel(20, 20, "#287AF0", 5);
            shortcutMark.Text = "✓";
            shortcutMark.FontSize = 16;
            shortcutMark.FontWeight = FontWeights.Bold;
            shortcutMark.Foreground = Brushes.White;
            shortcutMark.TextAlignment = TextAlignment.Center;
            box.Child = shortcutMark;
            Add(shortcutContent, box, 17, 24);
            Add(shortcutContent, Text("创建桌面快捷方式", 13,
                ColorBrush("#233C5E"), FontWeights.Bold, 335), 52, 17);
            Add(shortcutContent, Text("以后可以从桌面快速打开 EasyHub", 11,
                ColorBrush("#8B9BB2"), FontWeights.Normal, 335), 52, 39);
            shortcutBox.MouseLeftButtonUp += (sender, args) => { shortcutChecked = !shortcutChecked; UpdateShortcut(box); };
            shortcutBox.KeyDown += (sender, args) =>
            {
                if (args.Key == Key.Space || args.Key == Key.Enter)
                {
                    shortcutChecked = !shortcutChecked;
                    UpdateShortcut(box);
                    args.Handled = true;
                }
            };
            Add(form, shortcutBox, 54, 338);
            errorText.FontSize = 11;
            errorText.Foreground = ColorBrush("#BD3D4F");
            errorText.Width = 422;
            errorText.TextWrapping = TextWrapping.Wrap;
            errorText.Visibility = Visibility.Collapsed;
            Add(form, errorText, 54, 416);
            var install = Add(form, Action("开始安装   →", 422, 49, "#287AF0", "#FFFFFF", 14), 54, 444);
            install.Click += InstallClick;
            Add(form, Text("安装不会更改你已经保存在 GitHub 的项目。", 11,
                ColorBrush("#A0ACC0"), FontWeights.Normal, 422), 130, 509);
        }

        private void UpdateShortcut(Border box)
        {
            box.Background = shortcutChecked ? Blue : Brushes.White;
            box.BorderThickness = shortcutChecked ? new Thickness(0) : new Thickness(1);
            box.BorderBrush = ColorBrush("#B4C4D7");
            shortcutMark.Visibility = shortcutChecked ? Visibility.Visible : Visibility.Hidden;
            shortcutBox.BorderBrush = shortcutChecked ? ColorBrush("#A9C9F3") : ColorBrush("#E0E9F3");
        }

        private void BuildProgress()
        {
            AddRightCanvas(progress);
            Add(progress, Text("02 / 03 · 正在安装", 11, Blue, FontWeights.Bold, 350), 54, 59);
            var iconBox = Panel(90, 90, "#E9F3FF", 24);
            iconBox.Child = new Image { Width = 63, Height = 63, Source = Icon };
            Add(progress, iconBox, 219, 160);
            Add(progress, Text("正在安装 EasyHub", 29, Ink, FontWeights.Bold, 422), 116, 277);
            progressText.Text = "正在准备安装文件…";
            progressText.FontSize = 14;
            progressText.Foreground = Muted;
            progressText.TextAlignment = TextAlignment.Center;
            progressText.Width = 422;
            Add(progress, progressText, 54, 333);
            Add(progress, Panel(422, 8, "#E9F0FA", 4), 54, 394);
            var indicator = Add(progress, Panel(120, 8, "#287AF0", 4), 54, 394);
            var animation = new DoubleAnimation(0, 302, TimeSpan.FromSeconds(1.7));
            animation.AutoReverse = true;
            animation.RepeatBehavior = RepeatBehavior.Forever;
            var transform = new TranslateTransform();
            indicator.RenderTransform = transform;
            transform.BeginAnimation(TranslateTransform.XProperty, animation);
            Add(progress, Text("安装期间请保持窗口打开。", 11,
                ColorBrush("#A0ACC0"), FontWeights.Normal, 300), 163, 438);
        }

        private void BuildDone()
        {
            AddRightCanvas(done);
            Add(done, Text("03 / 03 · 安装完成", 11, Blue, FontWeights.Bold, 350), 54, 59);
            var iconBox = Panel(90, 90, "#E4F8EC", 24);
            iconBox.Child = new TextBlock { Text = "✓", FontSize = 52, FontWeight = FontWeights.Bold,
                Foreground = ColorBrush("#13A56C"), TextAlignment = TextAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center };
            Add(done, iconBox, 219, 160);
            Add(done, Text("一切准备好了", 29, Ink, FontWeights.Bold, 422), 151, 276);
            Add(done, Text("EasyHub 已安装到这台电脑。", 14, Muted,
                FontWeights.Normal, 422), 156, 333);
            installedPath.FontSize = 12;
            installedPath.Foreground = ColorBrush("#627996");
            installedPath.Width = 390;
            installedPath.TextAlignment = TextAlignment.Center;
            installedPath.TextWrapping = TextWrapping.Wrap;
            Add(done, installedPath, 69, 382);
            var open = Add(done, Action("打开 EasyHub   →", 422, 49, "#287AF0", "#FFFFFF", 14), 54, 443);
            open.Click += (sender, args) =>
            {
                try
                {
                    Process.Start(new ProcessStartInfo(Path.Combine(chosenPath, "EasyHub.exe"))
                    { WorkingDirectory = chosenPath, UseShellExecute = true });
                    Close();
                }
                catch { MessageBox.Show("无法打开 EasyHub，请从安装文件夹重新启动。", "EasyHub"); }
            };
            var later = Add(done, Action("稍后打开", 160, 35, "#FFFFFF", "#627996", 12), 184, 507);
            later.Click += (sender, args) => Close();
        }

        private void BrowseClick(object sender, RoutedEventArgs args)
        {
            using (var picker = new System.Windows.Forms.FolderBrowserDialog())
            {
                picker.Description = "选择 EasyHub 的安装位置";
                picker.ShowNewFolderButton = true;
                if (Directory.Exists(pathInput.Text)) picker.SelectedPath = pathInput.Text;
                if (picker.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                {
                    pathInput.Text = picker.SelectedPath;
                    ShowError("");
                }
            }
        }

        private async void InstallClick(object sender, RoutedEventArgs args)
        {
            if (installing) return;
            string destination;
            try
            {
                destination = TargetPath(pathInput.Text, previousPath);
                if (Directory.Exists(destination) &&
                    !string.Equals(destination, previousPath, StringComparison.OrdinalIgnoreCase) &&
                    !File.Exists(Path.Combine(destination, "EasyHub.exe")))
                {
                    using (var entries = Directory.EnumerateFileSystemEntries(destination).GetEnumerator())
                    {
                        if (entries.MoveNext()) throw new InvalidOperationException("这个文件夹已有其他内容，请选择空文件夹。");
                    }
                }
            }
            catch (Exception error)
            {
                ShowError(error is InvalidOperationException ? error.Message : "请选择有效的安装位置。");
                return;
            }
            installing = true;
            ShowError("");
            form.Visibility = Visibility.Collapsed;
            progress.Visibility = Visibility.Visible;
            try
            {
                progressText.Text = "正在准备安装文件…";
                var shortcut = shortcutChecked;
                await Task.Run(() => InstallCore(destination, shortcut));
                chosenPath = destination;
                installedPath.Text = destination;
                progress.Visibility = Visibility.Collapsed;
                done.Visibility = Visibility.Visible;
            }
            catch
            {
                progress.Visibility = Visibility.Collapsed;
                form.Visibility = Visibility.Visible;
                ShowError("安装没有完成，请检查磁盘空间或安装位置后重试。");
            }
            finally { installing = false; }
        }

        private void ShowError(string message)
        {
            errorText.Text = message;
            errorText.Visibility = string.IsNullOrEmpty(message) ? Visibility.Collapsed : Visibility.Visible;
        }

        private static void InstallCore(string destination, bool desktopShortcut)
        {
            var temporary = Path.Combine(Path.GetTempPath(), "EasyHubInstaller", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temporary);
            var core = Path.Combine(temporary, "core-installer.exe");
            try
            {
                using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("EasyHub.CoreInstaller"))
                {
                    if (source == null) throw new InvalidOperationException("Missing installer payload");
                    using (var target = new FileStream(core, FileMode.CreateNew, FileAccess.Write, FileShare.None)) source.CopyTo(target);
                }
                var start = new ProcessStartInfo(core)
                {
                    Arguments = "/S" + (desktopShortcut ? "" : " /NO_DESKTOP_SHORTCUT=1") + " /D=" + destination,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = temporary
                };
                using (var process = Process.Start(start))
                {
                    if (process == null) throw new InvalidOperationException("Cannot start installer");
                    process.WaitForExit();
                    if (process.ExitCode != 0) throw new InvalidOperationException("Installer exited with error");
                }
                if (!File.Exists(Path.Combine(destination, "EasyHub.exe")))
                    throw new InvalidOperationException("Installed application was not found");
            }
            finally
            {
                try { Directory.Delete(temporary, true); } catch { /* Windows may still be releasing the executable. */ }
            }
        }

        private static string PreviousPath()
        {
            foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                try
                {
                    using (var key = hive.OpenSubKey(RegistryKey))
                    {
                        var value = key == null ? null : key.GetValue("InstallLocation") as string;
                        if (!string.IsNullOrWhiteSpace(value)) return value.Trim();
                    }
                }
                catch { /* A missing or unreadable registry entry means first install. */ }
            }
            return "";
        }

        private static string PreferredPath()
        {
            foreach (var letter in new[] { "D:\\", "E:\\", "F:\\" })
            {
                try
                {
                    var drive = new DriveInfo(letter);
                    if (drive.IsReady && drive.DriveType == DriveType.Fixed) return Path.Combine(letter, "EasyHub");
                }
                catch { /* Try the next fixed drive. */ }
            }
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "EasyHub");
        }

        private static string TargetPath(string value, string previous)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Length > 240 ||
                !Regex.IsMatch(value, @"^[A-Za-z]:\\") || value.IndexOf('"') >= 0)
                throw new InvalidOperationException("请选择有效的安装位置。");
            var full = Path.GetFullPath(value.Trim()).TrimEnd(Path.DirectorySeparatorChar);
            var root = Path.GetPathRoot(full).TrimEnd(Path.DirectorySeparatorChar);
            if (string.Equals(full, root, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("请在磁盘中选择文件夹。");
            if (string.Equals(full, previous.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) return full;
            if (string.Equals(Path.GetFileName(full), "EasyHub", StringComparison.OrdinalIgnoreCase) ||
                File.Exists(Path.Combine(full, "EasyHub.exe"))) return full;
            return Path.Combine(full, "EasyHub");
        }

        internal void SaveScreenshot(string filename)
        {
            root.Measure(new Size(898, 618));
            root.Arrange(new Rect(0, 0, 898, 618));
            root.UpdateLayout();
            var bitmap = new RenderTargetBitmap(898, 618, 96, 96, PixelFormats.Pbgra32);
            bitmap.Render(root);
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(bitmap));
            using (var file = new FileStream(filename, FileMode.Create, FileAccess.Write)) encoder.Save(file);
        }
    }
}
