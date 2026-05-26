using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Calcpad.Core.Languages
{
    /// <summary>
    /// Executes Python code using a persistent Python process.
    /// Similar to Jupyter kernel - keeps Python running with libraries pre-loaded.
    /// First execution loads libraries (~3-4s), subsequent executions are instant (~1ms).
    /// </summary>
    public class PersistentPythonExecutor : IDisposable
    {
        private Process _pythonProcess;
        private StreamWriter _stdin;
        private StreamReader _stdout;
        private readonly object _lock = new object();
        private bool _isReady;
        private bool _isLoading;
        private bool _disposed;
        private readonly string _runnerPath;
        private readonly ExecutionLogger _logger;

        /// <summary>
        /// Event raised when Python is loading libraries
        /// </summary>
        public event EventHandler<string> StatusChanged;

        /// <summary>
        /// Whether the persistent process is ready
        /// </summary>
        public bool IsReady => _isReady;

        /// <summary>
        /// Whether Python is currently loading
        /// </summary>
        public bool IsLoading => _isLoading;

        /// <summary>
        /// Singleton instance
        /// </summary>
        private static PersistentPythonExecutor _instance;
        private static readonly object _instanceLock = new object();

        public static PersistentPythonExecutor Instance
        {
            get
            {
                if (_instance == null)
                {
                    lock (_instanceLock)
                    {
                        if (_instance == null)
                        {
                            _instance = new PersistentPythonExecutor();
                        }
                    }
                }
                return _instance;
            }
        }

        private PersistentPythonExecutor()
        {
            _logger = ExecutionLogger.Instance;

            // Find the runner script
            var assemblyPath = Path.GetDirectoryName(typeof(PersistentPythonExecutor).Assembly.Location);
            _runnerPath = Path.Combine(assemblyPath, "Languages", "python_runner.py");

            // Fallback paths
            if (!File.Exists(_runnerPath))
            {
                _runnerPath = Path.Combine(assemblyPath, "python_runner.py");
            }
            if (!File.Exists(_runnerPath))
            {
                // Try to find in source directory (for development)
                var sourceDir = Path.GetDirectoryName(assemblyPath);
                while (sourceDir != null && !File.Exists(Path.Combine(sourceDir, "Calcpad.Core", "Languages", "python_runner.py")))
                {
                    sourceDir = Path.GetDirectoryName(sourceDir);
                }
                if (sourceDir != null)
                {
                    _runnerPath = Path.Combine(sourceDir, "Calcpad.Core", "Languages", "python_runner.py");
                }
            }
        }

        /// <summary>
        /// Starts the persistent Python process if not already running
        /// </summary>
        public async Task<bool> EnsureStartedAsync()
        {
            if (_isReady && _pythonProcess != null && !_pythonProcess.HasExited)
            {
                return true;
            }

            return await StartProcessAsync();
        }

        private async Task<bool> StartProcessAsync()
        {
            lock (_lock)
            {
                if (_isLoading) return false;
                _isLoading = true;
                _isReady = false;
            }

            StatusChanged?.Invoke(this, "Loading Python environment...");
            _logger.Log("PERSIST", "Starting persistent Python process");

            try
            {
                // Kill existing process if any
                if (_pythonProcess != null && !_pythonProcess.HasExited)
                {
                    try { _pythonProcess.Kill(); } catch { }
                }

                if (!File.Exists(_runnerPath))
                {
                    _logger.LogError("PERSIST", $"Runner script not found: {_runnerPath}");
                    return false;
                }

                var startInfo = new ProcessStartInfo
                {
                    FileName = "python",
                    Arguments = $"-u \"{_runnerPath}\"",
                    UseShellExecute = false,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardInputEncoding = Encoding.UTF8
                };

                _pythonProcess = new Process { StartInfo = startInfo };
                _pythonProcess.Start();

                _stdin = _pythonProcess.StandardInput;
                _stdout = _pythonProcess.StandardOutput;

                _logger.Log("PERSIST", $"Process started (PID: {_pythonProcess.Id})");

                // Wait for READY signal
                var timeout = TimeSpan.FromSeconds(30);
                var stopwatch = Stopwatch.StartNew();

                while (stopwatch.Elapsed < timeout)
                {
                    var line = await _stdout.ReadLineAsync();
                    if (line == null) break;

                    _logger.Log("PERSIST", $"Received: {line}");

                    if (line == "CALCPAD_RUNNER:LOADING")
                    {
                        StatusChanged?.Invoke(this, "Loading Python libraries (numpy, plotly...)");
                    }
                    else if (line == "CALCPAD_RUNNER:READY")
                    {
                        _isReady = true;
                        _isLoading = false;
                        StatusChanged?.Invoke(this, "Python ready");
                        _logger.Log("PERSIST", $"Python ready in {stopwatch.ElapsedMilliseconds}ms");
                        return true;
                    }
                }

                _logger.LogError("PERSIST", "Timeout waiting for Python to be ready");
                return false;
            }
            catch (Exception ex)
            {
                _logger.LogError("PERSIST", $"Failed to start: {ex.Message}");
                return false;
            }
            finally
            {
                _isLoading = false;
            }
        }

        /// <summary>
        /// Executes Python code using the persistent process
        /// </summary>
        public async Task<ExecutionResult> ExecuteAsync(string code, CancellationToken cancellationToken = default)
        {
            var sw = Stopwatch.StartNew();

            if (!await EnsureStartedAsync())
            {
                return new ExecutionResult
                {
                    Success = false,
                    Error = "Failed to start persistent Python process"
                };
            }

            try
            {
                // Encode code as base64
                var codeBytes = Encoding.UTF8.GetBytes(code);
                var codeBase64 = Convert.ToBase64String(codeBytes);

                _logger.Log("PERSIST", $"Executing {code.Length} chars");

                // Send code
                await _stdin.WriteLineAsync($"CALCPAD_EXEC:{codeBase64}");
                await _stdin.FlushAsync();

                // Read response
                var response = await _stdout.ReadLineAsync();

                sw.Stop();
                _logger.Log("PERSIST", $"Response received in {sw.ElapsedMilliseconds}ms");

                if (response == null)
                {
                    return new ExecutionResult
                    {
                        Success = false,
                        Error = "Python process terminated unexpectedly"
                    };
                }

                if (response.StartsWith("CALCPAD_RUNNER:RESULT:"))
                {
                    var resultBase64 = response.Substring("CALCPAD_RUNNER:RESULT:".Length);
                    var resultJson = Encoding.UTF8.GetString(Convert.FromBase64String(resultBase64));

                    using var doc = JsonDocument.Parse(resultJson);
                    var root = doc.RootElement;

                    var success = root.GetProperty("success").GetBoolean();
                    var output = root.GetProperty("output").GetString() ?? "";
                    var error = root.GetProperty("error").GetString() ?? "";

                    return new ExecutionResult
                    {
                        Success = success,
                        Output = WrapOutputAsHtml(output),
                        Error = error
                    };
                }
                else if (response.StartsWith("CALCPAD_RUNNER:ERROR:"))
                {
                    return new ExecutionResult
                    {
                        Success = false,
                        Error = response.Substring("CALCPAD_RUNNER:ERROR:".Length)
                    };
                }

                return new ExecutionResult
                {
                    Success = false,
                    Error = $"Unexpected response: {response}"
                };
            }
            catch (Exception ex)
            {
                _logger.LogError("PERSIST", $"Execution failed: {ex.Message}");

                // Process may have died, mark as not ready
                _isReady = false;

                return new ExecutionResult
                {
                    Success = false,
                    Error = $"Execution error: {ex.Message}"
                };
            }
        }

        private string WrapOutputAsHtml(string output)
        {
            if (string.IsNullOrWhiteSpace(output))
                return string.Empty;

            var trimmed = output.TrimStart();
            if (trimmed.StartsWith("<", StringComparison.Ordinal) &&
                (trimmed.StartsWith("<!DOCTYPE", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<html", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<div", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<p", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<h", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<table", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<svg", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<img", StringComparison.OrdinalIgnoreCase) ||
                 trimmed.StartsWith("<script", StringComparison.OrdinalIgnoreCase)))
            {
                return output;
            }

            return $"<pre class=\"external-output\">{System.Web.HttpUtility.HtmlEncode(output)}</pre>";
        }

        /// <summary>
        /// Stops the persistent Python process
        /// </summary>
        public void Stop()
        {
            if (_pythonProcess != null && !_pythonProcess.HasExited)
            {
                try
                {
                    _stdin?.WriteLine("CALCPAD_EXIT");
                    _stdin?.Flush();
                    _pythonProcess.WaitForExit(2000);
                }
                catch { }
                finally
                {
                    try { _pythonProcess.Kill(); } catch { }
                }
            }

            _isReady = false;
            _logger.Log("PERSIST", "Python process stopped");
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            Stop();
            _stdin?.Dispose();
            _stdout?.Dispose();
            _pythonProcess?.Dispose();
        }
    }
}
