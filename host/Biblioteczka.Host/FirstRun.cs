namespace Biblioteczka.Host;

/// <summary>Remembers one-time actions (such as enabling autostart) with marker files in the state folder.</summary>
internal sealed class FirstRun(string stateDir)
{
    /// <summary>Returns true exactly once per <paramref name="name"/>, even across restarts.</summary>
    public bool TryClaim(string name)
    {
        Directory.CreateDirectory(stateDir);
        var marker = Path.Combine(stateDir, name + ".done");
        try
        {
            using var _ = new FileStream(marker, FileMode.CreateNew, FileAccess.Write);
            return true;
        }
        catch (IOException) when (File.Exists(marker))
        {
            return false;
        }
    }
}
