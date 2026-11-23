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
        text.AppendLine("Biblioteczka problem report");
        text.AppendLine("Version: " + Assembly.GetExecutingAssembly().GetName().Version);
        text.AppendLine("Mode: " + (options.Development ? "development" : "installed"));
        text.AppendLine("Language: " + L.Language);
        text.AppendLine("Windows: " + Environment.OSVersion.Version);
        text.AppendLine("WebView2: " + SafeWebViewVersion());
        text.AppendLine("Desktop: " + (desktopLayout ?? "not found"));
        foreach (var screen in Screen.AllScreens)
        {
            text.AppendLine($"Screen: {screen.Bounds.Width}x{screen.Bounds.Height}{(screen.Primary ? " (primary)" : "")}");
        }
        text.AppendLine();
        text.AppendLine("Recent log entries:");
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
            return ["(log unavailable)"];
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
            return "missing";
        }
    }
}
