using System.Runtime.InteropServices;

namespace Biblioteczka.Host;

/// <summary>
/// Hidden top-level window that receives global raw mouse input and Explorer's "TaskbarCreated"
/// broadcast (sent after Explorer restarts). Message-only windows do not receive broadcasts, so this
/// is an invisible ordinary window.
/// </summary>
internal sealed class ShellWindow : NativeWindow, IDisposable
{
    private static readonly uint TaskbarCreated = Native.RegisterWindowMessage("TaskbarCreated");
    private static readonly int HeaderSize = Marshal.SizeOf<Native.RAWINPUTHEADER>();

    /// <summary>Posted by a second launch (or <c>--control open-settings</c>) to show the panel.</summary>
    public const int OpenPanelMessage = 0x8000 + 1; // WM_APP + 1

    /// <summary>Window title other processes use to find the running instance for a given port.</summary>
    public static string CaptionFor(int port) => "Biblioteczka.ShellWindow." + port;

    /// <summary>Asks the instance running on <paramref name="port"/> to open its panel.</summary>
    public static bool SignalOpenPanel(int port)
    {
        var window = Native.FindWindow(null, CaptionFor(port));
        return window != IntPtr.Zero && Native.PostMessage(window, (uint)OpenPanelMessage, IntPtr.Zero, IntPtr.Zero);
    }

    public ShellWindow(int port)
    {
        CreateHandle(new CreateParams { Caption = CaptionFor(port) });
        var device = new Native.RAWINPUTDEVICE
        {
            usUsagePage = 0x01, // generic desktop
            usUsage = 0x02, // mouse
            dwFlags = Native.RIDEV_INPUTSINK,
            hwndTarget = Handle,
        };
        if (!Native.RegisterRawInputDevices([device], 1, (uint)Marshal.SizeOf<Native.RAWINPUTDEVICE>()))
            Log.Error("RegisterRawInputDevices failed with " + Marshal.GetLastPInvokeError());
    }

    /// <summary>Raw mouse event: button flags and button data (wheel delta).</summary>
    public event Action<ushort, ushort>? RawMouse;

    public event Action? ExplorerRestarted;

    public event Action? OpenPanelRequested;

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == (int)Native.WM_INPUT) ReadRawInput(m.LParam);
        else if (m.Msg == OpenPanelMessage) OpenPanelRequested?.Invoke();
        else if (TaskbarCreated != 0 && m.Msg == (int)TaskbarCreated) ExplorerRestarted?.Invoke();
        base.WndProc(ref m);
    }

    private void ReadRawInput(IntPtr handle)
    {
        uint size = 0;
        Native.GetRawInputData(handle, Native.RID_INPUT, IntPtr.Zero, ref size, (uint)HeaderSize);
        if (size == 0 || size > 1024) return;
        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            if (Native.GetRawInputData(handle, Native.RID_INPUT, buffer, ref size, (uint)HeaderSize) != size) return;
            if ((uint)Marshal.ReadInt32(buffer) != Native.RIM_TYPEMOUSE) return;
            // RAWMOUSE: usFlags (2), padding (2), then usButtonFlags (2) and usButtonData (2).
            var flags = (ushort)Marshal.ReadInt16(buffer, HeaderSize + 4);
            var data = (ushort)Marshal.ReadInt16(buffer, HeaderSize + 6);
            RawMouse?.Invoke(flags, data);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public void Dispose() => DestroyHandle();
}
