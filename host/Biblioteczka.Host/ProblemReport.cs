using System.Reflection;
using System.Text;
using Microsoft.Web.WebView2.Core;

namespace Biblioteczka.Host;

/// <summary>
/// Text the user can paste into a bug report. Technical details only: no book titles, no file paths
/// inside the collection, no account data.
/// </summary>
internal static class ProblemReport
{
    public static string Build(HostOptions options, string? desktopLayout, IEnumerable<string> logTail)
    {
        var text = new StringBuilder();
        text.AppendLine("Biblioteczka – raport o problemie");
        text.AppendLine("Wersja: " + Assembly.GetExecutingAssembly().GetName().Version);
        text.AppendLine("Tryb: " + (options.Development ? "deweloperski" : "zwykły"));
        text.AppendLine("Windows: " + Environment.OSVersion.Version);
        text.AppendLine("WebView2: " + SafeWebViewVersion());
        text.AppendLine("Pulpit: " + (desktopLayout ?? "nie znaleziono"));
        foreach (var screen in Screen.AllScreens)
        {
            text.AppendLine($"Ekran: {screen.Bounds.Width}x{screen.Bounds.Height}{(screen.Primary ? " (główny)" : "")}");
        }
        text.AppendLine();
        text.AppendLine("Ostatnie wpisy dziennika:");
        foreach (var line in logTail) text.AppendLine(line);
        return text.ToString();
    }

    public static IEnumerable<string> ReadLogTail(string logFile, int lines)
    {
        try
        {
            using var stream = new FileStream(logFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var reader = new StreamReader(stream);
            var all = reader.ReadToEnd().Split('\n', StringSplitOptions.RemoveEmptyEntries);
            return all.Skip(Math.Max(0, all.Length - lines)).Select(l => l.TrimEnd('\r'));
        }
        catch (IOException)
        {
            return ["(dziennik niedostępny)"];
        }
    }

    private static string SafeWebViewVersion()
    {
        try
        {
            return CoreWebView2Environment.GetAvailableBrowserVersionString();
        }
        catch (Exception)
        {
            return "brak";
        }
    }
}
