namespace Biblioteczka.Host;

/// <summary>Small append-only local log. Never contains book titles or other collection data.</summary>
internal static class Log
{
    private static readonly object Gate = new();
    private static string? _file;

    public static void Open(string file)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        _file = file;
    }

    public static void Info(string message) => Write("INFO", message);

    public static void Error(string message, Exception? error = null) =>
        Write("ERROR", error is null ? message : message + ": " + error.GetType().Name + ": " + error.Message);

    private static void Write(string level, string message)
    {
        if (_file is null) return;
        var line = DateTime.UtcNow.ToString("O") + " " + level + " " + message + Environment.NewLine;
        lock (Gate)
        {
            try { File.AppendAllText(_file, line); }
            catch (IOException) { }
        }
    }
}
