namespace MediaFinder.Companion;

/// <summary>Hosts Chrome Native Messaging and routes validated requests to yt-dlp.</summary>
public static class Program
{
    /// <summary>Runs the native message loop until Chrome closes its connection.</summary>
    public static async Task<int> Main()
    {
        var reader = new NativeMessageReader(Console.OpenStandardInput());
        var writer = new NativeMessageWriter(Console.OpenStandardOutput());
        var runner = new YtDlpRunner(writer);

        try
        {
            while (await reader.ReadAsync(CancellationToken.None) is { } request)
            {
                await HandleRequestAsync(request, runner, writer);
            }

            await runner.WaitForAllAsync();
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception);
            return 1;
        }
    }

    /// <summary>Handles health checks, validated downloads, log retrieval, and cancellation messages.</summary>
    private static async Task HandleRequestAsync(
        NativeRequest request,
        YtDlpRunner runner,
        NativeMessageWriter writer)
    {
        if (request.Type == "ping")
        {
            await writer.WriteAsync(new NativeResponse
            {
                Type = "companionStatus",
                Status = "ready",
                ProtocolVersion = 6,
                Message = runner.IsYtDlpAvailable
                    ? "Media Finder companion is ready."
                    : "Companion found, but yt-dlp is not installed.",
                OutputDirectory = YtDlpRunner.GetOutputDirectory(),
                YtDlpAvailable = runner.IsYtDlpAvailable,
                FfmpegAvailable = runner.IsFfmpegAvailable,
                DenoAvailable = runner.IsDenoAvailable
            });
            return;
        }

        if (request.Type == "cancel")
        {
            var cancelled = runner.Cancel(request.JobId);
            await writer.WriteAsync(new NativeResponse
            {
                Type = "downloadUpdate",
                JobId = request.JobId,
                Status = cancelled ? "cancelling" : "error",
                Message = cancelled ? "Cancelling download..." : "No active download matched this job."
            });
            return;
        }

        if (request.Type == "getLog")
        {
            await writer.WriteAsync(await runner.ReadLogAsync(request.JobId));
            return;
        }

        if (request.Type != "download")
        {
            await WriteErrorAsync(writer, request.JobId, "Unsupported companion request.");
            return;
        }

        var validationError = DownloadRequestValidator.Validate(request);
        if (validationError is not null)
        {
            await WriteErrorAsync(writer, request.JobId, validationError);
            return;
        }

        if (!runner.TryStart(request, out var startError))
        {
            await WriteErrorAsync(writer, request.JobId, startError);
            return;
        }

        // The runner sends the first lifecycle update after the child process is initialized.
    }

    /// <summary>Sends a consistent structured error response back to the extension.</summary>
    private static Task WriteErrorAsync(NativeMessageWriter writer, string jobId, string message)
    {
        return writer.WriteAsync(new NativeResponse
        {
            Type = "downloadUpdate",
            JobId = jobId,
            Status = "error",
            Message = message
        });
    }
}
