using System.Buffers.Binary;
using System.Text.Json;

namespace MediaFinder.Companion;

/// <summary>Reads Chrome Native Messaging frames from standard input.</summary>
public sealed class NativeMessageReader(Stream input)
{
    private const int MaximumMessageBytes = 1024 * 1024;
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Reads one length-prefixed request, or null when Chrome closes the pipe.</summary>
    public async Task<NativeRequest?> ReadAsync(CancellationToken cancellationToken)
    {
        var lengthBytes = new byte[sizeof(int)];
        var firstRead = await input.ReadAsync(lengthBytes.AsMemory(0, lengthBytes.Length), cancellationToken);
        if (firstRead == 0)
        {
            return null;
        }

        await ReadRemainingAsync(input, lengthBytes, firstRead, cancellationToken);
        var messageLength = BinaryPrimitives.ReadInt32LittleEndian(lengthBytes);
        if (messageLength <= 0 || messageLength > MaximumMessageBytes)
        {
            throw new InvalidDataException("Native message length is outside the allowed range.");
        }

        var payload = new byte[messageLength];
        await ReadRemainingAsync(input, payload, 0, cancellationToken);
        return JsonSerializer.Deserialize<NativeRequest>(payload, _jsonOptions)
            ?? throw new InvalidDataException("Native message did not contain a request.");
    }

    /// <summary>Fills the remainder of a protocol buffer even when a stream returns partial reads.</summary>
    private static async Task ReadRemainingAsync(
        Stream stream,
        byte[] buffer,
        int bytesAlreadyRead,
        CancellationToken cancellationToken)
    {
        var offset = bytesAlreadyRead;
        while (offset < buffer.Length)
        {
            var bytesRead = await stream.ReadAsync(buffer.AsMemory(offset), cancellationToken);
            if (bytesRead == 0)
            {
                throw new EndOfStreamException("Chrome closed the native messaging pipe mid-message.");
            }
            offset += bytesRead;
        }
    }
}

/// <summary>Writes thread-safe Chrome Native Messaging frames to standard output.</summary>
public sealed class NativeMessageWriter(Stream output)
{
    private static readonly TimeSpan WriteTimeout = TimeSpan.FromSeconds(1);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private int _outputUnavailable;

    /// <summary>Serializes and writes one length-prefixed response without interleaving jobs.</summary>
    public async Task WriteAsync(NativeResponse response, CancellationToken cancellationToken = default)
    {
        if (Volatile.Read(ref _outputUnavailable) != 0) return;
        var payload = JsonSerializer.SerializeToUtf8Bytes(response, _jsonOptions);
        var lengthBytes = new byte[sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(lengthBytes, payload.Length);

        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            if (Volatile.Read(ref _outputUnavailable) != 0) return;
            using var writeCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            writeCancellation.CancelAfter(WriteTimeout);
            try
            {
                await output.WriteAsync(lengthBytes, writeCancellation.Token);
                await output.WriteAsync(payload, writeCancellation.Token);
                await output.FlushAsync(writeCancellation.Token);
            }
            catch (Exception exception) when (
                exception is IOException or ObjectDisposedException ||
                exception is OperationCanceledException && !cancellationToken.IsCancellationRequested)
            {
                // Chrome UI delivery is optional; a closed or blocked pipe must never pause yt-dlp.
                Interlocked.Exchange(ref _outputUnavailable, 1);
            }
        }
        finally
        {
            _writeLock.Release();
        }
    }
}
