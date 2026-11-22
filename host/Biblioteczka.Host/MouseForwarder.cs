namespace Biblioteczka.Host;

/// <summary>
/// Forwards mouse input to the wallpaper while the cursor is over the bare desktop. The desktop icon
/// layer sits above the wallpaper and receives all input, so the page would otherwise never see hover
/// or clicks. Events go through WebView2's DevTools protocol (see <see cref="MouseTranslation"/>),
/// one at a time and in order; consecutive moves are coalesced so the page never lags behind.
/// </summary>
internal sealed class MouseForwarder
{
    private readonly Func<WallpaperWindow?> _wallpaper;
    private readonly MouseTranslation _translation = new();
    private readonly LinkedList<MouseTranslation.CdpMouseEvent> _queue = new();
    private bool _inside, _pumping;

    public MouseForwarder(ShellWindow shell, Func<WallpaperWindow?> wallpaper)
    {
        _wallpaper = wallpaper;
        shell.RawMouse += OnRawMouse;
    }

    private void OnRawMouse(ushort flags, ushort data)
    {
        var wallpaper = _wallpaper();
        if (wallpaper is null || wallpaper.IsPaused || !wallpaper.IsReady || !Native.GetCursorPos(out var screen)) return;
        var over = wallpaper.ScreenBounds.Contains(screen.X, screen.Y) && IsDesktopUnder(screen);
        if (!over)
        {
            if (_inside) Enqueue(_translation.Leave());
            _inside = false;
            return;
        }

        _inside = true;
        var scale = wallpaper.DpiScale;
        var x = (screen.X - wallpaper.ScreenBounds.X) / scale;
        var y = (screen.Y - wallpaper.ScreenBounds.Y) / scale;
        foreach (var e in _translation.Translate(flags, data, x, y, DateTime.UtcNow)) Enqueue(e);
    }

    private void Enqueue(MouseTranslation.CdpMouseEvent e)
    {
        // A newer position supersedes a move that has not been sent yet.
        if (e.Type == "mouseMoved" && _queue.Last is { Value.Type: "mouseMoved" } last) last.Value = e;
        else _queue.AddLast(e);
        if (!_pumping) _ = PumpAsync();
    }

    private async Task PumpAsync()
    {
        _pumping = true;
        try
        {
            while (_queue.First is { } first)
            {
                _queue.RemoveFirst();
                var wallpaper = _wallpaper();
                if (wallpaper is null || !wallpaper.IsReady) { _queue.Clear(); break; }
                try
                {
                    await wallpaper.DispatchMouseAsync(first.Value.ToJson());
                }
                catch (Exception error)
                {
                    Log.Error("Mouse dispatch failed", error);
                    _queue.Clear();
                }
            }
        }
        finally
        {
            _pumping = false;
        }
    }

    private static bool IsDesktopUnder(Native.POINT screen)
    {
        var hwnd = Native.WindowFromPoint(screen);
        if (hwnd == IntPtr.Zero) return false;
        return DesktopLayer.IsDesktopWindow(hwnd) || DesktopLayer.IsDesktopWindow(Native.GetAncestor(hwnd, Native.GA_ROOT));
    }
}
