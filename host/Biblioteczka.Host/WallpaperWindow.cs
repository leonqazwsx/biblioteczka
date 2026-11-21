using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Biblioteczka.Host;

/// <summary>Borderless window that shows the wallpaper page and lives inside the desktop layer.</summary>
internal sealed class WallpaperWindow : Form
{
    private readonly string _url;
    private readonly string _userDataFolder;
    private readonly Rectangle _bounds;
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
    private bool _paused;

    public WallpaperWindow(string url, string userDataFolder, Rectangle screenBounds)
    {
        _url = url;
        _userDataFolder = userDataFolder;
        _bounds = screenBounds;
        Text = "Biblioteczka – tapeta";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Bounds = screenBounds;
        BackColor = Color.Black;
        Controls.Add(_web);
    }

    public Rectangle ScreenBounds => _bounds;

    public bool IsPaused => _paused;

    /// <summary>The Chromium child window that receives mouse input, once WebView2 created it.</summary>
    public IntPtr InputWindow { get; private set; }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var p = base.CreateParams;
            p.ExStyle |= (int)(Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE);
            return p;
        }
    }

    public async Task InitializeAsync()
    {
        var environment = await CoreWebView2Environment.CreateAsync(null, _userDataFolder);
        await _web.EnsureCoreWebView2Async(environment);
        var settings = _web.CoreWebView2.Settings;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDevToolsEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsPinchZoomEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        _web.CoreWebView2.NewWindowRequested += (_, e) => e.Handled = true;
        _web.CoreWebView2.NavigationCompleted += (_, e) =>
        {
            Log.Info("Wallpaper navigation " + (e.IsSuccess ? "succeeded" : "failed: " + e.WebErrorStatus));
            InputWindow = FindInputWindow();
        };
        _web.CoreWebView2.Navigate(_url);
    }

    public void Reload()
    {
        if (_web.CoreWebView2 is not null) _web.CoreWebView2.Reload();
    }

    public IntPtr RefreshInputWindow()
    {
        if (InputWindow == IntPtr.Zero || !Native.IsWindow(InputWindow)) InputWindow = FindInputWindow();
        return InputWindow;
    }

    private IntPtr FindInputWindow()
    {
        var found = IntPtr.Zero;
        Native.EnumChildWindows(Handle, (child, _) =>
        {
            if (Native.ClassName(child) != "Chrome_RenderWidgetHostHWND") return true;
            found = child;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    /// <summary>Hides and suspends the page, e.g. while a fullscreen app covers the desktop.</summary>
    public async Task PauseAsync()
    {
        if (_paused || _web.CoreWebView2 is null) return;
        _paused = true;
        _web.Visible = false;
        try
        {
            var suspended = await _web.CoreWebView2.TrySuspendAsync();
            Log.Info("Wallpaper paused (suspended: " + suspended + ").");
        }
        catch (Exception error)
        {
            Log.Error("Suspend failed", error);
        }
    }

    public void Resume()
    {
        if (!_paused || _web.CoreWebView2 is null) return;
        _paused = false;
        _web.CoreWebView2.Resume();
        _web.Visible = true;
        Log.Info("Wallpaper resumed.");
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _web.Dispose();
        base.Dispose(disposing);
    }
}
