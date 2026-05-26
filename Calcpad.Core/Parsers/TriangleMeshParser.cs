using System;
using System.Text;
using System.Globalization;
using Calcpad.Core.Mesh;

namespace Calcpad.Core
{
    /// <summary>
    /// Parser for $Mesh_Triangle command.
    /// Generates Delaunay triangulation using Shewchuk's Triangle algorithm.
    ///
    /// Syntax: $Mesh_Triangle{vertices; segments; maxArea}
    ///
    /// Creates the following Calcpad variables:
    /// - mesh_nodes: Matrix Nx2 with node coordinates (x, y)
    /// - mesh_elements: Matrix Mx3 with element connectivity (node indices, base 0)
    /// - mesh_boundary: Vector with boundary node indices
    /// - mesh_n_nodes: Number of nodes
    /// - mesh_n_elements: Number of elements
    /// - mesh_n_boundary: Number of boundary nodes
    ///
    /// NOTE: This command only generates data (like awatif getMesh).
    /// Use $Mesh_View{} to visualize the mesh with Three.js (like awatif getViewer).
    /// </summary>
    internal class TriangleMeshParser
    {
        private readonly MathParser _parser;
        private readonly TriangleMesher _mesher;
        // Use InvariantCulture for all number formatting (SVG requires dot as decimal separator)
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        internal TriangleMeshParser(MathParser parser)
        {
            _parser = parser;
            _mesher = new TriangleMesher();
        }

        internal string Parse(ReadOnlySpan<char> s, bool calculate)
        {
            // Format:
            // $Mesh_Triangle{vertices; segments; maxArea}

            // If not calculating, return preview message
            if (!calculate)
            {
                return "<p><strong>$Mesh_Triangle</strong>{vertices; segments; maxArea}</p>";
            }

            // Extract content between braces { }
            var startIndex = s.IndexOf('{');
            var endIndex = s.LastIndexOf('}');

            if (startIndex == -1 || endIndex == -1 || endIndex <= startIndex)
                return "<p style='color:red;'>Error: Missing braces in $Mesh_Triangle command</p>";

            var content = s.Slice(startIndex + 1, endIndex - startIndex - 1);
            var parts = content.ToString().Split(';');

            if (parts.Length != 3)
                return "<p style='color:red;'>Error: $Mesh_Triangle requires exactly 3 parameters: {vertices; segments; maxArea}</p>";

            return ParseDelaunay(parts);
        }

        private string ParseDelaunay(string[] parts)
        {
            try
            {
                // Get vertices matrix from variable
                var verticesVarName = parts[0].Trim();
                var verticesVar = _parser.GetVariableRef(verticesVarName);
                if (verticesVar.Value is not Matrix verticesMatrix)
                    return $"<p style='color:red;'>Error: '{verticesVarName}' must be a matrix Nx2</p>";

                double[,] vertices = ConvertMatrixToArray(verticesMatrix);
                if (vertices.GetLength(1) != 2)
                    return $"<p style='color:red;'>Error: '{verticesVarName}' must be Nx2 matrix (found {vertices.GetLength(0)}x{vertices.GetLength(1)})</p>";

                // Get segments matrix from variable
                var segmentsVarName = parts[1].Trim();
                var segmentsVar = _parser.GetVariableRef(segmentsVarName);
                if (segmentsVar.Value is not Matrix segmentsMatrix)
                    return $"<p style='color:red;'>Error: '{segmentsVarName}' must be a matrix Mx2</p>";

                double[,] segmentsDouble = ConvertMatrixToArray(segmentsMatrix);
                if (segmentsDouble.GetLength(1) != 2)
                    return $"<p style='color:red;'>Error: '{segmentsVarName}' must be Mx2 matrix (found {segmentsDouble.GetLength(0)}x{segmentsDouble.GetLength(1)})</p>";

                int[,] segments = ConvertToIntArray(segmentsDouble);

                // Parse maxArea expression
                _parser.Parse(parts[2].Trim());
                var maxArea = _parser.CalculateReal();

                // Generate mesh using Triangle (Shewchuk's Delaunay algorithm)
                // Default minAngle = 30 degrees (Delaunay quality constraint)
                var meshResult = _mesher.Triangulate(vertices, segments, maxArea, 30.0);

                // Store results in Calcpad variables
                StoreMeshVariables(meshResult);

                // Return info message (no SVG - use $Mesh_View for visualization)
                int nNodes = meshResult.Nodes.GetLength(0);
                int nElements = meshResult.Elements.GetLength(0);
                int nBoundary = meshResult.BoundaryNodes.Length;
                return $"<p style='color:#006600;'><strong>Mesh generated:</strong> {nNodes} nodes, {nElements} elements, {nBoundary} boundary nodes. Use <code>$Mesh_View{{}}</code> to visualize.</p>";
            }
            catch (Exception ex)
            {
                return $"<p style='color:red;'>Error in $Mesh_Triangle: {ex.Message}</p>";
            }
        }

        /// <summary>
        /// Store mesh results as Calcpad variables so user can access them
        /// </summary>
        private void StoreMeshVariables(MeshResult mesh)
        {
            int nNodes = mesh.Nodes.GetLength(0);
            int nElements = mesh.Elements.GetLength(0);
            int nBoundary = mesh.BoundaryNodes.Length;

            // Create mesh_nodes matrix (Nx2)
            var nodesMatrix = new Matrix(nNodes, 2);
            for (int i = 0; i < nNodes; i++)
            {
                nodesMatrix[i, 0] = new RealValue(mesh.Nodes[i, 0]);
                nodesMatrix[i, 1] = new RealValue(mesh.Nodes[i, 1]);
            }
            _parser.SetVariable("mesh_nodes", nodesMatrix);

            // Create mesh_elements matrix (Mx3)
            var elementsMatrix = new Matrix(nElements, 3);
            for (int i = 0; i < nElements; i++)
            {
                elementsMatrix[i, 0] = new RealValue(mesh.Elements[i, 0]);
                elementsMatrix[i, 1] = new RealValue(mesh.Elements[i, 1]);
                elementsMatrix[i, 2] = new RealValue(mesh.Elements[i, 2]);
            }
            _parser.SetVariable("mesh_elements", elementsMatrix);

            // Create mesh_boundary vector
            var boundaryVector = new Vector(nBoundary);
            for (int i = 0; i < nBoundary; i++)
            {
                boundaryVector[i] = new RealValue(mesh.BoundaryNodes[i]);
            }
            _parser.SetVariable("mesh_boundary", boundaryVector);

            // Create scalar variables for counts
            _parser.SetVariable("mesh_n_nodes", new RealValue(nNodes));
            _parser.SetVariable("mesh_n_elements", new RealValue(nElements));
            _parser.SetVariable("mesh_n_boundary", new RealValue(nBoundary));
        }

        private double[,] ConvertMatrixToArray(Matrix matrix)
        {
            int rows = matrix.RowCount;
            int cols = matrix.ColCount;
            var result = new double[rows, cols];

            for (int i = 0; i < rows; i++)
            {
                for (int j = 0; j < cols; j++)
                {
                    result[i, j] = matrix[i, j].D;
                }
            }
            return result;
        }

        private int[,] ConvertToIntArray(double[,] array)
        {
            int rows = array.GetLength(0);
            int cols = array.GetLength(1);
            var result = new int[rows, cols];

            for (int i = 0; i < rows; i++)
            {
                for (int j = 0; j < cols; j++)
                {
                    result[i, j] = (int)Math.Round(array[i, j]);
                }
            }
            return result;
        }
    }
}
