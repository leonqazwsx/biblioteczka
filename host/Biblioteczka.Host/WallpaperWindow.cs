using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Biblioteczka.Host;

/// <summary>Borderless window that shows the wallpaper page and lives inside the desktop layer.</summary>
internal sealed class WallpaperWindow : Form
{
    private readonly string _url;
    private readonly CoreWebView2Environment _environment;
    private readonly Rectangle _bounds;
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
    private bool _paused;

    public WallpaperWindow(string url, CoreWebView2Environment environment, Rectangle screenBounds)
    {
        _url = url;
        _environment = environment;
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

    /// <summary>True once the page loaded and can receive input.</summary>
    public bool IsReady { get; private set; }

    /// <summary>Physical pixels per CSS pixel on this monitor.</summary>
    public double DpiScale => DeviceDpi / 96.0;

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
        await _web.EnsureCoreWebView2Async(_environment);
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
            IsReady = e.IsSuccess;
        };
        _web.CoreWebView2.Navigate(_url);
    }

    public void Reload()
    {
        if (!IsDisposed && _web.CoreWebView2 is not null) _web.CoreWebView2.Reload();
    }

    /// <summary>Injects one DevTools <c>Input.dispatchMouseEvent</c> call. Must run on the UI thread.</summary>
    public Task DispatchMouseAsync(string parametersJson) =>
        IsDisposed || _web.CoreWebView2 is null
            ? Task.CompletedTask
            : _web.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", parametersJson);

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
