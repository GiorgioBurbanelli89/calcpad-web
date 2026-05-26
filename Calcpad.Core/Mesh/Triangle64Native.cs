using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

namespace Calcpad.Core.Mesh
{
    /// <summary>
    /// P/Invoke wrapper para Triangle library (algoritmo de Shewchuk)
    /// Soporta Windows (Triangle64.dll) y Linux (libtriangle.so)
    /// </summary>
    public static class Triangle64Native
    {
        // Nombre genérico - el resolver encuentra la biblioteca correcta
        private const string DllName = "triangle";

        #region Cross-platform library loading

        static Triangle64Native()
        {
            NativeLibrary.SetDllImportResolver(typeof(Triangle64Native).Assembly, ImportResolver);
        }

        private static IntPtr ImportResolver(string libraryName, Assembly assembly, DllImportSearchPath? searchPath)
        {
            if (libraryName != "triangle")
                return IntPtr.Zero;

            IntPtr handle = IntPtr.Zero;
            string libPath;

            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                // Windows: Triangle64.dll
                string[] windowsNames = { "Triangle64.dll", "triangle.dll", "libtriangle.dll" };
                foreach (var name in windowsNames)
                {
                    libPath = Path.Combine(AppContext.BaseDirectory, name);
                    if (File.Exists(libPath) && NativeLibrary.TryLoad(libPath, out handle))
                        return handle;

                    // Intentar cargar desde el sistema
                    if (NativeLibrary.TryLoad(name, out handle))
                        return handle;
                }
            }
            else if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                // Linux: libtriangle.so
                string[] linuxNames = { "libtriangle.so", "libtriangle.so.1", "triangle.so" };
                foreach (var name in linuxNames)
                {
                    libPath = Path.Combine(AppContext.BaseDirectory, name);
                    if (File.Exists(libPath) && NativeLibrary.TryLoad(libPath, out handle))
                        return handle;

                    // Intentar cargar desde /usr/lib o /usr/local/lib
                    if (NativeLibrary.TryLoad(name, out handle))
                        return handle;
                }
            }
            else if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
            {
                // macOS: libtriangle.dylib
                string[] macNames = { "libtriangle.dylib", "triangle.dylib" };
                foreach (var name in macNames)
                {
                    libPath = Path.Combine(AppContext.BaseDirectory, name);
                    if (File.Exists(libPath) && NativeLibrary.TryLoad(libPath, out handle))
                        return handle;

                    if (NativeLibrary.TryLoad(name, out handle))
                        return handle;
                }
            }

            return IntPtr.Zero;
        }

        /// <summary>
        /// Obtiene el nombre de la biblioteca nativa según el OS
        /// </summary>
        public static string GetNativeLibraryName()
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                return "Triangle64.dll";
            else if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
                return "libtriangle.so";
            else if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
                return "libtriangle.dylib";
            else
                return "triangle";
        }

        #endregion

        #region Estructuras nativas

        /// <summary>
        /// Estructura triangleio para entrada/salida de datos con Triangle
        /// </summary>
        [StructLayout(LayoutKind.Sequential)]
        public struct TriangleIO
        {
            public IntPtr pointlist;              // REAL* - coordenadas [x0,y0,x1,y1,...]
            public IntPtr pointattributelist;     // REAL* - atributos de puntos
            public IntPtr pointmarkerlist;        // int* - marcadores de borde
            public int numberofpoints;
            public int numberofpointattributes;

            public IntPtr trianglelist;           // int* - índices de triángulos [t0_v0,t0_v1,t0_v2,t1_v0,...]
            public IntPtr triangleattributelist;  // REAL* - atributos de triángulos
            public IntPtr trianglearealist;       // REAL* - restricción de área por triángulo
            public IntPtr neighborlist;           // int* - vecinos de triángulos
            public int numberoftriangles;
            public int numberofcorners;           // normalmente 3, puede ser 6 para segundo orden
            public int numberoftriangleattributes;

            public IntPtr segmentlist;            // int* - segmentos [s0_v0,s0_v1,s1_v0,...]
            public IntPtr segmentmarkerlist;      // int* - marcadores de segmentos
            public int numberofsegments;

            public IntPtr holelist;               // REAL* - puntos dentro de huecos [x0,y0,x1,y1,...]
            public int numberofholes;

            public IntPtr regionlist;             // REAL* - regiones [x,y,attr,maxarea,...]
            public int numberofregions;

            public IntPtr edgelist;               // int* - aristas (salida)
            public IntPtr edgemarkerlist;         // int* - marcadores de aristas
            public int numberofedges;
        }

        /// <summary>
        /// Estadísticas de la malla
        /// </summary>
        [StructLayout(LayoutKind.Sequential)]
        public struct Statistics
        {
            public int vertices;
            public int undeads;
            public int triangles;
            public int hullsize;
            public int subsegs;
            public int edges;
            public double xmin, ymin, xmax, ymax;  // bounds
        }

        #endregion

        #region Funciones DLL importadas - API moderna

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr triangle_context_create();

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        public static extern void triangle_context_destroy(IntPtr ctx);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        public static extern int triangle_context_options(IntPtr ctx, string options);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        public static extern int triangle_mesh_create(IntPtr ctx, ref TriangleIO input);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        public static extern int triangle_mesh_copy(IntPtr ctx, ref TriangleIO output, int edges, int neighbors);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        public static extern int triangle_mesh_statistics(IntPtr ctx, ref Statistics stats);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        public static extern void triangle_free(IntPtr memptr);

        [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
        public static extern void triangle_version([Out] int[] version);

        #endregion

        #region Métodos de ayuda

        /// <summary>
        /// Obtiene la versión de Triangle
        /// </summary>
        public static string GetVersion()
        {
            int[] version = new int[4];
            triangle_version(version);
            return $"{version[0]}.{version[1]}.{version[2]}";
        }

        /// <summary>
        /// Verifica si la DLL está disponible
        /// </summary>
        public static bool IsAvailable()
        {
            try
            {
                int[] version = new int[4];
                triangle_version(version);
                return true;
            }
            catch
            {
                return false;
            }
        }

        #endregion
    }
}
