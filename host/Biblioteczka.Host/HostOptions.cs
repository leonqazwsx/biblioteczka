namespace Biblioteczka.Host;

/// <summary>
/// Command-line options and locations.
/// <para>Development mode (the app root is a git checkout) keeps everything inside <c>output/</c> and uses
/// port 47832, so it never touches a real installation. Production mode stores the collection in
/// <c>Documents\Biblioteczka</c> (it survives uninstalling) and runtime files in LocalAppData.</para>
/// </summary>
internal sealed record HostOptions(
    string AppRoot,
    string NodePath,
    int Port,
    string DataDir,
    string StateDir,
    bool Development,
    string? Control,
    string Language,
    bool SmokeTest = false)
{
    public const int ProductionPort = 47831;
    public const int DevelopmentPort = 47832;

    public string Origin => "http://127.0.0.1:" + Port;

    public string LogFile => Path.Combine(StateDir, "host.log");

    public string WebViewDataDir => Path.Combine(StateDir, "WebView2");

    public string ExecutablePath => Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "Biblioteczka.exe");

    public static HostOptions Parse(string[] args, string? documents = null, string? localAppData = null)
    {
        string? Value(string name)
        {
            var i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }

        var appRoot = Path.GetFullPath(Value("--app-root") ?? FindAppRoot(AppContext.BaseDirectory)
            ?? throw new InvalidOperationException("Application files not found (src/main.mjs)."));
        var development = Directory.Exists(Path.Combine(appRoot, ".git")) || File.Exists(Path.Combine(appRoot, ".git"));
        documents ??= Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        localAppData ??= Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        var port = int.TryParse(Value("--port"), out var p) && p is > 0 and < 65536
            ? p
            : development ? DevelopmentPort : ProductionPort;
        var dataDir = Value("--data-dir") ?? (development
            ? Path.Combine(appRoot, "output", "host-prototype-data")
            : Path.Combine(documents, "Biblioteczka"));
        // Not LocalAppData\Biblioteczka: the previous installer suggested that folder for the whole old app.
        var stateDir = Value("--state-dir") ?? (development ? Path.Combine(appRoot, "output", "host-state") : Path.Combine(localAppData, "BiblioteczkaApp"));
        var bundledNode = Path.Combine(AppContext.BaseDirectory, "runtime", "node.exe");
        var node = Value("--node") ?? (File.Exists(bundledNode) ? bundledNode : "node");
        return new HostOptions(appRoot, node, port, Path.GetFullPath(dataDir), Path.GetFullPath(stateDir),
            development, Value("--control"), L.Detect(Value("--lang")),
            // Release smoke tests: no first-run prompts and no changes to start-with-Windows.
            SmokeTest: Array.IndexOf(args, "--smoke-test") >= 0);
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
