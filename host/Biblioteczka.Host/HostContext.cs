using System.Diagnostics;

namespace Biblioteczka.Host;

/// <summary>
/// Prototype application: runs the Node server, shows the wallpaper behind the desktop icons on the
/// primary monitor, forwards the mouse, pauses under fullscreen apps and survives Explorer restarts.
/// </summary>
internal sealed class HostContext : ApplicationContext
{
    private readonly HostOptions _options;
    private readonly NodeServer _server;
    private readonly ShellWindow _shell = new();
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _watchdog = new() { Interval = 1000 };
    private readonly int _ownProcessId = Environment.ProcessId;
    private WallpaperWindow? _wallpaper;
    private DesktopLayer.Target? _target;
    private bool _rebuilding, _exiting;

    public HostContext(HostOptions options)
    {
        _options = options;
        _server = new NodeServer(options);
        _ = new MouseForwarder(_shell, () => _wallpaper);
        _shell.ExplorerRestarted += () =>
        {
            Log.Info("Explorer restarted (TaskbarCreated).");
            // The watchdog usually rebuilds first; only rebuild if the wallpaper is still not attached.
            if (!IsAttached()) _ = RebuildWallpaperAsync();
        };
        _server.Restarted += () => _shell_Invoke(() => _wallpaper?.Reload());
        _server.GaveUp += () => _shell_Invoke(() =>
            _tray?.ShowBalloonTip(5000, "Biblioteczka", "Serwer kolekcji przestał działać. Uruchom aplikację ponownie.", ToolTipIcon.Error));

        var menu = new ContextMenuStrip();
        menu.Items.Add("Otwórz panel", null, (_, _) => OpenPanel());
        menu.Items.Add("Przeładuj tapetę", null, (_, _) => _ = RebuildWallpaperAsync());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Zamknij", null, (_, _) => _ = ExitAsync());
        _tray = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "Biblioteczka (prototyp hosta)",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _tray.DoubleClick += (_, _) => OpenPanel();
        _watchdog.Tick += (_, _) => Watch();
        _ = StartAsync();
    }

    private readonly SynchronizationContext _ui = SynchronizationContext.Current
        ?? throw new InvalidOperationException("UI synchronization context required.");

    private void _shell_Invoke(Action action) => _ui.Post(_ => action(), null);

    private async Task StartAsync()
    {
        try
        {
            await _server.StartAsync();
            await RebuildWallpaperAsync();
            _watchdog.Start();
        }
        catch (Exception error)
        {
            Log.Error("Startup failed", error);
            MessageBox.Show("Nie udało się uruchomić Biblioteczki:\n" + error.Message, "Biblioteczka",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            await ExitAsync();
        }
    }

    private async Task RebuildWallpaperAsync()
    {
        if (_rebuilding || _exiting) return;
        _rebuilding = true;
        try
        {
            var old = _wallpaper;
            _wallpaper = null;
            _target = null;
            try
            {
                old?.Dispose();
            }
            catch (Exception error)
            {
                // After Explorer dies, the window and WebView2 may already be half torn down.
                Log.Info("Old wallpaper was already torn down: " + error.Message);
            }
            // Explorer may still be starting after a restart; wait for the desktop to exist.
            for (var attempt = 0; attempt < 20 && DesktopLayer.Find() is null; attempt++) await Task.Delay(500);
            var bounds = Screen.PrimaryScreen?.Bounds ?? throw new InvalidOperationException("Brak monitora.");
            var userData = Path.Combine(Path.GetDirectoryName(_options.LogFile)!, "host-webview2");
            var wallpaper = new WallpaperWindow(_options.Origin + "/wallpaper", userData, bounds);
            wallpaper.Show();
            _target = DesktopLayer.Attach(wallpaper.Handle, bounds);
            _wallpaper = wallpaper;
            await wallpaper.InitializeAsync();
        }
        catch (Exception error)
        {
            Log.Error("Creating the wallpaper failed", error);
        }
        finally
        {
            _rebuilding = false;
        }
    }

    private bool IsAttached() =>
        _wallpaper is { IsDisposed: false, IsHandleCreated: true } wallpaper && _target is not null &&
        Native.IsWindow(_target.Parent) && Native.GetAncestor(wallpaper.Handle, 1 /* GA_PARENT */) == _target.Parent;

    private IntPtr _lastForeground;

    private void Watch()
    {
        if (_rebuilding || _exiting) return;
        if (!IsAttached())
        {
            Log.Info("Wallpaper lost its desktop parent; rebuilding.");
            _ = RebuildWallpaperAsync();
            return;
        }

        var wallpaper = _wallpaper!;
        var foreground = Native.GetForegroundWindow();
        if (foreground == IntPtr.Zero) return;
        Native.GetWindowThreadProcessId(foreground, out var pid);
        var windowClass = Native.ClassName(foreground);
        Native.GetWindowRect(foreground, out var rect);
        var monitor = Native.MonitorBounds(foreground);
        var covered = pid != _ownProcessId && Native.IsWindowVisible(foreground) &&
            FullscreenRule.CoversWallpaper(windowClass, rect.ToRectangle(), monitor, wallpaper.ScreenBounds);
        if (foreground != _lastForeground)
        {
            // Diagnostics only: window class and geometry, never titles.
            _lastForeground = foreground;
            Log.Info($"Foreground {windowClass} rect {rect.ToRectangle()} monitor {monitor} covers={covered}");
        }
        if (covered) _ = wallpaper.PauseAsync();
        else wallpaper.Resume();
    }

    private void OpenPanel()
    {
        try
        {
            Process.Start(new ProcessStartInfo(_options.Origin + "/manager") { UseShellExecute = true });
        }
        catch (Exception error)
        {
            Log.Error("Opening the panel failed", error);
        }
    }

    private async Task ExitAsync()
    {
        if (_exiting) return;
        _exiting = true;
        _watchdog.Stop();
        _tray.Visible = false;
        _wallpaper?.Dispose();
        _wallpaper = null;
        await _server.StopAsync();
        _server.Dispose();
        _shell.Dispose();
        _tray.Dispose();
        Log.Info("Host exited.");
        ExitThread();
    }
}
