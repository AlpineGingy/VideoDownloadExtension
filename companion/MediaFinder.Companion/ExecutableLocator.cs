namespace MediaFinder.Companion;

/// <summary>Finds companion dependencies beside the host or on the user's PATH.</summary>
public static class ExecutableLocator
{
    /// <summary>Returns an absolute executable path, or null when the dependency is unavailable.</summary>
    public static string? Find(string executableName, string environmentVariable)
    {
        var configuredPath = Environment.GetEnvironmentVariable(environmentVariable);
        if (!string.IsNullOrWhiteSpace(configuredPath) && File.Exists(configuredPath))
        {
            return Path.GetFullPath(configuredPath);
        }

        foreach (var candidateName in GetCandidateNames(executableName))
        {
            var besideCompanion = Path.Combine(AppContext.BaseDirectory, candidateName);
            if (File.Exists(besideCompanion))
            {
                return besideCompanion;
            }

            foreach (var pathEntry in GetPathEntries())
            {
                var candidatePath = Path.Combine(pathEntry, candidateName);
                if (File.Exists(candidatePath))
                {
                    return candidatePath;
                }
            }
        }

        return null;
    }

    /// <summary>Returns platform-appropriate filenames for a requested command.</summary>
    private static IEnumerable<string> GetCandidateNames(string executableName)
    {
        yield return executableName;
        if (OperatingSystem.IsWindows() && !executableName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
        {
            yield return $"{executableName}.exe";
        }
    }

    /// <summary>Enumerates valid directories from the process PATH.</summary>
    private static IEnumerable<string> GetPathEntries()
    {
        return (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(Directory.Exists);
    }
}
