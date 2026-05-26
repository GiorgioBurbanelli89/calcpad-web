using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace Calcpad.Core.Languages
{
    /// <summary>
    /// Manages loading and accessing language definitions from JSON files
    /// with lazy loading support for improved startup performance
    /// </summary>
    public class LanguageManager
    {
        private static LanguageManager _instance;
        private static readonly object _lock = new();

        // Lazy-loaded language definitions (only loaded when requested)
        private readonly ConcurrentDictionary<string, Lazy<LanguageDefinition>> _lazyLanguages = new(StringComparer.OrdinalIgnoreCase);
        // Cached loaded languages for fast access
        private readonly ConcurrentDictionary<string, LanguageDefinition> _loadedLanguages = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, ParserDefinition> _parsers = new(StringComparer.OrdinalIgnoreCase);
        private string _defaultLanguage = "calcpad";
        private string _languagesPath;
        private readonly JsonSerializerOptions _jsonOptions;

        /// <summary>
        /// Gets the singleton instance of LanguageManager
        /// </summary>
        public static LanguageManager Instance
        {
            get
            {
                if (_instance == null)
                {
                    lock (_lock)
                    {
                        _instance ??= new LanguageManager();
                    }
                }
                return _instance;
            }
        }

        /// <summary>
        /// Gets all loaded language definitions (loads all if needed)
        /// </summary>
        public IReadOnlyDictionary<string, LanguageDefinition> Languages
        {
            get
            {
                // Ensure all languages are loaded
                foreach (var key in _lazyLanguages.Keys)
                {
                    GetLanguage(key);
                }
                return _loadedLanguages;
            }
        }

        /// <summary>
        /// Gets all loaded parser definitions
        /// </summary>
        public IReadOnlyDictionary<string, ParserDefinition> Parsers => _parsers;

        /// <summary>
        /// Gets the default language name
        /// </summary>
        public string DefaultLanguage => _defaultLanguage;

        /// <summary>
        /// Gets the path to the languages folder
        /// </summary>
        public string LanguagesPath => _languagesPath;

        private LanguageManager()
        {
            _jsonOptions = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                ReadCommentHandling = JsonCommentHandling.Skip
            };
            FindLanguagesPath();
            LoadConfiguration();
            PrepareLanguages(); // Changed from LoadLanguages to PrepareLanguages (lazy)
        }

        /// <summary>
        /// Forces reload of all language configurations
        /// </summary>
        public void Reload()
        {
            _lazyLanguages.Clear();
            _loadedLanguages.Clear();
            _parsers.Clear();
            LoadConfiguration();
            PrepareLanguages();
        }

        /// <summary>
        /// Gets a language definition by name (loads lazily if needed)
        /// </summary>
        public LanguageDefinition GetLanguage(string name)
        {
            if (string.IsNullOrEmpty(name))
                name = _defaultLanguage;

            // Check if already loaded
            if (_loadedLanguages.TryGetValue(name, out var loaded))
                return loaded;

            // Try lazy loading
            if (_lazyLanguages.TryGetValue(name, out var lazy))
            {
                var lang = lazy.Value;
                if (lang != null)
                {
                    _loadedLanguages[name] = lang;
                    return lang;
                }
            }

            return null;
        }

        /// <summary>
        /// Gets a parser definition by language name
        /// </summary>
        public ParserDefinition GetParser(string languageName)
        {
            if (string.IsNullOrEmpty(languageName))
                languageName = _defaultLanguage;

            return _parsers.TryGetValue(languageName, out var parser) ? parser : null;
        }

        /// <summary>
        /// Detects the language from a directive line (e.g., "#python")
        /// </summary>
        public string DetectLanguageFromDirective(string line)
        {
            if (string.IsNullOrWhiteSpace(line))
                return null;

            var trimmed = line.Trim();

            // Check each language (loading lazily as needed)
            foreach (var key in _lazyLanguages.Keys)
            {
                var lang = GetLanguage(key);
                if (lang != null && !string.IsNullOrEmpty(lang.Directive) &&
                    trimmed.Equals(lang.Directive, StringComparison.OrdinalIgnoreCase))
                {
                    return key;
                }
            }
            return null;
        }

        /// <summary>
        /// Checks if a line is an end directive for a language
        /// </summary>
        public bool IsEndDirective(string line, string languageName)
        {
            if (string.IsNullOrWhiteSpace(line) || string.IsNullOrEmpty(languageName))
                return false;

            var lang = GetLanguage(languageName);
            if (lang == null || string.IsNullOrEmpty(lang.EndDirective))
                return false;

            return line.Trim().Equals(lang.EndDirective, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Gets all available language names
        /// </summary>
        public IEnumerable<string> GetAvailableLanguages()
        {
            return _lazyLanguages.Keys.OrderBy(k => k);
        }

        /// <summary>
        /// Checks if a language is available
        /// </summary>
        public bool IsLanguageAvailable(string name)
        {
            return _lazyLanguages.ContainsKey(name);
        }

        /// <summary>
        /// Gets all language directives (both start and end) for syntax highlighting
        /// </summary>
        public IEnumerable<string> GetAllDirectives()
        {
            var directives = new List<string>();
            foreach (var key in _lazyLanguages.Keys)
            {
                var lang = GetLanguage(key);
                if (lang != null)
                {
                    if (!string.IsNullOrEmpty(lang.Directive))
                    {
                        directives.Add(lang.Directive);
                    }
                    if (!string.IsNullOrEmpty(lang.EndDirective))
                    {
                        directives.Add(lang.EndDirective);
                    }
                }
            }
            return directives;
        }

        private void FindLanguagesPath()
        {
            // Try multiple locations
            var possiblePaths = new[]
            {
                // Development: relative to executable
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "languages"),
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "languages"),
                // Installed: Program Files
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Calcpad", "languages"),
                // User folder
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Calcpad", "languages"),
                // Current directory
                Path.Combine(Directory.GetCurrentDirectory(), "languages")
            };

            foreach (var path in possiblePaths)
            {
                var fullPath = Path.GetFullPath(path);
                if (Directory.Exists(fullPath))
                {
                    _languagesPath = fullPath;
                    return;
                }
            }

            // Default to application directory if none found
            _languagesPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "languages");
        }

        private void LoadConfiguration()
        {
            var configPath = Path.Combine(_languagesPath, "config.json");
            if (!File.Exists(configPath))
            {
                // Create default configuration
                CreateDefaultConfig(configPath);
                return;
            }

            try
            {
                var json = File.ReadAllText(configPath);
                var options = new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true,
                    ReadCommentHandling = JsonCommentHandling.Skip
                };
                var config = JsonSerializer.Deserialize<ParserConfig>(json, options);

                if (config != null)
                {
                    _defaultLanguage = config.DefaultLanguage ?? "calcpad";
                    foreach (var kvp in config.Parsers)
                    {
                        _parsers[kvp.Key] = kvp.Value;
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Error loading config.json: {ex.Message}");
            }
        }

        /// <summary>
        /// Prepares language definitions for lazy loading (does not load immediately)
        /// </summary>
        private void PrepareLanguages()
        {
            if (!Directory.Exists(_languagesPath))
            {
                // Ensure Calcpad is always available
                _lazyLanguages["calcpad"] = new Lazy<LanguageDefinition>(() => CreateDefaultCalcpadDefinition());
                return;
            }

            var jsonFiles = Directory.GetFiles(_languagesPath, "*.json")
                .Where(f => !Path.GetFileName(f).Equals("config.json", StringComparison.OrdinalIgnoreCase));

            foreach (var file in jsonFiles)
            {
                var key = Path.GetFileNameWithoutExtension(file).ToLowerInvariant();
                var filePath = file; // Capture for closure

                // Create lazy loader for each language file
                _lazyLanguages[key] = new Lazy<LanguageDefinition>(() =>
                {
                    try
                    {
                        var json = File.ReadAllText(filePath);
                        var lang = JsonSerializer.Deserialize<LanguageDefinition>(json, _jsonOptions);
                        if (lang != null && !string.IsNullOrEmpty(lang.Name))
                        {
                            return lang;
                        }
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine($"Error loading {filePath}: {ex.Message}");
                    }
                    return null;
                });
            }

            // Ensure Calcpad is always available
            if (!_lazyLanguages.ContainsKey("calcpad"))
            {
                _lazyLanguages["calcpad"] = new Lazy<LanguageDefinition>(() => CreateDefaultCalcpadDefinition());
            }
        }

        private void CreateDefaultConfig(string configPath)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(configPath));
                var config = new ParserConfig
                {
                    DefaultLanguage = "calcpad",
                    Parsers = new Dictionary<string, ParserDefinition>
                    {
                        ["calcpad"] = new ParserDefinition
                        {
                            Command = null,
                            Extension = ".cpd",
                            OutputType = "internal",
                            Description = "Calcpad native parser"
                        },
                        ["python"] = new ParserDefinition
                        {
                            Command = "python",
                            Args = "{file}",
                            Extension = ".py",
                            OutputType = "stdout",
                            Description = "Python 3.x interpreter"
                        },
                        ["html"] = new ParserDefinition
                        {
                            Command = null,
                            Extension = ".html",
                            OutputType = "passthrough",
                            Description = "Raw HTML passthrough"
                        }
                    }
                };

                var options = new JsonSerializerOptions { WriteIndented = true };
                var json = JsonSerializer.Serialize(config, options);
                File.WriteAllText(configPath, json);

                foreach (var kvp in config.Parsers)
                {
                    _parsers[kvp.Key] = kvp.Value;
                }
                _defaultLanguage = config.DefaultLanguage;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Error creating default config: {ex.Message}");
            }
        }

        private LanguageDefinition CreateDefaultCalcpadDefinition()
        {
            return new LanguageDefinition
            {
                Name = "Calcpad",
                Directive = null,
                EndDirective = null,
                FileExtension = ".cpd",
                CaseSensitive = false,
                Keywords = new List<string>
                {
                    "#if", "#else", "#else if", "#end if",
                    "#for", "#while", "#loop", "#break", "#continue",
                    "#def", "#end def", "#include",
                    "#hide", "#show", "#val", "#equ", "#noc"
                },
                Commands = new List<string>
                {
                    "$plot", "$map", "$root", "$find", "$area", "$integral", "$sum", "$product"
                }
            };
        }
    }
}
