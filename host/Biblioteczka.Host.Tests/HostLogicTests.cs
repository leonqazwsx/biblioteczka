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
