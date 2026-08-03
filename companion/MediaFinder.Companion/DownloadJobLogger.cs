using System.Diagnostics;
using System.Text;

namespace MediaFinder.Companion;

/// <summary>Writes one timestamped diagnostic file for a yt-dlp job without recording cookie values.</summary>
public sealed class DownloadJobLogger : IAsyncDisposable
{
    private const int MaximumRetainedLogs = 20;
    private const int MaximumCopiedBytes = 180_000;
    private readonly Stopwatch _elapsed = Stopwatch.StartNew();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly StreamWriter _writer;

    private DownloadJobLogger(string path, StreamWriter writer)
    {
        Path = path;
        _writer = writer;
    }

    public string Path { get; }

    /// <summary>Creates the per-user log directory, removes old logs, and starts a new job log.</summary>
    public static async Task<DownloadJobLogger> CreateAsync(string jobId, string? directoryOverride = null)
    {
        var directory = directoryOverride is null
            ? GetLogDirectory()
            : System.IO.Path.GetFullPath(directoryOverride);
        Directory.CreateDirectory(directory);
        DeleteOldLogs(directory);
        var safeJobId = string.Concat(jobId.Where(character => char.IsLetterOrDigit(character) || character is '-' or '_'));
        var path = System.IO.Path.Combine(
            directory,
            $"media-finder-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{safeJobId}.log");
        var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
        var logger = new DownloadJobLogger(path, new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true });
        await logger.WriteAsync("companion", $"Log started. OS={Environment.OSVersion}; Architecture={System.Runtime.InteropServices.RuntimeInformation.OSArchitecture}");
        return logger;
    }

    /// <summary>Returns the cross-platform per-user directory used for companion diagnostics.</summary>
    public static string GetLogDirectory()
    {
        var localData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localData))
        {
            localData = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        }
        if (string.IsNullOrWhiteSpace(localData))
        {
            localData = AppContext.BaseDirectory;
        }
        return System.IO.Path.GetFullPath(System.IO.Path.Combine(localData, "MediaFinder", "Logs"));
    }

    /// <summary>Appends a UTC timestamp, elapsed time, source, and diagnostic message as one line.</summary>
    public async Task WriteAsync(string source, string message)
    {
        await _writeLock.WaitAsync();
        try
        {
            var normalized = message.Replace("\r", " ").Replace("\n", " ");
            await _writer.WriteLineAsync($"{DateTime.UtcNow:O} +{_elapsed.Elapsed.TotalSeconds,8:0.000}s [{source}] {normalized}");
        }
        finally
        {
            _writeLock.Release();
        }
    }

    /// <summary>Reads the newest part of a known log while staying below Native Messaging limits.</summary>
    public static async Task<string> ReadTailAsync(string path)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        var skippedBytes = Math.Max(0, stream.Length - MaximumCopiedBytes);
        stream.Seek(skippedBytes, SeekOrigin.Begin);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        var text = await reader.ReadToEndAsync();
        return skippedBytes > 0
            ? $"[Earlier log output omitted; showing the newest {MaximumCopiedBytes:N0} bytes.]\n{text}"
            : text;
    }

    /// <summary>Flushes and closes the job log after the final lifecycle entry is written.</summary>
    public async ValueTask DisposeAsync()
    {
        await _writeLock.WaitAsync();
        try
        {
            await _writer.DisposeAsync();
        }
        finally
        {
            _writeLock.Release();
            _writeLock.Dispose();
        }
    }

    /// <summary>Keeps the newest diagnostic files and deletes only older Media Finder logs.</summary>
    private static void DeleteOldLogs(string directory)
    {
        foreach (var file in new DirectoryInfo(directory)
                     .GetFiles("media-finder-*.log")
                     .OrderByDescending(file => file.CreationTimeUtc)
                     .Skip(MaximumRetainedLogs - 1))
        {
            try
            {
                file.Delete();
            }
            catch (IOException)
            {
                // An active or externally opened log can remain until a later cleanup pass.
            }
            catch (UnauthorizedAccessException)
            {
                // Logging must not prevent a download when an old file cannot be removed.
            }
        }
    }
}
