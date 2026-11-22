using System.Text.Json;

namespace Biblioteczka.Host;

/// <summary>
/// Turns raw-input mouse events into Chrome DevTools Protocol <c>Input.dispatchMouseEvent</c> calls.
///
/// Posting WM_MOUSEMOVE to WebView2 does not keep CSS :hover, because Chromium asks Windows to track the
/// cursor, Windows sees it over the desktop icons and immediately reports WM_MOUSELEAVE. Events injected
/// through DevTools do not depend on the real cursor, so hover, clicks and the wheel behave normally.
/// Pure logic, unit tested.
/// </summary>
internal sealed class MouseTranslation
{
    internal readonly record struct CdpMouseEvent(
        string Type, double X, double Y, string Button, int Buttons, int ClickCount = 0, double DeltaY = 0)
    {
        public string ToJson() => JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["type"] = Type,
            ["x"] = X,
            ["y"] = Y,
            ["button"] = Button,
            ["buttons"] = Buttons,
            ["clickCount"] = ClickCount,
            ["deltaX"] = 0,
            ["deltaY"] = DeltaY,
        });
    }

    private const int Left = 1, Right = 2, Middle = 4;
    private static readonly TimeSpan DoubleClickTime = TimeSpan.FromMilliseconds(500);
    private int _buttons;
    private (string Button, double X, double Y, DateTime At, int Count)? _lastPress;

    public int Buttons => _buttons;

    /// <summary>Events for one raw-input notification at page coordinates (CSS pixels).</summary>
    public List<CdpMouseEvent> Translate(ushort flags, ushort data, double x, double y, DateTime now)
    {
        var events = new List<CdpMouseEvent> { new("mouseMoved", x, y, HeldButton(), _buttons) };
        void Button(ushort down, ushort up, int mask, string name)
        {
            if ((flags & down) != 0)
            {
                _buttons |= mask;
                var count = _lastPress is { } last && last.Button == name && now - last.At <= DoubleClickTime &&
                    Math.Abs(last.X - x) <= 4 && Math.Abs(last.Y - y) <= 4 ? last.Count + 1 : 1;
                _lastPress = (name, x, y, now, count);
                events.Add(new CdpMouseEvent("mousePressed", x, y, name, _buttons, count));
            }
            if ((flags & up) != 0)
            {
                _buttons &= ~mask;
                var count = _lastPress is { } last && last.Button == name ? last.Count : 1;
                events.Add(new CdpMouseEvent("mouseReleased", x, y, name, _buttons, count));
            }
        }

        Button(Native.RI_MOUSE_LEFT_BUTTON_DOWN, Native.RI_MOUSE_LEFT_BUTTON_UP, Left, "left");
        Button(Native.RI_MOUSE_RIGHT_BUTTON_DOWN, Native.RI_MOUSE_RIGHT_BUTTON_UP, Right, "right");
        Button(Native.RI_MOUSE_MIDDLE_BUTTON_DOWN, Native.RI_MOUSE_MIDDLE_BUTTON_UP, Middle, "middle");
        if ((flags & Native.RI_MOUSE_WHEEL) != 0)
            // Windows: positive delta scrolls up. DevTools: positive deltaY scrolls down.
            events.Add(new CdpMouseEvent("mouseWheel", x, y, "none", _buttons, 0, -unchecked((short)data)));
        return events;
    }

    /// <summary>Moves the page's pointer outside the viewport so :hover clears, and forgets held buttons.</summary>
    public CdpMouseEvent Leave()
    {
        _buttons = 0;
        _lastPress = null;
        return new CdpMouseEvent("mouseMoved", -10, -10, "none", 0);
    }

    private string HeldButton() =>
        (_buttons & Left) != 0 ? "left" : (_buttons & Right) != 0 ? "right" : (_buttons & Middle) != 0 ? "middle" : "none";
}
