using System;
using System.Collections.Generic;

namespace Calcpad.Core
{
    /// <summary>
    /// Registry for storing string arrays that can be used in special commands like $Bar and $Table.
    /// This provides a way to define reusable string arrays without modifying the core math parser.
    ///
    /// Usage in Calcpad:
    /// - To define a string array, you can use inline syntax directly in commands:
    ///   $Bar{["Ene"; "Feb"; "Mar"] & valores}
    ///
    /// - Or reference variables that will be evaluated as string arrays:
    ///   $Bar{etiquetas & valores}
    ///   where 'etiquetas' contains ["Ene"; "Feb"; "Mar"] inline
    /// </summary>
    internal static class StringArrayRegistry
    {
        private static readonly Dictionary<string, string[]> _arrays = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>
        /// Registers a string array with the given name
        /// </summary>
        internal static void Register(string name, string[] values)
        {
            _arrays[name] = values;
        }

        /// <summary>
        /// Tries to get a string array by name
        /// </summary>
        internal static bool TryGet(string name, out string[] values)
        {
            return _arrays.TryGetValue(name, out values);
        }

        /// <summary>
        /// Checks if a string array exists with the given name
        /// </summary>
        internal static bool Contains(string name)
        {
            return _arrays.ContainsKey(name);
        }

        /// <summary>
        /// Removes a string array from the registry
        /// </summary>
        internal static void Remove(string name)
        {
            _arrays.Remove(name);
        }

        /// <summary>
        /// Clears all string arrays from the registry
        /// </summary>
        internal static void Clear()
        {
            _arrays.Clear();
        }

        /// <summary>
        /// Parses a string array expression like ["A"; "B"; "C"] or "A"; "B"; "C"
        /// </summary>
        internal static string[] Parse(string expr)
        {
            if (string.IsNullOrWhiteSpace(expr))
                return Array.Empty<string>();

            expr = expr.Trim();

            // Remove brackets if present
            if (expr.StartsWith("[") && expr.EndsWith("]"))
                expr = expr.Substring(1, expr.Length - 2);

            var result = new List<string>();
            var current = new System.Text.StringBuilder();
            bool inQuotes = false;
            char quoteChar = '\0';

            for (int i = 0; i < expr.Length; i++)
            {
                char c = expr[i];

                if (!inQuotes && (c == '"' || c == '\''))
                {
                    inQuotes = true;
                    quoteChar = c;
                }
                else if (inQuotes && c == quoteChar)
                {
                    inQuotes = false;
                    // Add the collected string (without quotes)
                    var s = current.ToString();
                    if (!string.IsNullOrWhiteSpace(s))
                        result.Add(s);
                    current.Clear();
                }
                else if (inQuotes)
                {
                    current.Append(c);
                }
                else if (c == ';' && !inQuotes)
                {
                    // Separator - if there's unquoted content, add it
                    var s = current.ToString().Trim();
                    if (!string.IsNullOrWhiteSpace(s))
                        result.Add(s);
                    current.Clear();
                }
                else if (!char.IsWhiteSpace(c) || current.Length > 0)
                {
                    // Collect unquoted content (for backward compatibility)
                    current.Append(c);
                }
            }

            // Add any remaining content
            var remaining = current.ToString().Trim();
            if (!string.IsNullOrWhiteSpace(remaining))
                result.Add(remaining);

            return result.ToArray();
        }

        /// <summary>
        /// Checks if the expression looks like a string array (contains quoted strings)
        /// </summary>
        internal static bool IsStringArrayExpression(string expr)
        {
            if (string.IsNullOrWhiteSpace(expr))
                return false;

            expr = expr.Trim();

            // Check if it starts with [ and contains quotes
            if (expr.StartsWith("["))
            {
                return expr.Contains("\"") || expr.Contains("'");
            }

            // Check if it's just quoted strings separated by semicolons
            return (expr.Contains("\"") || expr.Contains("'")) && expr.Contains(";");
        }
    }
}
