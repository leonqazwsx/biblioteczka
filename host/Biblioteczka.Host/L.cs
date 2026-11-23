using System.Globalization;
using System.Text.Json;

namespace Biblioteczka.Host;

/// <summary>
/// Translations for the host, sharing public/locales/en.json with the web pages and the server.
/// The Polish text is the key; placeholders use braces: L.T("Skopiuj z: {path}", ("path", folder)).
/// </summary>
internal static class L
{
    private static Dictionary<string, string>? _dictionary;

    public static string Language { get; private set; } = "pl";

    /// <summary>Polish when Windows uses Polish, English otherwise (or the explicit --lang value).</summary>
    public static string Detect(string? requested) =>
        (requested ?? CultureInfo.CurrentUICulture.TwoLetterISOLanguageName).StartsWith("pl", StringComparison.OrdinalIgnoreCase)
            ? "pl"
            : "en";

    public static void Init(string language, string appRoot)
    {
        Language = language;
        _dictionary = null;
        if (language == "pl") return;
        try
        {
            var file = Path.Combine(appRoot, "public", "locales", language + ".json");
            _dictionary = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(file));
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        {
            Log.Error("Translations unavailable", error);
        }
    }

    public static string T(string text, params (string Name, object? Value)[] values)
    {
        var template = _dictionary is not null && _dictionary.TryGetValue(text, out var translated) ? translated : text;
        foreach (var (name, value) in values) template = template.Replace("{" + name + "}", Convert.ToString(value, CultureInfo.CurrentCulture));
        return template;
    }
}
