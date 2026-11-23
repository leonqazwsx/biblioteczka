using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Biblioteczka.Host;

/// <summary>The collection panel in an ordinary application window.</summary>
internal sealed class PanelWindow : Form
{
    private readonly string _origin;
    private readonly CoreWebView2Environment _environment;
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    private bool _leaving, _mayClose;

    public PanelWindow(string origin, CoreWebView2Environment environment, Icon icon)
    {
        _origin = origin;
        _environment = environment;
        Text = "Biblioteczka";
        Icon = icon;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(720, 520);
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 860);
        Size = new Size(Math.Min(1280, area.Width - 80), Math.Min(880, area.Height - 60));
        Controls.Add(_web);
        Load += async (_, _) => await InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        try
        {
            await _web.EnsureCoreWebView2Async(_environment);
            var core = _web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.DocumentTitleChanged += (_, _) =>
                Text = string.IsNullOrWhiteSpace(core.DocumentTitle) ? "Biblioteczka" : core.DocumentTitle;
            // Links to other sites (catalog pages, documentation) open in the user's browser.
            core.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                OpenExternal(e.Uri);
            };
            core.NavigationStarting += (_, e) =>
            {
                if (IsOwn(e.Uri)) return;
                e.Cancel = true;
                OpenExternal(e.Uri);
            };
            core.NavigationCompleted += (_, e) =>
            {
                if (!_leaving) return;
                _leaving = false;
                // The page was left (no unsaved draft, or the user confirmed); now really close.
                if (e.IsSuccess && core.Source == "about:blank")
                {
                    _mayClose = true;
                    Close();
                }
            };
            core.Navigate(_origin + "/manager");
        }
        catch (Exception error)
        {
            Log.Error("Panel failed to load", error);
            MessageBox.Show(this, L.T("Nie udało się otworzyć panelu:") + " " + error.Message, "Biblioteczka",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private bool IsOwn(string uri) =>
        uri.StartsWith(_origin + "/", StringComparison.OrdinalIgnoreCase) || uri == _origin ||
        uri.StartsWith("blob:", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase) ||
        uri == "about:blank";

    private static void OpenExternal(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var parsed) || parsed.Scheme is not ("https" or "http")) return;
        try
        {
            Process.Start(new ProcessStartInfo(parsed.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception error)
        {
            Log.Error("Opening an external link failed", error);
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // Leaving the page first lets the panel's own "unsaved changes" prompt (beforeunload) run.
        if (!_mayClose && e.CloseReason == CloseReason.UserClosing && _web.CoreWebView2 is { } core &&
            core.Source.StartsWith(_origin, StringComparison.OrdinalIgnoreCase))
        {
            e.Cancel = true;
            _leaving = true;
            core.Navigate("about:blank");
            return;
        }
        base.OnFormClosing(e);
    }

    public void BringToFront(bool restore)
    {
        if (restore && WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Show();
        Activate();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _web.Dispose();
        base.Dispose(disposing);
    }
}
