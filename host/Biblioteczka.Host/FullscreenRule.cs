namespace Biblioteczka.Host;

/// <summary>Decides whether the foreground window hides the wallpaper completely. Pure logic, unit tested.</summary>
internal static class FullscreenRule
{
    private static readonly HashSet<string> ShellClasses =
        ["Progman", "WorkerW", "SHELLDLL_DefView", "SysListView32", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"];

    public static bool CoversWallpaper(string windowClass, Rectangle window, Rectangle monitor, Rectangle wallpaper)
    {
        if (ShellClasses.Contains(windowClass) || window.IsEmpty || monitor.IsEmpty) return false;
        if (monitor != wallpaper) return false;
        return window.Left <= monitor.Left && window.Top <= monitor.Top &&
            window.Right >= monitor.Right && window.Bottom >= monitor.Bottom;
    }
}
