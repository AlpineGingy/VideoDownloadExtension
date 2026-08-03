namespace MediaFinder.Companion;

/// <summary>Describes one validated command received from the Chrome extension.</summary>
public sealed class NativeRequest
{
    public string Type { get; init; } = string.Empty;
    public string JobId { get; init; } = string.Empty;
    public string Url { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string CookieSourceUrl { get; init; } = string.Empty;
    public bool UseChromeSessionCookies { get; init; }
    public IReadOnlyList<BrowserCookie> Cookies { get; init; } = [];
    public DownloadOptions? Options { get; init; } = new();
}

/// <summary>Contains one site-scoped Chrome cookie sent over the local native channel.</summary>
public sealed class BrowserCookie
{
    public string Domain { get; init; } = string.Empty;
    public bool HostOnly { get; init; }
    public string Path { get; init; } = "/";
    public bool Secure { get; init; }
    public double ExpirationDate { get; init; }
    public string Name { get; init; } = string.Empty;
    public string Value { get; init; } = string.Empty;
}

/// <summary>Contains the supported yt-dlp choices without exposing arbitrary command arguments.</summary>
public sealed class DownloadOptions
{
    public string CookiesBrowser { get; init; } = "none";
    public string Quality { get; init; } = "best";
    public string Container { get; init; } = "auto";
    public int ConcurrentFragments { get; init; } = 1;
    public string FilenameStyle { get; init; } = "pageTitle";
    public string OutputFolder { get; init; } = "mediaFinder";
    public bool EmbedMetadata { get; init; }
    public bool EmbedThumbnail { get; init; }
    public bool EmbedEnglishSubtitles { get; init; }
}

/// <summary>Represents status, progress, completion, or error information sent to Chrome.</summary>
public sealed class NativeResponse
{
    public string Type { get; init; } = "status";
    public string JobId { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public double? Percent { get; init; }
    public string Message { get; init; } = string.Empty;
    public string OutputDirectory { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string ThumbnailUrl { get; init; } = string.Empty;
    public string Duration { get; init; } = string.Empty;
    public string LogPath { get; init; } = string.Empty;
    public string LogText { get; init; } = string.Empty;
    public bool? YtDlpAvailable { get; init; }
    public bool? FfmpegAvailable { get; init; }
    public bool? DenoAvailable { get; init; }
    public int ProtocolVersion { get; init; }
}
