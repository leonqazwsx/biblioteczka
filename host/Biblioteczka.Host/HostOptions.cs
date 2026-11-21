namespace Biblioteczka.Host;

/// <summary>Command-line options. Defaults keep the prototype away from the user's real installation.</summary>
internal sealed record HostOptions(string AppRoot, string NodePath, int Port, string DataDir, string LogFile)
{
    public const int DefaultPrototypePort = 47832;

    public string Origin => "http://127.0.0.1:" + Port;

    public static HostOptions Parse(string[] args)
    {
        string? Value(string name)
        {
            var i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }

        var appRoot = Path.GetFullPath(Value("--app-root") ?? FindAppRoot(AppContext.BaseDirectory)
            ?? throw new InvalidOperationException("Nie znaleziono folderu aplikacji (src/main.mjs). Podaj --app-root."));
        var port = int.TryParse(Value("--port"), out var p) && p is > 0 and < 65536 ? p : DefaultPrototypePort;
        var dataDir = Path.GetFullPath(Value("--data-dir") ?? Path.Combine(appRoot, "output", "host-prototype-data"));
        var node = Value("--node") ?? "node";
        var log = Path.GetFullPath(Value("--log") ?? Path.Combine(appRoot, "output", "host-prototype.log"));
        return new HostOptions(appRoot, node, port, dataDir, log);
    }

    /// <summary>Walks up from <paramref name="start"/> to the folder that contains src/main.mjs.</summary>
    internal static string? FindAppRoot(string start)
    {
        for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "src", "main.mjs")) &&
                File.Exists(Path.Combine(dir.FullName, "package.json")))
                return dir.FullName;
        return null;
    }
}
