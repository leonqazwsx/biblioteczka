using System.Diagnostics;
using Microsoft.Web.WebView2.Core;

namespace Biblioteczka.Host;

/// <summary>
/// The running application: Node server, wallpaper behind the desktop icons on the primary monitor,
/// collection panel window and tray icon. Pauses under fullscreen apps and survives Explorer restarts.
/// </summary>
internal sealed class HostContext : ApplicationContext
{
    private readonly HostOptions _options;
    private readonly bool _openPanelOnStart;
    private readonly NodeServer _server;
    private readonly ShellWindow _shell;
    private readonly NotifyIcon _tray;
    private readonly Icon _icon = LoadIcon();
    private readonly ToolStripMenuItem _autostartItem;
    private readonly System.Windows.Forms.Timer _watchdog = new() { Interval = 1000 };
    private readonly int _ownProcessId = Environment.ProcessId;
    private readonly SynchronizationContext _ui = SynchronizationContext.Current
        ?? throw new InvalidOperationException("UI synchronization context required.");
    private CoreWebView2Environment? _environment;
    private WallpaperWindow? _wallpaper;
    private PanelWindow? _panel;
    private DesktopLayer.Target? _target;
    private IntPtr _lastForeground;
    private int _ticks;
    private bool _rebuilding, _exiting, _ready, _livelyWarned;

    public HostContext(HostOptions options, bool openPanelOnStart)
    {
        _options = options;
        _openPanelOnStart = openPanelOnStart;
        _server = new NodeServer(options);
        _shell = new ShellWindow(options.Port);
        _ = new MouseForwarder(_shell, () => _wallpaper);
        _shell.ExplorerRestarted += () =>
        {
            Log.Info("Explorer restarted (TaskbarCreated).");
            if (!IsAttached()) _ = RebuildWallpaperAsync();
        };
        _shell.OpenPanelRequested += OpenPanel;
        _server.Restarted += () => _ui.Post(_ => _wallpaper?.Reload(), null);
        _server.GaveUp += () => _ui.Post(_ =>
            Notify("Serwer kolekcji przestał działać. Zamknij Biblioteczkę i uruchom ją ponownie.", ToolTipIcon.Error), null);

        var menu = new ContextMenuStrip();
        var open = new ToolStripMenuItem("Otwórz Biblioteczkę", null, (_, _) => OpenPanel())
        {
            Font = new Font(menu.Font, FontStyle.Bold),
        };
        _autostartItem = new ToolStripMenuItem("Uruchamiaj z Windows", null, (_, _) => ToggleAutostart());
        menu.Items.Add(open);
        menu.Items.Add("Przeładuj tapetę", null, (_, _) => _ = RebuildWallpaperAsync());
        menu.Items.Add(_autostartItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Skopiuj raport o problemie", null, (_, _) => CopyReport());
        menu.Items.Add("Zamknij Biblioteczkę", null, (_, _) => _ = ExitAsync());
        menu.Opening += (_, _) => _autostartItem.Checked = SafeAutostart()?.Autostart ?? false;
        _tray = new NotifyIcon
        {
            Icon = _icon,
            Text = options.Development ? "Biblioteczka (dev)" : "Biblioteczka",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) OpenPanel(); };
        _watchdog.Tick += (_, _) => Watch();
        _ = StartAsync();
    }

    private static Icon LoadIcon()
    {
        using var stream = typeof(HostContext).Assembly.GetManifestResourceStream("biblioteczka.ico");
        return stream is null ? SystemIcons.Application : new Icon(stream);
    }

    private async Task StartAsync()
    {
        try
        {
            if (!LegacyImport.HasCollection(_options.DataDir)) OfferLegacyImport();
            WarnAboutSyncConflicts();
            await _server.StartAsync();
            _environment = await CoreWebView2Environment.CreateAsync(null, _options.WebViewDataDir);
            await RebuildWallpaperAsync();
            _ready = true;
            _watchdog.Start();
            EnableAutostartOnFirstRun();
            if (_openPanelOnStart) OpenPanel();
        }
        catch (Exception error)
        {
            Log.Error("Startup failed", error);
            var message = error.Message.Contains("zajęty", StringComparison.Ordinal)
                ? "Biblioteczka już działa w innej wersji (na przykład starsza wersja z Lively). Zamknij ją i uruchom tę ponownie."
                : "Nie udało się uruchomić Biblioteczki:\n" + error.Message;
            MessageBox.Show(message, "Biblioteczka", MessageBoxButtons.OK, MessageBoxIcon.Error);
            await ExitAsync();
        }
    }

    private void OfferLegacyImport()
    {
        var found = LegacyImport.Candidates(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)).FirstOrDefault();
        while (true)
        {
            var useFound = found is null ? null : new TaskDialogButton("Skopiuj z: " + found);
            var choose = new TaskDialogButton("Wskaż folder starej wersji…");
            var empty = new TaskDialogButton("Zacznij od pustej kolekcji");
            var page = new TaskDialogPage
            {
                Caption = "Biblioteczka",
                Heading = "Masz kolekcję ze starszej wersji Biblioteczki?",
                Text = "Nowa wersja trzyma kolekcję w folderze " + _options.DataDir +
                    ". Możesz skopiować do niego książki, okładki i ustawienia ze starej wersji. Stara kopia zostanie bez zmian.",
                Icon = TaskDialogIcon.Information,
            };
            if (useFound is not null) page.Buttons.Add(useFound);
            page.Buttons.Add(choose);
            page.Buttons.Add(empty);
            var answer = TaskDialog.ShowDialog(page);
            if (answer == empty) return;

            var source = found;
            if (answer == choose)
            {
                using var dialog = new FolderBrowserDialog { Description = "Wybierz folder starej Biblioteczki (z podfolderem data) albo sam folder data." };
                if (dialog.ShowDialog() != DialogResult.OK) continue;
                source = LegacyImport.ResolveDataDir(dialog.SelectedPath);
                if (source is null)
                {
                    MessageBox.Show("W tym folderze nie ma kolekcji Biblioteczki (library.json).", "Biblioteczka",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    continue;
                }
            }

            if (LegacyImport.IsInUse(source!))
            {
                MessageBox.Show("Stara wersja Biblioteczki wciąż działa. Zamknij ją (ikona w zasobniku → Zamknij) i spróbuj ponownie.",
                    "Biblioteczka", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                continue;
            }

            try
            {
                var files = LegacyImport.Copy(source!, _options.DataDir);
                Log.Info("Imported legacy collection (" + files + " files).");
                return;
            }
            catch (Exception error)
            {
                Log.Error("Legacy import failed", error);
                MessageBox.Show("Nie udało się skopiować kolekcji: " + error.Message, "Biblioteczka",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    /// <summary>OneDrive and similar tools keep both copies of a conflicting file under a new name.</summary>
    private void WarnAboutSyncConflicts()
    {
        if (!Directory.Exists(_options.DataDir)) return;
        var conflicts = Directory.EnumerateFiles(_options.DataDir, "library*.json")
            .Select(Path.GetFileName)
            .Where(name => name is not ("library.json" or "library.backup.json" or "library.schema1.backup.json"))
            .ToList();
        if (conflicts.Count == 0) return;
        Log.Info("Possible sync conflict copies: " + string.Join(", ", conflicts));
        Notify("W folderze kolekcji są kopie konfliktowe (" + string.Join(", ", conflicts) +
            "). Program używa library.json; sprawdź, czy nie zginęły tam zmiany.", ToolTipIcon.Warning);
    }

    private async Task RebuildWallpaperAsync()
    {
        if (_rebuilding || _exiting || _environment is null) return;
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
            var wallpaper = new WallpaperWindow(_options.Origin + "/wallpaper", _environment, bounds);
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

    private void Watch()
    {
        if (_rebuilding || _exiting) return;
        if (++_ticks % 30 == 1) WarnAboutLively();
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

    private void WarnAboutLively()
    {
        if (_livelyWarned) return;
        var running = Process.GetProcessesByName("Lively");
        foreach (var process in running) process.Dispose();
        if (running.Length == 0) return;
        _livelyWarned = true;
        Log.Info("Lively Wallpaper is running.");
        Notify("Lively Wallpaper też jest uruchomione i może zasłaniać tapetę Biblioteczki. Jeśli jej nie widać albo miga, zamknij Lively.",
            ToolTipIcon.Warning);
    }

    private void OpenPanel()
    {
        if (!_ready || _environment is null || _exiting) return;
        if (_panel is { IsDisposed: false })
        {
            _panel.BringToFront(restore: true);
            return;
        }
        _panel = new PanelWindow(_options.Origin, _environment, _icon);
        _panel.FormClosed += (_, _) =>
        {
            _panel?.Dispose();
            _panel = null;
        };
        _panel.Show();
        _panel.Activate();
    }

    private Autostart.Status? SafeAutostart()
    {
        try
        {
            return Autostart.For(_options).Read();
        }
        catch (Exception error)
        {
            Log.Error("Reading autostart failed", error);
            return null;
        }
    }

    /// <summary>
    /// A wallpaper that does not start with Windows leaves an empty desktop after every reboot, so the
    /// installed app turns autostart on once, says so, and never touches it again. Development builds don't.
    /// </summary>
    private void EnableAutostartOnFirstRun()
    {
        if (_options.Development || !new FirstRun(_options.StateDir).TryClaim("autostart-default")) return;
        try
        {
            var status = Autostart.For(_options).Set(true);
            Log.Info("First run: autostart " + (status.Autostart ? "enabled" : "left unchanged (conflict)") + ".");
            var text = status.Autostart
                ? "Biblioteczka będzie się uruchamiać razem z Windows. Zmienisz to w menu tej ikony."
                : "Nie udało się włączyć autostartu.";
            if (status.Message is not null) text += " " + status.Message;
            Notify(text, status.Autostart && status.Message is null ? ToolTipIcon.Info : ToolTipIcon.Warning);
        }
        catch (Exception error)
        {
            Log.Error("Enabling autostart on first run failed", error);
        }
    }

    private void ToggleAutostart()
    {
        try
        {
            var autostart = Autostart.For(_options);
            var status = autostart.Set(!autostart.Read().Autostart);
            if (status.Message is not null) Notify(status.Message, ToolTipIcon.Warning);
        }
        catch (Exception error)
        {
            Log.Error("Changing autostart failed", error);
            Notify("Nie udało się zmienić autostartu: " + error.Message, ToolTipIcon.Error);
        }
    }

    private void CopyReport()
    {
        var report = ProblemReport.Build(_options, _target?.Layout.ToString(), ProblemReport.ReadLogTail(_options.LogFile, 60));
        Clipboard.SetText(report);
        Notify("Raport skopiowany do schowka. Wklej go do zgłoszenia problemu.", ToolTipIcon.Info);
    }

    private void Notify(string text, ToolTipIcon icon) => _tray.ShowBalloonTip(6000, "Biblioteczka", text, icon);

    private async Task ExitAsync()
    {
        if (_exiting) return;
        _exiting = true;
        _watchdog.Stop();
        if (_panel is { IsDisposed: false }) _panel.Dispose();
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
