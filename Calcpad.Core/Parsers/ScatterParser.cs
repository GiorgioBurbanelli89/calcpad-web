using System;
using System.Collections.Generic;

namespace Calcpad.Core
{
    /// <summary>
    /// Parser for $Scatter command - scatter plots from vector data
    /// Syntax: $Scatter{x & y}
    ///         $Scatter{x & y | "label"}
    ///         $Scatter{x1 & y1 | "label1" & x2 & y2 | "label2"}
    /// </summary>
    internal class ScatterParser : PlotParser
    {
        internal ScatterParser(MathParser parser, PlotSettings settings) : base(parser, settings) { }

        internal override string Parse(ReadOnlySpan<char> script, bool calculate)
        {
            // Find the content between { and }
            int start = script.IndexOf('{');
            int end = script.LastIndexOf('}');

            if (start < 0 || end < 0 || end <= start)
                return $"<span class=\"err\">Error: Invalid $Scatter syntax. Expected $Scatter{{x & y}}</span>";

            var content = script.Slice(start + 1, end - start - 1).ToString().Trim();

            if (!calculate)
                return GetHtmlText(content);

            try
            {
                var series = ParseSeries(content);
                var plotter = new ScatterPlotter(Parser, Settings, series);
                return plotter.Plot();
            }
            catch (Exception ex)
            {
                return $"<span class=\"err\">Error in $Scatter: {ex.Message}</span>";
            }
        }

        private List<ScatterSeries> ParseSeries(string content)
        {
            var result = new List<ScatterSeries>();

            // Split by & to get pairs of x, y (and optional labels)
            var parts = SplitByAmpersand(content);

            int i = 0;
            while (i < parts.Count)
            {
                var series = new ScatterSeries();

                // Parse X vector
                var xPart = parts[i].Trim();
                series.XData = EvaluateVector(xPart);
                i++;

                if (i >= parts.Count)
                    throw new ArgumentException("Missing Y data for scatter series");

                // Parse Y vector (may include | label)
                var yPart = parts[i].Trim();
                int pipeIndex = yPart.IndexOf('|');
                if (pipeIndex > 0)
                {
                    var yExpr = yPart.Substring(0, pipeIndex).Trim();
                    var label = yPart.Substring(pipeIndex + 1).Trim().Trim('"', '\'');
                    series.YData = EvaluateVector(yExpr);
                    series.Label = label;
                }
                else
                {
                    series.YData = EvaluateVector(yPart);
                    series.Label = $"Serie {result.Count + 1}";
                }
                i++;

                result.Add(series);
            }

            return result;
        }

        private List<string> SplitByAmpersand(string content)
        {
            var result = new List<string>();
            int depth = 0;
            int start = 0;

            for (int i = 0; i < content.Length; i++)
            {
                char c = content[i];
                if (c == '[' || c == '(') depth++;
                else if (c == ']' || c == ')') depth--;
                else if (c == '&' && depth == 0)
                {
                    result.Add(content.Substring(start, i - start));
                    start = i + 1;
                }
            }
            result.Add(content.Substring(start));
            return result;
        }

        private double[] EvaluateVector(string expr)
        {
            expr = expr.Trim();
            Parser.Parse(expr);
            Parser.Calculate();

            // Try to get the variable if it's a variable reference
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
            return $"<span class=\"eq\"><span class=\"cond\">$Scatter</span>{{{content}}}</span>";
        }
    }

    internal class ScatterSeries
    {
        public double[] XData { get; set; }
        public double[] YData { get; set; }
        public string Label { get; set; } = "Serie";
        public string Color { get; set; }
    }
}
