"""
Round 2 — focused probe of AeccDbPipe entities + verify whether the existing
DXF filter ['LWPOLYLINE', 'POLYLINE'] actually catches pipe-network objects.
"""

from __future__ import annotations

import sys

import pythoncom
import win32com.client

PROGID = "AutoCAD.Application.24.3"


def safe(obj, prop, default=None):
    try:
        v = getattr(obj, prop)
        return default if v is None else v
    except Exception:
        return default


def try_call(obj, method, default=None):
    """Some Civil 3D props are exposed as zero-arg methods rather than
    regular properties when surfaced through win32com.client.GetActiveObject
    (late-bound). Try calling, fall back to attribute."""
    try:
        fn = getattr(obj, method)
        if callable(fn):
            return fn()
        return fn
    except Exception:
        return default


def main() -> int:
    app = win32com.client.GetActiveObject(PROGID)
    doc = app.ActiveDocument
    ms = doc.ModelSpace

    pipes: list = []
    structures: list = []
    for i in range(ms.Count):
        try:
            ent = ms.Item(i)
        except Exception:
            continue
        if safe(ent, "Layer") != "P-UTIL":
            continue
        obj = safe(ent, "ObjectName", "")
        if obj == "AeccDbPipe" and len(pipes) < 6:
            pipes.append(ent)
        elif obj == "AeccDbStructure" and len(structures) < 3:
            structures.append(ent)

    print(f"Collected {len(pipes)} AeccDbPipe + {len(structures)} AeccDbStructure samples\n")

    pipe_props = [
        "ObjectName", "ObjectID", "Layer",
        "Description", "PartDescription",
        "PartSizeName", "PartFamilyName", "PartType",
        "InnerDiameter", "OuterDiameter", "Diameter",
        "InnerWidth", "InnerHeight",
        "Length", "Length2D", "Length3DCenterToCenter", "Length3DToInsideEdge",
        "Material",
        "StartPoint", "EndPoint",
    ]
    print("=== AeccDbPipe samples ===")
    for i, ent in enumerate(pipes):
        print(f"--- pipe {i} ---")
        for p in pipe_props:
            # Prefer property; fall back to calling as method
            v = safe(ent, p)
            if v is None or callable(v):
                v = try_call(ent, p)
            if v is None:
                continue
            sv = str(v)
            if len(sv) > 120:
                sv = sv[:117] + "..."
            print(f"  {p:30s} = {sv}")
    print()

    print("=== AeccDbStructure samples (with method calls) ===")
    struct_props = pipe_props + ["Rim", "RimElevation", "SumpDepth"]
    for i, ent in enumerate(structures):
        print(f"--- structure {i} ---")
        for p in struct_props:
            v = safe(ent, p)
            if v is None or callable(v):
                v = try_call(ent, p)
            if v is None:
                continue
            sv = str(v)
            if len(sv) > 120:
                sv = sv[:117] + "..."
            print(f"  {p:30s} = {sv}")
    print()

    # ---------------------------------------------------------------
    # Reproduce what the Electron app does today: SelectionSet with
    # DXF filter ['LWPOLYLINE', 'POLYLINE'] on layer P-UTIL.
    # ---------------------------------------------------------------
    SS_NAME = "abmPipeProbe"
    try:
        doc.SelectionSets.Item(SS_NAME).Delete()
    except Exception:
        pass
    ss = doc.SelectionSets.Add(SS_NAME)
    try:
        codes_arr = win32com.client.VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_I2, [8, 0])
        vals_arr = win32com.client.VARIANT(
            pythoncom.VT_ARRAY | pythoncom.VT_BSTR, ["P-UTIL", "LWPOLYLINE,POLYLINE"]
        )
        ss.Select(5, None, None, codes_arr, vals_arr)
        print(f"SelectionSet (P-UTIL, LWPOLYLINE/POLYLINE) -> Count={ss.Count}  [current Electron filter]")
    finally:
        try:
            ss.Delete()
        except Exception:
            pass

    # Try without the DXF type filter — just layer P-UTIL
    try:
        doc.SelectionSets.Item(SS_NAME).Delete()
    except Exception:
        pass
    ss = doc.SelectionSets.Add(SS_NAME)
    try:
        codes_arr = win32com.client.VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_I2, [8])
        vals_arr = win32com.client.VARIANT(
            pythoncom.VT_ARRAY | pythoncom.VT_BSTR, ["P-UTIL"]
        )
        ss.Select(5, None, None, codes_arr, vals_arr)
        print(f"SelectionSet (P-UTIL, no type filter)       -> Count={ss.Count}")
    finally:
        try:
            ss.Delete()
        except Exception:
            pass

    # And try with the Civil 3D DXF names. Pipe-network entities are
    # registered as AECC_PIPE / AECC_STRUCTURE in the DXF dictionary on most
    # AutoCAD versions. Worth confirming.
    for dxf_name in ["AECC_PIPE", "AECC_STRUCTURE", "AECCPIPE", "AECCSTRUCTURE"]:
        try:
            doc.SelectionSets.Item(SS_NAME).Delete()
        except Exception:
            pass
        ss = doc.SelectionSets.Add(SS_NAME)
        try:
            codes_arr = win32com.client.VARIANT(
                pythoncom.VT_ARRAY | pythoncom.VT_I2, [8, 0]
            )
            vals_arr = win32com.client.VARIANT(
                pythoncom.VT_ARRAY | pythoncom.VT_BSTR, ["P-UTIL", dxf_name]
            )
            ss.Select(5, None, None, codes_arr, vals_arr)
            print(f"SelectionSet (P-UTIL, {dxf_name})            -> Count={ss.Count}")
        except Exception as e:
            print(f"SelectionSet (P-UTIL, {dxf_name}) FAILED: {e}")
        finally:
            try:
                ss.Delete()
            except Exception:
                pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
