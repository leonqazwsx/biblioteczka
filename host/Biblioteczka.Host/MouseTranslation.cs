namespace Biblioteczka.Host;

/// <summary>Translates raw-input mouse button flags into window messages. Pure logic, unit tested.</summary>
internal sealed class MouseTranslation
{
    internal readonly record struct Message(uint Id, int Keys, short WheelDelta = 0);

    private int _keys;

    public int Keys => _keys;

    /// <summary>Returns the messages for one raw-input event. Always ends with nothing or button/wheel messages; moves are separate.</summary>
    public List<Message> Translate(ushort buttonFlags, ushort buttonData)
    {
        var messages = new List<Message>();
        void Button(ushort down, ushort up, int mask, uint downId, uint upId)
        {
            if ((buttonFlags & down) != 0)
            {
                _keys |= mask;
                messages.Add(new Message(downId, _keys));
            }
            if ((buttonFlags & up) != 0)
            {
                _keys &= ~mask;
                messages.Add(new Message(upId, _keys));
            }
        }

        Button(Native.RI_MOUSE_LEFT_BUTTON_DOWN, Native.RI_MOUSE_LEFT_BUTTON_UP, Native.MK_LBUTTON, Native.WM_LBUTTONDOWN, Native.WM_LBUTTONUP);
        Button(Native.RI_MOUSE_RIGHT_BUTTON_DOWN, Native.RI_MOUSE_RIGHT_BUTTON_UP, Native.MK_RBUTTON, Native.WM_RBUTTONDOWN, Native.WM_RBUTTONUP);
        Button(Native.RI_MOUSE_MIDDLE_BUTTON_DOWN, Native.RI_MOUSE_MIDDLE_BUTTON_UP, Native.MK_MBUTTON, Native.WM_MBUTTONDOWN, Native.WM_MBUTTONUP);
        if ((buttonFlags & Native.RI_MOUSE_WHEEL) != 0)
            messages.Add(new Message(Native.WM_MOUSEWHEEL, _keys, unchecked((short)buttonData)));
        return messages;
    }

    /// <summary>Forgets held buttons, e.g. after the cursor left the desktop.</summary>
    public void Reset() => _keys = 0;
}
