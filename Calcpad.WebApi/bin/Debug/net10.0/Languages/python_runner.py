#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Calcpad Python Runner - Persistent Python Process
Keeps Python running with libraries pre-loaded for fast execution.
Similar to Jupyter kernel approach.
"""

import sys
import io
import json
import traceback
import base64
import hashlib
import time

# Force UTF-8 output
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Enable timing diagnostics
ENABLE_TIMING = True
_startup_time = time.perf_counter()

def timing_log(phase, elapsed_ms):
    """Log timing information that will be visible in output"""
    if ENABLE_TIMING:
        return f"<!-- TIMING: {phase}: {elapsed_ms:.1f}ms -->"
    return ""

# Pre-load common libraries (this is the slow part, done once)
print("CALCPAD_RUNNER:LOADING", flush=True)

_t0 = time.perf_counter()
try:
    import numpy as np
    NUMPY_LOADED = True
    _numpy_time = (time.perf_counter() - _t0) * 1000
except ImportError:
    NUMPY_LOADED = False
    _numpy_time = 0

_t0 = time.perf_counter()
try:
    import matplotlib
    matplotlib.use('Agg')  # Non-interactive backend
    import matplotlib.pyplot as plt
    MATPLOTLIB_LOADED = True
    _matplotlib_time = (time.perf_counter() - _t0) * 1000
except ImportError:
    MATPLOTLIB_LOADED = False
    _matplotlib_time = 0

_t0 = time.perf_counter()
try:
    import plotly.graph_objects as go
    import plotly.express as px
    PLOTLY_LOADED = True
    _plotly_time = (time.perf_counter() - _t0) * 1000
except ImportError:
    PLOTLY_LOADED = False
    _plotly_time = 0

_t0 = time.perf_counter()
try:
    import pandas as pd
    PANDAS_LOADED = True
    _pandas_time = (time.perf_counter() - _t0) * 1000
except ImportError:
    PANDAS_LOADED = False
    _pandas_time = 0

_t0 = time.perf_counter()
try:
    import scipy
    SCIPY_LOADED = True
    _scipy_time = (time.perf_counter() - _t0) * 1000
except ImportError:
    SCIPY_LOADED = False
    _scipy_time = 0

_total_startup = (time.perf_counter() - _startup_time) * 1000

# Store timing info for diagnostics
_STARTUP_TIMING = {
    'numpy': _numpy_time,
    'matplotlib': _matplotlib_time,
    'plotly': _plotly_time,
    'pandas': _pandas_time,
    'scipy': _scipy_time,
    'total': _total_startup
}

# ============================================================================
# SAP2000 API Helper - Persistent connection manager
# ============================================================================
class SAP2000Helper:
    """
    Helper para manejar conexiones persistentes a SAP2000.
    Uso:
        SAP.connect()      # Conecta a existente o crea nuevo
        SAP.SapModel       # Acceso al modelo
        SAP.mySapObject    # Acceso al objeto principal
        SAP.close()        # Cierra SAP2000
        SAP.is_connected   # True si hay conexión activa
    """
    def __init__(self):
        self._mySapObject = None
        self._SapModel = None
        self._is_new = False

    @property
    def is_connected(self):
        """Verifica si hay conexión activa a SAP2000"""
        if self._mySapObject is None:
            return False
        try:
            # Intentar acceder al modelo para verificar conexión
            _ = self._mySapObject.SapModel
            return True
        except:
            self._mySapObject = None
            self._SapModel = None
            return False

    @property
    def mySapObject(self):
        """Objeto principal de SAP2000"""
        if not self.is_connected:
            self.connect()
        return self._mySapObject

    @property
    def SapModel(self):
        """Modelo activo de SAP2000"""
        if not self.is_connected:
            self.connect()
        return self._SapModel

    def connect(self, units=6, visible=True, create_blank=True):
        """
        Conecta a SAP2000 existente o crea uno nuevo.

        Args:
            units: Unidades (6=kN,m,C por defecto)
            visible: True para mostrar ventana
            create_blank: True para crear modelo en blanco si es nuevo

        Returns:
            tuple: (mySapObject, SapModel, is_new)
        """
        import comtypes.client

        # Si ya está conectado, retornar conexión existente
        if self.is_connected:
            print("[SAP2000] Ya conectado - reutilizando conexión existente")
            return self._mySapObject, self._SapModel, False

        # Intentar conectar a instancia existente
        try:
            print("[SAP2000] Buscando instancia existente...")
            self._mySapObject = comtypes.client.GetActiveObject("CSI.SAP2000.API.SapObject")
            self._SapModel = self._mySapObject.SapModel
            self._is_new = False
            print("[SAP2000] OK - Conectado a SAP2000 existente")

            # Mostrar info del modelo
            nudos = self._SapModel.PointObj.Count()
            areas = self._SapModel.AreaObj.Count()
            frames = self._SapModel.FrameObj.Count()
            print(f"[SAP2000] Modelo actual: {nudos} nudos, {areas} areas, {frames} frames")

            return self._mySapObject, self._SapModel, False

        except Exception as e:
            print(f"[SAP2000] No hay instancia existente, creando nueva...")

        # Crear nueva instancia
        try:
            helper = comtypes.client.CreateObject('SAP2000v1.Helper')
            helper = helper.QueryInterface(comtypes.gen.SAP2000v1.cHelper)
            self._mySapObject = helper.CreateObjectProgID("CSI.SAP2000.API.SapObject")

            print(f"[SAP2000] Iniciando SAP2000 (unidades={units}, visible={visible})...")
            ret = self._mySapObject.ApplicationStart(units, visible)

            if ret != 0:
                print(f"[SAP2000] WARN: ApplicationStart retornó {ret}")

            # Esperar a que inicie
            import time
            print("[SAP2000] Esperando que SAP2000 cargue...")
            time.sleep(3)

            self._SapModel = self._mySapObject.SapModel

            if create_blank:
                print("[SAP2000] Inicializando modelo en blanco...")
                self._SapModel.InitializeNewModel(units)
                self._SapModel.File.NewBlank()

            self._is_new = True
            print("[SAP2000] OK - SAP2000 nuevo creado y listo")
            return self._mySapObject, self._SapModel, True

        except Exception as e:
            print(f"[SAP2000] ERROR: {e}")
            self._mySapObject = None
            self._SapModel = None
            raise

    def close(self, save=False):
        """
        Cierra SAP2000.

        Args:
            save: True para guardar cambios antes de cerrar
        """
        if self._mySapObject is not None:
            try:
                print(f"[SAP2000] Cerrando (guardar={save})...")
                self._mySapObject.ApplicationExit(save)
                print("[SAP2000] OK - SAP2000 cerrado")
            except Exception as e:
                print(f"[SAP2000] Error al cerrar: {e}")
            finally:
                self._mySapObject = None
                self._SapModel = None
        else:
            print("[SAP2000] No hay conexión activa para cerrar")

    def new_model(self, units=6):
        """Crea un nuevo modelo en blanco (sin cerrar SAP2000)"""
        if not self.is_connected:
            self.connect(units=units)
        else:
            print("[SAP2000] Creando nuevo modelo en blanco...")
            self._SapModel.InitializeNewModel(units)
            self._SapModel.File.NewBlank()
            print("[SAP2000] OK - Nuevo modelo creado")

    def status(self):
        """Muestra el estado actual de la conexión"""
        if not self.is_connected:
            print("[SAP2000] Estado: No conectado")
            return

        try:
            units = self._SapModel.GetPresentUnits()
            nudos = self._SapModel.PointObj.Count()
            areas = self._SapModel.AreaObj.Count()
            frames = self._SapModel.FrameObj.Count()
            locked = self._SapModel.GetModelIsLocked()

            units_names = {
                1: "lb,in,F", 2: "lb,ft,F", 3: "kip,in,F", 4: "kip,ft,F",
                5: "kN,mm,C", 6: "kN,m,C", 7: "kgf,mm,C", 8: "kgf,m,C",
                9: "N,mm,C", 10: "N,m,C", 11: "Ton,mm,C", 12: "Ton,m,C"
            }

            print("[SAP2000] Estado: Conectado")
            print(f"         Unidades: {units_names.get(units, units)}")
            print(f"         Nudos:    {nudos}")
            print(f"         Areas:    {areas}")
            print(f"         Frames:   {frames}")
            print(f"         Analizado: {'Sí' if locked else 'No'}")
        except Exception as e:
            print(f"[SAP2000] Error obteniendo estado: {e}")

# Crear instancia global del helper
SAP = SAP2000Helper()

print("CALCPAD_RUNNER:READY", flush=True)

# Execution namespace (persists between executions like Jupyter)
_namespace = {
    'np': np if NUMPY_LOADED else None,
    'plt': plt if MATPLOTLIB_LOADED else None,
    'go': go if PLOTLY_LOADED else None,
    'px': px if PLOTLY_LOADED else None,
    'pd': pd if PANDAS_LOADED else None,
    'SAP': SAP,  # SAP2000 Helper disponible globalmente
    '__name__': '__main__',
}

def execute_code(code):
    """Execute code and capture output with detailed timing"""
    _exec_start = time.perf_counter()

    old_stdout = sys.stdout
    old_stderr = sys.stderr

    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    sys.stdout = stdout_capture
    sys.stderr = stderr_capture

    result = {
        'success': True,
        'output': '',
        'error': '',
    }

    try:
        _code_start = time.perf_counter()
        # Execute the code in the persistent namespace
        exec(code, _namespace)
        _code_time = (time.perf_counter() - _code_start) * 1000

        output = stdout_capture.getvalue()

        # Add timing info as HTML comment at the end of output
        if ENABLE_TIMING:
            _total_exec = (time.perf_counter() - _exec_start) * 1000
            timing_html = f'''
<div id="python-timing" style="font-family:monospace;font-size:10px;color:#666;background:#f0f8ff;border:1px solid #ccd;padding:4px 8px;margin:4px 0;border-radius:3px;">
<b>[Python Timing]</b><br>
Code execution: {_code_time:.1f}ms<br>
Total (with capture): {_total_exec:.1f}ms<br>
Libraries loaded: numpy={_STARTUP_TIMING["numpy"]:.0f}ms, matplotlib={_STARTUP_TIMING["matplotlib"]:.0f}ms
</div>'''
            output = output + timing_html

        result['output'] = output
    except Exception as e:
        result['success'] = False
        result['error'] = traceback.format_exc()
        result['output'] = stdout_capture.getvalue()
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    return result

def main():
    """Main loop - wait for code, execute, return results"""
    while True:
        try:
            # Read command
            line = sys.stdin.readline()
            if not line:
                break

            line = line.strip()

            if line == "CALCPAD_EXIT":
                print("CALCPAD_RUNNER:EXITING", flush=True)
                break

            if line == "CALCPAD_PING":
                print("CALCPAD_RUNNER:PONG", flush=True)
                continue

            if line.startswith("CALCPAD_EXEC:"):
                # Decode base64 code
                b64_code = line[13:]
                try:
                    code = base64.b64decode(b64_code).decode('utf-8')
                except:
                    print("CALCPAD_RUNNER:ERROR:Invalid base64 encoding", flush=True)
                    continue

                # Execute
                result = execute_code(code)

                # Send result as JSON (base64 encoded to avoid newline issues)
                result_json = json.dumps(result)
                result_b64 = base64.b64encode(result_json.encode('utf-8')).decode('ascii')
                print(f"CALCPAD_RUNNER:RESULT:{result_b64}", flush=True)

        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"CALCPAD_RUNNER:ERROR:{str(e)}", flush=True)

if __name__ == "__main__":
    main()
