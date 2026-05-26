using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Calcpad.Core.Languages
{
    /// <summary>
    /// Configuration for external parser executables (config.json)
    /// </summary>
    public class ParserConfig
    {
        [JsonPropertyName("defaultLanguage")]
        public string DefaultLanguage { get; set; } = "calcpad";

        [JsonPropertyName("parsers")]
        public Dictionary<string, ParserDefinition> Parsers { get; set; } = new();
    }

    /// <summary>
    /// Definition of an external parser executable
    /// </summary>
    public class ParserDefinition
    {
        [JsonPropertyName("command")]
        public string Command { get; set; }

        [JsonPropertyName("args")]
        public string Args { get; set; }

        [JsonPropertyName("extension")]
        public string Extension { get; set; }

        [JsonPropertyName("outputType")]
        public string OutputType { get; set; } = "stdout";

        [JsonPropertyName("description")]
        public string Description { get; set; }

        /// <summary>
        /// Default timeout in milliseconds for this parser (0 = use global default)
        /// </summary>
        [JsonPropertyName("defaultTimeout")]
        public int DefaultTimeout { get; set; } = 0;

        /// <summary>
        /// Maximum timeout in milliseconds for complex scripts (0 = no maximum)
        /// </summary>
        [JsonPropertyName("maxTimeout")]
        public int MaxTimeout { get; set; } = 0;

        /// <summary>
        /// Whether to enable process pooling for this parser
        /// </summary>
        [JsonPropertyName("poolingEnabled")]
        public bool PoolingEnabled { get; set; } = false;

        /// <summary>
        /// Returns true if this parser requires an external executable
        /// </summary>
        public bool IsExternal => !string.IsNullOrEmpty(Command);

        /// <summary>
        /// Returns true if output is passed through without processing
        /// </summary>
        public bool IsPassthrough => OutputType == "passthrough";

        /// <summary>
        /// Returns true if this is the internal Calcpad parser
        /// </summary>
        public bool IsInternal => OutputType == "internal";
    }

    /// <summary>
    /// Language definition loaded from JSON (e.g., python.json, calcpad.json)
    /// </summary>
    public class LanguageDefinition
    {
        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("directive")]
        public string Directive { get; set; }

        [JsonPropertyName("endDirective")]
        public string EndDirective { get; set; }

        [JsonPropertyName("fileExtension")]
        public string FileExtension { get; set; }

        [JsonPropertyName("caseSensitive")]
        public bool CaseSensitive { get; set; }

        [JsonPropertyName("comments")]
        public CommentDefinition Comments { get; set; } = new();

        [JsonPropertyName("colors")]
        public Dictionary<string, string> Colors { get; set; } = new();

        [JsonPropertyName("keywords")]
        public List<string> Keywords { get; set; } = new();

        [JsonPropertyName("builtins")]
        public List<string> Builtins { get; set; } = new();

        [JsonPropertyName("functions")]
        public List<string> Functions { get; set; } = new();

        [JsonPropertyName("commands")]
        public List<string> Commands { get; set; } = new();

        [JsonPropertyName("units")]
        public List<string> Units { get; set; } = new();

        [JsonPropertyName("operators")]
        public List<string> Operators { get; set; } = new();

        [JsonPropertyName("tags")]
        public List<string> Tags { get; set; } = new();

        [JsonPropertyName("attributes")]
        public List<string> Attributes { get; set; } = new();

        [JsonPropertyName("stringDelimiters")]
        public List<string> StringDelimiters { get; set; } = new();

        [JsonPropertyName("constants")]
        public Dictionary<string, double> Constants { get; set; } = new();

        [JsonPropertyName("libraries")]
        public Dictionary<string, LibraryDefinition> Libraries { get; set; } = new();

        [JsonPropertyName("autocomplete")]
        public List<AutocompleteItem> Autocomplete { get; set; } = new();

        /// <summary>
        /// Returns true if this language has a directive (not native Calcpad)
        /// </summary>
        public bool HasDirective => !string.IsNullOrEmpty(Directive);
    }

    /// <summary>
    /// Comment syntax definition
    /// </summary>
    public class CommentDefinition
    {
        [JsonPropertyName("singleLine")]
        public string SingleLine { get; set; }

        [JsonPropertyName("title")]
        public string Title { get; set; }

        [JsonPropertyName("multiLineStart")]
        public string MultiLineStart { get; set; }

        [JsonPropertyName("multiLineEnd")]
        public string MultiLineEnd { get; set; }

        [JsonPropertyName("htmlStart")]
        public string HtmlStart { get; set; }

        [JsonPropertyName("htmlEnd")]
        public string HtmlEnd { get; set; }
    }

    /// <summary>
    /// Library definition (for Python, etc.)
    /// </summary>
    public class LibraryDefinition
    {
        [JsonPropertyName("alias")]
        public string Alias { get; set; }

        [JsonPropertyName("functions")]
        public List<string> Functions { get; set; } = new();
    }

    /// <summary>
    /// Autocomplete item definition
    /// </summary>
    public class AutocompleteItem
    {
        [JsonPropertyName("text")]
        public string Text { get; set; }

        [JsonPropertyName("type")]
        public string Type { get; set; }

        [JsonPropertyName("description")]
        public string Description { get; set; }
    }
}
