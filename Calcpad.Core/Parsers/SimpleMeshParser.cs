using System;
using System.Text;
using System.Globalization;
using Calcpad.Core.Mesh;

namespace Calcpad.Core
{
    /// <summary>
    /// Simple mesh functions like Python/Octave.
    ///
    /// $mesh2d{polygon; maxArea} - generates and shows 2D mesh (SVG)
    /// $mesh3d{polygon; maxArea} - generates and shows 3D mesh (Three.js)
    ///
    /// polygon is a matrix Nx2 with vertex coordinates.
    /// Segments are auto-generated (consecutive vertices, closed loop).
    /// </summary>
    internal class SimpleMeshParser
    {
        private readonly MathParser _parser;
        private readonly TriangleMesher _mesher;
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        private static int _id = 0;

        internal SimpleMeshParser(MathParser parser)
        {
            _parser = parser;
            _mesher = new TriangleMesher();
        }

        internal string ParseMesh2D(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate)
                return "<p><strong>$mesh2d</strong>{polygon; maxArea}</p>";

            return GenerateMesh(s, false);
        }

        internal string ParseMesh3D(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate)
                return "<p><strong>$mesh3d</strong>{polygon; maxArea}</p>";

            return GenerateMesh(s, true);
        }

        private string GenerateMesh(ReadOnlySpan<char> s, bool is3D)
        {
            try
            {
                // Extract content between braces
                var startIndex = s.IndexOf('{');
                var endIndex = s.LastIndexOf('}');

                if (startIndex == -1 || endIndex == -1 || endIndex <= startIndex)
                    return "<p style='color:red;'>Error: Missing braces</p>";

                var content = s.Slice(startIndex + 1, endIndex - startIndex - 1);
                var parts = content.ToString().Split(';');

                if (parts.Length < 2)
                    return "<p style='color:red;'>Error: $mesh requires {polygon; maxArea}</p>";

                // Get polygon matrix
                var polygonVarName = parts[0].Trim();
                var polygonVar = _parser.GetVariableRef(polygonVarName);
                if (polygonVar?.Value is not Matrix polygonMatrix)
                    return $"<p style='color:red;'>Error: '{polygonVarName}' must be a matrix Nx2</p>";

                if (polygonMatrix.ColCount != 2)
                    return $"<p style='color:red;'>Error: polygon must be Nx2 matrix</p>";

                // Parse maxArea
                _parser.Parse(parts[1].Trim());
                var maxArea = _parser.CalculateReal();

                // Convert polygon to vertices array
                int nVertices = polygonMatrix.RowCount;
                var vertices = new double[nVertices, 2];
                for (int i = 0; i < nVertices; i++)
                {
                    vertices[i, 0] = polygonMatrix[i, 0].D;
                    vertices[i, 1] = polygonMatrix[i, 1].D;
                }

                // Auto-generate segments (closed loop)
                var segments = new int[nVertices, 2];
                for (int i = 0; i < nVertices; i++)
                {
                    segments[i, 0] = i;
                    segments[i, 1] = (i + 1) % nVertices;
                }

                // Generate mesh
                var meshResult = _mesher.Triangulate(vertices, segments, maxArea, 30.0);

                // Store variables for potential later use
                StoreMeshVariables(meshResult);

                // Generate visualization
                if (is3D)
                    return Generate3DView(meshResult);
                else
                    return Generate2DView(meshResult);
            }
            catch (Exception ex)
            {
                return $"<p style='color:red;'>Error: {ex.Message}</p>";
            }
        }

        private void StoreMeshVariables(MeshResult mesh)
        {
            int nNodes = mesh.Nodes.GetLength(0);
            int nElements = mesh.Elements.GetLength(0);

            var nodesMatrix = new Matrix(nNodes, 2);
            for (int i = 0; i < nNodes; i++)
            {
                nodesMatrix[i, 0] = new RealValue(mesh.Nodes[i, 0]);
                nodesMatrix[i, 1] = new RealValue(mesh.Nodes[i, 1]);
            }
            _parser.SetVariable("mesh_nodes", nodesMatrix);

            var elementsMatrix = new Matrix(nElements, 3);
            for (int i = 0; i < nElements; i++)
            {
                elementsMatrix[i, 0] = new RealValue(mesh.Elements[i, 0]);
                elementsMatrix[i, 1] = new RealValue(mesh.Elements[i, 1]);
                elementsMatrix[i, 2] = new RealValue(mesh.Elements[i, 2]);
            }
            _parser.SetVariable("mesh_elements", elementsMatrix);

            _parser.SetVariable("mesh_n_nodes", new RealValue(nNodes));
            _parser.SetVariable("mesh_n_elements", new RealValue(nElements));
        }

        private string Generate2DView(MeshResult mesh)
        {
            _id++;
            var nodes = mesh.Nodes;
            var elements = mesh.Elements;
            int nNodes = nodes.GetLength(0);
            int nElements = elements.GetLength(0);

            // Bounding box
            double minX = double.MaxValue, maxX = double.MinValue;
            double minY = double.MaxValue, maxY = double.MinValue;
            for (int i = 0; i < nNodes; i++)
            {
                if (nodes[i, 0] < minX) minX = nodes[i, 0];
                if (nodes[i, 0] > maxX) maxX = nodes[i, 0];
                if (nodes[i, 1] < minY) minY = nodes[i, 1];
                if (nodes[i, 1] > maxY) maxY = nodes[i, 1];
            }

            double padding = 20;
            double width = 500;
            double height = 400;
            double rangeX = Math.Max(maxX - minX, 0.001);
            double rangeY = Math.Max(maxY - minY, 0.001);
            double scale = Math.Min((width - 2 * padding) / rangeX, (height - 2 * padding) / rangeY);
            double offsetX = padding + ((width - 2 * padding) - rangeX * scale) / 2;
            double offsetY = padding + ((height - 2 * padding) - rangeY * scale) / 2;

            var sb = new StringBuilder();
            sb.AppendFormat(Inv, "<svg width=\"{0}\" height=\"{1}\" style=\"background:#f5f5f5;border:1px solid #ddd;margin:5px 0;\">\n", width, height);

            // Draw triangles
            for (int i = 0; i < nElements; i++)
            {
                int n1 = elements[i, 0], n2 = elements[i, 1], n3 = elements[i, 2];
                double x1 = offsetX + (nodes[n1, 0] - minX) * scale;
                double y1 = height - (offsetY + (nodes[n1, 1] - minY) * scale);
                double x2 = offsetX + (nodes[n2, 0] - minX) * scale;
                double y2 = height - (offsetY + (nodes[n2, 1] - minY) * scale);
                double x3 = offsetX + (nodes[n3, 0] - minX) * scale;
                double y3 = height - (offsetY + (nodes[n3, 1] - minY) * scale);

                sb.AppendFormat(Inv, "<polygon points=\"{0:F1},{1:F1} {2:F1},{3:F1} {4:F1},{5:F1}\" fill=\"#d0e8f8\" stroke=\"#0077bb\" stroke-width=\"1\"/>\n",
                    x1, y1, x2, y2, x3, y3);
            }

            // Info
            sb.AppendFormat(Inv, "<text x=\"5\" y=\"15\" font-size=\"11\" fill=\"#555\">{0} nodes, {1} elements</text>\n", nNodes, nElements);
            sb.AppendLine("</svg>");

            return sb.ToString();
        }

        private string Generate3DView(MeshResult mesh)
        {
            _id++;
            var viewerId = $"mesh3d_{_id}";
            var nodes = mesh.Nodes;
            var elements = mesh.Elements;
            int nNodes = nodes.GetLength(0);
            int nElements = elements.GetLength(0);

            // Build flat arrays for Three.js
            var nodesJs = new StringBuilder("[");
            for (int i = 0; i < nNodes; i++)
            {
                if (i > 0) nodesJs.Append(",");
                nodesJs.AppendFormat(Inv, "{0},{1},0", nodes[i, 0], nodes[i, 1]);
            }
            nodesJs.Append("]");

            var elementsJs = new StringBuilder("[");
            for (int i = 0; i < nElements; i++)
            {
                if (i > 0) elementsJs.Append(",");
                elementsJs.AppendFormat("{0},{1},{2}", elements[i, 0], elements[i, 1], elements[i, 2]);
            }
            elementsJs.Append("]");

            // Calculate bounds
            double minX = double.MaxValue, maxX = double.MinValue;
            double minY = double.MaxValue, maxY = double.MinValue;
            for (int i = 0; i < nNodes; i++)
            {
                if (nodes[i, 0] < minX) minX = nodes[i, 0];
                if (nodes[i, 0] > maxX) maxX = nodes[i, 0];
                if (nodes[i, 1] < minY) minY = nodes[i, 1];
                if (nodes[i, 1] > maxY) maxY = nodes[i, 1];
            }
            double centerX = (minX + maxX) / 2;
            double centerY = (minY + maxY) / 2;
            double size = Math.Max(maxX - minX, maxY - minY);
            if (size < 0.001) size = 1;

            var sb = new StringBuilder();
            sb.AppendFormat("<div id=\"{0}\" style=\"width:600px;height:400px;background:#1a1a2e;border-radius:4px;margin:5px 0;\"></div>\n", viewerId);
            sb.AppendLine("<script>");
            sb.AppendLine("(function(){");
            sb.AppendLine("if(typeof THREE==='undefined'){console.error('THREE not loaded');return;}");
            sb.AppendFormat("var c=document.getElementById('{0}');\n", viewerId);
            sb.AppendFormat("var n={0};\n", nodesJs);
            sb.AppendFormat("var e={0};\n", elementsJs);
            sb.AppendFormat(Inv, "var cx={0},cy={1},sz={2};\n", centerX, centerY, size);
            sb.AppendLine(@"
var scene=new THREE.Scene();
scene.background=new THREE.Color(0x1a1a2e);
var camera=new THREE.PerspectiveCamera(45,600/400,0.1,1000);
camera.position.set(cx+sz,cy-sz,sz);
var renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setSize(600,400);
c.appendChild(renderer.domElement);
var controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.target.set(cx,cy,0);
controls.update();
var geo=new THREE.BufferGeometry();
geo.setAttribute('position',new THREE.Float32BufferAttribute(n,3));
geo.setIndex(e);
geo.computeVertexNormals();
scene.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0x4488cc,side:THREE.DoubleSide,transparent:true,opacity:0.6})));
scene.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0x00ffff,wireframe:true})));
scene.add(new THREE.GridHelper(sz*1.5,10,0x444466,0x333355).rotateX(Math.PI/2).translateY(cy).translateX(cx));
(function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);})();
");
            sb.AppendLine("})();");
            sb.AppendLine("</script>");

            return sb.ToString();
        }
    }
}
