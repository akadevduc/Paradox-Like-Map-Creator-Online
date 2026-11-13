#!/usr/bin/env python3
"""
EU4: recopila dos cosas y las guarda en archivos separados.

  "EU4_countries.json"  ->  { "SWE": [r, g, b], ... }   (tag -> color)
  "EU4_water.json"     ->  [1, 2, 3, ...]              (IDs de provincias de mar y lagos)

Uso:
    python build_countries_eu4.py
"""

import glob
import json
import os
import re

# ----------------------------------------------------------------------
# CONFIGURACIÓN: editá las rutas
# ----------------------------------------------------------------------
# Carpetas que contienen "common/" y "map/". Si usás un mod, agregalo
# DESPUÉS del juego base: lo que tenga el mod pisa lo del base.
ROOTS = [
    r"C:\Program Files (x86)\Steam\steamapps\common\Europa Universalis IV",
    # r"C:\RUTA\A\mod\MiMod",
]

OUTPUT_COUNTRIES = "EU4_countries.json"
OUTPUT_WATER = "EU4_water.json"
OUTPUT_LISTS = "eu4_lists.json"
OUTPUT_PROVINCES = "EU4_provinces.json"
DEFAULT_PAINT = [128, 128, 128]   # tu colorInicial
WATER_PAINT   = [10, 10, 60]      # tu waterColor.rgb
# ----------------------------------------------------------------------

TAG_FILES = "common/country_tags/*.txt"

# SWE = "countries/Sweden.txt"
TAG_RE = re.compile(r'^[ \t]*([A-Za-z0-9_]{3})[ \t]*=[ \t]*"([^"]+)"', re.MULTILINE)

# color = { 0 80 160 }   (no matchea map_color, revolutionary_colors, etc.)
COLOR_RE = re.compile(r"(?<![A-Za-z0-9_])color\s*=\s*\{\s*(\d+)\s+(\d+)\s+(\d+)\s*\}")

# sea_starts = { 1 2 3 ... }   /   lakes = { 4 5 6 ... }
WATER_RE = re.compile(r"(?<![A-Za-z0-9_])(sea_starts|lakes)\s*=\s*\{([^}]*)\}")


def read_text(path):
    """Los archivos de Paradox suelen venir en Windows-1252, a veces en UTF-8."""
    with open(path, "rb") as f:
        raw = f.read()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def strip_comments(text):
    return re.sub(r"#[^\n]*", "", text)


def parse_tags(text):
    """Devuelve {TAG: ruta_relativa_a_common}."""
    return {m.group(1): m.group(2) for m in TAG_RE.finditer(strip_comments(text))}


def find_color(text):
    """Primer color = { r g b } que esté en el nivel raíz del archivo."""
    text = strip_comments(text)
    for m in COLOR_RE.finditer(text):
        depth = text.count("{", 0, m.start()) - text.count("}", 0, m.start())
        if depth == 0:
            return [int(m.group(1)), int(m.group(2)), int(m.group(3))]
    return None


def resolve_country_file(roots, rel):
    """Busca el archivo del país empezando por el último root (mod gana sobre base)."""
    rel = rel.replace("/", os.sep).replace("\\", os.sep)
    for root in reversed(roots):
        path = os.path.join(root, "common", rel)
        if os.path.isfile(path):
            return path
    return None


def find_water(roots):
    """IDs de mar y lagos desde map/default.map (el del último root que lo tenga)."""
    for root in reversed(roots):
        path = os.path.join(root, "map", "default.map")
        if os.path.isfile(path):
            text = strip_comments(read_text(path))
            ids = set()
            for m in WATER_RE.finditer(text):
                ids.update(int(n) for n in re.findall(r"\d+", m.group(2)))
            return sorted(ids)
    return None

def top_level(text):
    """Texto sin lo que está adentro de llaves (deja solo las claves de primer nivel)."""
    out, depth = [], 0
    for ch in text:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        elif depth == 0:
            out.append(ch)
    return "".join(out)


HISTORY_RE = re.compile(r'(?m)^\s*(base_tax|base_production|base_manpower|trade_goods|religion|culture)\s*=\s*"?([^\s"#]+)')


def load_history(roots):
    """Valores iniciales de cada provincia desde history/provinces (los roots posteriores pisan)."""
    result = {}
    for root in roots:
        for path in glob.glob(os.path.join(root, "history", "provinces", "*.txt")):
            m = re.match(r"\s*(\d+)", os.path.basename(path))
            if not m:
                continue
            text = top_level(strip_comments(read_text(path)))
            result[int(m.group(1))] = {k: v for k, v in HISTORY_RE.findall(text)}
    return result


def to_int(value):
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return 0

def build_provinces(roots, water):
    """EU4_provinces.json en el formato de tu loadMapProvinces, con los IDs reales de EU4."""
    path = None
    for root in reversed(roots):
        p = os.path.join(root, "map", "definition.csv")
        if os.path.isfile(p):
            path = p
            break
    if path is None:
        return None

    water = set(water or [])
    history = load_history(roots)
    rows = []
    for line in read_text(path).splitlines():
        parts = line.split(";")
        if len(parts) < 4 or not parts[0].strip().isdigit():
            continue                      # encabezado o línea rara
        pid = int(parts[0])
        if pid == 0:
            continue                      # el 0 sería color 0 = "océano" en tu createBaseMap
        r, g, b = int(parts[1]), int(parts[2]), int(parts[3])
        name = parts[4].strip() if len(parts) > 4 else ""
        if not name or name == "x":
            name = f"Provincia {pid}"

        is_water = pid in water
        h = history.get(pid, {})
        entry = {
            "name": name,
            "owner": None,
            "paintColor": WATER_PAINT if is_water else DEFAULT_PAINT,
            "colorKey": (r << 16) | (g << 8) | b,
            "isWater": is_water,
            "tradeGoods": h.get("trade_goods"),
            "baseTax": to_int(h.get("base_tax")),
            "baseProduction": to_int(h.get("base_production")),
            "baseManpower": to_int(h.get("base_manpower")),
            "religion": h.get("religion"),
            "culture": h.get("culture"),
        }
        rows.append(f'    "{pid}": {json.dumps(entry, ensure_ascii=False)}')
    return rows

BLOCK_RE = re.compile(r"(?m)^[ \t]*([A-Za-z0-9_.\-']+)[ \t]*=[ \t]*\{")
LOC_RE = re.compile(r'^\s*([A-Za-z0-9_.\-\']+):\d*\s+"(.*)"\s*(?:#.*)?$')
NON_CULTURE_KEYS = {"male_names", "female_names", "dynasty_names", "country", "province"}


def blocks_at_depth(text, target_depth=0):
    """[(clave, interior)] de los bloques `clave = { ... }` que están a esa profundidad."""
    result = []
    for m in BLOCK_RE.finditer(text):
        if text.count("{", 0, m.start()) - text.count("}", 0, m.start()) != target_depth:
            continue
        open_pos = m.end() - 1
        depth, i = 0, open_pos
        while i < len(text):
            c = text[i]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        result.append((m.group(1), text[open_pos + 1:i]))
    return result


def load_localisation(roots):
    """clave -> texto en inglés, desde localisation/**/*_l_english.yml"""
    loc = {}
    for root in roots:
        pattern = os.path.join(root, "localisation", "**", "*_l_english.yml")
        for path in glob.glob(pattern, recursive=True):
            for line in read_text(path).splitlines():
                m = LOC_RE.match(line)
                if m:
                    loc[m.group(1)] = m.group(2)
    return loc


def build_lists(roots):
    """Bienes comerciales, religiones y culturas (id + nombre) para los desplegables."""
    def texts(sub):
        for root in roots:
            for path in sorted(glob.glob(os.path.join(root, "common", sub, "*.txt"))):
                yield strip_comments(read_text(path))

    goods, religions, cultures = [], [], []
    for text in texts("tradegoods"):
        goods += [key for key, _ in blocks_at_depth(text)]
    for text in texts("religions"):
        for _, group in blocks_at_depth(text):
            for key, inner in blocks_at_depth(group):
                if re.search(r"\bicon\s*=", top_level(inner)):
                    religions.append(key)
    for text in texts("cultures"):
        for _, group in blocks_at_depth(text):
            for key, _ in blocks_at_depth(group):
                if key not in NON_CULTURE_KEYS:
                    cultures.append(key)

    loc = load_localisation(roots)

    def named(ids):
        items = [{"id": i, "name": loc.get(i) or i.replace("_", " ").title()} for i in dict.fromkeys(ids)]
        return sorted(items, key=lambda it: it["name"].lower())

    return {"tradeGoods": named(goods), "religions": named(religions), "cultures": named(cultures)}

def preview(items, n=15):
    return ", ".join(items[:n]) + (" ..." if len(items) > n else "")


def build_countries(roots):
    # 1) tags (los roots posteriores pisan a los anteriores)
    tags = {}
    for root in roots:
        for path in sorted(glob.glob(os.path.join(root, TAG_FILES))):
            tags.update(parse_tags(read_text(path)))
    print(f"{len(tags)} tags encontrados")

    # 2) color de cada tag
    colors = {}
    no_file, no_color = [], []
    for tag, rel in tags.items():
        path = resolve_country_file(roots, rel)
        if path is None:
            no_file.append(tag)
            continue
        color = find_color(read_text(path))
        if color is None:
            no_color.append(tag)
            continue
        colors[tag] = color

    if no_file:
        print(f"[!] {len(no_file)} tags sin archivo: {preview(no_file)}")
    if no_color:
        print(f"[!] {len(no_color)} tags sin color legible: {preview(no_color)}")
    print(f"{len(colors)} colores guardados")
    return colors


def save_countries(colors, path):
    # un tag por línea, más fácil de revisar a mano
    rows = [f'  "{tag}": {json.dumps(colors[tag])}' for tag in sorted(colors)]
    with open(path, "w", encoding="utf-8") as f:
        f.write("{\n" + ",\n".join(rows) + "\n}\n")
    print(f"Listo: {path}")


def save_water(water, path):
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(water) + "\n")
    print(f"Listo: {path}")


def main():
    roots = [r for r in ROOTS if os.path.isdir(r)]
    for r in ROOTS:
        if r not in roots:
            print(f"[!] No existe la carpeta: {r}")
    if not roots:
        print("Ninguna carpeta válida, revisá ROOTS.")
        return

    print("Países:")
    colors = build_countries(roots)
    if colors:
        save_countries(colors, OUTPUT_COUNTRIES)
    else:
        print("[!] No se generaron colores, no se guarda countries.")

        print("\nAgua:")
    water = find_water(roots)
    if water is None:
        print("[!] No se encontró map/default.map, no se guarda water.")
    elif not water:
        print("[!] default.map no tiene sea_starts ni lakes legibles, no se guarda water.")
    else:
        print(f"{len(water)} provincias de agua (mar + lagos)")
        save_water(water, OUTPUT_WATER)

    rows = build_provinces(roots, water)
    if rows is None:
        print("[!] No se encontró map/definition.csv, no se guarda provinces.")
    else:
        with open(OUTPUT_PROVINCES, "w", encoding="utf-8") as f:
            f.write('{\n  "mapType": "EU4",\n  "provinces": {\n' + ",\n".join(rows) + '\n  }\n}\n')
        print(f"{len(rows)} provincias -> {OUTPUT_PROVINCES}")
    lists = build_lists(roots)
    with open(OUTPUT_LISTS, "w", encoding="utf-8") as f:
        json.dump(lists, f, ensure_ascii=False, indent=1)
    print(f"{len(lists['tradeGoods'])} bienes, {len(lists['religions'])} religiones, "
          f"{len(lists['cultures'])} culturas -> {OUTPUT_LISTS}")



if __name__ == "__main__":
    main()