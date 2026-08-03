using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MediaFinder.Companion;

/// <summary>Runs validated yt-dlp jobs and streams their lifecycle back to Chrome.</summary>
public sealed partial class YtDlpRunner(NativeMessageWriter writer)
{
    private readonly ConcurrentDictionary<string, (CancellationTokenSource Cancellation, Task Task, string Url)> _jobs = new();
    private readonly Dictionary<string, string> _activeUrls = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, string> _logPaths = new();
    private readonly object _jobStartLock = new();

    /// <summary>Reports whether the required yt-dlp executable can currently be found.</summary>
    public bool IsYtDlpAvailable => FindYtDlp() is not null;

    /// <summary>Reports whether FFmpeg can currently be found for merging and conversion.</summary>
    public bool IsFfmpegAvailable => ExecutableLocator.Find("ffmpeg", "MEDIA_FINDER_FFMPEG") is not null;

    /// <summary>Reports whether the recommended JavaScript runtime is available for YouTube extraction.</summary>
    public bool IsDenoAvailable => FindDeno() is not null;

    /// <summary>Returns an absolute path for one of the extension's allow-listed destinations.</summary>
    public static string GetOutputDirectory(string? outputFolder = "mediaFinder")
    {
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrWhiteSpace(userProfile))
        {
            userProfile = Environment.GetEnvironmentVariable(OperatingSystem.IsWindows() ? "USERPROFILE" : "HOME");
        }
        if (string.IsNullOrWhiteSpace(userProfile))
        {
            userProfile = AppContext.BaseDirectory;
        }

        var downloadsDirectory = Path.Combine(userProfile, "Downloads");
        var destination = outputFolder switch
        {
            "downloads" => downloadsDirectory,
            "videos" => ResolveSpecialFolder(Environment.SpecialFolder.MyVideos, Path.Combine(userProfile, "Videos")),
            "desktop" => ResolveSpecialFolder(Environment.SpecialFolder.DesktopDirectory, Path.Combine(userProfile, "Desktop")),
            _ => Path.Combine(downloadsDirectory, "Media Finder")
        };
        return Path.GetFullPath(destination);
    }

    /// <summary>Uses the operating system's folder when available and a predictable profile path otherwise.</summary>
    private static string ResolveSpecialFolder(Environment.SpecialFolder folder, string fallback)
    {
        var resolved = Environment.GetFolderPath(folder);
        return string.IsNullOrWhiteSpace(resolved) ? fallback : resolved;
    }

    /// <summary>Starts a download in the background when its identifier is not already active.</summary>
    public bool TryStart(NativeRequest request, out string error)
    {
        var ytDlpPath = FindYtDlp();
        if (ytDlpPath is null)
        {
            error = "yt-dlp was not found. Install it or place it beside the Media Finder companion.";
            return false;
        }
        if (IsYouTubeUrl(request.Url) && !IsDenoAvailable)
        {
            error = "Deno was not found. Reinstall the companion to enable reliable YouTube downloads.";
            return false;
        }

        CancellationTokenSource cancellation;
        Task task;
        lock (_jobStartLock)
        {
            if (_jobs.ContainsKey(request.JobId))
            {
                error = "A download with this job identifier is already running.";
                return false;
            }
            if (_activeUrls.ContainsKey(request.Url))
            {
                error = "This exact media URL is already downloading.";
                return false;
            }

            cancellation = new CancellationTokenSource();
            task = Task.Run(() => RunJobAsync(request, ytDlpPath, cancellation.Token));
            _jobs[request.JobId] = (cancellation, task, request.Url);
            _activeUrls[request.Url] = request.JobId;
        }

        _ = task.ContinueWith(
            _ => RemoveJob(request.JobId),
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
        error = string.Empty;
        return true;
    }

    /// <summary>Cancels an active job and returns whether a matching job existed.</summary>
    public bool Cancel(string jobId)
    {
        if (!_jobs.TryGetValue(jobId, out var job))
        {
            return false;
        }

        job.Cancellation.Cancel();
        return true;
    }

    /// <summary>Returns a copyable tail of a log created by this running companion process.</summary>
    public async Task<NativeResponse> ReadLogAsync(string jobId)
    {
        try
        {
            var path = ResolveLogPath(jobId);
            if (path is null)
            {
                return new NativeResponse
                {
                    Type = "downloadLog",
                    JobId = jobId,
                    Status = "error",
                    Message = "This log is no longer available. Retry the download to create a new diagnostic log."
                };
            }
            return new NativeResponse
            {
                Type = "downloadLog",
                JobId = jobId,
                Status = "ready",
                Message = "Diagnostic log loaded.",
                LogPath = path,
                LogText = await DownloadJobLogger.ReadTailAsync(path)
            };
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return new NativeResponse
            {
                Type = "downloadLog",
                JobId = jobId,
                Status = "error",
                Message = $"The diagnostic log could not be read: {exception.Message}",
                LogPath = _logPaths.GetValueOrDefault(jobId) ?? string.Empty
            };
        }
    }

    /// <summary>Finds a known job log, including after Chrome starts a fresh companion process.</summary>
    private string? ResolveLogPath(string jobId)
    {
        if (_logPaths.TryGetValue(jobId, out var rememberedPath) && File.Exists(rememberedPath))
        {
            return rememberedPath;
        }

        var safeJobId = string.Concat(jobId.Where(character => char.IsLetterOrDigit(character) || character is '-' or '_'));
        if (safeJobId.Length == 0 || safeJobId != jobId)
        {
            return null;
        }
        var path = Directory.Exists(DownloadJobLogger.GetLogDirectory())
            ? Directory.GetFiles(DownloadJobLogger.GetLogDirectory(), $"media-finder-*-{safeJobId}.log")
                .OrderByDescending(File.GetLastWriteTimeUtc)
                .FirstOrDefault()
            : null;
        if (path is not null)
        {
            _logPaths[jobId] = path;
        }
        return path;
    }

    /// <summary>Waits for active downloads to finish when Chrome closes the input pipe.</summary>
    public async Task WaitForAllAsync()
    {
        await Task.WhenAll(_jobs.Values.Select(job => job.Task).ToArray());
    }

    /// <summary>Runs one yt-dlp process and converts output lines into structured progress.</summary>
    private async Task RunJobAsync(NativeRequest request, string ytDlpPath, CancellationToken cancellationToken)
    {
        var outputDirectory = GetOutputDirectory(request.Options?.OutputFolder);
        var temporaryDirectory = GetJobTemporaryDirectory(request.JobId);
        Directory.CreateDirectory(outputDirectory);
        Directory.CreateDirectory(temporaryDirectory);
        string? completedFile = null;
        string? lastError = null;
        string? cookieFilePath = null;
        CancellationTokenSource? heartbeatCancellation = null;
        Task? heartbeatTask = null;
        long lastOutputTimestamp = Stopwatch.GetTimestamp();
        var denoPath = FindDeno();
        var ffmpegPath = FindFfmpeg();
        var logger = await TryCreateLoggerAsync(request.JobId);
        if (logger is not null)
        {
            _logPaths[request.JobId] = logger.Path;
        }

        try
        {
            await SafeLogAsync(logger, "companion", $"Job={request.JobId}; URL={RedactUrlQuery(request.Url)}");
            await SafeLogAsync(logger, "companion", $"Output={outputDirectory}; yt-dlp={ytDlpPath}; Deno={denoPath ?? "not found"}; FFmpeg={ffmpegPath ?? "not found"}");
            await SafeLogAsync(logger, "companion", $"Options: quality={request.Options?.Quality}; container={request.Options?.Container}; fragments={request.Options?.ConcurrentFragments}; filenameStyle={request.Options?.FilenameStyle}; cookies={request.Options?.CookiesBrowser}; transferredCookieCount={request.Cookies.Count}");
            if (request.UseChromeSessionCookies)
            {
                await SafeLogAsync(logger, "cookies", "Creating a temporary Netscape cookie file from site-matching Chrome cookies. Cookie names and values are not logged.");
                cookieFilePath = await BrowserCookieFile.CreateAsync(request.Cookies, cancellationToken);
            }

            await writer.WriteAsync(new NativeResponse
            {
                Type = "downloadUpdate",
                JobId = request.JobId,
                Status = "started",
                Message = request.Cookies.Count > 0
                    ? "Chrome session cookies loaded. Starting yt-dlp."
                    : "yt-dlp started the download.",
                OutputDirectory = outputDirectory,
                LogPath = logger?.Path ?? string.Empty
            });

            var arguments = YtDlpArgumentBuilder.Build(
                request,
                outputDirectory,
                cookieFilePath,
                denoPath,
                ffmpegPath,
                temporaryDirectory);
            await SafeLogAsync(logger, "command", FormatArguments(ytDlpPath, arguments, cookieFilePath));
            using var process = CreateProcess(ytDlpPath, arguments);
            if (!process.Start())
            {
                throw new InvalidOperationException("The operating system did not start yt-dlp.");
            }
            process.StandardInput.Close();
            await SafeLogAsync(logger, "companion", $"yt-dlp process started. PID={process.Id}");
            using var cancellationRegistration = cancellationToken.Register(() => KillProcess(process));
            heartbeatCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            heartbeatTask = ReportHeartbeatAsync(
                request.JobId,
                outputDirectory,
                () => Interlocked.Read(ref lastOutputTimestamp),
                heartbeatCancellation.Token);

            var standardOutputTask = ReadLinesAsync(process.StandardOutput, async line =>
            {
                Interlocked.Exchange(ref lastOutputTimestamp, Stopwatch.GetTimestamp());
                await SafeLogAsync(logger, "stdout", line);
                completedFile = ReadCompletedFile(line) ?? completedFile;
                var metadata = ReadMetadata(line);
                if (metadata is not null)
                {
                    await writer.WriteAsync(new NativeResponse
                    {
                        Type = "downloadUpdate",
                        JobId = request.JobId,
                        Status = "metadata",
                        Message = "Media details found.",
                        OutputDirectory = outputDirectory,
                        Title = metadata.Title,
                        ThumbnailUrl = metadata.ThumbnailUrl,
                        Duration = metadata.Duration
                    });
                }
                await ReportOutputAsync(request.JobId, line, outputDirectory);
            });
            var standardErrorTask = ReadLinesAsync(process.StandardError, line =>
            {
                return HandleStandardErrorAsync(line);

                async Task HandleStandardErrorAsync(string errorLine)
                {
                    Interlocked.Exchange(ref lastOutputTimestamp, Stopwatch.GetTimestamp());
                    await SafeLogAsync(logger, "stderr", errorLine);
                    if (!string.IsNullOrWhiteSpace(errorLine))
                    {
                        lastError = errorLine;
                    }
                    await ReportOutputAsync(request.JobId, errorLine, outputDirectory);
                }
            });

            await process.WaitForExitAsync(cancellationToken);
            await Task.WhenAll(standardOutputTask, standardErrorTask);
            await SafeLogAsync(logger, "companion", $"yt-dlp exited with code {process.ExitCode}.");

            if (process.ExitCode != 0)
            {
                throw new InvalidOperationException(ExplainError(lastError, process.ExitCode));
            }

            await writer.WriteAsync(new NativeResponse
            {
                Type = "downloadUpdate",
                JobId = request.JobId,
                Status = "completed",
                Percent = 100,
                Message = completedFile is null
                    ? "Download completed."
                    : $"Saved {Path.GetFileName(completedFile)}",
                OutputDirectory = outputDirectory,
                LogPath = logger?.Path ?? string.Empty
            });
            await SafeLogAsync(logger, "companion", $"Job completed. File={completedFile ?? "not reported by yt-dlp"}");
        }
        catch (OperationCanceledException)
        {
            await SafeLogAsync(logger, "companion", "Job cancelled by the user or Chrome.");
            await writer.WriteAsync(new NativeResponse
            {
                Type = "downloadUpdate",
                JobId = request.JobId,
                Status = "cancelled",
                Message = "Download cancelled.",
                OutputDirectory = outputDirectory,
                LogPath = logger?.Path ?? string.Empty
            });
        }
        catch (Exception exception)
        {
            await SafeLogAsync(logger, "error", exception.ToString());
            await writer.WriteAsync(new NativeResponse
            {
                Type = "downloadUpdate",
                JobId = request.JobId,
                Status = "error",
                Message = exception.Message,
                OutputDirectory = outputDirectory,
                LogPath = logger?.Path ?? string.Empty
            });
        }
        finally
        {
            if (heartbeatCancellation is not null)
            {
                heartbeatCancellation.Cancel();
            }
            if (heartbeatTask is not null)
            {
                try
                {
                    await heartbeatTask;
                }
                catch (OperationCanceledException)
                {
                    // Cancellation is the normal way to stop the heartbeat when yt-dlp exits.
                }
            }
            heartbeatCancellation?.Dispose();
            BrowserCookieFile.Delete(cookieFilePath);
            DeleteJobTemporaryDirectory(temporaryDirectory);
            await SafeLogAsync(logger, "companion", "Temporary cookie and isolated job files cleanup completed. Log closed.");
            if (logger is not null)
            {
                await logger.DisposeAsync();
            }
        }
    }

    /// <summary>Returns a job-scoped directory so concurrent yt-dlp fragment files never collide.</summary>
    public static string GetJobTemporaryDirectory(string jobId)
    {
        var safeJobId = string.Concat(jobId.Where(character => char.IsLetterOrDigit(character) || character is '-' or '_'));
        if (safeJobId.Length == 0 || safeJobId != jobId)
        {
            throw new ArgumentException("The job identifier cannot be used for temporary files.", nameof(jobId));
        }
        return Path.GetFullPath(Path.Combine(Path.GetTempPath(), "MediaFinder", safeJobId));
    }

    /// <summary>Deletes only the validated job directory beneath Media Finder's temporary root.</summary>
    private static void DeleteJobTemporaryDirectory(string directory)
    {
        try
        {
            var root = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "MediaFinder"))
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var resolvedDirectory = Path.GetFullPath(directory);
            var isChild = resolvedDirectory.StartsWith(
                $"{root}{Path.DirectorySeparatorChar}",
                StringComparison.OrdinalIgnoreCase);
            if (isChild && Directory.Exists(resolvedDirectory))
            {
                Directory.Delete(resolvedDirectory, recursive: true);
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // A stale temporary directory is safer than interrupting a completed media job.
        }
    }

    /// <summary>Creates diagnostics without allowing a log-directory problem to block a download.</summary>
    private static async Task<DownloadJobLogger?> TryCreateLoggerAsync(string jobId)
    {
        try
        {
            return await DownloadJobLogger.CreateAsync(jobId);
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>Writes a diagnostic entry while keeping a later disk problem from stopping yt-dlp.</summary>
    private static async Task SafeLogAsync(DownloadJobLogger? logger, string source, string message)
    {
        if (logger is null) return;
        try
        {
            await logger.WriteAsync(source, message);
        }
        catch (Exception exception) when (exception is IOException or ObjectDisposedException)
        {
            // The media job remains more important than an optional diagnostic write.
        }
    }

    /// <summary>Formats the executable and arguments while redacting signed URL queries and cookie paths.</summary>
    private static string FormatArguments(string executablePath, IReadOnlyList<string> arguments, string? cookieFilePath)
    {
        var safeArguments = arguments.Select(argument =>
        {
            if (!string.IsNullOrWhiteSpace(cookieFilePath) && argument == cookieFilePath)
            {
                return "<temporary-cookie-file>";
            }
            return Uri.TryCreate(argument, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https"
                ? RedactUrlQuery(argument)
                : argument;
        });
        return string.Join(" ", new[] { executablePath }.Concat(safeArguments).Select(QuoteForLog));
    }

    /// <summary>Adds readable quotes to diagnostic arguments without creating an executable shell command.</summary>
    private static string QuoteForLog(string value)
    {
        return value.Any(char.IsWhiteSpace) ? $"\"{value.Replace("\"", "\\\"")}\"" : value;
    }

    /// <summary>Removes query values that may contain short-lived authorization tokens from copied logs.</summary>
    private static string RedactUrlQuery(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || string.IsNullOrEmpty(uri.Query))
        {
            return value;
        }
        return uri.GetLeftPart(UriPartial.Path) + "?<redacted>";
    }

    /// <summary>Turns common yt-dlp failures into a useful next action while preserving raw output in the log.</summary>
    private static string ExplainError(string? lastError, int exitCode)
    {
        if (lastError?.Contains("Requested format is not available", StringComparison.OrdinalIgnoreCase) == true)
        {
            return "The selected quality is unavailable for this URL. Retry with Best available, then use Copy log if it still fails.";
        }
        return lastError ?? $"yt-dlp exited with code {exitCode}. Use Copy log for the full diagnostic output.";
    }

    /// <summary>Creates a hidden child process with every argument passed without a command shell.</summary>
    private static Process CreateProcess(string executablePath, IReadOnlyList<string> arguments)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = executablePath,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }
        return new Process { StartInfo = startInfo };
    }

    /// <summary>Reads redirected process output asynchronously until the stream closes.</summary>
    private static async Task ReadLinesAsync(StreamReader reader, Func<string, Task> onLine)
    {
        while (await reader.ReadLineAsync() is { } line)
        {
            await onLine(line);
        }
    }

    /// <summary>Shows that yt-dlp is alive when extraction, networking, or FFmpeg produces no output.</summary>
    private async Task ReportHeartbeatAsync(
        string jobId,
        string outputDirectory,
        Func<long> readLastOutputTimestamp,
        CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        while (await timer.WaitForNextTickAsync(cancellationToken))
        {
            var quietTime = Stopwatch.GetElapsedTime(readLastOutputTimestamp());
            if (quietTime < TimeSpan.FromSeconds(2)) continue;
            await writer.WriteAsync(new NativeResponse
            {
                Type = "downloadUpdate",
                JobId = jobId,
                Message = $"yt-dlp is still working • {quietTime.TotalSeconds:0}s since its last output",
                OutputDirectory = outputDirectory
            }, cancellationToken);
        }
    }

    /// <summary>Parses yt-dlp's machine-readable progress line and reports meaningful changes.</summary>
    private async Task ReportProgressAsync(string jobId, string line, string outputDirectory)
    {
        var progress = ReadProgress(line);
        if (progress is null)
        {
            return;
        }

        await writer.WriteAsync(new NativeResponse
        {
            Type = "downloadUpdate",
            JobId = jobId,
            Status = "downloading",
            Percent = progress.Percent,
            Message = progress.Message,
            OutputDirectory = outputDirectory
        });
    }

    /// <summary>Parses percentage, speed, ETA, and byte totals from a Media Finder progress line.</summary>
    public static YtDlpProgress? ReadProgress(string line)
    {
        var match = ProgressPattern().Match(line);
        if (!match.Success ||
            !double.TryParse(match.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var percent))
        {
            return null;
        }

        var speed = NormalizeProgressValue(match.Groups[2].Value);
        var eta = NormalizeProgressValue(match.Groups[3].Value);
        var downloaded = NormalizeProgressValue(match.Groups[4].Value);
        var total = NormalizeProgressValue(match.Groups[5].Value);
        var details = new List<string> { $"Downloading {percent:0.0}%" };
        if (speed.Length > 0) details.Add(speed);
        if (eta.Length > 0) details.Add($"ETA {eta}");
        if (downloaded.Length > 0)
        {
            details.Add(total.Length > 0 ? $"{downloaded} / {total}" : downloaded);
        }
        return new YtDlpProgress(Math.Clamp(percent, 0, 100), string.Join(" • ", details));
    }

    /// <summary>Removes yt-dlp placeholders so unavailable progress details do not clutter the UI.</summary>
    private static string NormalizeProgressValue(string value)
    {
        var normalized = value.Trim();
        return normalized.Equals("N/A", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("NA", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("Unknown", StringComparison.OrdinalIgnoreCase)
            ? string.Empty
            : normalized;
    }

    /// <summary>Reports download percentages or a concise extraction phase from yt-dlp output.</summary>
    private async Task ReportOutputAsync(string jobId, string line, string outputDirectory)
    {
        var progressMatch = ProgressPattern().Match(line);
        if (progressMatch.Success)
        {
            await ReportProgressAsync(jobId, line, outputDirectory);
            return;
        }

        var processingActivity = line switch
        {
            var value when value.StartsWith("[Merger]", StringComparison.OrdinalIgnoreCase) => "Merging video and audio...",
            var value when value.StartsWith("[ExtractAudio]", StringComparison.OrdinalIgnoreCase) => "Converting audio...",
            var value when value.StartsWith("[EmbedSubtitle]", StringComparison.OrdinalIgnoreCase) => "Embedding subtitles...",
            var value when value.StartsWith("[Metadata]", StringComparison.OrdinalIgnoreCase) => "Embedding metadata...",
            var value when value.StartsWith("[ThumbnailsConvertor]", StringComparison.OrdinalIgnoreCase) => "Converting thumbnail...",
            var value when value.Contains("Deleting original file", StringComparison.OrdinalIgnoreCase) => "Finalizing downloaded files...",
            _ => string.Empty
        };
        var activity = processingActivity.Length > 0 ? processingActivity : line switch
        {
            var value when value.Contains("Extracting URL", StringComparison.OrdinalIgnoreCase) => "Reading page details...",
            var value when value.Contains("Downloading webpage", StringComparison.OrdinalIgnoreCase) => "Connecting to the website...",
            var value when value.Contains("Downloading m3u8 information", StringComparison.OrdinalIgnoreCase) => "Reading the stream playlist...",
            var value when value.Contains("Checking m3u8 live status", StringComparison.OrdinalIgnoreCase) => "Checking whether the stream is live...",
            var value when value.Contains("player API JSON", StringComparison.OrdinalIgnoreCase) => "Checking available video formats...",
            var value when value.Contains("Solving JS challenges", StringComparison.OrdinalIgnoreCase) => "Preparing protected video formats...",
            var value when value.StartsWith("[info]", StringComparison.OrdinalIgnoreCase) => "Selecting video and audio...",
            var value when value.Contains("Destination:", StringComparison.OrdinalIgnoreCase) => "Starting media transfer...",
            _ => string.Empty
        };
        if (string.IsNullOrWhiteSpace(activity)) return;

        await writer.WriteAsync(new NativeResponse
        {
            Type = "downloadUpdate",
            JobId = jobId,
            Status = processingActivity.Length > 0 ? "processing" : "preparing",
            Message = activity,
            OutputDirectory = outputDirectory
        });
    }

    /// <summary>Extracts the final filepath emitted by the yt-dlp after-move print template.</summary>
    private static string? ReadCompletedFile(string line)
    {
        const string prefix = "[MediaFinderFile]";
        return line.StartsWith(prefix, StringComparison.Ordinal) ? line[prefix.Length..].Trim() : null;
    }

    /// <summary>Parses the small JSON object printed by yt-dlp before a download starts.</summary>
    public static YtDlpMetadata? ReadMetadata(string line)
    {
        const string prefix = "[MediaFinderMeta]";
        if (!line.StartsWith(prefix, StringComparison.Ordinal))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(line[prefix.Length..]);
            var root = document.RootElement;
            return new YtDlpMetadata(
                ReadString(root, "title"),
                ReadString(root, "thumbnail"),
                ReadString(root, "duration_string"));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Reads an optional JSON string without allowing null values to escape into responses.</summary>
    private static string ReadString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty
            : string.Empty;
    }

    /// <summary>Terminates yt-dlp and child FFmpeg processes when a user cancels.</summary>
    private static void KillProcess(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }
        catch (InvalidOperationException)
        {
            // The process exited between the HasExited check and the kill request.
        }
    }

    /// <summary>Removes a completed job and releases its cancellation token source.</summary>
    private void RemoveJob(string jobId)
    {
        if (_jobs.TryRemove(jobId, out var job))
        {
            lock (_jobStartLock)
            {
                if (_activeUrls.GetValueOrDefault(job.Url) == jobId)
                {
                    _activeUrls.Remove(job.Url);
                }
            }
            job.Cancellation.Dispose();
        }
    }

    /// <summary>Finds yt-dlp using an explicit override, the companion folder, or PATH.</summary>
    private static string? FindYtDlp()
    {
        return ExecutableLocator.Find("yt-dlp", "MEDIA_FINDER_YTDLP");
    }

    /// <summary>Finds the recommended JavaScript runtime beside the companion or on PATH.</summary>
    private static string? FindDeno()
    {
        return ExecutableLocator.Find("deno", "MEDIA_FINDER_DENO");
    }

    /// <summary>Finds the installer's private FFmpeg binary before checking the system PATH.</summary>
    private static string? FindFfmpeg()
    {
        return ExecutableLocator.Find("ffmpeg", "MEDIA_FINDER_FFMPEG");
    }

    /// <summary>Identifies YouTube page URLs that require the external JavaScript challenge runtime.</summary>
    private static bool IsYouTubeUrl(string url)
    {
        return Uri.TryCreate(url, UriKind.Absolute, out var uri) &&
            (uri.Host.Equals("youtu.be", StringComparison.OrdinalIgnoreCase) ||
             uri.Host.Equals("youtube.com", StringComparison.OrdinalIgnoreCase) ||
             uri.Host.EndsWith(".youtube.com", StringComparison.OrdinalIgnoreCase));
    }

    [GeneratedRegex(@"\[MediaFinder\]\s*(\d+(?:\.\d+)?)%\|([^|]*)\|([^|]*)\|([^|]*)\|([^\r\n]*)")]
    private static partial Regex ProgressPattern();
}

/// <summary>Contains the media details yt-dlp discovers before downloading bytes.</summary>
public sealed record YtDlpMetadata(string Title, string ThumbnailUrl, string Duration);

/// <summary>Contains user-facing yt-dlp transfer progress parsed from one output line.</summary>
public sealed record YtDlpProgress(double Percent, string Message);
