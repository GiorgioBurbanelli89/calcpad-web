using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Calcpad.Core.Languages
{
    /// <summary>
    /// Dispatches code to appropriate language parsers.
    /// If a file starts with #python, #octave, etc., the ENTIRE file is processed by that language.
    /// Calcpad is only used if NO language directive is present at the start.
    /// </summary>
    public class LanguageDispatcher
    {
        private readonly LanguageManager _languageManager;
        private readonly ExternalExecutor _executor;
        private readonly ExecutionLogger _logger;

        // Cache for language detection to avoid re-detecting same content
        private string _lastDetectedCode;
        private string _lastDetectedLanguage;
        private bool _lastDetectionPerformed;

        public LanguageDispatcher()
        {
            _languageManager = LanguageManager.Instance;
            _executor = new ExternalExecutor();
            _logger = ExecutionLogger.Instance;
        }

        /// <summary>
        /// Clears the language detection cache
        /// </summary>
        public void ClearDetectionCache()
        {
            _lastDetectedCode = null;
            _lastDetectedLanguage = null;
            _lastDetectionPerformed = false;
        }

        /// <summary>
        /// Gets or sets the working directory for external script execution
        /// </summary>
        public string WorkingDirectory
        {
            get => _executor.WorkingDirectory;
            set => _executor.WorkingDirectory = value;
        }

        /// <summary>
        /// Gets or sets the timeout for external execution in milliseconds
        /// </summary>
        public int Timeout
        {
            get => _executor.Timeout;
            set => _executor.Timeout = value;
        }

        /// <summary>
        /// Detects if the file uses an external language.
        /// Checks if the first non-empty line is #python, #octave, etc.
        /// Returns the language name or null if it's native Calcpad.
        /// Uses internal cache to avoid re-detecting same content.
        /// </summary>
        public string DetectFileLanguage(string sourceCode)
        {
            if (string.IsNullOrWhiteSpace(sourceCode))
            {
                return null;
            }

            // Strip BOM character (U+FEFF) if present for consistent detection
            if (sourceCode[0] == '\uFEFF')
            {
                sourceCode = sourceCode.Substring(1);
            }

            // Check cache first - avoid re-detecting same code
            if (_lastDetectionPerformed && sourceCode == _lastDetectedCode)
            {
                return _lastDetectedLanguage;
            }

            var sw = System.Diagnostics.Stopwatch.StartNew();

            // Optimization: only check first few lines, not split entire file
            var firstLineEnd = sourceCode.IndexOf('\n');
            var firstLine = firstLineEnd > 0 ? sourceCode.Substring(0, firstLineEnd).Trim() : sourceCode.Trim();

            string detected = null;

            // Skip empty first line
            if (string.IsNullOrEmpty(firstLine))
            {
                var lines = sourceCode.Split('\n', 5); // Only split first 5 lines max
                foreach (var line in lines)
                {
                    var trimmed = line.Trim();
                    if (string.IsNullOrEmpty(trimmed))
                        continue;

                    detected = _languageManager.DetectLanguageFromDirective(trimmed);
                    break;
                }
            }
            else
            {
                // Check first non-empty line
                detected = _languageManager.DetectLanguageFromDirective(firstLine);
            }

            // Cache the result
            _lastDetectedCode = sourceCode;
            _lastDetectedLanguage = detected;
            _lastDetectionPerformed = true;

            sw.Stop();
            _logger.Log("DETECT", $"Language: {detected ?? "calcpad"} ({sw.ElapsedMilliseconds}ms)");
            return detected;
        }

        /// <summary>
        /// Extracts the code after the language directive.
        /// Removes #python line and optional #end python at the end.
        /// Also strips BOM and other invisible characters.
        /// </summary>
        public string ExtractLanguageCode(string sourceCode, string language)
        {
            // Strip BOM character (U+FEFF) if present
            if (!string.IsNullOrEmpty(sourceCode) && sourceCode[0] == '\uFEFF')
            {
                sourceCode = sourceCode.Substring(1);
            }

            var lines = sourceCode.Split('\n');
            var codeBuilder = new StringBuilder();
            var lang = _languageManager.GetLanguage(language);
            bool foundDirective = false;

            foreach (var line in lines)
            {
                var trimmed = line.Trim();

                // Skip the opening directive
                if (!foundDirective)
                {
                    if (_languageManager.DetectLanguageFromDirective(trimmed) == language)
                    {
                        foundDirective = true;
                        continue;
                    }
                }

                // Skip the closing directive if present
                if (foundDirective && lang != null && !string.IsNullOrEmpty(lang.EndDirective))
                {
                    if (trimmed.Equals(lang.EndDirective, StringComparison.OrdinalIgnoreCase))
                        continue;
                }

                if (foundDirective)
                    codeBuilder.AppendLine(line);
            }

            return codeBuilder.ToString();
        }

        /// <summary>
        /// Processes the source code with the appropriate parser.
        /// If an external language is detected, executes it and returns HTML.
        /// If Calcpad, returns null so the caller uses the normal Calcpad parser.
        /// </summary>
        /// <param name="sourceCode">Full source code</param>
        /// <param name="cancellationToken">Cancellation token</param>
        /// <returns>DispatchResult with HTML if external language, or IsCalcpad=true if should use Calcpad parser</returns>
        public async Task<DispatchResult> ProcessAsync(string sourceCode, CancellationToken cancellationToken = default)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            _logger.Log("DISP", $"ProcessAsync starting ({sourceCode?.Length ?? 0} chars)");

            var result = new DispatchResult();

            // Detect if this is an external language file
            var language = DetectFileLanguage(sourceCode);
            _logger.Log("DISP", $"Detection complete: {language ?? "calcpad"} ({sw.ElapsedMilliseconds}ms)");

            if (language == null)
            {
                // No external language directive - use Calcpad parser
                result.IsCalcpad = true;
                result.Success = true;
                return result;
            }

            // External language detected - process entirely with that language
            result.Language = language;
            result.IsCalcpad = false;

            // Extract code (remove directive lines)
            var extractStart = sw.ElapsedMilliseconds;
            var code = ExtractLanguageCode(sourceCode, language);
            var originalCode = code; // Save original for cache key
            _logger.Log("DISP", $"Code extraction: {sw.ElapsedMilliseconds - extractStart}ms ({code?.Length ?? 0} chars)");

            // Check cache FIRST (before any modifications)
            var cachedResult = _executor.GetCachedResult(language, originalCode);
            if (cachedResult != null)
            {
                _logger.Log("DISP", $"Cache hit - returning cached result");
                result.Success = cachedResult.Success;
                result.HtmlOutput = cachedResult.Output;
                return result;
            }

            // Inject SAP2000 helper if needed (for Python scripts using SAP2000 API)
            if (language.Equals("python", StringComparison.OrdinalIgnoreCase) && IsSAP2000Script(code))
            {
                code = InjectSAP2000Helper(code);
                _logger.Log("DISP", "SAP2000 helper injected");
            }

            // Execute external language
            var execStart = sw.ElapsedMilliseconds;
            _logger.Log("DISP", $"Starting external execution...");
            var execResult = await _executor.ExecuteAsync(language, code, cancellationToken, originalCode);
            _logger.Log("DISP", $"Execution complete: {sw.ElapsedMilliseconds - execStart}ms");

            if (execResult.Success)
            {
                result.Success = true;
                result.HtmlOutput = execResult.Output;
                _logger.Log("DISP", $"ProcessAsync success, total: {sw.ElapsedMilliseconds}ms");
            }
            else
            {
                result.Success = false;
                result.Error = execResult.Error;
                // Generate error HTML
                result.HtmlOutput = GenerateErrorHtml(language, execResult.Error);
                _logger.Log("DISP", $"ProcessAsync failed: {execResult.Error}");
            }

            return result;
        }

        /// <summary>
        /// Synchronous wrapper for ProcessAsync
        /// </summary>
        public DispatchResult Process(string sourceCode)
        {
            return ProcessAsync(sourceCode).GetAwaiter().GetResult();
        }

        /// <summary>
        /// Generates error HTML for display
        /// </summary>
        private string GenerateErrorHtml(string language, string error)
        {
            var sb = new StringBuilder();
            sb.AppendLine($"<div class=\"error external-error\" style=\"color:red; background:#fee; padding:10px; margin:10px 0; border-left:4px solid red;\">");
            sb.AppendLine($"<strong>Error executing {language}:</strong>");
            sb.AppendLine($"<pre>{System.Web.HttpUtility.HtmlEncode(error)}</pre>");
            sb.AppendLine($"</div>");
            return sb.ToString();
        }

        /// <summary>
        /// Cleans up temporary files
        /// </summary>
        public void Cleanup()
        {
            _executor.CleanupTempFiles();
        }

        /// <summary>
        /// Checks if result is cached for the given source code.
        /// This allows WPF to skip showing "Calculating" page for cached results.
        /// </summary>
        /// <param name="sourceCode">Full source code including directive</param>
        /// <returns>True if result is cached</returns>
        public bool IsCached(string sourceCode)
        {
            var language = DetectFileLanguage(sourceCode);
            if (language == null)
                return false; // Calcpad code is handled differently

            var code = ExtractLanguageCode(sourceCode, language);
            return _executor.IsCached(language, code);
        }

        /// <summary>
        /// Gets cached result if available, for fast path without "Calculating" delay.
        /// </summary>
        /// <param name="sourceCode">Full source code including directive</param>
        /// <returns>DispatchResult if cached, null otherwise</returns>
        public DispatchResult GetCachedResult(string sourceCode)
        {
            var language = DetectFileLanguage(sourceCode);
            if (language == null)
                return null;

            var code = ExtractLanguageCode(sourceCode, language);
            var cachedExec = _executor.GetCachedResult(language, code);

            if (cachedExec != null)
            {
                _logger.Log("DISP", $"[{language}] Fast path - returning cached result");
                return new DispatchResult
                {
                    Success = cachedExec.Success,
                    IsCalcpad = false,
                    Language = language,
                    HtmlOutput = cachedExec.Output,
                    Error = cachedExec.Error
                };
            }
            return null;
        }

        /// <summary>
        /// Checks if Python code uses SAP2000 API
        /// </summary>
        private bool IsSAP2000Script(string code)
        {
            if (string.IsNullOrEmpty(code))
                return false;

            // Check for SAP2000 indicators
            return code.Contains("SAP2000") ||
                   code.Contains("SapModel") ||
                   code.Contains("SapObject") ||
                   code.Contains("SAP.connect") ||
                   code.Contains("SAP.SapModel") ||
                   (code.Contains("comtypes") && code.Contains("CSI.SAP2000"));
        }

        /// <summary>
        /// Injects SAP2000 helper class into Python code
        /// </summary>
        private string InjectSAP2000Helper(string code)
        {
            var helper = @"
# ============================================================================
# SAP2000 Helper (auto-injected by Calcpad)
# ============================================================================
import comtypes.client
import time

class _SAP2000Helper:
    _instance = None
    _mySapObject = None
    _SapModel = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @property
    def is_connected(self):
        if self._mySapObject is None:
            return False
        try:
            _ = self._mySapObject.SapModel
            return True
        except:
            self._mySapObject = None
            self._SapModel = None
            return False

    @property
    def mySapObject(self):
        if not self.is_connected:
            self.connect()
        return self._mySapObject

    @property
    def SapModel(self):
        if not self.is_connected:
            self.connect()
        return self._SapModel

    def connect(self, units=6, visible=True, create_blank=True):
        if self.is_connected:
            print('[SAP2000] Ya conectado - reutilizando conexion')
            return self._mySapObject, self._SapModel, False

        try:
            print('[SAP2000] Buscando instancia existente...')
            self._mySapObject = comtypes.client.GetActiveObject('CSI.SAP2000.API.SapObject')
            self._SapModel = self._mySapObject.SapModel
            print('[SAP2000] OK - Conectado a SAP2000 existente')
            return self._mySapObject, self._SapModel, False
        except:
            print('[SAP2000] No existe, creando nueva instancia...')

        helper = comtypes.client.CreateObject('SAP2000v1.Helper')
        helper = helper.QueryInterface(comtypes.gen.SAP2000v1.cHelper)
        self._mySapObject = helper.CreateObjectProgID('CSI.SAP2000.API.SapObject')
        print(f'[SAP2000] Iniciando (unidades={units})...')
        self._mySapObject.ApplicationStart(units, visible)
        time.sleep(3)
        self._SapModel = self._mySapObject.SapModel
        if create_blank:
            self._SapModel.InitializeNewModel(units)
            self._SapModel.File.NewBlank()
        print('[SAP2000] OK - SAP2000 nuevo creado')
        return self._mySapObject, self._SapModel, True

    def close(self, save=False):
        if self._mySapObject:
            print(f'[SAP2000] Cerrando (guardar={save})...')
            self._mySapObject.ApplicationExit(save)
            self._mySapObject = None
            self._SapModel = None
            print('[SAP2000] Cerrado')

    def status(self):
        if not self.is_connected:
            print('[SAP2000] No conectado')
            return
        sm = self._SapModel
        print(f'[SAP2000] Conectado: {sm.PointObj.Count()} nudos, {sm.AreaObj.Count()} areas, {sm.FrameObj.Count()} frames')

SAP = _SAP2000Helper()
# ============================================================================

";
            return helper + code;
        }
    }

    /// <summary>
    /// Result of language dispatch processing
    /// </summary>
    public class DispatchResult
    {
        /// <summary>
        /// Whether processing completed successfully
        /// </summary>
        public bool Success { get; set; } = true;

        /// <summary>
        /// True if the file should be processed by Calcpad parser (no external language)
        /// </summary>
        public bool IsCalcpad { get; set; } = true;

        /// <summary>
        /// The detected language (null if Calcpad)
        /// </summary>
        public string Language { get; set; }

        /// <summary>
        /// HTML output from external language execution (null if Calcpad)
        /// </summary>
        public string HtmlOutput { get; set; }

        /// <summary>
        /// Error message if any
        /// </summary>
        public string Error { get; set; }
    }
}
