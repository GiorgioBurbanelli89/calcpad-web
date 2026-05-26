using System;
using System.Collections.Generic;

namespace Calcpad.Core
{
    /// <summary>
    /// Parser for $Bar command - bar charts from vector data
    /// Syntax: $Bar{labels & values}
    ///         $Bar{labels & values | "serie name"}
    ///         $Bar{labels & values1 | "name1" & values2 | "name2"}
    /// Also supports $BarH for horizontal bars
    ///
    /// Labels can be:
    /// - Numeric vector: $Bar{[1; 2; 3] & valores}
    /// - String array inline: $Bar{["Ene"; "Feb"; "Mar"] & valores}
    /// - Variable reference: $Bar{etiquetas & valores}
    /// </summary>
    internal class BarParser : PlotParser
    {
        private readonly bool _horizontal;

        internal BarParser(MathParser parser, PlotSettings settings, bool horizontal = false)
            : base(parser, settings)
        {
            _horizontal = horizontal;
        }

        internal override string Parse(ReadOnlySpan<char> script, bool calculate)
        {
            // Find the content between { and }
            int start = script.IndexOf('{');
            int end = script.LastIndexOf('}');

            if (start < 0 || end < 0 || end <= start)
                return $"<span class=\"err\">Error: Invalid $Bar syntax. Expected $Bar{{labels & values}}</span>";

            var content = script.Slice(start + 1, end - start - 1).ToString().Trim();

            if (!calculate)
                return GetHtmlText(content);

            try
            {
                var (labels, series) = ParseContent(content);
                var plotter = new BarPlotter(Parser, Settings, labels, series, _horizontal);
                return plotter.Plot();
            }
            catch (Exception ex)
            {
                return $"<span class=\"err\">Error in $Bar: {ex.Message}</span>";
            }
        }

        private (string[] labels, List<BarSeries> series) ParseContent(string content)
        {
            var seriesList = new List<BarSeries>();

            // Split by & to get parts
            var parts = SplitByAmpersand(content);

            if (parts.Count < 2)
                throw new ArgumentException("$Bar requires at least labels & values");

            // First part is labels (could be vector of strings or numbers)
            string[] labels = EvaluateLabels(parts[0].Trim());

            // Remaining parts are value series
            for (int i = 1; i < parts.Count; i++)
            {
                var part = parts[i].Trim();
                var series = new BarSeries();

                int pipeIndex = FindPipeOutsideBrackets(part);
                if (pipeIndex > 0)
                {
                    var valExpr = part.Substring(0, pipeIndex).Trim();
                    var label = part.Substring(pipeIndex + 1).Trim().Trim('"', '\'');
                    series.Values = EvaluateVector(valExpr);
                    series.Label = label;
                }
                else
                {
                    series.Values = EvaluateVector(part);
                    series.Label = $"Serie {seriesList.Count + 1}";
                }

                seriesList.Add(series);
            }

            return (labels, seriesList);
        }

        private int FindPipeOutsideBrackets(string s)
        {
            int depth = 0;
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (c == '[' || c == '(') depth++;
                else if (c == ']' || c == ')') depth--;
                else if (c == '|' && depth == 0) return i;
            }
            return -1;
        }

        private List<string> SplitByAmpersand(string content)
        {
            var result = new List<string>();
            int depth = 0;
            int start = 0;
            bool inString = false;
            char stringChar = '\0';

            for (int i = 0; i < content.Length; i++)
            {
                char c = content[i];

                if ((c == '"' || c == '\'') && (i == 0 || content[i - 1] != '\\'))
                {
                    if (!inString)
                    {
                        inString = true;
                        stringChar = c;
                    }
                    else if (c == stringChar)
                    {
                        inString = false;
                    }
                }
                else if (!inString)
                {
                    if (c == '[' || c == '(') depth++;
                    else if (c == ']' || c == ')') depth--;
                    else if (c == '&' && depth == 0)
                    {
                        result.Add(content.Substring(start, i - start));
                        start = i + 1;
                    }
                }
            }
            result.Add(content.Substring(start));
            return result;
        }

        private string[] EvaluateLabels(string expr)
        {
            expr = expr.Trim();

            // First, check if it is a string array expression (contains quotes)
            if (StringArrayRegistry.IsStringArrayExpression(expr))
            {
                return StringArrayRegistry.Parse(expr);
            }

            // Check if it is registered in the string array registry
            if (StringArrayRegistry.TryGet(expr, out var stringArray))
            {
                return stringArray;
            }

            // Try to parse as vector variable (numeric)
            try
            {
                Parser.Parse(expr);
                Parser.Calculate();

                var varRef = Parser.GetVariableRef(expr);
                if (varRef != null)
                {
                    var value = varRef.Value;

                    // Check if it is a StringArray stored as IValue
                    if (value is StringArray strArr)
                    {
                        return strArr.Values;
                    }

                    if (value is Vector vec)
                    {
                        var result = new string[vec.Length];
                        for (int i = 0; i < vec.Length; i++)
                            result[i] = vec[i].D.ToString("G4");
                        return result;
                    }
                    else if (value is RealValue real)
                    {
                        return [real.D.ToString("G4")];
                    }
                    else if (value is IScalarValue scalar)
                    {
                        return [scalar.Re.ToString("G4")];
                    }
                }
            }
            catch
            {
                // If it fails, try to parse as string array: ["A"; "B"; "C"]
            }

            // Final fallback: parse as string array
            return StringArrayRegistry.Parse(expr);
        }

        private static string[] ParseStringArray(string expr)
        {
            expr = expr.Trim();
            if (expr.StartsWith("[") && expr.EndsWith("]"))
                expr = expr.Substring(1, expr.Length - 2);

            var result = new List<string>();
            var parts = expr.Split(';');
            foreach (var p in parts)
            {
                var s = p.Trim().Trim('"', '\'');
                if (!string.IsNullOrWhiteSpace(s))
                    result.Add(s);
            }
            return result.ToArray();
        }

        private double[] EvaluateVector(string expr)
        {
            expr = expr.Trim();
            Parser.Parse(expr);
            Parser.Calculate();

            // Try to get the variable if it is a variable reference
            try
            {
                var varRef = Parser.GetVariableRef(expr);
                var value = varRef.Value;

                if (value is Vector vec)
                {
                    var result = new double[vec.Length];
                    for (int i = 0; i < vec.Length; i++)
                        result[i] = vec[i].D;
                    return result;
                }
                else if (value is RealValue real)
                {
                    return [real.D];
                }
                else if (value is IScalarValue scalar)
                {
                    return [scalar.Re];
                }
            }
            catch
            {
                // Not a simple variable, try parsing as inline vector [1; 2; 3]
            }

            // Try to parse as inline vector expression
            if (expr.StartsWith("[") && expr.EndsWith("]"))
            {
                var inner = expr.Substring(1, expr.Length - 2);
                var parts = inner.Split(';');
                var result = new double[parts.Length];
                for (int i = 0; i < parts.Length; i++)
                {
                    Parser.Parse(parts[i].Trim());
                    Parser.Calculate();
                    result[i] = Parser.Real;
                }
                return result;
            }

            // Single value
            return [Parser.Real];
        }

        private string GetHtmlText(string content)
        {
            var cmd = _horizontal ? "$BarH" : "$Bar";
            return $"<span class=\"eq\"><span class=\"cond\">{cmd}</span>{{{content}}}</span>";
        }
    }

    internal class BarSeries
    {
        public double[] Values { get; set; }
        public string Label { get; set; } = "Serie";
        public string Color { get; set; }
    }
}
