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
    [Fact]
    public void ClickProducesDownAndUpWithHeldButtonState()
    {
        var translation = new MouseTranslation();
        var down = Assert.Single(translation.Translate(0x0001, 0));
        Assert.Equal((0x0201u, 0x0001), (down.Id, down.Keys));
        Assert.Equal(0x0001, translation.Keys);
        var up = Assert.Single(translation.Translate(0x0002, 0));
        Assert.Equal((0x0202u, 0), (up.Id, up.Keys));
    }

    [Fact]
    public void WheelCarriesSignedDelta()
    {
        var wheel = Assert.Single(new MouseTranslation().Translate(0x0400, unchecked((ushort)-120)));
        Assert.Equal(0x020Au, wheel.Id);
        Assert.Equal(-120, wheel.WheelDelta);
    }

    [Fact]
    public void MoveWithoutButtonsProducesNoButtonMessages() =>
        Assert.Empty(new MouseTranslation().Translate(0, 0));

    [Fact]
    public void ResetForgetsHeldButtons()
    {
        var translation = new MouseTranslation();
        translation.Translate(0x0004, 0);
        translation.Reset();
        Assert.Equal(0, translation.Keys);
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
    public void DefaultsStayAwayFromTheInstalledApp()
    {
        var root = Directory.CreateTempSubdirectory("biblioteczka-root-").FullName;
        try
        {
            var options = HostOptions.Parse(["--app-root", root]);
            Assert.Equal(47832, options.Port);
            Assert.StartsWith(Path.Combine(root, "output"), options.DataDir);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
