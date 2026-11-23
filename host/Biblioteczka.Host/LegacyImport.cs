using System.Diagnostics;
using System.Text.Json;

namespace Biblioteczka.Host;

/// <summary>
/// Copies a collection from the previous (PowerShell + Lively) version into the new data folder.
/// The old folder is never modified. Pure file logic, unit tested; the dialog lives in HostContext.
/// </summary>
internal static class LegacyImport
{
    private static readonly string[] SkippedFiles =
        ["server.log", "server-error.log", "server-stdin.txt", "tray.log", "tray-error.log", "data-initialized.json"];

    public static bool HasCollection(string dataDir) => File.Exists(Path.Combine(dataDir, "library.json"));

    /// <summary>Accepts either an old data folder or the old installation folder that contains <c>data</c>.</summary>
    public static string? ResolveDataDir(string folder)
    {
        if (HasCollection(folder)) return folder;
        var nested = Path.Combine(folder, "data");
        return HasCollection(nested) ? nested : null;
    }

    /// <summary>Old installations in the places the previous installer suggested.</summary>
    public static IEnumerable<string> Candidates(string localAppData, string desktop, string documents) =>
        new[]
            {
                Path.Combine(localAppData, "Biblioteczka"),
                Path.Combine(desktop, "Biblioteczka"),
                Path.Combine(documents, "Biblioteczka", "Biblioteczka"),
            }
            .Select(ResolveDataDir)
            .OfType<string>()
            .Distinct(StringComparer.OrdinalIgnoreCase);

    /// <summary>True while the old version's server holds the data lock.</summary>
    public static bool IsInUse(string dataDir)
    {
        var lockDir = Path.Combine(dataDir, ".bookshelf-data-lock");
        if (!Directory.Exists(lockDir)) return false;
        foreach (var file in Directory.EnumerateFiles(lockDir))
        {
            try
            {
                using var json = JsonDocument.Parse(File.ReadAllText(file));
                if (!json.RootElement.TryGetProperty("pid", out var pid)) return true;
                using var process = Process.GetProcessById(pid.GetInt32());
                return !process.HasExited;
            }
            catch (ArgumentException)
            {
                return false; // The recorded process no longer exists: a stale lock.
            }
            catch (Exception)
            {
                return true; // Unreadable lock: be careful.
            }
        }
        return false;
    }

    /// <summary>
    /// Copies <paramref name="source"/> into <paramref name="target"/> through a temporary folder, so a failed
    /// copy never leaves a half collection behind. The target must not contain a collection yet.
    /// </summary>
    public static int Copy(string source, string target)
    {
        if (!HasCollection(source)) throw new InvalidOperationException(L.T("W wybranym folderze nie ma kolekcji (library.json)."));
        if (HasCollection(target)) throw new InvalidOperationException(L.T("Nowa kolekcja już istnieje i nie zostanie nadpisana."));
        using (var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(source, "library.json"))))
            if (!json.RootElement.TryGetProperty("books", out var books) || books.ValueKind != JsonValueKind.Array)
                throw new InvalidOperationException(L.T("Plik library.json nie wygląda na kolekcję Biblioteczki."));

        var parent = Path.GetDirectoryName(Path.GetFullPath(target))!;
        Directory.CreateDirectory(parent);
        var staging = Path.Combine(parent, ".biblioteczka-import-" + Guid.NewGuid().ToString("N"));
        var copied = 0;
        try
        {
            copied = CopyTree(source, staging);
            if (Directory.Exists(target))
            {
                if (Directory.EnumerateFileSystemEntries(target).Any())
                    throw new InvalidOperationException(L.T("Folder {folder} nie jest pusty.", ("folder", target)));
                Directory.Delete(target);
            }
            Directory.Move(staging, target);
            return copied;
        }
        finally
        {
            if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true);
        }
    }

    private static int CopyTree(string from, string to)
    {
        Directory.CreateDirectory(to);
        var count = 0;
        foreach (var file in Directory.EnumerateFiles(from))
        {
            var name = Path.GetFileName(file);
            if (SkippedFiles.Contains(name, StringComparer.OrdinalIgnoreCase) || name.StartsWith("runtime-", StringComparison.OrdinalIgnoreCase) ||
                name.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase))
                continue;
            File.Copy(file, Path.Combine(to, name));
            count++;
        }
        foreach (var dir in Directory.EnumerateDirectories(from))
        {
            var name = Path.GetFileName(dir);
            if (name.StartsWith(".bookshelf-data-lock", StringComparison.OrdinalIgnoreCase)) continue;
            count += CopyTree(dir, Path.Combine(to, name));
        }
        return count;
    }
}
