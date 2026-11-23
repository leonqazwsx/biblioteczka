using System.Diagnostics;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Biblioteczka.Host;

/// <summary>
/// Starts the Node server as a child process, waits until it answers, restarts it after a crash
/// (within a budget) and stops it gracefully. A job object kills it if the host itself dies.
/// </summary>
internal sealed partial class NodeServer : IDisposable
{
    private readonly HostOptions _options;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(3) };
    private readonly RestartBudget _budget = new(3, TimeSpan.FromMinutes(10));
    private readonly IntPtr _job = CreateKillOnCloseJob();
    private Process? _process;
    private bool _stopping;

    public NodeServer(HostOptions options) => _options = options;

    /// <summary>Raised on the thread pool after the server became healthy again following a restart.</summary>
    public event Action? Restarted;

    /// <summary>Raised when the server crashed and the restart budget is exhausted.</summary>
    public event Action? GaveUp;

    public async Task StartAsync(CancellationToken cancel = default)
    {
        if (await IsHealthyAsync(cancel))
            throw new InvalidOperationException("Port " + _options.Port + " jest już zajęty przez działającą Biblioteczkę.");
        Launch();
        await WaitHealthyAsync(TimeSpan.FromSeconds(30), cancel);
    }

    private void Launch()
    {
        Directory.CreateDirectory(_options.DataDir);
        var info = new ProcessStartInfo(_options.NodePath)
        {
            WorkingDirectory = _options.AppRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        info.ArgumentList.Add(Path.Combine(_options.AppRoot, "src", "main.mjs"));
        info.ArgumentList.Add("--port");
        info.ArgumentList.Add(_options.Port.ToString());
        info.ArgumentList.Add("--data-dir");
        info.ArgumentList.Add(_options.DataDir);
        // Lets the server reach Windows features (autostart, opening the panel) through this executable.
        info.ArgumentList.Add("--host-exe");
        info.ArgumentList.Add(_options.ExecutablePath);
        var process = new Process { StartInfo = info, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) Log.Info("node: " + e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) Log.Error("node: " + e.Data); };
        process.Exited += OnExited;
        process.Start();
        if (_job != IntPtr.Zero) AssignProcessToJobObject(_job, process.Handle);
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        _process = process;
        Log.Info("Started Node server pid " + process.Id + " on " + _options.Origin);
    }

    private async void OnExited(object? sender, EventArgs e)
    {
        var code = (sender as Process)?.ExitCode;
        if (_stopping) return;
        Log.Error("Node server exited unexpectedly with code " + code);
        if (!_budget.TryReserve(DateTime.UtcNow))
        {
            Log.Error("Restart budget exhausted; giving up.");
            GaveUp?.Invoke();
            return;
        }
        try
        {
            await Task.Delay(1000);
            Launch();
            await WaitHealthyAsync(TimeSpan.FromSeconds(30), CancellationToken.None);
            Restarted?.Invoke();
        }
        catch (Exception error)
        {
            Log.Error("Restart failed", error);
        }
    }

    public async Task WaitHealthyAsync(TimeSpan timeout, CancellationToken cancel)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (await IsHealthyAsync(cancel)) return;
            if (_process is { HasExited: true }) throw new InvalidOperationException("Serwer zakończył pracę podczas uruchamiania.");
            await Task.Delay(200, cancel);
        }
        throw new TimeoutException("Serwer nie odpowiedział w ciągu " + timeout.TotalSeconds + " s.");
    }

    private async Task<bool> IsHealthyAsync(CancellationToken cancel)
    {
        try
        {
            using var response = await _http.GetAsync(_options.Origin + "/api/health", cancel);
            if (!response.IsSuccessStatusCode) return false;
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancel));
            return json.RootElement.TryGetProperty("appId", out var id) && id.GetString() == "bookshelf-wallpaper";
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException)
        {
            return false;
        }
    }

    /// <summary>Asks the server to shut down cleanly, then kills it if it does not exit in time.</summary>
    public async Task StopAsync()
    {
        _stopping = true;
        var process = _process;
        if (process is null || process.HasExited) return;
        try
        {
            var bootstrap = await _http.GetFromJsonAsync<JsonElement>(_options.Origin + "/api/bootstrap");
            using var request = new HttpRequestMessage(HttpMethod.Post, _options.Origin + "/api/shutdown")
            {
                Content = JsonContent.Create(new { expectedPid = process.Id }),
            };
            request.Headers.Add("Origin", _options.Origin);
            request.Headers.Add("X-Bookshelf-Token", bootstrap.GetProperty("token").GetString());
            using var _ = await _http.SendAsync(request);
            await process.WaitForExitAsync(new CancellationTokenSource(TimeSpan.FromSeconds(5)).Token);
            Log.Info("Node server stopped cleanly.");
        }
        catch (Exception error)
        {
            Log.Error("Graceful shutdown failed; killing server", error);
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
        }
    }

    public void Dispose()
    {
        _http.Dispose();
        _process?.Dispose();
        if (_job != IntPtr.Zero) CloseHandle(_job);
    }

    private static IntPtr CreateKillOnCloseJob()
    {
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return IntPtr.Zero;
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        var size = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, buffer, false);
            SetInformationJobObject(job, 9 /* JobObjectExtendedLimitInformation */, buffer, (uint)size);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
        return job;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [LibraryImport("kernel32.dll", EntryPoint = "CreateJobObjectW", StringMarshalling = StringMarshalling.Utf16)]
    private static partial IntPtr CreateJobObject(IntPtr attributes, string? name);

    [LibraryImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

    [LibraryImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [LibraryImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CloseHandle(IntPtr handle);
}
