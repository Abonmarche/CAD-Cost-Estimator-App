---
name: costestdb-mcp-guide
description: ALWAYS read this skill before using any costestdb MCP tools (search_pay_items, get_project_summary, list_ingested_projects). Use when the user asks about construction costs, unit prices, bid prices, cost estimates, or "how much does X cost" for civil engineering pay items — including water main, sewer, HMA, pavement, curb and gutter, manhole, catch basin, sidewalk, excavation, aggregate base, or any infrastructure line item. Contains critical terminology mappings (e.g., catch basin → Drainage Structure) and query strategies that dramatically improve search result quality. Without this guide, queries will return poor matches.
---
 
# CostEstDB MCP Query Guide
 
## Tool Reference
 
**`search_pay_items`** -- Primary search tool. Parameters:
- `query` (required): Item description to search. Use MDOT terminology (see table below) for best results.
- `quantity` (float): Target quantity -- triggers closest-quantity match and blended sort.
- `unit` (string): Unit of measure (FT, SYD, SFT, TON, EA, CYD, LS). Filters results to matching units.
- `min_year` (int): Earliest bid year to include.
- `state` / `city` (string): Geographic filters.
- `top_k` (int, default 10): Number of results.
**`get_project_summary`** -- Full bid tab for one project. Pass full or partial project name.
 
**`list_ingested_projects`** -- See all available projects, locations, and item counts. Run first if unsure what data exists.
 
## MDOT Terminology Translation
 
The database contains Michigan DOT (MDOT) bid tabulations. MDOT uses specific nomenclature that differs from common engineering terms.
 
**Important:** The embedding model already expands common abbreviations (HMA, DI, HDPE, Rem, etc.), so natural-language queries enriched with MDOT context often score higher similarity than raw MDOT abbreviations. Use descriptive queries with MDOT item names, not terse codes.
 
| Common Term | MDOT Search Term | Notes |
|---|---|---|
| Catch basin / inlet | `Dr Structure, 48 inch` | MDOT calls these "Drainage Structure." Always include diameter. For new construction, also search `Sanitary Manhole` as some are classified there. |
| Storm sewer | `12 inch storm sewer` or `Sewer, Cl IV` + size | DB does not distinguish storm vs. sanitary in most descriptions. Note ambiguity to user. |
| Sanitary sewer | `Sewer, Cl IV, 12 inch` or `12 inch sanitary sewer` | Both natural language and MDOT codes work well. Add HDPE or Cl IV for specificity. |
| Hot mix asphalt / HMA | `HMA surface course` | Mix codes in DB: 4EML, 5EML, 4EL, 13A, 36A. Use unit=TON. "HMA surface course" finds production-scale items better than "hot mix asphalt." |
| Pavement removal | `remove existing pavement` | Natural language works better than "Pavt, Rem" (sim 0.69 vs 0.51). MDOT description is "Pavt, Rem, Modified". Unit=SYD. |
| Curb and gutter | `concrete curb and gutter` | Detail types: "Det C3" (barrier), "Det C4" (mountable). Unit=FT. Natural language scores high (sim 0.82+). |
| Manhole | `Sanitary Manhole, 48 inch` | Sim 0.93! For storm manholes, also run second search for "Dr Structure, 48 inch". Unit=EA. |
| Water main | `Water Main, DI` + size | "DI" = ductile iron. Use unit=FT. Sparse data: only 1 item for 8" water main. |
| Water service line | `Water Service` + size | Only 2-inch water service in DB. No 6" water service data. |
| Maintenance of traffic | `Traffic Control` | Usually lump sum (LS). MDOT calls it "Traffic Control" not "MOT". |
| Aggregate base | `Aggregate Base, 8 inch` | Unit=SYD. Sim 0.80+ with natural language. |
| Sidewalk | `Sidewalk, Conc, 4 inch` | Unit=SFT. |
| Driveway | `Driveway, Nonreinf Conc, 6 inch` | Unit=SYD. "Driveway replacement concrete" also works well. |
| Excavation | `Excavation, Earth` | Unit=CYD. Natural language "excavation for utilities" works (sim 0.76). |
| Erosion control / silt fence | `Erosion Control, Silt Fence` | Unit=FT. |
| Inlet protection | `Erosion Control, Inlet Protection` | Unit=EA. |
| Cold milling | `Cold Milling HMA Surface` | Unit=SYD. Sim 0.79+. |
| Signal pole / mast arm | `Mast Arm, 40 foot` | Include length. Unit=EA. |
| Mobilization | `Mobilization` | Always lump sum. Stats excluded from price calculations. |
 
## Query Strategy
 
**Good queries** blend descriptive language with MDOT terms, plus size, unit, and quantity:
- "Sanitary Manhole, 48 inch" with unit=EA -- sim 0.93
- "12 inch sanitary sewer" with quantity=500, unit=FT -- sim 0.75
- "HMA surface course" with quantity=2000, unit=TON -- sim 0.70
- "remove existing pavement" with unit=SYD -- sim 0.69
**Bad queries** use vague natural language without parameters:
- "How much do catch basins cost?" (wrong term, no unit)
- "What's hot mix going for?" (vague, no quantity/unit)
**Key insight:** Natural language often scores higher than raw MDOT abbreviations because the embedding model expands abbreviations internally. "remove existing pavement" outscores "Pavt, Rem" (0.69 vs 0.51). Use descriptive queries enriched with MDOT item names.
 
**Strategy:**
1. Translate the user's term using the table above
2. Search with descriptive natural language + MDOT item name, always setting unit
3. If the item might be classified differently (e.g., catch basin vs. drainage structure vs. manhole), run parallel searches
4. If similarity is low (<0.65), try a broader query without size specification
## Interpreting Results
 
**Similarity scores:**
- 0.75+ : Strong match -- high confidence in relevance
- 0.65-0.75 : Good match -- results likely relevant
- 0.50-0.65 : Weak match -- review descriptions carefully, may be adjacent items
- Below 0.50 : Poor match -- results probably not what was asked for. Warn the user.
**Engineer's Estimate (EE):** Bids marked "(EE)" are the engineer's pre-bid estimate, not contractor pricing. Report separately from contractor bids.
 
**Throw-away bid filtering:** Bids below 10% of median are automatically excluded from statistics. Very low bids ($0.01, $1.00) are typically placeholder/throw-away bids.
 
**Closest quantity match:** When quantity is provided, the system finds the item with the nearest quantity and shows all bids for that item. This gives the most directly comparable pricing.
 
**Lump sum items:** Items with unit=LS are excluded from price statistics since they aren't unit-price comparable. Report the raw bid amounts instead.
 
**Low confidence flag:** If no results exceed similarity 0.65, stats are computed from all results but marked low-confidence. Warn the user.
 
## Known Data Gaps
 
The database covers 23 Michigan projects (2024-2026). These items have **no or extremely limited data** -- warn the user rather than presenting low-relevance results:
 
- **Geotextile / fabric:** 0 items in database
- **Temporary barriers (concrete/jersey):** 0 items
- **6-inch water service line:** Only 2-inch available
- **8-inch water main:** Only 1 item (Harbor Shores, 2545 FT)
- **Guardrail:** Very limited data
- **Landscaping / seeding:** Sparse coverage
When a query hits a known gap, say so explicitly rather than returning unrelated results.
 
## Response Pattern
 
When presenting results to an engineer:
1. State what was searched and how many relevant matches were found
2. Report price range, median, and engineer's estimate (if available)
3. Highlight the closest quantity match if quantity was provided
4. Note any data limitations (sparse data, storm/sanitary ambiguity, low similarity)
5. Flag if results span a wide price range and explain likely causes (quantity variation, geographic differences, bid year)
6. Suggest follow-up searches if initial results are incomplete (e.g., "also try Dr Structure for catch basins")