using System.Runtime.InteropServices;
using Windows.ApplicationModel;

namespace Biblioteczka.Host;

/// <summary>Start with Windows: Run key for the portable app, MSIX StartupTask for the Store package.</summary>
internal interface IAutostart
{
    Autostart.Status Read();

    Autostart.Status Set(bool enabled);
}

/// <summary>
/// The Store (MSIX) package cannot use the Run key (package registry writes are virtualized); Windows starts
/// it through the StartupTask declared in Package.appxmanifest, enabled by default and listed in
/// Settings → Apps → Startup, where the user stays in control.
/// </summary>
internal sealed partial class PackagedAutostart : IAutostart
{
    public const string TaskId = "BiblioteczkaStartup";

    public static bool IsPackaged()
    {
        uint length = 0;
        return GetCurrentPackageFullName(ref length, IntPtr.Zero) != 15700; // APPMODEL_ERROR_NO_PACKAGE
    }

    /// <summary>The Store package's StartupTask passes no arguments; its activation kind tells us instead.</summary>
    public static bool WasStartedByStartupTask()
    {
        if (!IsPackaged()) return false;
        try
        {
            return Windows.ApplicationModel.AppInstance.GetActivatedEventArgs()?.Kind ==
                Windows.ApplicationModel.Activation.ActivationKind.StartupTask;
        }
        catch (Exception error)
        {
            Log.Error("Reading the activation kind failed", error);
            return false;
        }
    }

    public Autostart.Status Read() => Map(Task().State);

    public Autostart.Status Set(bool enabled)
    {
        var task = Task();
        if (enabled && task.State == StartupTaskState.Disabled)
            System.Threading.Tasks.Task.Run(async () => await task.RequestEnableAsync()).GetAwaiter().GetResult();
        else if (!enabled && task.State == StartupTaskState.Enabled)
            task.Disable();
        return Read();
    }

    internal static Autostart.Status Map(StartupTaskState state) => state switch
    {
        StartupTaskState.Enabled => new(true, true, false, true, null),
        StartupTaskState.EnabledByPolicy => new(true, true, false, false, L.T("Autostart jest ustawiony przez zasady tego komputera.")),
        StartupTaskState.DisabledByUser => new(true, false, false, false,
            L.T("Autostart wyłączono w ustawieniach Windows. Włączysz go w Ustawienia → Aplikacje → Uruchamianie.")),
        StartupTaskState.DisabledByPolicy => new(true, false, false, false, L.T("Autostart jest zablokowany przez zasady tego komputera.")),
        _ => new(true, false, false, true, null),
    };

    private static StartupTask Task() =>
        System.Threading.Tasks.Task.Run(async () => await StartupTask.GetAsync(TaskId)).GetAwaiter().GetResult();

    [LibraryImport("kernel32.dll")]
    private static partial int GetCurrentPackageFullName(ref uint length, IntPtr name);
}
