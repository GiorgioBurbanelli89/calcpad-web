using System;
using System.Text;
using System.Globalization;

namespace Calcpad.Core
{
    /// <summary>
    /// Parser for $Mesh_View command.
    /// Generates Three.js interactive 3D visualization (like awatif getViewer).
    ///
    /// Syntax: $Mesh_View{}
    /// or:     $Mesh_View{values}  - for color map based on values array
    ///
    /// Requires mesh_nodes and mesh_elements variables from $Mesh_Triangle.
    /// Features:
    /// - Interactive 3D view with OrbitControls (rotate, zoom, pan)
    /// - Wireframe mesh with colored triangles
    /// - Optional color map for results visualization (rainbow scale)
    /// - Dark background like awatif
    /// </summary>
    internal class MeshViewParser
    {
        private readonly MathParser _parser;
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        private static int _viewerId = 0; // Unique ID for multiple viewers

        internal MeshViewParser(MathParser parser)
        {
            _parser = parser;
        }

        internal string Parse(ReadOnlySpan<char> s, bool calculate)
        {
            if (!calculate)
            {
                return "<p><strong>$Mesh_View</strong>{} or $Mesh_View{values}</p>";
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
                            // If matrix, take first column
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

                return GenerateThreeJsViewer(nodesMatrix, elementsMatrix, values, boundary);
            }
            catch (Exception ex)
            {
                return $"<p style='color:red;'>Error in $Mesh_View: {ex.Message}</p>";
            }
        }

        private string GenerateThreeJsViewer(Matrix nodes, Matrix elements, double[] values, int[] boundary)
        {
            _viewerId++;
            var viewerId = $"meshViewer{_viewerId}";

            int nNodes = nodes.RowCount;
            int nElements = elements.RowCount;

            // Build nodes array as flat list [x0,y0,z0, x1,y1,z1, ...]
            var nodesJs = new StringBuilder();
            nodesJs.Append("[");
            for (int i = 0; i < nNodes; i++)
            {
                double x = nodes[i, 0].D;
                double y = nodes[i, 1].D;
                double z = nodes.ColCount > 2 ? nodes[i, 2].D : 0;
                if (i > 0) nodesJs.Append(",");
                nodesJs.AppendFormat(Inv, "{0},{1},{2}", x, y, z);
            }
            nodesJs.Append("]");

            // Build elements array as flat list [i0,j0,k0, i1,j1,k1, ...]
            var elementsJs = new StringBuilder();
            elementsJs.Append("[");
            for (int i = 0; i < nElements; i++)
            {
                int n1 = (int)elements[i, 0].D;
                int n2 = (int)elements[i, 1].D;
                int n3 = (int)elements[i, 2].D;
                if (i > 0) elementsJs.Append(",");
                elementsJs.AppendFormat(Inv, "{0},{1},{2}", n1, n2, n3);
            }
            elementsJs.Append("]");

            // Build values array if provided
            var valuesJs = "null";
            if (values != null && values.Length > 0)
            {
                var valuesBuilder = new StringBuilder();
                valuesBuilder.Append("[");
                for (int i = 0; i < values.Length; i++)
                {
                    if (i > 0) valuesBuilder.Append(",");
                    valuesBuilder.AppendFormat(Inv, "{0}", values[i]);
                }
                valuesBuilder.Append("]");
                valuesJs = valuesBuilder.ToString();
            }

            // Build boundary array if provided
            var boundaryJs = "[]";
            if (boundary != null && boundary.Length > 0)
            {
                var boundaryBuilder = new StringBuilder();
                boundaryBuilder.Append("[");
                for (int i = 0; i < boundary.Length; i++)
                {
                    if (i > 0) boundaryBuilder.Append(",");
                    boundaryBuilder.Append(boundary[i]);
                }
                boundaryBuilder.Append("]");
                boundaryJs = boundaryBuilder.ToString();
            }

            var sb = new StringBuilder();

            // Container div with fixed dimensions
            sb.AppendLine($"<div id=\"{viewerId}\" style=\"width:800px;height:500px;background:#1a1a2e;position:relative;border-radius:8px;overflow:hidden;margin:10px 0;\"></div>");

            // Three.js viewer script (Three.js 0.145 is loaded in template.html)
            sb.AppendLine("<script>");
            sb.AppendLine("(function() {");
            sb.AppendLine("  if (typeof THREE === 'undefined') { console.error('THREE not loaded'); return; }");
            sb.AppendLine("  if (typeof THREE.OrbitControls === 'undefined') { console.error('OrbitControls not loaded'); return; }");
            sb.AppendLine($"  const container = document.getElementById('{viewerId}');");
            sb.AppendLine($"  const nodeData = {nodesJs};");
            sb.AppendLine($"  const elementData = {elementsJs};");
            sb.AppendLine($"  const valueData = {valuesJs};");
            sb.AppendLine(@"
  // Calculate bounding box
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < nodeData.length; i += 3) {
      minX = Math.min(minX, nodeData[i]);
      maxX = Math.max(maxX, nodeData[i]);
      minY = Math.min(minY, nodeData[i+1]);
      maxY = Math.max(maxY, nodeData[i+1]);
    }
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const sizeX = maxX - minX || 1;
    const sizeY = maxY - minY || 1;
    const gridSize = Math.max(sizeX, sizeY) * 1.5;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Camera (like awatif)
    const camera = new THREE.PerspectiveCamera(45, 800/500, 0.1, 10000);
    const camDist = gridSize * 2;
    camera.position.set(centerX + camDist * 0.5, centerY - camDist * 0.8, camDist * 0.6);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(800, 500);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // OrbitControls
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(centerX, centerY, 0);
    controls.enableDamping = true;
    controls.update();

    // Grid (XY plane, like awatif)
    const gridHelper = new THREE.GridHelper(gridSize, 20, 0x444466, 0x333355);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.set(centerX, centerY, -0.001);
    scene.add(gridHelper);

    // Axes
    const axesHelper = new THREE.AxesHelper(gridSize * 0.2);
    scene.add(axesHelper);

    // Create geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(nodeData, 3));
    geometry.setIndex(elementData);
    geometry.computeVertexNormals();

    // Mesh surface (semi-transparent blue)
    const meshMaterial = new THREE.MeshBasicMaterial({
      color: 0x4488cc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5
    });
    const meshSurface = new THREE.Mesh(geometry, meshMaterial);
    scene.add(meshSurface);

    // Wireframe (cyan edges)
    const wireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      wireframe: true
    });
    const wireframeMesh = new THREE.Mesh(geometry, wireframeMaterial);
    scene.add(wireframeMesh);

    // Info panel
    const info = document.createElement('div');
    info.style.cssText = 'position:absolute;bottom:10px;left:10px;background:rgba(0,0,0,0.7);padding:8px 12px;border-radius:4px;color:#0ff;font-family:monospace;font-size:12px;';
    info.textContent = 'Nodes: ' + (nodeData.length/3) + ' | Elements: ' + (elementData.length/3) + ' | Drag to rotate, scroll to zoom';
    container.appendChild(info);

    // Animation loop
    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

})();
");
            sb.AppendLine("</script>");

            return sb.ToString();
        }
    }
}
