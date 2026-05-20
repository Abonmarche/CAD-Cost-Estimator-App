"""
Round 3 — figure out which SelectionSet filter (if any) catches AeccDbPipe.

Tries the layer-only filter, then several DXF-name candidates for Civil 3D
pipe/structure entities. We want a path that lets the Electron app
SelectionSet the pipes/structures directly instead of walking ModelSpace.
"""

from __future__ import annotations

import sys

import pythoncom
import win32com.client


PROGID = "AutoCAD.Application.24.3"
LAYER = "P-UTIL"
SS_NAME = "abmPipeProbe2"


def select(doc, codes, values):
    try:
        doc.SelectionSets.Item(SS_NAME).Delete()
    except Exception:
        pass
    ss = doc.SelectionSets.Add(SS_NAME)
    try:
        codes_arr = win32com.client.VARIANT(
            pythoncom.VT_ARRAY | pythoncom.VT_I2, list(codes)
        )
        vals_arr = win32com.client.VARIANT(
            pythoncom.VT_ARRAY | pythoncom.VT_VARIANT, list(values)
        )
        ss.Select(5, None, None, codes_arr, vals_arr)
        return ss.Count
    finally:
        try:
            ss.Delete()
        except Exception:
            pass


def main() -> int:
    app = win32com.client.GetActiveObject(PROGID)
    doc = app.ActiveDocument

    # Baseline: just the layer filter, no DXF type filter
    try:
        cnt = select(doc, [8], [LAYER])
        print(f"layer={LAYER} (no type filter)            -> {cnt}")
    except Exception as e:
        print(f"layer-only FAILED: {e}")

    # Current Electron behavior: LWPOLYLINE/POLYLINE
    try:
        cnt = select(doc, [8, 0], [LAYER, "LWPOLYLINE,POLYLINE"])
        print(f"layer + LWPOLYLINE/POLYLINE              -> {cnt}  [current Electron filter]")
    except Exception as e:
        print(f"LWPOLYLINE/POLYLINE FAILED: {e}")

    # Civil 3D candidates
    for name in [
        "AECC_PIPE",
        "AECC_STRUCTURE",
        "AECC_PIPE,AECC_STRUCTURE",
        "AECCDBPIPE",
        "AECCPIPE",
        "AeccDbPipe",
    ]:
        try:
            cnt = select(doc, [8, 0], [LAYER, name])
            print(f"layer + {name:30s}     -> {cnt}")
        except Exception as e:
            print(f"layer + {name:30s}     FAILED: {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
