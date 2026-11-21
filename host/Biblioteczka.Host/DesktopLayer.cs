namespace Biblioteczka.Host;

/// <summary>
/// Places a window between the desktop wallpaper and the desktop icons.
///
/// Sending 0x052C to Progman asks Explorer to create a WorkerW window for animated wallpapers.
/// Two layouts exist:
/// <list type="bullet">
/// <item>Classic (Windows 10, Windows 11 before 24H2): SHELLDLL_DefView (icons) lives in a top-level
/// WorkerW; the wallpaper WorkerW is the next top-level WorkerW. We become its child.</item>
/// <item>Raised desktop (Windows 11 24H2+): SHELLDLL_DefView and the WorkerW are children of Progman.
/// We become a child of Progman, ordered below the icons and above the WorkerW.</item>
/// </list>
/// The approach follows Lively Wallpaper (GPL-3.0, rocksdanister), reimplemented here.
/// </summary>
internal static class DesktopLayer
{
    internal enum Layout { Classic, Raised }

    internal sealed record Target(Layout Layout, IntPtr Parent, IntPtr Icons, IntPtr WorkerW);

    public static Target? Find()
    {
        var progman = Native.FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return null;
        Native.SendMessageTimeout(progman, Native.WM_SPAWN_WORKERW, (IntPtr)0xD, (IntPtr)1, Native.SMTO_NORMAL, 1000, out _);
        Native.SendMessageTimeout(progman, Native.WM_SPAWN_WORKERW, IntPtr.Zero, IntPtr.Zero, Native.SMTO_NORMAL, 1000, out _);

        var raisedIcons = Native.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        var raisedWorker = Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        if (raisedIcons != IntPtr.Zero && raisedWorker != IntPtr.Zero)
            return new Target(Layout.Raised, progman, raisedIcons, raisedWorker);

        IntPtr icons = IntPtr.Zero, worker = IntPtr.Zero;
        Native.EnumWindows((top, _) =>
        {
            var view = Native.FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (view == IntPtr.Zero) return true;
            icons = view;
            worker = Native.FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
            return false;
        }, IntPtr.Zero);
        return worker == IntPtr.Zero ? null : new Target(Layout.Classic, worker, icons, worker);
    }

    /// <summary>Re-parents <paramref name="window"/> into the desktop layer covering <paramref name="screenBounds"/>.</summary>
    public static Target? Attach(IntPtr window, Rectangle screenBounds)
    {
        var target = Find();
        if (target is null)
        {
            Log.Error("Desktop layer not found (Progman/WorkerW missing).");
            return null;
        }

        var style = (long)Native.GetWindowLongPtr(window, Native.GWL_STYLE);
        style = (style & ~(Native.WS_POPUP | Native.WS_CAPTION | Native.WS_THICKFRAME)) | Native.WS_CHILD | Native.WS_VISIBLE;
        Native.SetWindowLongPtr(window, Native.GWL_STYLE, (IntPtr)style);
        var exStyle = (long)Native.GetWindowLongPtr(window, Native.GWL_EXSTYLE);
        exStyle = (exStyle & ~Native.WS_EX_APPWINDOW) | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
        Native.SetWindowLongPtr(window, Native.GWL_EXSTYLE, (IntPtr)exStyle);

        if (Native.SetParent(window, target.Parent) == IntPtr.Zero)
        {
            Log.Error("SetParent failed with " + System.Runtime.InteropServices.Marshal.GetLastPInvokeError());
            return null;
        }

        var rect = Native.RECT.From(screenBounds);
        Native.MapWindowPoints(IntPtr.Zero, target.Parent, ref rect, 2);
        var local = rect.ToRectangle();
        if (target.Layout == Layout.Raised)
        {
            // Below the icons, above Explorer's WorkerW.
            Native.SetWindowPos(window, target.Icons, local.X, local.Y, local.Width, local.Height,
                Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW | Native.SWP_FRAMECHANGED);
            Native.SetWindowPos(target.WorkerW, window, 0, 0, 0, 0,
                Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
        }
        else
        {
            Native.SetWindowPos(window, IntPtr.Zero, local.X, local.Y, local.Width, local.Height,
                Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW | Native.SWP_FRAMECHANGED);
        }

        Log.Info($"Attached wallpaper ({target.Layout}) to parent 0x{target.Parent:X} at {local}.");
        return target;
    }

    /// <summary>True when <paramref name="hwnd"/> belongs to Explorer's desktop (icons, Progman, WorkerW).</summary>
    public static bool IsDesktopWindow(IntPtr hwnd) =>
        Native.ClassName(hwnd) is "SysListView32" or "SHELLDLL_DefView" or "WorkerW" or "Progman";
}
