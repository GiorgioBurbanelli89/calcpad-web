using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Calcpad.Core.Mesh
{
    /// <summary>
    /// Resultado de la triangulación
    /// </summary>
    public class MeshResult
    {
        /// <summary>Coordenadas de nodos [n_nodos, 2] donde cada fila es [x, y]</summary>
        public double[,] Nodes { get; set; }
        
        /// <summary>Conectividad de elementos [n_elementos, 3] donde cada fila son índices de nodos</summary>
        public int[,] Elements { get; set; }
        
        /// <summary>Índices de nodos en el borde (para condiciones de contorno)</summary>
        public int[] BoundaryNodes { get; set; }
        
        /// <summary>Aristas del borde [n_aristas, 2]</summary>
        public int[,] BoundaryEdges { get; set; }
        
        /// <summary>Número de nodos</summary>
        public int NodeCount => Nodes?.GetLength(0) ?? 0;
        
        /// <summary>Número de elementos</summary>
        public int ElementCount => Elements?.GetLength(0) ?? 0;
    }

    /// <summary>
    /// Generador de mallas triangulares usando el algoritmo de Shewchuk (Triangle)
    /// </summary>
    public class TriangleMesher : IDisposable
    {
        private bool _disposed = false;

        /// <summary>
        /// Genera una malla triangular Delaunay con restricciones de calidad
        /// </summary>
        /// <param name="vertices">Vértices del polígono [n, 2]</param>
        /// <param name="segments">Segmentos del contorno [m, 2] (índices de vértices)</param>
        /// <param name="maxArea">Área máxima por elemento</param>
        /// <param name="minAngle">Ángulo mínimo en grados (default 30°)</param>
        /// <param name="holes">Puntos dentro de huecos [h, 2] (opcional)</param>
        /// <returns>Resultado de la malla</returns>
        public MeshResult Triangulate(
            double[,] vertices,
            int[,] segments,
            double maxArea,
            double minAngle = 30.0,
            double[,] holes = null)
        {
            if (vertices == null || vertices.GetLength(0) < 3)
                throw new ArgumentException("Se requieren al menos 3 vértices");

            int numPoints = vertices.GetLength(0);
            int numSegments = segments?.GetLength(0) ?? 0;
            int numHoles = holes?.GetLength(0) ?? 0;

            // Preparar arrays para interop
            double[] pointList = new double[numPoints * 2];
            for (int i = 0; i < numPoints; i++)
            {
                pointList[i * 2] = vertices[i, 0];
                pointList[i * 2 + 1] = vertices[i, 1];
            }

            int[] segmentList = null;
            if (numSegments > 0)
            {
                segmentList = new int[numSegments * 2];
                for (int i = 0; i < numSegments; i++)
                {
                    segmentList[i * 2] = segments[i, 0];
                    segmentList[i * 2 + 1] = segments[i, 1];
                }
            }

            double[] holeList = null;
            if (numHoles > 0)
            {
                holeList = new double[numHoles * 2];
                for (int i = 0; i < numHoles; i++)
                {
                    holeList[i * 2] = holes[i, 0];
                    holeList[i * 2 + 1] = holes[i, 1];
                }
            }

            // Construir opciones de Triangle
            // p = usa PSLG (segmentos)
            // q{angle} = calidad con ángulo mínimo
            // a{area} = área máxima
            // z = indexación base 0
            // Q = modo silencioso
            // IMPORTANTE: Usar InvariantCulture para asegurar punto decimal
            string options = string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "pzQq{0:F1}a{1:G}", minAngle, maxArea);

            return TriangulateNative(pointList, numPoints, segmentList, numSegments, 
                                     holeList, numHoles, options);
        }

        /// <summary>
        /// Genera malla para un rectángulo
        /// </summary>
        public MeshResult TriangulateRectangle(double width, double height, double maxArea, double minAngle = 30.0)
        {
            var vertices = new double[,]
            {
                { 0, 0 },
                { width, 0 },
                { width, height },
                { 0, height }
            };

            var segments = new int[,]
            {
                { 0, 1 },
                { 1, 2 },
                { 2, 3 },
                { 3, 0 }
            };

            return Triangulate(vertices, segments, maxArea, minAngle);
        }

        /// <summary>
        /// Genera malla rectangular estructurada (sin Delaunay, más rápido)
        /// </summary>
        public MeshResult GenerateStructuredMesh(double width, double height, int nx, int ny)
        {
            double dx = width / nx;
            double dy = height / ny;
            
            int nNodesX = nx + 1;
            int nNodesY = ny + 1;
            int totalNodes = nNodesX * nNodesY;
            int totalElements = nx * ny * 2;

            var nodes = new double[totalNodes, 2];
            var elements = new int[totalElements, 3];
            var boundaryNodes = new List<int>();

            // Generar nodos
            int idx = 0;
            for (int j = 0; j <= ny; j++)
            {
                for (int i = 0; i <= nx; i++)
                {
                    nodes[idx, 0] = i * dx;
                    nodes[idx, 1] = j * dy;
                    
                    // Identificar nodos del borde
                    if (i == 0 || i == nx || j == 0 || j == ny)
                        boundaryNodes.Add(idx);
                    
                    idx++;
                }
            }

            // Generar elementos (patrón de diagonales alternadas)
            int elemIdx = 0;
            for (int j = 0; j < ny; j++)
            {
                for (int i = 0; i < nx; i++)
                {
                    int n0 = j * nNodesX + i;
                    int n1 = n0 + 1;
                    int n2 = n0 + nNodesX;
                    int n3 = n2 + 1;

                    if ((i + j) % 2 == 0)
                    {
                        // Diagonal /
                        elements[elemIdx, 0] = n0;
                        elements[elemIdx, 1] = n1;
                        elements[elemIdx, 2] = n3;
                        elemIdx++;
                        
                        elements[elemIdx, 0] = n0;
                        elements[elemIdx, 1] = n3;
                        elements[elemIdx, 2] = n2;
                        elemIdx++;
                    }
                    else
                    {
                        // Diagonal \
                        elements[elemIdx, 0] = n0;
                        elements[elemIdx, 1] = n1;
                        elements[elemIdx, 2] = n2;
                        elemIdx++;
                        
                        elements[elemIdx, 0] = n1;
                        elements[elemIdx, 1] = n3;
                        elements[elemIdx, 2] = n2;
                        elemIdx++;
                    }
                }
            }

            return new MeshResult
            {
                Nodes = nodes,
                Elements = elements,
                BoundaryNodes = boundaryNodes.ToArray()
            };
        }

        #region Implementación nativa

        private MeshResult TriangulateNative(double[] points, int numPoints,
            int[] segments, int numSegments, double[] holes, int numHoles, string options)
        {
            IntPtr ctx = IntPtr.Zero;
            GCHandle pointsHandle = default;
            GCHandle segmentsHandle = default;
            GCHandle holesHandle = default;

            try
            {
                // Crear contexto
                ctx = Triangle64Native.triangle_context_create();
                if (ctx == IntPtr.Zero)
                    throw new Exception("No se pudo crear el contexto de Triangle");

                // Configurar opciones
                int result = Triangle64Native.triangle_context_options(ctx, options);
                if (result != 0)
                    throw new Exception($"Error configurando opciones de Triangle: {result}");

                // Preparar estructura de entrada
                var input = new Triangle64Native.TriangleIO();
                
                pointsHandle = GCHandle.Alloc(points, GCHandleType.Pinned);
                input.pointlist = pointsHandle.AddrOfPinnedObject();
                input.numberofpoints = numPoints;
                input.numberofpointattributes = 0;

                if (segments != null && numSegments > 0)
                {
                    segmentsHandle = GCHandle.Alloc(segments, GCHandleType.Pinned);
                    input.segmentlist = segmentsHandle.AddrOfPinnedObject();
                    input.numberofsegments = numSegments;
                }

                if (holes != null && numHoles > 0)
                {
                    holesHandle = GCHandle.Alloc(holes, GCHandleType.Pinned);
                    input.holelist = holesHandle.AddrOfPinnedObject();
                    input.numberofholes = numHoles;
                }

                // Crear malla
                result = Triangle64Native.triangle_mesh_create(ctx, ref input);
                if (result != 0)
                    throw new Exception($"Error creando malla: {result}");

                // Obtener resultado
                var output = new Triangle64Native.TriangleIO();
                result = Triangle64Native.triangle_mesh_copy(ctx, ref output, 1, 0);
                if (result != 0)
                    throw new Exception($"Error copiando malla: {result}");

                // Convertir a MeshResult
                return ConvertOutput(output);
            }
            finally
            {
                // Liberar handles
                if (pointsHandle.IsAllocated) pointsHandle.Free();
                if (segmentsHandle.IsAllocated) segmentsHandle.Free();
                if (holesHandle.IsAllocated) holesHandle.Free();

                // Destruir contexto
                if (ctx != IntPtr.Zero)
                    Triangle64Native.triangle_context_destroy(ctx);
            }
        }

        private MeshResult ConvertOutput(Triangle64Native.TriangleIO output)
        {
            var result = new MeshResult();

            // Convertir nodos
            if (output.numberofpoints > 0 && output.pointlist != IntPtr.Zero)
            {
                result.Nodes = new double[output.numberofpoints, 2];
                double[] temp = new double[output.numberofpoints * 2];
                Marshal.Copy(output.pointlist, temp, 0, temp.Length);
                
                for (int i = 0; i < output.numberofpoints; i++)
                {
                    result.Nodes[i, 0] = temp[i * 2];
                    result.Nodes[i, 1] = temp[i * 2 + 1];
                }
                
                Triangle64Native.triangle_free(output.pointlist);
            }

            // Convertir elementos
            if (output.numberoftriangles > 0 && output.trianglelist != IntPtr.Zero)
            {
                result.Elements = new int[output.numberoftriangles, 3];
                int[] temp = new int[output.numberoftriangles * 3];
                Marshal.Copy(output.trianglelist, temp, 0, temp.Length);
                
                for (int i = 0; i < output.numberoftriangles; i++)
                {
                    result.Elements[i, 0] = temp[i * 3];
                    result.Elements[i, 1] = temp[i * 3 + 1];
                    result.Elements[i, 2] = temp[i * 3 + 2];
                }
                
                Triangle64Native.triangle_free(output.trianglelist);
            }

            // Extraer nodos del borde usando marcadores
            if (output.pointmarkerlist != IntPtr.Zero)
            {
                int[] markers = new int[output.numberofpoints];
                Marshal.Copy(output.pointmarkerlist, markers, 0, markers.Length);
                
                var boundaryList = new List<int>();
                for (int i = 0; i < markers.Length; i++)
                {
                    if (markers[i] != 0)
                        boundaryList.Add(i);
                }
                result.BoundaryNodes = boundaryList.ToArray();
                
                Triangle64Native.triangle_free(output.pointmarkerlist);
            }

            // Liberar memoria restante
            if (output.edgelist != IntPtr.Zero)
                Triangle64Native.triangle_free(output.edgelist);
            if (output.edgemarkerlist != IntPtr.Zero)
                Triangle64Native.triangle_free(output.edgemarkerlist);

            return result;
        }

        #endregion

        #region IDisposable

        public void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        protected virtual void Dispose(bool disposing)
        {
            if (!_disposed)
            {
                _disposed = true;
            }
        }

        ~TriangleMesher()
        {
            Dispose(false);
        }

        #endregion
    }
}
