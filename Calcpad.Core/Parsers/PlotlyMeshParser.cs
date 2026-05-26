using System;

namespace Calcpad.Core
{
    /// <summary>
    /// Parser for $PlotlyMesh command - 3D mesh visualization with Plotly.js
    /// Syntax: $PlotlyMesh{nodes; elements}
    ///         $PlotlyMesh{nodes; elements; values}
    ///         $PlotlyMesh{nodes; elements; values | type}
    /// Where:
    ///   nodes    - Nx3 matrix with [x, y, z] coordinates (variable name)
    ///   elements - ExM matrix with node indices (1-based, M=3 for triangles) (variable name)
    ///   values   - Optional Nx1 or Ex1 vector for coloring (variable name)
    ///   type     - Optional: mesh3d (default), wireframe
    /// </summary>
    internal class PlotlyMeshParser : PlotParser
    {
        internal PlotlyMeshParser(MathParser parser, PlotSettings settings) : base(parser, settings) { }

        internal override string Parse(ReadOnlySpan<char> script, bool calculate)
        {
            // Find the opening brace
            int startBrace = script.IndexOf('{');
            if (startBrace < 0)
                return "<span class=\"err\">$PlotlyMesh: Missing opening brace</span>";

            // Find the closing brace (accounting for nested braces)
            int endBrace = FindMatchingBrace(script, startBrace);
            if (endBrace < 0)
                return "<span class=\"err\">$PlotlyMesh: Missing closing brace</span>";

            // Extract content between braces
            var content = script.Slice(startBrace + 1, endBrace - startBrace - 1).ToString().Trim();

            // Parse options (after |)
            string plotType = "mesh3d";
            int pipeIndex = content.LastIndexOf('|');
            if (pipeIndex > 0)
            {
                plotType = content.Substring(pipeIndex + 1).Trim().ToLowerInvariant();
                content = content.Substring(0, pipeIndex).Trim();
            }

            // Split by semicolons (top-level only)
            var parts = SplitTopLevel(content, ';');

            if (parts.Length < 2)
                return "<span class=\"err\">$PlotlyMesh: Requires at least nodes and elements matrices</span>";

            if (!calculate)
                return GetHtmlText(parts, plotType);

            try
            {
                // Get nodes matrix by variable name
                var nodesName = parts[0].Trim();
                var nodesVar = Parser.GetVariableRef(nodesName);
                if (nodesVar?.Value is not Matrix nodes)
                    return $"<span class=\"err\">$PlotlyMesh: '{nodesName}' must be a matrix (nodes)</span>";

                // Get elements matrix by variable name
                var elementsName = parts[1].Trim();
                var elementsVar = Parser.GetVariableRef(elementsName);
                if (elementsVar?.Value is not Matrix elements)
                    return $"<span class=\"err\">$PlotlyMesh: '{elementsName}' must be a matrix (elements)</span>";

                // Parse optional values vector
                Vector values = null;
                if (parts.Length > 2 && !string.IsNullOrWhiteSpace(parts[2]))
                {
                    var valuesName = parts[2].Trim();
                    var valuesVar = Parser.GetVariableRef(valuesName);

                    if (valuesVar?.Value is Vector v)
                    {
                        values = v;
                    }
                    else if (valuesVar?.Value is Matrix m && m.ColCount == 1)
                    {
                        // Convert column matrix to vector
                        var arr = new RealValue[m.RowCount];
                        for (int i = 0; i < m.RowCount; i++)
                            arr[i] = m[i, 0];
                        values = new Vector(arr);
                    }
                }

                // Create plotter and render
                var plotter = new PlotlyMeshPlotter(Parser, Settings, nodes, elements, values, plotType);
                return plotter.Plot();
            }
            catch (Exception ex)
            {
                return $"<span class=\"err\">Error in $PlotlyMesh: {ex.Message}</span>";
            }
        }

        private static int FindMatchingBrace(ReadOnlySpan<char> script, int start)
        {
            int count = 0;
            for (int i = start; i < script.Length; i++)
            {
                if (script[i] == '{') count++;
                else if (script[i] == '}') count--;

                if (count == 0) return i;
            }
            return -1;
        }

        private static string[] SplitTopLevel(string content, char separator)
        {
            var result = new System.Collections.Generic.List<string>();
            int depth = 0;
            int start = 0;

            for (int i = 0; i < content.Length; i++)
            {
                char c = content[i];
                if (c == '{' || c == '[' || c == '(') depth++;
                else if (c == '}' || c == ']' || c == ')') depth--;
                else if (c == separator && depth == 0)
                {
                    result.Add(content.Substring(start, i - start));
                    start = i + 1;
                }
            }
            result.Add(content.Substring(start));
            return result.ToArray();
        }

        private static string GetHtmlText(string[] parts, string plotType)
        {
            var typeStr = plotType != "mesh3d" ? $" | {plotType}" : "";
            if (parts.Length == 2)
                return $"<span class=\"eq\"><span class=\"cond\">$PlotlyMesh</span>{{{parts[0]}; {parts[1]}{typeStr}}}</span>";
            else
                return $"<span class=\"eq\"><span class=\"cond\">$PlotlyMesh</span>{{{parts[0]}; {parts[1]}; {parts[2]}{typeStr}}}</span>";
        }
    }
}
