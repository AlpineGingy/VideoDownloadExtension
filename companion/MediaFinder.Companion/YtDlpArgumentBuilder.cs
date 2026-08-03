using System.Text.RegularExpressions;

namespace MediaFinder.Companion;

/// <summary>Builds a fixed yt-dlp argument list from validated download options.</summary>
public static class YtDlpArgumentBuilder
{
    /// <summary>Creates arguments for progress reporting, output location, and selected options.</summary>
    public static IReadOnlyList<string> Build(
        NativeRequest request,
        string outputDirectory,
        string? cookieFilePath = null,
        string? denoPath = null,
        string? ffmpegPath = null,
        string? temporaryDirectory = null)
    {
        var options = request.Options
            ?? throw new ArgumentException("Validated download options are required.", nameof(request));
        var args = new List<string>
        {
            "--newline",
            "--continue",
            "--no-overwrites",
            "--no-playlist",
            "--socket-timeout", "20",
            "--retries", "5",
            "--fragment-retries", "5",
            "--extractor-retries", "3",
            "--progress",
            "--progress-delta", "0.2",
            "--verbose",
            "--no-color",
            "--paths", outputDirectory,
            "--windows-filenames",
            "--trim-filenames", "180",
            "--output", BuildOutputTemplate(request),
            "--progress-template", "download:[MediaFinder]%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._downloaded_bytes_str)s|%(progress._total_bytes_str)s",
            "--print", "before_dl:[MediaFinderMeta]%(.{title,thumbnail,duration_string})j",
            "--print", "after_move:[MediaFinderFile]%(filepath)s"
        };

        if (!string.IsNullOrWhiteSpace(temporaryDirectory))
        {
            args.AddRange(["--paths", $"temp:{temporaryDirectory}"]);
        }

        if (!string.IsNullOrWhiteSpace(denoPath))
        {
            args.AddRange(["--js-runtimes", $"deno:{denoPath}"]);
        }

        if (!string.IsNullOrWhiteSpace(ffmpegPath))
        {
            args.AddRange(["--ffmpeg-location", Path.GetDirectoryName(ffmpegPath)!]);
        }

        if (!string.IsNullOrWhiteSpace(cookieFilePath))
        {
            args.AddRange(["--cookies", cookieFilePath]);
        }
        else if (options.CookiesBrowser is "chrome" or "edge" or "firefox")
        {
            args.AddRange(["--cookies-from-browser", options.CookiesBrowser]);
        }

        if (options.Quality == "1080p")
        {
            args.AddRange(["-f", "bestvideo*[height<=1080]+bestaudio/best[height<=1080]/bestvideo*+bestaudio/best"]);
        }
        else if (options.Quality == "720p")
        {
            args.AddRange(["-f", "bestvideo*[height<=720]+bestaudio/best[height<=720]/bestvideo*+bestaudio/best"]);
        }
        else if (options.Quality == "audio")
        {
            args.AddRange(["-x", "--audio-format", "mp3"]);
        }

        if (options.Quality != "audio" && options.Container is "mp4" or "mkv")
        {
            args.AddRange(["--merge-output-format", options.Container]);
        }

        if (options.EmbedMetadata)
        {
            args.Add("--embed-metadata");
        }
        if (options.EmbedThumbnail)
        {
            args.Add("--embed-thumbnail");
        }
        if (options.EmbedEnglishSubtitles && options.Quality != "audio")
        {
            args.AddRange(["--write-subs", "--write-auto-subs", "--sub-langs", "en.*", "--embed-subs"]);
        }
        if (options.ConcurrentFragments > 1)
        {
            args.AddRange(["--concurrent-fragments", options.ConcurrentFragments.ToString()]);
        }

        args.Add(request.Url);
        return args;
    }

    /// <summary>Chooses one fixed, allow-listed filename template for the requested naming style.</summary>
    public static string BuildOutputTemplate(NativeRequest request)
    {
        var options = request.Options
            ?? throw new ArgumentException("Validated download options are required.", nameof(request));
        return options.FilenameStyle switch
        {
            "pageTitle" when !string.IsNullOrWhiteSpace(request.Title) && options.Quality == "audio" => $"{SanitizePageTitle(request.Title)} [audio].%(ext)s",
            "pageTitle" when !string.IsNullOrWhiteSpace(request.Title) => $"{SanitizePageTitle(request.Title)} [%(resolution)s].%(ext)s",
            "titleQuality" when options.Quality == "audio" => "%(title)s [audio].%(ext)s",
            "titleQuality" => "%(title)s [%(resolution)s].%(ext)s",
            "titleId" => "%(title)s [%(id)s].%(ext)s",
            _ => "%(title)s.%(ext)s"
        };
    }

    /// <summary>Turns an untrusted browser page title into a short cross-platform filename literal.</summary>
    public static string SanitizePageTitle(string title)
    {
        var invalidCharacters = "<>:\"/\\|?*";
        var replaced = new string(title
            .Select(character => char.IsControl(character) || invalidCharacters.Contains(character) ? ' ' : character)
            .ToArray());
        var normalized = Regex.Replace(replaced, @"\s+", " ").Trim().Trim('.');
        if (normalized.Length == 0) normalized = "media";
        if (normalized.Length > 120) normalized = normalized[..120].TrimEnd().TrimEnd('.');
        return normalized.Replace("%", "%%", StringComparison.Ordinal);
    }
}
