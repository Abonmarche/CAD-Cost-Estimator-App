"""
Probe the Civil 3D `Style` property on every AeccDbPipe + AeccDbStructure
on layer P-UTIL. The user reports the style reads e.g. "P: Storm Pipe" for
storm pipes — if that's exposed via COM, it's our differentiator.
"""

from __future__ import annotations

import sys

import win32com.client

PROGID = "AutoCAD.Application.24.3"


def safe(obj, prop, default=None):
    try:
        v = getattr(obj, prop)
        return default if v is None else v
    except Exception:
        return default


def try_call(obj, method, default=None):
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

    pipes = []
    structs = []
    for i in range(ms.Count):
        try:
            ent = ms.Item(i)
        except Exception:
            continue
        if safe(ent, "Layer") != "P-UTIL":
            continue
        obj = safe(ent, "ObjectName")
        if obj == "AeccDbPipe":
            pipes.append(ent)
        elif obj == "AeccDbStructure":
            structs.append(ent)

    style_props = [
        "Style",
        "StyleName",
        "StyleId",
        "PipeStyle",
        "PipeStyleName",
        "StructureStyle",
        "StructureStyleName",
    ]

    def dump(ents, label):
        print(f"=== {label} (n={len(ents)}) ===")
        for i, e in enumerate(ents):
            row = [f"[{i:02d}]"]
            for p in style_props:
                v = safe(e, p)
                if v is None or callable(v):
                    v = try_call(e, p)
                if v is None:
                    continue
                # COM proxies print as <COMObject ...>; try to coerce to a name.
                if "COMObject" in str(v):
                    style_name = safe(v, "Name") or try_call(v, "Name")
                    if style_name is not None:
                        v = f"<style>.Name={style_name!r}"
                    else:
                        # Last resort: print the object repr verbatim
                        pass
                sv = str(v)
                if len(sv) > 60:
                    sv = sv[:57] + "..."
                row.append(f"{p}={sv}")
            # Also include Description so we can correlate
            d = safe(e, "Description")
            if d is not None:
                row.append(f"Description={d!r}")
            print("  " + "  ".join(row))
        print()

    dump(pipes, "AeccDbPipe on P-UTIL")
    dump(structs, "AeccDbStructure on P-UTIL")
    return 0


if __name__ == "__main__":
    sys.exit(main())
