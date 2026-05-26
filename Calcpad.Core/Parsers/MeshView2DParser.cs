using System;
using System.Text;
using System.Globalization;

namespace Calcpad.Core
{
    /// <summary>
    /// Parser for $Mesh_View2D command.
    /// Generates SVG 2D visualization of the mesh (plan view).
    ///
    /// Syntax: $Mesh_View2D{}
    /// or:     $Mesh_View2D{values}  - for color map based on values array
    ///
    /// Requires mesh_nodes and mesh_elements variables from $Mesh_Triangle.
    /// Features:
    /// - SVG plan view (XY plane)
    /// - Triangular elements with stroke
    /// - Optional color map for results visualization
    /// - Node numbering option
    /// </summary>
    internal class MeshView2DParser
    {
        private readonly MathParser _parser;
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        private static int _viewerId = 0;

        internal MeshView2DParser(MathParser parser)
        {
            _parser = parser;
        }

        internal string Parse(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate)
            {
                return "<p><strong>$Mesh_View2D</strong>{} or $Mesh_View2D{values}</p>";
            }

            try
            {
                // Get mesh_nodes matrix
                var nodesVar = _parser.GetVariableRef("mesh_nodes");
                if (nodesVar?.Value is not Matrix nodesMatrix)
                    return "<p style='color:red;'>Error: mesh_nodes not found. Run $Mesh_Triangle first.</p>";

                // Get mesh_elements matrix
                var elementsVar = _parser.GetVariableRef("mesh_elements");
                if (elementsVar?.Value is not Matrix elementsMatrix)
                    return "<p style='color:red;'>Error: mesh_elements not found. Run $Mesh_Triangle first.</p>";

                // Check for optional values parameter (for color map)
                double[] values = null;
                var startIndex = s.IndexOf('{');
                var endIndex = s.LastIndexOf('}');

                if (startIndex != -1 && endIndex > startIndex + 1)
                {
                    var content = s.Slice(startIndex + 1, endIndex - startIndex - 1).ToString().Trim();
                    if (!string.IsNullOrEmpty(content))
                    {
                        var valuesVar = _parser.GetVariableRef(content);
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
                    }
                }

                // Get optional mesh_boundary for highlighting
                int[] boundary = null;
                var boundaryVar = _parser.GetVariableRef("mesh_boundary");
                if (boundaryVar?.Value is Vector boundaryVector)
                {
                    boundary = new int[boundaryVector.Length];
                    for (int i = 0; i < boundaryVector.Length; i++)
                        boundary[i] = (int)boundaryVector[i].D;
                }

                return GenerateSvgViewer(nodesMatrix, elementsMatrix, values, boundary);
            }
            catch (Exception ex)
            {
                return $"<p style='color:red;'>Error in $Mesh_View2D: {ex.Message}</p>";
            }
        }

        private string GenerateSvgViewer(Matrix nodes, Matrix elements, double[] values, int[] boundary)
        {
            _viewerId++;
            var viewerId = $"meshView2D_{_viewerId}";

            int nNodes = nodes.RowCount;
            int nElements = elements.RowCount;

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

            // Add padding
            double padding = 20;
            double width = 600;
            double height = 400;

            double rangeX = maxX - minX;
            double rangeY = maxY - minY;
            if (rangeX < 0.001) rangeX = 1;
            if (rangeY < 0.001) rangeY = 1;

            // Calculate scale to fit
            double scaleX = (width - 2 * padding) / rangeX;
            double scaleY = (height - 2 * padding) / rangeY;
            double scale = Math.Min(scaleX, scaleY);

            // Center offset
            double offsetX = padding + ((width - 2 * padding) - rangeX * scale) / 2;
            double offsetY = padding + ((height - 2 * padding) - rangeY * scale) / 2;

            // Calculate value range for color map
            double minVal = 0, maxVal = 1;
            if (values != null && values.Length > 0)
            {
                minVal = values[0];
                maxVal = values[0];
                for (int i = 1; i < values.Length; i++)
                {
                    if (values[i] < minVal) minVal = values[i];
                    if (values[i] > maxVal) maxVal = values[i];
                }
                if (Math.Abs(maxVal - minVal) < 1e-10)
                {
                    maxVal = minVal + 1;
                }
            }

            var sb = new StringBuilder();

            // SVG header
            sb.AppendLine($"<svg id=\"{viewerId}\" width=\"{width}\" height=\"{height}\" style=\"background:#f8f8f8;border:1px solid #ccc;border-radius:4px;margin:10px 0;\">");

            // Draw elements (triangles)
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

                string fillColor = "#e8f4fc";
                if (values != null && values.Length > i)
                {
                    // Use element value for color
                    double t = (values[i] - minVal) / (maxVal - minVal);
                    fillColor = GetRainbowColor(t);
                }

                sb.AppendFormat(Inv,
                    "<polygon points=\"{0:F2},{1:F2} {2:F2},{3:F2} {4:F2},{5:F2}\" fill=\"{6}\" stroke=\"#0088cc\" stroke-width=\"1\"/>\n",
                    x1, y1, x2, y2, x3, y3, fillColor);
            }

            // Draw boundary nodes (if available)
            if (boundary != null)
            {
                var boundarySet = new System.Collections.Generic.HashSet<int>(boundary);
                for (int i = 0; i < nNodes; i++)
                {
                    double x = offsetX + (nodes[i, 0].D - minX) * scale;
                    double y = height - (offsetY + (nodes[i, 1].D - minY) * scale);

                    if (boundarySet.Contains(i))
                    {
                        sb.AppendFormat(Inv,
                            "<circle cx=\"{0:F2}\" cy=\"{1:F2}\" r=\"3\" fill=\"#ff6600\" stroke=\"#cc4400\" stroke-width=\"1\"/>\n",
                            x, y);
                    }
                }
            }

            // Info text
            sb.AppendFormat(Inv,
                "<text x=\"10\" y=\"20\" font-family=\"monospace\" font-size=\"12\" fill=\"#666\">Nodes: {0} | Elements: {1}</text>\n",
                nNodes, nElements);

            // Color scale legend (if values provided)
            if (values != null && values.Length > 0)
            {
                double legendX = width - 80;
                double legendY = 30;
                double legendH = 100;

                // Draw gradient
                for (int i = 0; i < 20; i++)
                {
                    double t = 1.0 - i / 19.0;
                    string color = GetRainbowColor(t);
                    double y = legendY + i * (legendH / 20);
                    sb.AppendFormat(Inv,
                        "<rect x=\"{0}\" y=\"{1:F1}\" width=\"15\" height=\"{2:F1}\" fill=\"{3}\"/>\n",
                        legendX, y, legendH / 20 + 1, color);
                }

                // Labels
                sb.AppendFormat(Inv,
                    "<text x=\"{0}\" y=\"{1}\" font-family=\"monospace\" font-size=\"10\" fill=\"#333\">{2:G4}</text>\n",
                    legendX + 20, legendY + 10, maxVal);
                sb.AppendFormat(Inv,
                    "<text x=\"{0}\" y=\"{1}\" font-family=\"monospace\" font-size=\"10\" fill=\"#333\">{2:G4}</text>\n",
                    legendX + 20, legendY + legendH, minVal);
            }

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
