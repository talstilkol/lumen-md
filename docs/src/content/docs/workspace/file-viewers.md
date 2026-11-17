---
title: Notebooks, data files and maps
description: Jupyter notebooks, CSV/TSV/JSON/YAML/XLSX files and GeoJSON/GPX tracks open in a viewer of their own, without converting them.
type: how-to
tasks: ["W12.F4"]
---

Some files in your vault open in a viewer instead of the editor. Each viewer
has **Open as text**, and the notebook and data viewers have **Convert to
note**, which does the same conversion as before.

## Jupyter notebooks (`.ipynb`)

The notebook is shown as it was saved: markdown cells rendered, code cells
highlighted with their `[n]` execution count, and the outputs. Outputs
include text, errors (without colour codes), PNG and JPEG images, SVG and
HTML tables.

**Nothing runs.** SVG and HTML go through the app's sanitizer before they
are shown, which removes `<script>`, event handlers and `javascript:` links.
JavaScript and widget outputs are shown as code and labelled as not run.

## Data files (`.csv`, `.tsv`, `.json`, `.yaml`, `.xlsx`)

A data file opens as a table, one row per record, or as a board grouped by
any column. Records with no value go under *None*. Only the rows on screen
are drawn, so a file of 10,000 rows opens at once.

- **Edit** a cell with Enter or F2, or by double-clicking it. The change is
  written to the file straight away.
- **CSV and TSV:** only the edited row changes. The rest of the file,
  including its quoting and line endings, stays byte for byte.
- **YAML:** comments are kept.
- **JSON:** an array of objects, rewritten with the file's own indentation.
- **XLSX** (the first sheet) and records with nested values are read only.

## Maps (`.geojson`, `.gpx`)

GeoJSON (RFC 7946) and GPX 1.1 open on a map. In GPX, waypoints become
points, and each track segment and each route becomes a line. A table
beside the map lists every feature with its position or its length in km.

The map's background comes from OpenStreetMap, and loading it is the only
request a map makes. **In airplane mode no background is requested:** the
map shows its shapes on a blank background. This also applies to the
`map` block and to the map view of databases.
