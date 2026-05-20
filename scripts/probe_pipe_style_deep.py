"""
Aggressive probe of the Style property on AeccDbPipe.
Show raw exceptions, traverse sub-objects, and try Civil 3D-specific
property paths we may have missed.
"""

from __future__ import annotations

import sys
import traceback

import win32com.client

PROGID = "AutoCAD.Application.24.3"


def main() -> int:
    app = win32com.client.GetActiveObject(PROGID)
    doc = app.ActiveDocument
    ms = doc.ModelSpace

    pipe = None
    for i in range(ms.Count):
        try:
            ent = ms.Item(i)
        except Exception:
            continue
        if (
            getattr(ent, "Layer", None) == "P-UTIL"
            and getattr(ent, "ObjectName", None) == "AeccDbPipe"
        ):
            pipe = ent
            break
    if pipe is None:
        print("No AeccDbPipe found on P-UTIL.")
        return 1

    print(f"Found pipe ObjectID={pipe.ObjectID}  Desc={pipe.Description!r}")
    print(f"Type repr: {type(pipe).__name__}")
    print()

    candidate_props = [
        "Style", "StyleName", "StyleId",
        "PipeStyle", "PipeStyleName", "PipeStyleId",
        "DisplayStyle", "GraphicsStyle",
        "Name",
        "PartCatalog", "PartCatalogId",
        "Network", "NetworkName", "NetworkId",
        "SystemName", "Domain",
        "PartFamily", "PartFamilyName", "PartFamilyId",
        "PartSubType", "FlowDirection",
        "StartStructure", "EndStructure",
    ]
    print("=== Raw property probe (with exceptions) ===")
    for p in candidate_props:
        try:
            v = getattr(pipe, p)
        except Exception as e:
            print(f"  .{p:30s} EXCEPTION: {type(e).__name__}: {e}")
            continue
        print(f"  .{p:30s} -> type={type(v).__name__}  repr={v!r}")
        # If it's a sub-COM object, traverse one level deeper
        if "COMObject" in str(type(v)) or hasattr(v, "_oleobj_"):
            for sub in ["Name", "DisplayName", "StyleName", "Description"]:
                try:
                    sv = getattr(v, sub)
                    print(f"      .{sub} -> {sv!r}")
                except Exception as e:
                    print(f"      .{sub} EXCEPTION: {type(e).__name__}: {e}")
    print()

    # Try dispatching the Civil 3D AECC API directly to find Style by-name.
    print("=== Try GetInterfaceObject for Civil 3D pipe API ===")
    for progid in [
        "AeccXUiPipe.AeccPipeApplication.13.5",  # Civil 3D 2024
        "AeccXUiPipe.AeccPipeApplication.13.4",
        "AeccXUiPipe.AeccPipeApplication.13.3",
        "AeccXUiPipe.AeccPipeApplication",
    ]:
        try:
            iface = app.GetInterfaceObject(progid)
            print(f"  GetInterfaceObject({progid!r}) -> OK  type={type(iface).__name__}")
            aecc_doc = iface.ActiveDocument
            print(f"  iface.ActiveDocument -> {aecc_doc!r}")
            for prop in ["PipeNetworks", "Networks", "PipeStyles", "StructureStyles"]:
                try:
                    coll = getattr(aecc_doc, prop)
                    cnt = getattr(coll, "Count", "?")
                    print(f"    .{prop}.Count = {cnt}")
                    if isinstance(cnt, int) and cnt > 0:
                        for j in range(min(cnt, 10)):
                            try:
                                item = coll.Item(j)
                                name = getattr(item, "Name", "<no name>")
                                print(f"      [{j}] {name!r}")
                            except Exception as e:
                                print(f"      [{j}] EXCEPTION: {e}")
                except Exception as e:
                    print(f"    .{prop} EXCEPTION: {type(e).__name__}: {e}")
            break
        except Exception as e:
            print(f"  GetInterfaceObject({progid!r}) FAILED: {type(e).__name__}: {e}")

    print()
    # ------------------------------------------------------------------
    # Last resort: read Style via SETPROPERTYVALUE-style invocation
    # ------------------------------------------------------------------
    print("=== Last resort — Invoke via dispatch on _oleobj_ ===")
    try:
        oleobj = pipe._oleobj_
        # Try GetIDsOfNames for "Style"
        from win32com.client import DispatchBaseClass  # noqa: F401
        import pythoncom

        ids = oleobj.GetIDsOfNames("Style")
        print(f"  GetIDsOfNames('Style') -> {ids}")
        val = oleobj.Invoke(ids, 0, pythoncom.DISPATCH_PROPERTYGET, True)
        print(f"  Invoke result type={type(val).__name__} repr={val!r}")
    except Exception as e:
        traceback.print_exc()
    return 0


if __name__ == "__main__":
    sys.exit(main())
