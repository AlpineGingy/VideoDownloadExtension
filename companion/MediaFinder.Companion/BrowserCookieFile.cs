using System.Globalization;
using System.Text;

namespace MediaFinder.Companion;

/// <summary>Creates and removes a short-lived Netscape cookie file for one yt-dlp job.</summary>
public static class BrowserCookieFile
{
    /// <summary>Writes validated Chrome-session cookies to a uniquely named local temporary file.</summary>
    public static async Task<string> CreateAsync(
        IReadOnlyList<BrowserCookie> cookies,
        CancellationToken cancellationToken)
    {
        var path = Path.Combine(Path.GetTempPath(), $"media-finder-{Guid.NewGuid():N}.cookies.txt");
        await using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        await using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
        {
            await writer.WriteLineAsync("# Netscape HTTP Cookie File");
            await writer.WriteLineAsync("# Temporary file created by Media Finder and deleted after this download.");
            foreach (var cookie in cookies)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var includeSubdomains = cookie.HostOnly ? "FALSE" : "TRUE";
                var secure = cookie.Secure ? "TRUE" : "FALSE";
                var expires = cookie.ExpirationDate > 0
                    ? Math.Floor(cookie.ExpirationDate).ToString(CultureInfo.InvariantCulture)
                    : "0";
                await writer.WriteLineAsync(string.Join('\t',
                    cookie.Domain,
                    includeSubdomains,
                    cookie.Path,
                    secure,
                    expires,
                    cookie.Name,
                    cookie.Value));
            }
        }

        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        return path;
    }

    /// <summary>Best-effort deletion ensures session cookies do not remain on disk after a job.</summary>
    public static void Delete(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try
        {
            File.Delete(path);
        }
        catch (IOException)
        {
            // A finishing child process may briefly retain its file handle; startup cleanup is intentionally avoided.
        }
        catch (UnauthorizedAccessException)
        {
            // Failure to clean up is reported only through local OS controls to avoid exposing cookie details.
        }
    }
}
