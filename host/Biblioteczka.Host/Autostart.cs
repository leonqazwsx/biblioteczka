using Microsoft.Win32;

namespace Biblioteczka.Host;

/// <summary>
/// Start-with-Windows for the unpackaged app, through the current user's Run key.
/// (The Microsoft Store package will use an MSIX StartupTask instead.)
/// </summary>
internal sealed class Autostart(string valueName, string executable, string runKeyPath = Autostart.RunKey)
{
    public const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    internal sealed record Status(bool Supported, bool Autostart, bool Conflict, bool CanEnable, string? Message);

    public static Autostart For(HostOptions options) =>
        new(options.Development ? "Biblioteczka (dev)" : "Biblioteczka", options.ExecutablePath);

    public string Command => "\"" + executable + "\" --autostart";

    public Status Read()
    {
        using var key = Registry.CurrentUser.OpenSubKey(runKeyPath);
        var current = key?.GetValue(valueName) as string;
        if (current is null)
            return new Status(true, false, false, true, LegacyShortcutMessage());
        var ours = string.Equals(current, Command, StringComparison.OrdinalIgnoreCase);
        return ours
            ? new Status(true, true, false, true, null)
            : new Status(true, false, true, false,
                "Autostart wskazuje inną kopię Biblioteczki. Wyłącz go tam albo usuń wpis „" + valueName + "” w Menedżerze zadań → Aplikacje autostartu.");
    }

    public Status Set(bool enabled)
    {
        var status = Read();
        if (status.Conflict) return status;
        using var key = Registry.CurrentUser.CreateSubKey(runKeyPath);
        if (enabled) key.SetValue(valueName, Command, RegistryValueKind.String);
        else key.DeleteValue(valueName, throwOnMissingValue: false);
        return Read();
    }

    /// <summary>The previous PowerShell version could add a shortcut to the Startup folder.</summary>
    private static string? LegacyShortcutMessage()
    {
        var startup = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
        return Directory.Exists(startup) && Directory.EnumerateFiles(startup, "Biblioteczka*.lnk").Any()
            ? "W folderze Autostart jest skrót starej wersji Biblioteczki. Usuń go, żeby po zalogowaniu nie uruchamiały się obie."
            : null;
    }
}
