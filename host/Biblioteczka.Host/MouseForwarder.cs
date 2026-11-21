namespace Biblioteczka.Host;

/// <summary>
/// Forwards mouse input to the wallpaper while the cursor is over the bare desktop. The desktop icon
/// layer sits above the wallpaper and receives all input, so the page would otherwise never see hover
/// or clicks. Messages are posted to WebView2's Chromium input window, as Lively Wallpaper does.
/// </summary>
internal sealed class MouseForwarder
{
    private readonly Func<WallpaperWindow?> _wallpaper;
    private readonly MouseTranslation _translation = new();
    private bool _inside;

    public MouseForwarder(ShellWindow shell, Func<WallpaperWindow?> wallpaper)
    {
        _wallpaper = wallpaper;
        shell.RawMouse += OnRawMouse;
    }

    private void OnRawMouse(ushort flags, ushort data)
    {
        var wallpaper = _wallpaper();
        if (wallpaper is null || wallpaper.IsPaused || !Native.GetCursorPos(out var screen)) return;
        var target = wallpaper.RefreshInputWindow();
        var over = target != IntPtr.Zero &&
            wallpaper.ScreenBounds.Contains(screen.X, screen.Y) &&
            IsDesktopUnder(screen);
        if (!over)
        {
            if (_inside && target != IntPtr.Zero) Native.PostMessage(target, Native.WM_MOUSELEAVE, IntPtr.Zero, IntPtr.Zero);
            _inside = false;
            _translation.Reset();
            return;
        }

        _inside = true;
        var client = screen;
        Native.ScreenToClient(target, ref client);
        var clientParam = Native.MakeLParam(client.X, client.Y);
        Native.PostMessage(target, Native.WM_MOUSEMOVE, _translation.Keys, clientParam);
        foreach (var message in _translation.Translate(flags, data))
        {
            if (message.Id == Native.WM_MOUSEWHEEL)
                Native.PostMessage(target, message.Id, Native.MakeLParam(message.Keys, message.WheelDelta),
                    Native.MakeLParam(screen.X, screen.Y));
            else
                Native.PostMessage(target, message.Id, message.Keys, clientParam);
        }
    }

    private static bool IsDesktopUnder(Native.POINT screen)
    {
        var hwnd = Native.WindowFromPoint(screen);
        if (hwnd == IntPtr.Zero) return false;
        return DesktopLayer.IsDesktopWindow(hwnd) || DesktopLayer.IsDesktopWindow(Native.GetAncestor(hwnd, Native.GA_ROOT));
    }
}
