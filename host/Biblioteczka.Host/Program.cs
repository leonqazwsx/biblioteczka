using System.Text.Json;

namespace Biblioteczka.Host;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        HostOptions options;
        try
        {
            options = HostOptions.Parse(args);
        }
        catch (Exception error)
        {
            if (Array.IndexOf(args, "--control") >= 0) return WriteControl(new { error = error.Message }, 2);
            MessageBox.Show(error.Message, "Biblioteczka", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }

        L.Init(options.Language, options.AppRoot);
        if (options.Control is not null) return RunControl(options);

        using var instance = new Mutex(true, @"Local\Biblioteczka.Host." + options.Port, out var first);
        if (!first)
        {
            // Already running: launching again opens the panel, like any other app.
            ShellWindow.SignalOpenPanel(options.Port);
            return 0;
        }

        ApplicationConfiguration.Initialize();
        Log.Open(options.LogFile);
        Log.Info($"Host starting ({(options.Development ? "development" : "production")}); port {options.Port}, language {options.Language}");
        SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        Application.Run(new HostContext(options, openPanelOnStart: Array.IndexOf(args, "--autostart") < 0));
        return 0;
    }

    /// <summary>
    /// Small command interface used by the Node server (see src/windows.mjs): prints one JSON object.
    /// </summary>
    private static int RunControl(HostOptions options)
    {
        try
        {
            var autostart = Autostart.For(options);
            return options.Control switch
            {
                "status" => WriteControl(autostart.Read()),
                "enable" => WriteControl(autostart.Set(true)),
                "disable" => WriteControl(autostart.Set(false)),
                "open-settings" => WriteControl(new { opened = ShellWindow.SignalOpenPanel(options.Port) }),
                _ => WriteControl(new { error = L.T("Nieznane polecenie.") }, 2),
            };
        }
        catch (Exception error)
        {
            return WriteControl(new { error = error.Message }, 1);
        }
    }

    private static int WriteControl(object value, int code = 0)
    {
        var json = JsonSerializer.Serialize(value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var stdout = Console.OpenStandardOutput();
        using var writer = new StreamWriter(stdout, new System.Text.UTF8Encoding(false));
        writer.Write(json);
        return code;
    }
}
