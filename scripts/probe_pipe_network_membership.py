"""
Round 4 — figure out how to tell sanitary pipes apart from storm pipes when
they share a layer (P-UTIL on the active drawing).

Strategy:
  1. Enumerate doc.AeccPipeNetworks (if exposed via COM) and list each
     network's name + pipe count + a sample pipe's Description.
  2. For each AeccDbPipe on layer P-UTIL, try to read NetworkName /
     Network / Domain / SystemName / PartFamilyName to see which (if any)
     of these the pipe itself surfaces.
  3. Sanity check: do all 22 pipes have a Description that contains a
     keyword we could fall back on if the network info is unavailable?
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

    # ------------------------------------------------------------------
    # 1. Walk the Pipe Networks collection on the document (Civil 3D).
    # The COM property name varies by Civil 3D version. Try the common ones.
    # ------------------------------------------------------------------
    print("=== Pipe networks on document (via COM) ===")
    networks_collection = None
    for prop in [
        "AeccPipeNetworks",
        "PipeNetworks",
        "Networks",
    ]:
        coll = safe(doc, prop)
        if coll is not None:
            print(f"  doc.{prop} -> {coll}")
            networks_collection = coll
            break
        # Maybe it's on doc.AeccDocument or similar
    if networks_collection is None:
        # Try the Civil 3D doc wrapper paths
        for prop in ["AeccDocument", "AeccApplication"]:
            sub = safe(doc, prop) or safe(app, prop)
            if sub is not None:
                print(f"  Found wrapper: {prop} -> {sub}")
                for sub_prop in ["PipeNetworks", "AeccPipeNetworks"]:
                    coll = safe(sub, sub_prop) or try_call(sub, sub_prop)
                    if coll is not None:
                        print(f"    -> .{sub_prop} -> {coll}")
                        networks_collection = coll
                        break
                if networks_collection is not None:
                    break

    if networks_collection is None:
        print("  (could not locate a pipe-networks collection on this doc)")
    else:
        try:
            cnt = safe(networks_collection, "Count")
            print(f"  Network count: {cnt}")
            if isinstance(cnt, int):
                for i in range(cnt):
                    try:
                        net = networks_collection.Item(i)
                    except Exception as e:
                        print(f"    [{i}] Item() failed: {e}")
                        continue
                    name = safe(net, "Name", "<no name>")
                    desc = safe(net, "Description", "")
                    print(f"    [{i}] name={name!r}  desc={desc!r}")
                    for prop in ["Pipes", "Structures"]:
                        sub = safe(net, prop)
                        sub_cnt = safe(sub, "Count") if sub is not None else None
                        print(f"        .{prop}.Count = {sub_cnt}")
        except Exception as e:
            print(f"  iteration failed: {e}")
    print()

    # ------------------------------------------------------------------
    # 2. For each AeccDbPipe on P-UTIL, dump every property that might
    #    surface its parent network or system.
    # ------------------------------------------------------------------
    print("=== Per-pipe network / system properties (P-UTIL) ===")
    candidate_props = [
        "NetworkName", "Network", "ParentNetwork",
        "SystemName", "System",
        "Domain", "DomainName",
        "PartFamilyName", "PartFamily",
        "PartCatalog",
        "Description",
        "PartSizeName",
    ]
    pipes = []
    for i in range(ms.Count):
        try:
            ent = ms.Item(i)
        except Exception:
            continue
        if safe(ent, "Layer") == "P-UTIL" and safe(ent, "ObjectName") == "AeccDbPipe":
            pipes.append(ent)
    print(f"Found {len(pipes)} pipes on P-UTIL")
    print()
    for i, p in enumerate(pipes):
        line = [f"[{i:02d}]"]
        for prop in candidate_props:
            v = safe(p, prop)
            if v is None or callable(v):
                v = try_call(p, prop)
            if v is None:
                continue
            sv = str(v)
            if len(sv) > 40:
                sv = sv[:37] + "..."
            line.append(f"{prop}={sv!r}")
        print("  " + "  ".join(line))

    # ------------------------------------------------------------------
    # 3. Tally Description keywords as a fallback hint.
    # ------------------------------------------------------------------
    print()
    print("=== Description keyword tally (fallback signal) ===")
    desc_buckets: dict[str, int] = {}
    for p in pipes:
        d = (safe(p, "Description") or "").lower()
        key = "?"
        for kw, label in [
            ("san", "SANITARY"),
            ("storm", "STORM"),
            ("rcp", "STORM (RCP)"),
            ("sdr 35", "SANITARY (SDR 35 typical)"),
            ("sdr-35", "SANITARY (SDR 35 typical)"),
        ]:
            if kw in d:
                key = label
                break
        desc_buckets[key] = desc_buckets.get(key, 0) + 1
    for k, n in sorted(desc_buckets.items(), key=lambda r: -r[1]):
        print(f"  {k:30s} {n}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
