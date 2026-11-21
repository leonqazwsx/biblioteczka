namespace Biblioteczka.Host;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        HostOptions options;
        try
        {
            options = HostOptions.Parse(args);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Biblioteczka", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }

        using var instance = new Mutex(true, @"Local\Biblioteczka.Host." + options.Port, out var first);
        if (!first) return 0;
        Log.Open(options.LogFile);
        Log.Info("Host starting; app root " + options.AppRoot + ", port " + options.Port);
        SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        Application.Run(new HostContext(options));
        return 0;
    }
}
