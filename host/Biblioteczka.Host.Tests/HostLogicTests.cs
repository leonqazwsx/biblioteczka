using System.Drawing;
using Biblioteczka.Host;

namespace Biblioteczka.Host.Tests;

public class RestartBudgetTests
{
    [Fact]
    public void AllowsThreeRestartsPerWindowThenRecovers()
    {
        var budget = new RestartBudget(3, TimeSpan.FromMinutes(10));
        var start = new DateTime(2026, 11, 21, 12, 0, 0, DateTimeKind.Utc);
        Assert.True(budget.TryReserve(start));
        Assert.True(budget.TryReserve(start.AddMinutes(1)));
        Assert.True(budget.TryReserve(start.AddMinutes(2)));
        Assert.False(budget.TryReserve(start.AddMinutes(3)));
        Assert.True(budget.TryReserve(start.AddMinutes(10)));
    }
}

public class FullscreenRuleTests
{
    private static readonly Rectangle Monitor = new(0, 0, 1920, 1080);

    [Fact]
    public void FullscreenAppOnWallpaperMonitorCoversIt() =>
        Assert.True(FullscreenRule.CoversWallpaper("UnityWndClass", Monitor, Monitor, Monitor));

    [Fact]
    public void BorderlessWindowLargerThanMonitorCoversIt() =>
        Assert.True(FullscreenRule.CoversWallpaper("Chrome_WidgetWin_1", new Rectangle(-8, -8, 1936, 1096), Monitor, Monitor));

    [Fact]
    public void MaximizedWindowLeavingTaskbarDoesNotCoverIt() =>
        Assert.False(FullscreenRule.CoversWallpaper("Notepad", new Rectangle(0, 0, 1920, 1032), Monitor, Monitor));

    [Theory]
    [InlineData("Progman")]
    [InlineData("WorkerW")]
    [InlineData("Shell_TrayWnd")]
    public void ShellWindowsNeverCoverIt(string windowClass) =>
        Assert.False(FullscreenRule.CoversWallpaper(windowClass, Monitor, Monitor, Monitor));

    [Fact]
    public void FullscreenOnAnotherMonitorDoesNotCoverIt()
    {
        var second = new Rectangle(1920, 0, 1920, 1080);
        Assert.False(FullscreenRule.CoversWallpaper("UnityWndClass", second, second, Monitor));
    }
}

public class MouseTranslationTests
{
    private static readonly DateTime T0 = new(2026, 11, 22, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void EveryEventStartsWithAMoveSoHoverFollowsTheCursor()
    {
        var events = new MouseTranslation().Translate(0, 0, 552, 156, T0);
        var move = Assert.Single(events);
        Assert.Equal(("mouseMoved", 552.0, 156.0, "none", 0), (move.Type, move.X, move.Y, move.Button, move.Buttons));
    }

    [Fact]
    public void ClickPressesAndReleasesTheLeftButton()
    {
        var translation = new MouseTranslation();
        var down = translation.Translate(0x0001, 0, 10, 20, T0);
        Assert.Equal(["mouseMoved", "mousePressed"], down.Select(e => e.Type));
        Assert.Equal(("left", 1, 1), (down[1].Button, down[1].Buttons, down[1].ClickCount));
        Assert.Equal(1, translation.Buttons);
        var up = translation.Translate(0x0002, 0, 10, 20, T0.AddMilliseconds(80));
        Assert.Equal(("mouseMoved", "left"), (up[0].Type, up[0].Button));
        Assert.Equal(("mouseReleased", "left", 0, 1), (up[1].Type, up[1].Button, up[1].Buttons, up[1].ClickCount));
    }

    [Fact]
    public void QuickSecondClickInPlaceIsADoubleClick()
    {
        var translation = new MouseTranslation();
        translation.Translate(0x0001, 0, 10, 20, T0);
        translation.Translate(0x0002, 0, 10, 20, T0.AddMilliseconds(50));
        var second = translation.Translate(0x0001, 0, 11, 21, T0.AddMilliseconds(200));
        Assert.Equal(2, second[1].ClickCount);
        var later = translation.Translate(0x0001, 0, 11, 21, T0.AddSeconds(5));
        Assert.Equal(1, later[1].ClickCount);
    }

    [Fact]
    public void WheelUpScrollsUpInTheBrowser()
    {
        var wheel = new MouseTranslation().Translate(0x0400, 120, 0, 0, T0)[1];
        Assert.Equal(("mouseWheel", -120.0), (wheel.Type, wheel.DeltaY));
    }

    [Fact]
    public void LeaveMovesOutsideTheViewportAndForgetsButtons()
    {
        var translation = new MouseTranslation();
        translation.Translate(0x0004, 0, 5, 5, T0);
        var leave = translation.Leave();
        Assert.True(leave.X < 0 && leave.Y < 0);
        Assert.Equal(0, translation.Buttons);
    }

    [Fact]
    public void SerializesDevToolsParameters()
    {
        var json = new MouseTranslation.CdpMouseEvent("mousePressed", 1.5, 2, "left", 1, 1).ToJson();
        Assert.Contains("\"type\":\"mousePressed\"", json);
        Assert.Contains("\"x\":1.5", json);
        Assert.Contains("\"clickCount\":1", json);
    }
}

public class HostOptionsTests
{
    [Fact]
    public void FindsAppRootAboveTheExecutable()
    {
        var root = Directory.CreateTempSubdirectory("biblioteczka-root-").FullName;
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "src"));
            File.WriteAllText(Path.Combine(root, "src", "main.mjs"), "");
            File.WriteAllText(Path.Combine(root, "package.json"), "{}");
            var bin = Directory.CreateDirectory(Path.Combine(root, "host", "bin", "Debug")).FullName;
            Assert.Equal(root, HostOptions.FindAppRoot(bin));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void GitCheckoutRunsInDevelopmentModeAwayFromTheInstalledApp()
    {
        var root = Directory.CreateTempSubdirectory("biblioteczka-root-").FullName;
        try
        {
            Directory.CreateDirectory(Path.Combine(root, ".git"));
            var options = HostOptions.Parse(["--app-root", root], documents: @"C:\Docs", localAppData: @"C:\Local");
            Assert.True(options.Development);
            Assert.Equal(47832, options.Port);
            Assert.StartsWith(Path.Combine(root, "output"), options.DataDir);
            Assert.StartsWith(Path.Combine(root, "output"), options.LogFile);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void InstalledAppKeepsTheCollectionInDocuments()
    {
        var root = Directory.CreateTempSubdirectory("biblioteczka-root-").FullName;
        try
        {
            var options = HostOptions.Parse(["--app-root", root, "--control", "status"], documents: @"C:\Docs", localAppData: @"C:\Local");
            Assert.False(options.Development);
            Assert.Equal(47831, options.Port);
            Assert.Equal(@"C:\Docs\Biblioteczka", options.DataDir);
            Assert.Equal(@"C:\Local\BiblioteczkaApp\host.log", options.LogFile);
            Assert.Equal("status", options.Control);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}

public class AutostartTests : IDisposable
{
    private readonly string _key = @"Software\Biblioteczka.Tests\Run-" + Guid.NewGuid().ToString("N");

    [Fact]
    public void EnablesAndDisablesItsOwnEntry()
    {
        var autostart = new Autostart("Biblioteczka", @"C:\App\Biblioteczka.exe", _key);
        Assert.False(autostart.Read().Autostart);
        Assert.True(autostart.Set(true).Autostart);
        using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(_key))
            Assert.Equal("\"C:\\App\\Biblioteczka.exe\" --autostart", key!.GetValue("Biblioteczka"));
        Assert.False(autostart.Set(false).Autostart);
    }

    [Fact]
    public void NeverOverwritesAnotherCopysEntry()
    {
        new Autostart("Biblioteczka", @"C:\Other\Biblioteczka.exe", _key).Set(true);
        var ours = new Autostart("Biblioteczka", @"C:\App\Biblioteczka.exe", _key);
        var status = ours.Set(true);
        Assert.True(status.Conflict);
        Assert.False(status.Autostart);
        Assert.NotNull(status.Message);
    }

    public void Dispose() => Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(@"Software\Biblioteczka.Tests", throwOnMissingSubKey: false);
}

public class LegacyImportTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("biblioteczka-import-").FullName;

    private string OldInstall()
    {
        var data = Directory.CreateDirectory(Path.Combine(_root, "old", "Biblioteczka", "data")).FullName;
        File.WriteAllText(Path.Combine(data, "library.json"), """{"schemaVersion":2,"books":[{"id":"a"}]}""");
        File.WriteAllText(Path.Combine(data, "library.backup.json"), "{}");
        File.WriteAllText(Path.Combine(data, "server.log"), "log");
        File.WriteAllText(Path.Combine(data, "runtime-events.log"), "log");
        Directory.CreateDirectory(Path.Combine(data, "covers"));
        File.WriteAllText(Path.Combine(data, "covers", "abc.jpg"), "image");
        Directory.CreateDirectory(Path.Combine(data, ".bookshelf-data-lock-stage-x"));
        return data;
    }

    [Fact]
    public void FindsTheDataFolderFromTheInstallationFolder()
    {
        var data = OldInstall();
        Assert.Equal(data, LegacyImport.ResolveDataDir(Path.GetDirectoryName(data)!));
        Assert.Equal(data, LegacyImport.ResolveDataDir(data));
        Assert.Null(LegacyImport.ResolveDataDir(_root));
    }

    [Fact]
    public void CopiesTheCollectionButNotLogsLocksOrRuntimeFiles()
    {
        var data = OldInstall();
        var target = Path.Combine(_root, "Documents", "Biblioteczka");
        Assert.Equal(3, LegacyImport.Copy(data, target));
        Assert.True(File.Exists(Path.Combine(target, "library.json")));
        Assert.True(File.Exists(Path.Combine(target, "covers", "abc.jpg")));
        Assert.False(File.Exists(Path.Combine(target, "server.log")));
        Assert.False(File.Exists(Path.Combine(target, "runtime-events.log")));
        Assert.False(Directory.Exists(Path.Combine(target, ".bookshelf-data-lock-stage-x")));
        Assert.True(File.Exists(Path.Combine(data, "library.json")), "the old collection stays untouched");
    }

    [Fact]
    public void RefusesToOverwriteAnExistingCollection()
    {
        var data = OldInstall();
        var target = Directory.CreateDirectory(Path.Combine(_root, "new")).FullName;
        File.WriteAllText(Path.Combine(target, "library.json"), """{"books":[]}""");
        Assert.Throws<InvalidOperationException>(() => LegacyImport.Copy(data, target));
    }

    [Fact]
    public void RejectsAFolderWithoutACollection()
    {
        var notBiblioteczka = Directory.CreateDirectory(Path.Combine(_root, "other")).FullName;
        File.WriteAllText(Path.Combine(notBiblioteczka, "library.json"), """{"songs":[]}""");
        Assert.Throws<InvalidOperationException>(() => LegacyImport.Copy(notBiblioteczka, Path.Combine(_root, "t")));
        Assert.False(Directory.Exists(Path.Combine(_root, "t")));
    }

    [Fact]
    public void StaleLockFromAFinishedProcessDoesNotBlockImport()
    {
        var data = OldInstall();
        var lockDir = Directory.CreateDirectory(Path.Combine(data, ".bookshelf-data-lock")).FullName;
        File.WriteAllText(Path.Combine(lockDir, "owner.json"), """{"pid":999999}""");
        Assert.False(LegacyImport.IsInUse(data));
        File.WriteAllText(Path.Combine(lockDir, "owner.json"), "{\"pid\":" + Environment.ProcessId + "}");
        Assert.True(LegacyImport.IsInUse(data));
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);
}

public class FirstRunTests
{
    [Fact]
    public void ClaimsEachActionOnlyOnceEvenAfterRestart()
    {
        var dir = Path.Combine(Path.GetTempPath(), "biblioteczka-firstrun-" + Guid.NewGuid().ToString("N"));
        try
        {
            Assert.True(new FirstRun(dir).TryClaim("autostart-default"));
            Assert.False(new FirstRun(dir).TryClaim("autostart-default"));
            Assert.True(new FirstRun(dir).TryClaim("other"));
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
    }
}
