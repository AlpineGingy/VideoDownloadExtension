using System.Buffers.Binary;
using System.Text.Json;
using MediaFinder.Companion;

/// <summary>Runs dependency-free protocol and argument validation checks.</summary>
public static class Program
{
    /// <summary>Executes all companion smoke tests and returns a nonzero exit code on failure.</summary>
    public static async Task<int> Main()
    {
        try
        {
            ValidateSafeRequest();
            RejectUnsafeRequest();
            BuildExpectedArguments();
            ResolveAbsoluteOutputDirectory();
            ResolveIsolatedTemporaryDirectories();
            ParsePrintedMetadata();
            ParseDetailedProgress();
            await WriteDiagnosticLogAsync();
            await WriteCookieFileAsync();
            await ReadNativeMessageAsync();
            await WriteNativeMessageAsync();
            await IgnoreClosedNativeOutputAsync();
            Console.WriteLine("Companion smoke tests passed (12 checks).");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception.Message);
            return 1;
        }
    }

    /// <summary>Proves ordinary HTTPS downloads and allow-listed options pass validation.</summary>
    private static void ValidateSafeRequest()
    {
        Assert(DownloadRequestValidator.Validate(CreateRequest()) is null, "A safe request was rejected.");
    }

    /// <summary>Proves local file URLs and arbitrary option values cannot reach yt-dlp.</summary>
    private static void RejectUnsafeRequest()
    {
        var request = new NativeRequest
        {
            Type = "download",
            JobId = "job-2",
            Url = "file:///etc/passwd",
            Options = new DownloadOptions { Quality = "--exec" }
        };
        Assert(DownloadRequestValidator.Validate(request) is not null, "An unsafe request was accepted.");
        Assert(
            DownloadRequestValidator.Validate(new NativeRequest
            {
                Type = "download",
                JobId = "job-3",
                Url = "https://example.com/video",
                Options = null
            }) is not null,
            "A request with null options was accepted.");
        Assert(
            DownloadRequestValidator.Validate(new NativeRequest
            {
                Type = "download",
                JobId = "job-4",
                Url = "https://example.com/video",
                Options = new DownloadOptions { OutputFolder = "../../outside" }
            }) is not null,
            "An arbitrary output folder was accepted.");
        var unrelatedCookieRequest = CreateRequest();
        unrelatedCookieRequest = new NativeRequest
        {
            Type = unrelatedCookieRequest.Type,
            JobId = unrelatedCookieRequest.JobId,
            Url = unrelatedCookieRequest.Url,
            CookieSourceUrl = unrelatedCookieRequest.CookieSourceUrl,
            Options = unrelatedCookieRequest.Options,
            Cookies = [new BrowserCookie { Domain = ".unrelated.test", Name = "SID", Value = "secret" }]
        };
        Assert(
            DownloadRequestValidator.Validate(unrelatedCookieRequest) is not null,
            "A cookie for an unrelated domain was accepted.");
    }

    /// <summary>Proves options become separate process arguments without shell composition.</summary>
    private static void BuildExpectedArguments()
    {
        var args = YtDlpArgumentBuilder.Build(
            CreateRequest(),
            "/downloads/Media Finder",
            "/tmp/cookies.txt",
            temporaryDirectory: "/tmp/MediaFinder/job-1");
        Assert(args.Contains("--cookies"), "Temporary cookie-file option was not included.");
        Assert(args.Contains("/tmp/cookies.txt"), "Temporary cookie-file path was not included.");
        Assert(args.Contains("--no-playlist"), "Single-video mode was not enabled.");
        Assert(args.Contains("--socket-timeout"), "Socket timeout was not included.");
        Assert(args.Contains("--progress"), "Progress output was not explicitly enabled alongside print hooks.");
        Assert(args.Contains("--progress-delta"), "Progress update interval was not included.");
        Assert(args.Contains("--verbose"), "Detailed extraction logging was not enabled.");
        Assert(args.Contains("--output"), "A predictable output filename template was not included.");
        Assert(args.Contains("Example Lesson Intro [%(resolution)s].%(ext)s"), "The page-title filename was not sanitized as expected.");
        Assert(args.Contains("temp:/tmp/MediaFinder/job-1"), "The isolated temporary path was not included.");
        Assert(args.Contains("0.2"), "Fast progress reporting was not enabled.");
        Assert(args.Any(argument => argument.Contains("progress._speed_str")), "Progress output omitted transfer speed.");
        Assert(
            args.Any(argument => argument.Contains("bestvideo*+bestaudio/best")),
            "A quality preference did not include a best-available fallback.");
        Assert(args.Any(argument => argument.StartsWith("before_dl:[MediaFinderMeta]")), "Metadata output was not requested.");
        Assert(args[^1] == "https://example.com/watch?v=123&list=abc", "URL was modified or misplaced.");
        Assert(args.All(argument => !argument.Contains("yt-dlp ")), "Arguments unexpectedly contain a shell command.");
        var builtInCookieArgs = YtDlpArgumentBuilder.Build(
            CreateRequest(),
            "/downloads/Media Finder",
            cookieFilePath: null,
            denoPath: "/tools/deno",
            ffmpegPath: "/tools/ffmpeg");
        Assert(builtInCookieArgs.Contains("--cookies-from-browser"), "Built-in browser-cookie mode was not included.");
        Assert(builtInCookieArgs.Contains("--js-runtimes"), "Deno runtime option was not included.");
        Assert(builtInCookieArgs.Contains("--ffmpeg-location"), "The private FFmpeg location was not included.");
    }

    /// <summary>Proves restricted environments still receive an absolute download destination.</summary>
    private static void ResolveAbsoluteOutputDirectory()
    {
        Assert(
            Path.IsPathFullyQualified(YtDlpRunner.GetOutputDirectory()),
            "The companion output directory was not absolute.");
        Assert(
            YtDlpRunner.GetOutputDirectory("desktop") != YtDlpRunner.GetOutputDirectory("mediaFinder"),
            "Different destination presets unexpectedly resolved to the same folder.");
    }

    /// <summary>Proves concurrent jobs receive different fully-qualified fragment directories.</summary>
    private static void ResolveIsolatedTemporaryDirectories()
    {
        var first = YtDlpRunner.GetJobTemporaryDirectory("job-1");
        var second = YtDlpRunner.GetJobTemporaryDirectory("job-2");
        Assert(Path.IsPathFullyQualified(first), "The job temporary directory was not absolute.");
        Assert(first != second, "Concurrent jobs unexpectedly shared a temporary directory.");
    }

    /// <summary>Proves yt-dlp title, thumbnail, and duration output becomes structured metadata.</summary>
    private static void ParsePrintedMetadata()
    {
        var metadata = YtDlpRunner.ReadMetadata(
            "[MediaFinderMeta]{\"title\":\"Example video\",\"thumbnail\":\"https://example.com/thumb.jpg\",\"duration_string\":\"1:23\"}");
        Assert(metadata?.Title == "Example video", "The printed title was not parsed.");
        Assert(metadata?.ThumbnailUrl == "https://example.com/thumb.jpg", "The printed thumbnail was not parsed.");
        Assert(metadata?.Duration == "1:23", "The printed duration was not parsed.");
    }

    /// <summary>Proves detailed yt-dlp output becomes a concise percentage, speed, ETA, and byte message.</summary>
    private static void ParseDetailedProgress()
    {
        var progress = YtDlpRunner.ReadProgress(
            "[MediaFinder] 42.5%| 5.2MiB/s|00:12|20.4MiB|48.0MiB");
        Assert(progress?.Percent == 42.5, "The detailed download percentage was not parsed.");
        Assert(
            progress?.Message == "Downloading 42.5% • 5.2MiB/s • ETA 00:12 • 20.4MiB / 48.0MiB",
            "The detailed download message was not formatted correctly.");
        Assert(YtDlpRunner.ReadProgress("ordinary yt-dlp output") is null, "Unrelated output became progress.");
    }

    /// <summary>Proves a timestamped job log records elapsed output and can be copied while open.</summary>
    private static async Task WriteDiagnosticLogAsync()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"media-finder-log-test-{Guid.NewGuid():N}");
        string? path = null;
        try
        {
            await using (var logger = await DownloadJobLogger.CreateAsync("job-log-test", directory))
            {
                path = logger.Path;
                await logger.WriteAsync("stderr", "Requested format is not available");
                var openText = await DownloadJobLogger.ReadTailAsync(path);
                Assert(openText.Contains("[stderr] Requested format is not available"), "An open diagnostic log could not be copied.");
                Assert(openText.Contains(" +"), "Diagnostic output omitted elapsed timing.");
            }
            Assert(File.Exists(path), "The diagnostic log was not retained after completion.");
        }
        finally
        {
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, recursive: true);
            }
        }
    }

    /// <summary>Proves Chrome cookies use Netscape formatting and their temporary file is removable.</summary>
    private static async Task WriteCookieFileAsync()
    {
        var path = await BrowserCookieFile.CreateAsync(CreateRequest().Cookies, CancellationToken.None);
        try
        {
            var text = await File.ReadAllTextAsync(path);
            Assert(text.Contains(".example.com\tTRUE\t/\tTRUE\t"), "Cookie file formatting was invalid.");
            Assert(text.Contains("\tSID\ttest-value"), "Cookie file omitted the cookie value.");
        }
        finally
        {
            BrowserCookieFile.Delete(path);
        }
        Assert(!File.Exists(path), "Temporary cookie file was not deleted.");
    }

    /// <summary>Proves the reader accepts Chrome's little-endian length-prefixed JSON frame.</summary>
    private static async Task ReadNativeMessageAsync()
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(CreateRequest(), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var frame = new byte[payload.Length + sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(frame, payload.Length);
        payload.CopyTo(frame.AsSpan(sizeof(int)));

        await using var stream = new MemoryStream(frame);
        var request = await new NativeMessageReader(stream).ReadAsync(CancellationToken.None);
        Assert(request?.JobId == "job-1", "Native request frame was not read correctly.");
    }

    /// <summary>Proves the writer emits a valid length prefix followed by camel-case JSON.</summary>
    private static async Task WriteNativeMessageAsync()
    {
        await using var stream = new MemoryStream();
        await new NativeMessageWriter(stream).WriteAsync(new NativeResponse
        {
            Type = "downloadUpdate",
            JobId = "job-1",
            Status = "completed",
            ProtocolVersion = 6
        });

        var frame = stream.ToArray();
        var payloadLength = BinaryPrimitives.ReadInt32LittleEndian(frame.AsSpan(0, sizeof(int)));
        using var document = JsonDocument.Parse(frame.AsMemory(sizeof(int), payloadLength));
        Assert(document.RootElement.GetProperty("status").GetString() == "completed", "Native response frame was invalid.");
        Assert(document.RootElement.GetProperty("protocolVersion").GetInt32() == 6, "Protocol version was not serialized.");
    }

    /// <summary>Proves a closed Chrome pipe cannot interrupt the companion's media work.</summary>
    private static async Task IgnoreClosedNativeOutputAsync()
    {
        var closedOutput = new MemoryStream();
        await closedOutput.DisposeAsync();
        var writer = new NativeMessageWriter(closedOutput);
        await writer.WriteAsync(new NativeResponse { Type = "downloadUpdate", JobId = "job-1" });
        await writer.WriteAsync(new NativeResponse { Type = "downloadUpdate", JobId = "job-1" });
    }

    /// <summary>Creates the shared valid request used by several independent checks.</summary>
    private static NativeRequest CreateRequest()
    {
        return new NativeRequest
        {
            Type = "download",
            JobId = "job-1",
            Url = "https://example.com/watch?v=123&list=abc",
            Title = "Example Lesson: Intro?",
            CookieSourceUrl = "https://www.example.com/account",
            UseChromeSessionCookies = true,
            Cookies =
            [
                new BrowserCookie
                {
                    Domain = ".example.com",
                    Path = "/",
                    Secure = true,
                    Name = "SID",
                    Value = "test-value"
                }
            ],
            Options = new DownloadOptions
            {
                CookiesBrowser = "chrome",
                Quality = "1080p",
                Container = "mp4",
                ConcurrentFragments = 4,
                FilenameStyle = "pageTitle",
                OutputFolder = "videos",
                EmbedMetadata = true
            }
        };
    }

    /// <summary>Throws a readable failure when a smoke-test condition is false.</summary>
    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException(message);
        }
    }
}
