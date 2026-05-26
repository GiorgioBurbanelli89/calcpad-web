using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Calcpad.Core.Languages
{
    /// <summary>
    /// Real-time execution logger for monitoring Calcpad performance
    /// Writes to a log file that can be monitored externally
    /// </summary>
    public class ExecutionLogger : IDisposable
    {
        private static ExecutionLogger _instance;
        private static readonly object _lock = new();

        private readonly string _logPath;
        private readonly ConcurrentQueue<LogEntry> _logQueue = new();
        private readonly CancellationTokenSource _cts = new();
        private readonly Task _writerTask;
        private readonly Stopwatch _appStopwatch;
        private bool _disposed;

        /// <summary>
        /// Gets the singleton instance
        /// </summary>
        public static ExecutionLogger Instance
        {
            get
            {
                if (_instance == null)
                {
                    lock (_lock)
                    {
                        _instance ??= new ExecutionLogger();
                    }
                }
                return _instance;
            }
        }

        /// <summary>
        /// Gets or sets whether logging is enabled
        /// </summary>
        public bool Enabled { get; set; } = true;

        /// <summary>
        /// Gets the log file path
        /// </summary>
        public string LogPath => _logPath;

        private ExecutionLogger()
        {
            _logPath = Path.Combine(Path.GetTempPath(), "Calcpad", "execution.log");
            EnsureLogDirectory();
            _appStopwatch = Stopwatch.StartNew();

            // Start background writer task
            _writerTask = Task.Run(WriteLogsAsync);

            // Write startup header
            WriteHeader();
        }

        private void EnsureLogDirectory()
        {
            try
            {
                var dir = Path.GetDirectoryName(_logPath);
                if (!Directory.Exists(dir))
                    Directory.CreateDirectory(dir);

                // Clear old log on startup
                if (File.Exists(_logPath))
                    File.Delete(_logPath);
            }
            catch { }
        }

        private void WriteHeader()
        {
            var header = $@"
================================================================================
 CALCPAD EXECUTION LOG
 Started: {DateTime.Now:yyyy-MM-dd HH:mm:ss}
 Log File: {_logPath}
================================================================================
";
            Log("SYSTEM", "Logger initialized");
        }

        /// <summary>
        /// Log a message
        /// </summary>
        public void Log(string category, string message)
        {
            if (!Enabled) return;

            _logQueue.Enqueue(new LogEntry
            {
                Timestamp = DateTime.Now,
                ElapsedMs = _appStopwatch.ElapsedMilliseconds,
                Category = category,
                Message = message,
                Level = LogLevel.Info
            });
        }

        /// <summary>
        /// Log execution start
        /// </summary>
        public void LogExecutionStart(string language, int codeLength)
        {
            if (!Enabled) return;
            Log("EXEC", $"[{language}] Starting execution ({codeLength} chars)");
        }

        /// <summary>
        /// Log execution end with timing
        /// </summary>
        public void LogExecutionEnd(string language, long durationMs, bool fromCache, bool success)
        {
            if (!Enabled) return;
            var source = fromCache ? "CACHE" : "PROCESS";
            var status = success ? "OK" : "FAIL";
            Log("EXEC", $"[{language}] Completed in {durationMs}ms ({source}) [{status}]");
        }

        /// <summary>
        /// Log cache hit
        /// </summary>
        public void LogCacheHit(string language)
        {
            if (!Enabled) return;
            Log("CACHE", $"[{language}] Cache hit - returning cached result");
        }

        /// <summary>
        /// Log cache miss
        /// </summary>
        public void LogCacheMiss(string language)
        {
            if (!Enabled) return;
            Log("CACHE", $"[{language}] Cache miss - executing fresh");
        }

        /// <summary>
        /// Log process start
        /// </summary>
        public void LogProcessStart(string command, string args)
        {
            if (!Enabled) return;
            Log("PROC", $"Starting: {command} {args}");
        }

        /// <summary>
        /// Log error
        /// </summary>
        public void LogError(string category, string message, Exception ex = null)
        {
            if (!Enabled) return;

            var fullMessage = ex != null ? $"{message}: {ex.Message}" : message;
            _logQueue.Enqueue(new LogEntry
            {
                Timestamp = DateTime.Now,
                ElapsedMs = _appStopwatch.ElapsedMilliseconds,
                Category = category,
                Message = fullMessage,
                Level = LogLevel.Error
            });
        }

        /// <summary>
        /// Log warning
        /// </summary>
        public void LogWarning(string category, string message)
        {
            if (!Enabled) return;

            _logQueue.Enqueue(new LogEntry
            {
                Timestamp = DateTime.Now,
                ElapsedMs = _appStopwatch.ElapsedMilliseconds,
                Category = category,
                Message = message,
                Level = LogLevel.Warning
            });
        }

        /// <summary>
        /// Log language detection
        /// </summary>
        public void LogLanguageDetected(string language)
        {
            if (!Enabled) return;
            Log("LANG", $"Detected language: {language ?? "calcpad (native)"}");
        }

        /// <summary>
        /// Log file operation
        /// </summary>
        public void LogFileOp(string operation, string path)
        {
            if (!Enabled) return;
            Log("FILE", $"{operation}: {Path.GetFileName(path)}");
        }

        /// <summary>
        /// Log memory usage
        /// </summary>
        public void LogMemory()
        {
            if (!Enabled) return;
            var process = Process.GetCurrentProcess();
            var memMB = process.WorkingSet64 / 1024 / 1024;
            Log("MEM", $"Working set: {memMB} MB");
        }

        /// <summary>
        /// Log a separator line
        /// </summary>
        public void LogSeparator()
        {
            if (!Enabled) return;
            _logQueue.Enqueue(new LogEntry
            {
                Timestamp = DateTime.Now,
                ElapsedMs = _appStopwatch.ElapsedMilliseconds,
                Category = "---",
                Message = new string('-', 60),
                Level = LogLevel.Info
            });
        }

        private async Task WriteLogsAsync()
        {
            while (!_cts.Token.IsCancellationRequested)
            {
                try
                {
                    if (_logQueue.TryDequeue(out var entry))
                    {
                        await WriteEntryAsync(entry);
                    }
                    else
                    {
                        await Task.Delay(50, _cts.Token);
                    }
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch
                {
                    // Ignore write errors
                }
            }

            // Flush remaining entries
            while (_logQueue.TryDequeue(out var entry))
            {
                try { await WriteEntryAsync(entry); } catch { }
            }
        }

        private async Task WriteEntryAsync(LogEntry entry)
        {
            var levelChar = entry.Level switch
            {
                LogLevel.Error => "E",
                LogLevel.Warning => "W",
                _ => "I"
            };

            var line = $"[{entry.Timestamp:HH:mm:ss.fff}] [{entry.ElapsedMs,8}ms] [{levelChar}] [{entry.Category,-6}] {entry.Message}\n";

            await File.AppendAllTextAsync(_logPath, line, Encoding.UTF8);
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            Log("SYSTEM", "Logger shutting down");
            _cts.Cancel();

            try { _writerTask.Wait(1000); } catch { }

            _cts.Dispose();
        }

        private class LogEntry
        {
            public DateTime Timestamp { get; set; }
            public long ElapsedMs { get; set; }
            public string Category { get; set; }
            public string Message { get; set; }
            public LogLevel Level { get; set; }
        }

        private enum LogLevel
        {
            Info,
            Warning,
            Error
        }
    }
}
