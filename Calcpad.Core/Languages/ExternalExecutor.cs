using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Calcpad.Core.Languages
{
    /// <summary>
    /// Executes external language parsers (Python, Octave, C++, etc.)
    /// and captures their HTML output with caching support
    /// </summary>
    public class ExternalExecutor
    {
        private readonly LanguageManager _languageManager;
        private string _tempDirectory;
        private int _timeout = 30000; // 30 seconds default

        // Cache for execution results (key: language:codeHash, value: result + timestamp)
        private readonly ConcurrentDictionary<string, CachedResult> _resultCache = new();
        private TimeSpan _cacheExpiration = TimeSpan.FromMinutes(5);
        private bool _cacheEnabled = true;

        /// <summary>
        /// Gets or sets whether caching is enabled
        /// </summary>
        public bool CacheEnabled
        {
            get => _cacheEnabled;
            set => _cacheEnabled = value;
        }

        /// <summary>
        /// Gets or sets the cache expiration time
        /// </summary>
        public TimeSpan CacheExpiration
        {
            get => _cacheExpiration;
            set => _cacheExpiration = value;
        }

        /// <summary>
        /// Gets or sets the execution timeout in milliseconds
        /// </summary>
        public int Timeout
        {
            get => _timeout;
            set => _timeout = value > 0 ? value : 30000;
        }

        /// <summary>
        /// Gets or sets the working directory for script execution
        /// </summary>
        public string WorkingDirectory { get; set; }

        /// <summary>
        /// Event raised when output is received (for real-time feedback)
        /// </summary>
        public event EventHandler<string> OutputReceived;

        /// <summary>
        /// Event raised when error output is received
        /// </summary>
        public event EventHandler<string> ErrorReceived;

        /// <summary>
        /// Event raised when execution timing info is available
        /// </summary>
        public event EventHandler<ExecutionTiming> TimingReceived;

        /// <summary>
        /// Gets or sets whether timing is enabled
        /// </summary>
        public bool TimingEnabled { get; set; } = true;

        /// <summary>
        /// Gets or sets whether to use persistent Python process (faster, like Jupyter)
        /// </summary>
        public bool UsePersistentPython { get; set; } = false; // TODO: Fix persistent executor

        private readonly ExecutionLogger _logger;

        public ExternalExecutor()
        {
            _languageManager = LanguageManager.Instance;
            _logger = ExecutionLogger.Instance;
            _tempDirectory = Path.Combine(Path.GetTempPath(), "Calcpad");
            EnsureTempDirectory();
        }

        /// <summary>
        /// Executes code in the specified language and returns HTML output
        /// </summary>
        /// <param name="languageName">Language name (python, octave, cpp, etc.)</param>
        /// <param name="code">Source code to execute</param>
        /// <param name="cancellationToken">Cancellation token</param>
        /// <param name="cacheKeyCode">Optional: use this code for cache key instead of executed code</param>
        /// <returns>HTML output from the script</returns>
        public async Task<ExecutionResult> ExecuteAsync(string languageName, string code, CancellationToken cancellationToken = default, string cacheKeyCode = null)
        {
            // Use cacheKeyCode for cache operations if provided, otherwise use code
            var codeForCache = cacheKeyCode ?? code;

            var stopwatch = TimingEnabled ? Stopwatch.StartNew() : null;
            var timing = new ExecutionTiming { Language = languageName };

            _logger.LogSeparator();
            _logger.LogExecutionStart(languageName, code?.Length ?? 0);

            var parser = _languageManager.GetParser(languageName);
            if (parser == null)
            {
                _logger.LogError("EXEC", $"Unknown language: {languageName}");
                return new ExecutionResult
                {
                    Success = false,
                    Error = $"Unknown language: {languageName}"
                };
            }

            // Passthrough: return code as-is (for HTML)
            if (parser.IsPassthrough)
            {
                _logger.Log("EXEC", $"[{languageName}] Passthrough mode - returning as-is");
                return new ExecutionResult
                {
                    Success = true,
                    Output = code
                };
            }

            // Internal: should not reach here (handled by Calcpad parser)
            if (parser.IsInternal)
            {
                _logger.LogWarning("EXEC", "Internal parser called on ExternalExecutor");
                return new ExecutionResult
                {
                    Success = false,
                    Error = "Internal parser should be handled by Calcpad"
                };
            }

            // Check cache first (for external execution only)
            if (_cacheEnabled)
            {
                var cacheKey = GetCacheKey(languageName, codeForCache);
                if (_resultCache.TryGetValue(cacheKey, out var cached) &&
                    DateTime.UtcNow - cached.Timestamp < _cacheExpiration)
                {
                    // Return cached result (fast path)
                    _logger.LogCacheHit(languageName);
                    timing.FromCache = true;
                    timing.TotalMs = stopwatch?.ElapsedMilliseconds ?? 0;
                    _logger.LogExecutionEnd(languageName, timing.TotalMs, true, cached.Result.Success);
                    TimingReceived?.Invoke(this, timing);

                    return new ExecutionResult
                    {
                        Success = cached.Result.Success,
                        Output = cached.Result.Output,
                        Error = cached.Result.Error,
                        ExitCode = cached.Result.ExitCode
                    };
                }
                _logger.LogCacheMiss(languageName);
            }

            // Use parser-specific timeout if available, otherwise default
            var effectiveTimeout = parser.DefaultTimeout > 0 ? parser.DefaultTimeout : _timeout;
            _logger.Log("EXEC", $"[{languageName}] Timeout set to {effectiveTimeout}ms");

            // Use persistent Python executor if enabled (faster, like Jupyter)
            ExecutionResult result;
            if (languageName.Equals("python", StringComparison.OrdinalIgnoreCase) && UsePersistentPython)
            {
                _logger.Log("EXEC", $"[{languageName}] Using persistent Python executor");
                result = await PersistentPythonExecutor.Instance.ExecuteAsync(code, cancellationToken);
            }
            else
            {
                // External: execute via command (traditional way)
                result = await ExecuteExternalAsync(parser, code, effectiveTimeout, cancellationToken);
            }

            // Record timing
            if (stopwatch != null)
            {
                stopwatch.Stop();
                timing.TotalMs = stopwatch.ElapsedMilliseconds;
                timing.FromCache = false;
                _logger.LogExecutionEnd(languageName, timing.TotalMs, false, result.Success);
                TimingReceived?.Invoke(this, timing);
            }

            // Cache successful results
            if (_cacheEnabled && result.Success)
            {
                var cacheKey = GetCacheKey(languageName, codeForCache);
                _resultCache[cacheKey] = new CachedResult
                {
                    Result = result,
                    Timestamp = DateTime.UtcNow
                };
                _logger.Log("CACHE", $"[{languageName}] Result cached (total cached: {_resultCache.Count})");

                // Cleanup old cache entries periodically
                CleanupCacheIfNeeded();
            }

            if (!result.Success && !string.IsNullOrEmpty(result.Error))
            {
                _logger.LogError("EXEC", result.Error);
            }

            return result;
        }

        private string GetCacheKey(string language, string code)
        {
            // Normalize code for cache key:
            // - Remove directives (#python, #end python, etc.)
            // - Trim whitespace from lines
            // - Remove empty lines
            // - This way adding spaces/enters won't invalidate cache
            var normalizedCode = NormalizeCodeForCache(code);

            using var sha256 = SHA256.Create();
            var bytes = Encoding.UTF8.GetBytes(normalizedCode);
            var hash = sha256.ComputeHash(bytes);
            var hashString = Convert.ToBase64String(hash);
            return $"{language}:{hashString}";
        }

        private string NormalizeCodeForCache(string code)
        {
            if (string.IsNullOrEmpty(code))
                return string.Empty;

            var lines = code.Split('\n')
                .Select(line => line.Trim())
                .Where(line => !string.IsNullOrEmpty(line))
                .Where(line => !line.StartsWith("#python", StringComparison.OrdinalIgnoreCase))
                .Where(line => !line.StartsWith("#end python", StringComparison.OrdinalIgnoreCase))
                .Where(line => !line.StartsWith("#end ", StringComparison.OrdinalIgnoreCase) ||
                              !line.Contains("python", StringComparison.OrdinalIgnoreCase));

            return string.Join("\n", lines);
        }

        private DateTime _lastCacheCleanup = DateTime.UtcNow;
        private void CleanupCacheIfNeeded()
        {
            // Cleanup every 10 minutes
            if (DateTime.UtcNow - _lastCacheCleanup < TimeSpan.FromMinutes(10))
                return;

            _lastCacheCleanup = DateTime.UtcNow;
            var now = DateTime.UtcNow;
            var keysToRemove = new System.Collections.Generic.List<string>();

            foreach (var kvp in _resultCache)
            {
                if (now - kvp.Value.Timestamp > _cacheExpiration)
                    keysToRemove.Add(kvp.Key);
            }

            foreach (var key in keysToRemove)
                _resultCache.TryRemove(key, out _);
        }

        /// <summary>
        /// Clears the execution cache
        /// </summary>
        public void ClearCache()
        {
            _resultCache.Clear();
        }

        /// <summary>
        /// Gets the number of cached results
        /// </summary>
        public int CacheCount => _resultCache.Count;

        /// <summary>
        /// Checks if a result is cached for the given language and code
        /// </summary>
        /// <param name="languageName">Language name</param>
        /// <param name="code">Source code</param>
        /// <returns>True if result is cached and not expired</returns>
        public bool IsCached(string languageName, string code)
        {
            if (!_cacheEnabled || string.IsNullOrEmpty(code))
                return false;

            var cacheKey = GetCacheKey(languageName, code);
            if (_resultCache.TryGetValue(cacheKey, out var cached) &&
                DateTime.UtcNow - cached.Timestamp < _cacheExpiration)
            {
                return true;
            }
            return false;
        }

        /// <summary>
        /// Gets cached result if available, without executing
        /// </summary>
        /// <param name="languageName">Language name</param>
        /// <param name="code">Source code</param>
        /// <returns>Cached result or null if not cached</returns>
        public ExecutionResult GetCachedResult(string languageName, string code)
        {
            if (!_cacheEnabled || string.IsNullOrEmpty(code))
                return null;

            var cacheKey = GetCacheKey(languageName, code);
            if (_resultCache.TryGetValue(cacheKey, out var cached) &&
                DateTime.UtcNow - cached.Timestamp < _cacheExpiration)
            {
                _logger.Log("CACHE", $"[{languageName}] Fast cache lookup hit");
                return new ExecutionResult
                {
                    Success = cached.Result.Success,
                    Output = cached.Result.Output,
                    Error = cached.Result.Error,
                    ExitCode = cached.Result.ExitCode
                };
            }
            return null;
        }

        /// <summary>
        /// Synchronous execution wrapper
        /// </summary>
        public ExecutionResult Execute(string languageName, string code)
        {
            return ExecuteAsync(languageName, code).GetAwaiter().GetResult();
        }

        private async Task<ExecutionResult> ExecuteExternalAsync(ParserDefinition parser, string code, int timeout, CancellationToken cancellationToken)
        {
            var result = new ExecutionResult();
            string tempFile = null;
            string outputFile = null;
            var processStopwatch = Stopwatch.StartNew();

            try
            {
                // Create temporary file with code
                var fileName = $"calcpad_script_{Guid.NewGuid():N}{parser.Extension}";
                tempFile = Path.Combine(_tempDirectory, fileName);
                outputFile = Path.Combine(_tempDirectory, $"calcpad_output_{Guid.NewGuid():N}");

                // For Python, prepend code to add languages folder to sys.path
                if (parser.Extension == ".py")
                {
                    code = PrependPythonPath(code);
                }

                _logger.LogFileOp("CREATE", tempFile);
                await File.WriteAllTextAsync(tempFile, code, Encoding.UTF8, cancellationToken);

                // Prepare arguments
                var args = parser.Args ?? "{file}";
                args = args.Replace("{file}", $"\"{tempFile}\"");
                args = args.Replace("{output}", $"\"{outputFile}\"");

                _logger.LogProcessStart(parser.Command, args);

                // Create process
                var startInfo = new ProcessStartInfo
                {
                    FileName = parser.Command,
                    Arguments = args,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    WorkingDirectory = WorkingDirectory ?? _tempDirectory,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8
                };

                var outputBuilder = new StringBuilder();
                var errorBuilder = new StringBuilder();

                using var process = new Process { StartInfo = startInfo };

                process.OutputDataReceived += (s, e) =>
                {
                    if (e.Data != null)
                    {
                        outputBuilder.AppendLine(e.Data);
                        OutputReceived?.Invoke(this, e.Data);
                    }
                };

                process.ErrorDataReceived += (s, e) =>
                {
                    if (e.Data != null)
                    {
                        errorBuilder.AppendLine(e.Data);
                        ErrorReceived?.Invoke(this, e.Data);
                    }
                };

                process.Start();
                _logger.Log("PROC", $"Process started (PID: {process.Id})");
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                // Wait with timeout (use parser-specific or provided timeout)
                var completed = await WaitForExitAsync(process, timeout, cancellationToken);

                if (!completed)
                {
                    _logger.LogWarning("PROC", $"TIMEOUT after {timeout}ms - killing process");
                    try { process.Kill(true); } catch { }
                    result.Success = false;
                    result.Error = $"Execution timed out after {timeout / 1000} seconds";
                    return result;
                }

                processStopwatch.Stop();
                _logger.Log("PROC", $"Process exited (code: {process.ExitCode}, time: {processStopwatch.ElapsedMilliseconds}ms)");

                result.ExitCode = process.ExitCode;
                result.Output = outputBuilder.ToString();
                result.Error = errorBuilder.ToString();
                result.Success = process.ExitCode == 0;

                _logger.Log("PROC", $"Output size: {result.Output?.Length ?? 0} chars");

                // If no stdout but output file exists, read it
                if (string.IsNullOrEmpty(result.Output) && File.Exists(outputFile))
                {
                    result.Output = await File.ReadAllTextAsync(outputFile, cancellationToken);
                }

                // Wrap output in HTML if it's not already
                if (result.Success && !string.IsNullOrEmpty(result.Output))
                {
                    result.Output = WrapOutputAsHtml(result.Output);
                }
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                result.Success = false;
                result.Error = $"Cannot execute '{parser.Command}': {ex.Message}\n" +
                              $"Make sure {parser.Description ?? parser.Command} is installed and in PATH.";
            }
            catch (OperationCanceledException)
            {
                result.Success = false;
                result.Error = "Execution was cancelled";
            }
            catch (Exception ex)
            {
                result.Success = false;
                result.Error = $"Execution error: {ex.Message}";
            }
            finally
            {
                // Cleanup temp files
                TryDeleteFile(tempFile);
                TryDeleteFile(outputFile);
                TryDeleteFile(outputFile + ".exe"); // For compiled languages
            }

            return result;
        }

        private static async Task<bool> WaitForExitAsync(Process process, int timeout, CancellationToken cancellationToken)
        {
            var tcs = new TaskCompletionSource<bool>();

            process.EnableRaisingEvents = true;
            process.Exited += (s, e) => tcs.TrySetResult(true);

            if (process.HasExited)
                return true;

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(timeout);

            try
            {
                using (cts.Token.Register(() => tcs.TrySetResult(false)))
                {
                    return await tcs.Task;
                }
            }
            catch
            {
                return false;
            }
        }

        private string WrapOutputAsHtml(string output)
        {
            if (string.IsNullOrWhiteSpace(output))
                return string.Empty;

            // Check if output is already HTML
            var trimmed = output.TrimStart();
            if (trimmed.StartsWith("<", StringComparison.Ordinal) &&
                (trimmed.StartsWith("<!DOCTYPE", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<html", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<div", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<p", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<h", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<table", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<svg", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<img", StringComparison.OrdinalIgnoreCase)))
            {
                return output;
            }

            // Wrap plain text in <pre> tags
            return $"<pre class=\"external-output\">{System.Web.HttpUtility.HtmlEncode(output)}</pre>";
        }

        private void EnsureTempDirectory()
        {
            try
            {
                if (!Directory.Exists(_tempDirectory))
                {
                    Directory.CreateDirectory(_tempDirectory);
                }
            }
            catch
            {
                _tempDirectory = Path.GetTempPath();
            }
        }

        /// <summary>
        /// Prepends Python code to add the languages folder to sys.path
        /// This allows importing calcpad_helper and other modules from the languages folder
        /// </summary>
        private string PrependPythonPath(string code)
        {
            // Find the languages folder path
            var languagesPath = _languageManager.LanguagesPath;
            if (string.IsNullOrEmpty(languagesPath) || !Directory.Exists(languagesPath))
            {
                // Fallback: try to find languages folder relative to assembly
                var assemblyPath = Path.GetDirectoryName(typeof(ExternalExecutor).Assembly.Location);
                languagesPath = Path.Combine(assemblyPath, "languages");
            }

            if (string.IsNullOrEmpty(languagesPath) || !Directory.Exists(languagesPath))
            {
                return code; // Can't find languages folder, return code as-is
            }

            // Normalize path for Python (use forward slashes)
            var pythonPath = languagesPath.Replace("\\", "/");

            // Prepend sys.path manipulation
            var preamble = $@"# Auto-generated: Add Calcpad languages folder to path
import sys
if r'{pythonPath}' not in sys.path:
    sys.path.insert(0, r'{pythonPath}')
# End auto-generated code

";
            return preamble + code;
        }

        private static void TryDeleteFile(string path)
        {
            if (string.IsNullOrEmpty(path))
                return;

            try
            {
                if (File.Exists(path))
                    File.Delete(path);
            }
            catch { }
        }

        /// <summary>
        /// Cleans up all temporary files created by this executor
        /// </summary>
        public void CleanupTempFiles()
        {
            try
            {
                if (Directory.Exists(_tempDirectory))
                {
                    foreach (var file in Directory.GetFiles(_tempDirectory, "calcpad_*"))
                    {
                        TryDeleteFile(file);
                    }
                }
            }
            catch { }
        }
    }

    /// <summary>
    /// Result of external code execution
    /// </summary>
    public class ExecutionResult
    {
        /// <summary>
        /// Whether execution completed successfully
        /// </summary>
        public bool Success { get; set; }

        /// <summary>
        /// HTML output from the script
        /// </summary>
        public string Output { get; set; } = string.Empty;

        /// <summary>
        /// Error messages from the script
        /// </summary>
        public string Error { get; set; } = string.Empty;

        /// <summary>
        /// Process exit code
        /// </summary>
        public int ExitCode { get; set; }

        /// <summary>
        /// Gets the full result (output + error) as HTML
        /// </summary>
        public string ToHtml()
        {
            var sb = new StringBuilder();

            if (!string.IsNullOrEmpty(Output))
                sb.Append(Output);

            if (!string.IsNullOrEmpty(Error))
            {
                sb.Append($"<pre class=\"error\" style=\"color:red;\">{System.Web.HttpUtility.HtmlEncode(Error)}</pre>");
            }

            return sb.ToString();
        }
    }

    /// <summary>
    /// Cached execution result with timestamp
    /// </summary>
    internal class CachedResult
    {
        public ExecutionResult Result { get; set; }
        public DateTime Timestamp { get; set; }
    }

    /// <summary>
    /// Execution timing information
    /// </summary>
    public class ExecutionTiming
    {
        /// <summary>
        /// Language that was executed
        /// </summary>
        public string Language { get; set; }

        /// <summary>
        /// Total execution time in milliseconds
        /// </summary>
        public long TotalMs { get; set; }

        /// <summary>
        /// Whether result was from cache
        /// </summary>
        public bool FromCache { get; set; }

        public override string ToString()
        {
            var source = FromCache ? "cache" : "exec";
            return $"[{Language}] {TotalMs}ms ({source})";
        }
    }
}
