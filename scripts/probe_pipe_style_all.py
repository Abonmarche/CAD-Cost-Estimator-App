"""Confirm Style.Name reads cleanly across every AECC entity on P-UTIL."""

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


def style_name(ent) -> str | None:
    style = safe(ent, "Style")
    if style is None:
        return None
    name = safe(style, "Name")
    return name


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
        n = safe(ent, "ObjectName")
        if n == "AeccDbPipe":
            pipes.append(ent)
        elif n == "AeccDbStructure":
            structs.append(ent)

    print(f"=== AeccDbPipe styles on P-UTIL (n={len(pipes)}) ===")
    tally: dict[str, int] = {}
    for i, p in enumerate(pipes):
        s = style_name(p) or "<none>"
        d = safe(p, "Description")
        print(f"  [{i:02d}]  Style.Name={s!r:30s}  Description={d!r}")
        tally[s] = tally.get(s, 0) + 1
    print()
    for s, n in sorted(tally.items(), key=lambda r: -r[1]):
        print(f"  TOTAL  {s:30s} {n}")
    print()

    print(f"=== AeccDbStructure styles on P-UTIL (n={len(structs)}) ===")
    tally2: dict[str, int] = {}
    for i, s in enumerate(structs):
        nm = style_name(s) or "<none>"
        d = safe(s, "Description")
        print(f"  [{i:02d}]  Style.Name={nm!r:35s}  Description={d!r}")
        tally2[nm] = tally2.get(nm, 0) + 1
    print()
    for s, n in sorted(tally2.items(), key=lambda r: -r[1]):
        print(f"  TOTAL  {s:35s} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
