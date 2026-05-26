using System;
using System.Text;
using System.Globalization;
using System.Collections.Generic;

namespace Calcpad.Core
{
    /// <summary>
    /// Parser for $Contour command.
    /// Generates SVG contour lines (isolines) from mesh values.
    ///
    /// Syntax: $Contour{values}           - 10 contour lines by default
    ///         $Contour{values; n}        - n contour lines
    ///         $Contour{values; levels}   - specific levels vector
    ///
    /// Requires mesh_nodes and mesh_elements from $mesh2d or $Mesh_Triangle.
    /// Uses Marching Triangles algorithm to find isolines.
    /// </summary>
    internal class ContourParser
    {
        private readonly MathParser _parser;
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        private static int _contourId = 0;

        // Contour line color (semi-transparent dark gray for subtle visibility)
        private const string ContourLineColor = "rgba(50,50,50,0.5)";
        private const string ContourLineStrokeWidth = "0.8";

        internal ContourParser(MathParser parser)
        {
            _parser = parser;
        }

        internal string Parse(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate)
            {
                return "<p><strong>$Contour</strong>{values} or $Contour{values; n_levels}</p>";
            }

            try
            {
                // Get mesh_nodes matrix
                var nodesVar = _parser.GetVariableRef("mesh_nodes");
                if (nodesVar?.Value is not Matrix nodesMatrix)
                    return "<p style='color:red;'>Error: mesh_nodes not found. Run $mesh2d or $Mesh_Triangle first.</p>";

                // Get mesh_elements matrix
                var elementsVar = _parser.GetVariableRef("mesh_elements");
                if (elementsVar?.Value is not Matrix elementsMatrix)
                    return "<p style='color:red;'>Error: mesh_elements not found. Run $mesh2d or $Mesh_Triangle first.</p>";

                // Parse parameters
                var startIndex = s.IndexOf('{');
                var endIndex = s.LastIndexOf('}');

                if (startIndex == -1 || endIndex <= startIndex)
                    return "<p style='color:red;'>Error: Invalid $Contour syntax. Use $Contour{values} or $Contour{values; n}</p>";

                var content = s.Slice(startIndex + 1, endIndex - startIndex - 1).ToString();
                var parts = content.Split(';');

                // Get values
                var valuesName = parts[0].Trim();
                var valuesVar = _parser.GetVariableRef(valuesName);
                double[] values = null;

                if (valuesVar?.Value is Vector valuesVector)
                {
                    values = new double[valuesVector.Length];
                    for (int i = 0; i < valuesVector.Length; i++)
                        values[i] = valuesVector[i].D;
                }
                else if (valuesVar?.Value is Matrix valuesMatrix)
                {
                    values = new double[valuesMatrix.RowCount];
                    for (int i = 0; i < valuesMatrix.RowCount; i++)
                        values[i] = valuesMatrix[i, 0].D;
                }
                else
                {
                    return $"<p style='color:red;'>Error: '{valuesName}' must be a vector or matrix with values at nodes.</p>";
                }

                // Get number of levels or specific levels
                int nLevels = 10;
                double[] levels = null;

                if (parts.Length > 1)
                {
                    var levelParam = parts[1].Trim();
                    var levelVar = _parser.GetVariableRef(levelParam);

                    if (levelVar?.Value is Vector levelVector)
                    {
                        // Specific levels provided
                        levels = new double[levelVector.Length];
                        for (int i = 0; i < levelVector.Length; i++)
                            levels[i] = levelVector[i].D;
                    }
                    else
                    {
                        // Try to parse as number
                        _parser.Parse(levelParam);
                        nLevels = (int)_parser.CalculateReal();
                        if (nLevels < 2) nLevels = 2;
                        if (nLevels > 50) nLevels = 50;
                    }
                }

                return GenerateContourSvg(nodesMatrix, elementsMatrix, values, nLevels, levels);
            }
            catch (Exception ex)
            {
                return $"<p style='color:red;'>Error in $Contour: {ex.Message}</p>";
            }
        }

        private string GenerateContourSvg(Matrix nodes, Matrix elements, double[] values, int nLevels, double[] customLevels)
        {
            _contourId++;
            var viewerId = $"contour_{_contourId}";

            int nNodes = nodes.RowCount;
            int nElements = elements.RowCount;

            // Validate values array
            if (values.Length < nNodes)
            {
                return $"<p style='color:red;'>Error: values array ({values.Length}) must have at least {nNodes} elements (number of nodes).</p>";
            }

            // Calculate bounding box
            double minX = double.MaxValue, maxX = double.MinValue;
            double minY = double.MaxValue, maxY = double.MinValue;

            for (int i = 0; i < nNodes; i++)
            {
                double x = nodes[i, 0].D;
                double y = nodes[i, 1].D;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }

            // SVG dimensions
            double padding = 40;
            double width = 600;
            double height = 400;

            double rangeX = maxX - minX;
            double rangeY = maxY - minY;
            if (rangeX < 0.001) rangeX = 1;
            if (rangeY < 0.001) rangeY = 1;

            double scaleX = (width - 2 * padding) / rangeX;
            double scaleY = (height - 2 * padding) / rangeY;
            double scale = Math.Min(scaleX, scaleY);

            double offsetX = padding + ((width - 2 * padding) - rangeX * scale) / 2;
            double offsetY = padding + ((height - 2 * padding) - rangeY * scale) / 2;

            // Calculate value range
            double minVal = values[0], maxVal = values[0];
            for (int i = 1; i < nNodes; i++)
            {
                if (values[i] < minVal) minVal = values[i];
                if (values[i] > maxVal) maxVal = values[i];
            }

            if (Math.Abs(maxVal - minVal) < 1e-10)
            {
                return "<p style='color:orange;'>Warning: All values are equal, no contours to draw.</p>";
            }

            // Generate contour levels
            double[] levels;
            if (customLevels != null)
            {
                levels = customLevels;
            }
            else
            {
                levels = new double[nLevels];
                for (int i = 0; i < nLevels; i++)
                {
                    levels[i] = minVal + (maxVal - minVal) * (i + 0.5) / nLevels;
                }
            }

            var sb = new StringBuilder();

            // SVG header
            sb.AppendLine($"<svg id=\"{viewerId}\" width=\"{width}\" height=\"{height}\" style=\"background:#ffffff;border:1px solid #ccc;border-radius:4px;margin:10px 0;\">");

            // Draw mesh triangles with color fill based on average value
            for (int i = 0; i < nElements; i++)
            {
                int n1 = (int)elements[i, 0].D;
                int n2 = (int)elements[i, 1].D;
                int n3 = (int)elements[i, 2].D;

                double x1 = offsetX + (nodes[n1, 0].D - minX) * scale;
                double y1 = height - (offsetY + (nodes[n1, 1].D - minY) * scale);
                double x2 = offsetX + (nodes[n2, 0].D - minX) * scale;
                double y2 = height - (offsetY + (nodes[n2, 1].D - minY) * scale);
                double x3 = offsetX + (nodes[n3, 0].D - minX) * scale;
                double y3 = height - (offsetY + (nodes[n3, 1].D - minY) * scale);

                // Calculate average value for element color
                double avgVal = (values[n1] + values[n2] + values[n3]) / 3.0;
                double t = (avgVal - minVal) / (maxVal - minVal);
                string fillColor = GetRainbowColor(t);

                sb.AppendFormat(Inv,
                    "<polygon points=\"{0:F2},{1:F2} {2:F2},{3:F2} {4:F2},{5:F2}\" fill=\"{6}\" stroke=\"rgba(80,80,80,0.4)\" stroke-width=\"0.5\"/>\n",
                    x1, y1, x2, y2, x3, y3, fillColor);
            }

            // Draw contour lines using Marching Triangles (black lines on colored mesh)
            for (int levelIdx = 0; levelIdx < levels.Length; levelIdx++)
            {
                double level = levels[levelIdx];

                var contourSegments = new List<(double x1, double y1, double x2, double y2)>();

                // Process each triangle
                for (int i = 0; i < nElements; i++)
                {
                    int n1 = (int)elements[i, 0].D;
                    int n2 = (int)elements[i, 1].D;
                    int n3 = (int)elements[i, 2].D;

                    double v1 = values[n1];
                    double v2 = values[n2];
                    double v3 = values[n3];

                    // Get screen coordinates
                    double x1 = offsetX + (nodes[n1, 0].D - minX) * scale;
                    double y1 = height - (offsetY + (nodes[n1, 1].D - minY) * scale);
                    double x2 = offsetX + (nodes[n2, 0].D - minX) * scale;
                    double y2 = height - (offsetY + (nodes[n2, 1].D - minY) * scale);
                    double x3 = offsetX + (nodes[n3, 0].D - minX) * scale;
                    double y3 = height - (offsetY + (nodes[n3, 1].D - minY) * scale);

                    // Find crossings on each edge
                    var crossings = new List<(double x, double y)>();

                    // Edge 1-2
                    if ((v1 - level) * (v2 - level) < 0)
                    {
                        double t = (level - v1) / (v2 - v1);
                        crossings.Add((x1 + t * (x2 - x1), y1 + t * (y2 - y1)));
                    }

                    // Edge 2-3
                    if ((v2 - level) * (v3 - level) < 0)
                    {
                        double t = (level - v2) / (v3 - v2);
                        crossings.Add((x2 + t * (x3 - x2), y2 + t * (y3 - y2)));
                    }

                    // Edge 3-1
                    if ((v3 - level) * (v1 - level) < 0)
                    {
                        double t = (level - v3) / (v1 - v3);
                        crossings.Add((x3 + t * (x1 - x3), y3 + t * (y1 - y3)));
                    }

                    // If we have exactly 2 crossings, draw a line segment
                    if (crossings.Count == 2)
                    {
                        contourSegments.Add((crossings[0].x, crossings[0].y, crossings[1].x, crossings[1].y));
                    }
                }

                // Draw all segments for this level (attenuated/subtle lines)
                foreach (var seg in contourSegments)
                {
                    sb.AppendFormat(Inv,
                        "<line x1=\"{0:F2}\" y1=\"{1:F2}\" x2=\"{2:F2}\" y2=\"{3:F2}\" stroke=\"{4}\" stroke-width=\"{5}\"/>\n",
                        seg.x1, seg.y1, seg.x2, seg.y2, ContourLineColor, ContourLineStrokeWidth);
                }
            }

            // Draw color scale legend (gradient bar)
            double legendX = width - 80;
            double legendY = 40;
            double legendH = height - 100;
            int legendSteps = 20;

            // Draw gradient bar
            for (int i = 0; i < legendSteps; i++)
            {
                double t = 1.0 - (double)i / (legendSteps - 1);
                string color = GetRainbowColor(t);
                double y = legendY + i * (legendH / legendSteps);
                sb.AppendFormat(Inv,
                    "<rect x=\"{0}\" y=\"{1:F1}\" width=\"15\" height=\"{2:F1}\" fill=\"{3}\"/>\n",
                    legendX, y, legendH / legendSteps + 1, color);
            }

            // Border around legend
            sb.AppendFormat(Inv,
                "<rect x=\"{0}\" y=\"{1}\" width=\"15\" height=\"{2:F0}\" fill=\"none\" stroke=\"#333\" stroke-width=\"1\"/>\n",
                legendX, legendY, legendH);

            // Max/min labels
            sb.AppendFormat(Inv,
                "<text x=\"{0}\" y=\"{1}\" font-family=\"monospace\" font-size=\"10\" fill=\"#333\">{2:G4}</text>\n",
                legendX + 20, legendY + 10, maxVal);
            sb.AppendFormat(Inv,
                "<text x=\"{0}\" y=\"{1:F0}\" font-family=\"monospace\" font-size=\"10\" fill=\"#333\">{2:G4}</text>\n",
                legendX + 20, legendY + legendH, minVal);

            // Contour levels markers
            for (int i = 0; i < levels.Length; i++)
            {
                double t = (levels[i] - minVal) / (maxVal - minVal);
                double y = legendY + legendH * (1.0 - t);
                sb.AppendFormat(Inv,
                    "<line x1=\"{0}\" y1=\"{1:F1}\" x2=\"{2}\" y2=\"{3:F1}\" stroke=\"#000\" stroke-width=\"1\"/>\n",
                    legendX - 3, y, legendX, y);
            }

            // Title
            sb.AppendFormat(Inv,
                "<text x=\"10\" y=\"20\" font-family=\"sans-serif\" font-size=\"12\" fill=\"#333\">Contour: {0} levels ({1:G3} to {2:G3})</text>\n",
                levels.Length, minVal, maxVal);

            sb.AppendLine("</svg>");

            return sb.ToString();
        }

        /// <summary>
        /// Get rainbow color from normalized value (0-1)
        /// Blue -> Cyan -> Green -> Yellow -> Red
        /// </summary>
        private string GetRainbowColor(double t)
        {
            t = Math.Max(0, Math.Min(1, t));

            int r, g, b;
            if (t < 0.25)
            {
                // Blue to Cyan
                double s = t / 0.25;
                r = 0;
                g = (int)(255 * s);
                b = 255;
            }
            else if (t < 0.5)
            {
                // Cyan to Green
                double s = (t - 0.25) / 0.25;
                r = 0;
                g = 255;
                b = (int)(255 * (1 - s));
            }
            else if (t < 0.75)
            {
                // Green to Yellow
                double s = (t - 0.5) / 0.25;
                r = (int)(255 * s);
                g = 255;
                b = 0;
            }
            else
            {
                // Yellow to Red
                double s = (t - 0.75) / 0.25;
                r = 255;
                g = (int)(255 * (1 - s));
                b = 0;
            }

            return $"#{r:X2}{g:X2}{b:X2}";
        }
    }
}
