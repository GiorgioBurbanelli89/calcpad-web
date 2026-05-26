using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Calcpad.Core
{
    /// <summary>
    /// Parser for $Table command - generates HTML tables from matrices/vectors
    /// Syntax:
    ///   $Table{matrix}                    - Simple table from matrix
    ///   $Table{vector1 & vector2}         - Table from column vectors
    ///   $Table{vector1|"Col1" & vector2|"Col2"} - With headers
    ///   $Table{matrix | "Title"}          - With caption
    ///   $Table{matrix | headers: ["A";"B"] | caption: "Title"} - Full options
    /// </summary>
    internal class TableParser : PlotParser
    {
        internal TableParser(MathParser parser, PlotSettings settings)
            : base(parser, settings)
        {
        }

        internal override string Parse(ReadOnlySpan<char> script, bool calculate)
        {
            // Find the content between { and }
            int start = script.IndexOf('{');
            int end = script.LastIndexOf('}');

            if (start < 0 || end < 0 || end <= start)
                return "<span class=\"err\">Error: Invalid $Table syntax. Expected $Table{data}</span>";

            var content = script.Slice(start + 1, end - start - 1).ToString().Trim();

            if (!calculate)
                return GetHtmlText(content);

            try
            {
                return GenerateTable(content);
            }
            catch (Exception ex)
            {
                return $"<span class=\"err\">Error in $Table: {ex.Message}</span>";
            }
        }

        private string GenerateTable(string content)
        {
            var sb = new StringBuilder();
            string caption = null;
            string[] headers = null;
            string tableClass = "bordered";

            // Check for options (separated by |)
            var parts = SplitByPipe(content);
            var dataExpr = parts[0].Trim();

            // Parse options
            for (int i = 1; i < parts.Count; i++)
            {
                var opt = parts[i].Trim();
                if (opt.StartsWith("caption:", StringComparison.OrdinalIgnoreCase))
                {
                    caption = opt.Substring(8).Trim().Trim('"', '\'');
                }
                else if (opt.StartsWith("headers:", StringComparison.OrdinalIgnoreCase))
                {
                    headers = ParseStringArray(opt.Substring(8).Trim());
                }
                else if (opt.StartsWith("class:", StringComparison.OrdinalIgnoreCase))
                {
                    tableClass = opt.Substring(6).Trim().Trim('"', '\'');
                }
                else if (opt.StartsWith("\"") || opt.StartsWith("'"))
                {
                    // Simple caption
                    caption = opt.Trim('"', '\'');
                }
            }

            // Check if data is multiple vectors separated by &
            var columns = SplitByAmpersand(dataExpr);

            if (columns.Count > 1)
            {
                // Multiple vectors/columns
                return GenerateTableFromColumns(columns, headers, caption, tableClass);
            }
            else
            {
                // Single matrix or vector
                return GenerateTableFromMatrix(dataExpr, headers, caption, tableClass);
            }
        }

        private string GenerateTableFromMatrix(string expr, string[] headers, string caption, string tableClass)
        {
            var sb = new StringBuilder();
            IValue value = null;

            // Check if it's an inline expression (starts with [) or a variable name
            expr = expr.Trim();
            if (expr.StartsWith("["))
            {
                // Inline vector/matrix expression - parse and get result
                value = ParseInlineExpression(expr);
            }
            else
            {
                // Variable reference - get from variables dictionary
                var varRef = Parser.GetVariableRef(expr);
                value = varRef?.Value;
            }

            sb.Append($"<table class=\"{tableClass}\">");

            if (!string.IsNullOrEmpty(caption))
                sb.Append($"<caption>{caption}</caption>");

            if (value is Matrix mat)
            {
                int rows = mat.RowCount;
                int cols = mat.ColCount;

                // Headers
                if (headers != null && headers.Length > 0)
                {
                    sb.Append("<thead><tr>");
                    for (int j = 0; j < cols && j < headers.Length; j++)
                        sb.Append($"<th>{headers[j]}</th>");
                    for (int j = headers.Length; j < cols; j++)
                        sb.Append($"<th>Col {j + 1}</th>");
                    sb.Append("</tr></thead>");
                }

                // Data
                sb.Append("<tbody>");
                for (int i = 0; i < rows; i++)
                {
                    sb.Append("<tr>");
                    for (int j = 0; j < cols; j++)
                    {
                        var val = mat[i, j];
                        sb.Append($"<td>{FormatValue(val)}</td>");
                    }
                    sb.Append("</tr>");
                }
                sb.Append("</tbody>");
            }
            else if (value is Vector vec)
            {
                // Vector as single column or row
                if (headers != null && headers.Length > 0)
                {
                    sb.Append("<thead><tr>");
                    sb.Append($"<th>{headers[0]}</th>");
                    sb.Append("</tr></thead>");
                }

                sb.Append("<tbody>");
                // Use Values array directly
                var values = vec.Values;
                for (int i = 0; i < values.Length; i++)
                {
                    sb.Append($"<tr><td>{FormatDouble(values[i].D)}</td></tr>");
                }
                sb.Append("</tbody>");
            }
            else if (value is RealValue real)
            {
                sb.Append($"<tbody><tr><td>{FormatValue(real)}</td></tr></tbody>");
            }

            sb.Append("</table>");
            return sb.ToString();
        }

        private string GenerateTableFromColumns(List<string> columns, string[] defaultHeaders, string caption, string tableClass)
        {
            var sb = new StringBuilder();
            var vectors = new List<(double[] data, string header)>();

            // Parse each column
            for (int i = 0; i < columns.Count; i++)
            {
                var col = columns[i].Trim();
                string header = defaultHeaders != null && i < defaultHeaders.Length
                    ? defaultHeaders[i]
                    : $"Col {i + 1}";

                // Check for inline header: expr | "Header"
                int pipeIdx = FindPipeOutsideBrackets(col);
                if (pipeIdx > 0)
                {
                    header = col.Substring(pipeIdx + 1).Trim().Trim('"', '\'');
                    col = col.Substring(0, pipeIdx).Trim();
                }

                var data = EvaluateVector(col);
                vectors.Add((data, header));
            }

            // Find max length
            int maxLen = 0;
            foreach (var v in vectors)
                if (v.data.Length > maxLen) maxLen = v.data.Length;

            // Generate table
            sb.Append($"<table class=\"{tableClass}\">");

            if (!string.IsNullOrEmpty(caption))
                sb.Append($"<caption>{caption}</caption>");

            // Headers
            sb.Append("<thead><tr>");
            foreach (var v in vectors)
                sb.Append($"<th>{v.header}</th>");
            sb.Append("</tr></thead>");

            // Data rows
            sb.Append("<tbody>");
            for (int i = 0; i < maxLen; i++)
            {
                sb.Append("<tr>");
                foreach (var v in vectors)
                {
                    if (i < v.data.Length)
                        sb.Append($"<td>{FormatDouble(v.data[i])}</td>");
                    else
                        sb.Append("<td></td>");
                }
                sb.Append("</tr>");
            }
            sb.Append("</tbody>");

            sb.Append("</table>");
            return sb.ToString();
        }

        private string FormatValue(IValue val)
        {
            if (val is RealValue real)
                return FormatDouble(real.D);
            if (val is ComplexValue cplx)
                return $"{FormatDouble(cplx.A)} + {FormatDouble(cplx.B)}i";
            if (val is IScalarValue scalar)
                return FormatDouble(scalar.Re);
            return val?.ToString() ?? "";
        }

        private string FormatDouble(double d)
        {
            if (double.IsNaN(d)) return "NaN";
            if (double.IsInfinity(d)) return d > 0 ? "∞" : "-∞";
            if (Math.Abs(d) < 1e-10) return "0";
            if (Math.Abs(d) >= 1e6 || (Math.Abs(d) < 1e-4 && d != 0))
                return d.ToString("G6");
            // Format as G6 and only trim trailing zeros after decimal point
            var s = d.ToString("G6");
            if (s.Contains('.'))
                s = s.TrimEnd('0').TrimEnd('.');
            return s;
        }

        private List<string> SplitByPipe(string content)
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
                    if (!inString) { inString = true; stringChar = c; }
                    else if (c == stringChar) { inString = false; }
                }
                else if (!inString)
                {
                    if (c == '[' || c == '(') depth++;
                    else if (c == ']' || c == ')') depth--;
                    else if (c == '|' && depth == 0)
                    {
                        result.Add(content.Substring(start, i - start));
                        start = i + 1;
                    }
                }
            }
            result.Add(content.Substring(start));
            return result;
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
                    if (!inString) { inString = true; stringChar = c; }
                    else if (c == stringChar) { inString = false; }
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

        private static string[] ParseStringArray(string expr)
        {
            // Use the centralized StringArrayRegistry for parsing
            return StringArrayRegistry.Parse(expr);
        }

        private double[] EvaluateVector(string expr)
        {
            expr = expr.Trim();
            Parser.Parse(expr);
            Parser.Calculate();

            try
            {
                var varRef = Parser.GetVariableRef(expr);
                var value = varRef?.Value;

                if (value is Vector vec)
                {
                    var result = new double[vec.Length];
                    for (int i = 0; i < vec.Length; i++)
                        result[i] = vec[i].D;
                    return result;
                }
                else if (value is RealValue real)
                {
                    return new[] { real.D };
                }
                else if (value is IScalarValue scalar)
                {
                    return new[] { scalar.Re };
                }
            }
            catch
            {
                // Try inline vector
            }

            // Try to parse as inline vector [1; 2; 3]
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

            return new[] { Parser.Real };
        }

        private string GetHtmlText(string content)
        {
            return $"<span class=\"eq\"><span class=\"cond\">$Table</span>{{{content}}}</span>";
        }

        /// <summary>
        /// Parses an inline vector/matrix expression like [1;2;3] or [1;2|3;4]
        /// </summary>
        private IValue ParseInlineExpression(string expr)
        {
            expr = expr.Trim();
            if (!expr.StartsWith("[") || !expr.EndsWith("]"))
                return null;

            var inner = expr.Substring(1, expr.Length - 2);

            // Check if it's a matrix (contains |) or vector
            if (inner.Contains('|'))
            {
                // Matrix: rows separated by |
                var rows = SplitByChar(inner, '|');
                var rowCount = rows.Count;

                // Parse first row to get column count
                var firstRowParts = SplitByChar(rows[0], ';');
                var colCount = firstRowParts.Count;

                var matrix = new Matrix(rowCount, colCount);
                for (int i = 0; i < rowCount; i++)
                {
                    var cols = SplitByChar(rows[i], ';');
                    for (int j = 0; j < cols.Count && j < colCount; j++)
                    {
                        Parser.Parse(cols[j].Trim());
                        Parser.Calculate();
                        matrix[i, j] = new RealValue(Parser.Real);
                    }
                }
                return matrix;
            }
            else
            {
                // Vector: elements separated by ;
                var parts = SplitByChar(inner, ';');
                var vecValues = new RealValue[parts.Count];
                for (int i = 0; i < parts.Count; i++)
                {
                    Parser.Parse(parts[i].Trim());
                    Parser.Calculate();
                    vecValues[i] = new RealValue(Parser.Real);
                }
                return new Vector(vecValues);
            }
        }

        private List<string> SplitByChar(string s, char separator)
        {
            var result = new List<string>();
            int depth = 0;
            int start = 0;
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (c == '[' || c == '(') depth++;
                else if (c == ']' || c == ')') depth--;
                else if (c == separator && depth == 0)
                {
                    result.Add(s.Substring(start, i - start));
                    start = i + 1;
                }
            }
            result.Add(s.Substring(start));
            return result;
        }
    }
}
