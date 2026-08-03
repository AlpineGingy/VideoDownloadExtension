using System.Text.RegularExpressions;

namespace MediaFinder.Companion;

/// <summary>Validates extension messages before they can reach a local executable.</summary>
public static partial class DownloadRequestValidator
{
    private static readonly HashSet<string> AllowedBrowsers = ["none", "chrome", "edge", "firefox"];
    private static readonly HashSet<string> AllowedQualities = ["best", "1080p", "720p", "audio"];
    private static readonly HashSet<string> AllowedContainers = ["auto", "mp4", "mkv"];
    private static readonly HashSet<int> AllowedFragmentCounts = [1, 4, 8];
    private static readonly HashSet<string> AllowedFilenameStyles = ["pageTitle", "mediaTitle", "titleQuality", "titleId"];
    private static readonly HashSet<string> AllowedOutputFolders = ["mediaFinder", "downloads", "videos", "desktop"];

    /// <summary>Returns a user-facing error when a download request is not safe to execute.</summary>
    public static string? Validate(NativeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.JobId) || !JobIdPattern().IsMatch(request.JobId))
        {
            return "The download job identifier is invalid.";
        }

        if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return "Only HTTP and HTTPS media URLs are supported.";
        }

        if (request.Options is null)
        {
            return "Download options are required.";
        }

        if (request.Title is null || request.Title.Length > 500 || request.Title.Any(char.IsControl))
        {
            return "The page title is invalid.";
        }

        if (request.Cookies.Count > 300)
        {
            return "Too many browser cookies were supplied.";
        }

        if (request.Cookies.Count > 0 &&
            (request.Options.CookiesBrowser != "chrome" || !request.UseChromeSessionCookies))
        {
            return "Session cookies are only supported for Chrome downloads.";
        }

        if (request.UseChromeSessionCookies)
        {
            if (request.Cookies.Count == 0)
            {
                return "No matching Chrome session cookies were found for this page.";
            }

            var allowedHosts = new List<string> { uri.Host };
            if (Uri.TryCreate(request.CookieSourceUrl, UriKind.Absolute, out var cookieSourceUri) &&
                (cookieSourceUri.Scheme == Uri.UriSchemeHttp || cookieSourceUri.Scheme == Uri.UriSchemeHttps))
            {
                allowedHosts.Add(cookieSourceUri.Host);
            }

            if (request.Cookies.Any(cookie => !IsSafeCookie(cookie, allowedHosts)))
            {
                return "One or more Chrome cookies were invalid or unrelated to the requested page.";
            }
        }

        if (!AllowedBrowsers.Contains(request.Options.CookiesBrowser) ||
            !AllowedQualities.Contains(request.Options.Quality) ||
            !AllowedContainers.Contains(request.Options.Container) ||
            !AllowedFragmentCounts.Contains(request.Options.ConcurrentFragments) ||
            !AllowedFilenameStyles.Contains(request.Options.FilenameStyle) ||
            !AllowedOutputFolders.Contains(request.Options.OutputFolder))
        {
            return "One or more download options are unsupported.";
        }

        return null;
    }

    /// <summary>Restricts transient cookie data to valid fields and the requested site domains.</summary>
    private static bool IsSafeCookie(BrowserCookie cookie, IReadOnlyList<string> allowedHosts)
    {
        var domain = cookie.Domain.TrimStart('.');
        var domainMatches = allowedHosts.Any(host =>
            host.Equals(domain, StringComparison.OrdinalIgnoreCase) ||
            host.EndsWith($".{domain}", StringComparison.OrdinalIgnoreCase));
        return domainMatches &&
            domain.Length is > 0 and <= 253 &&
            cookie.Path.Length is > 0 and <= 2048 && cookie.Path.StartsWith('/') &&
            cookie.Name.Length is > 0 and <= 256 &&
            cookie.Value.Length <= 8192 &&
            !ContainsCookieControlCharacters(cookie.Domain) &&
            !ContainsCookieControlCharacters(cookie.Path) &&
            !ContainsCookieControlCharacters(cookie.Name) &&
            !ContainsCookieControlCharacters(cookie.Value);
    }

    /// <summary>Rejects characters that could create extra fields or rows in a Netscape cookie file.</summary>
    private static bool ContainsCookieControlCharacters(string value)
    {
        return value.IndexOfAny(['\t', '\r', '\n']) >= 0;
    }

    [GeneratedRegex("^[a-zA-Z0-9-]{1,64}$")]
    private static partial Regex JobIdPattern();
}
