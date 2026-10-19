#!/usr/bin/env python3
"""Subset the self-hosted fonts to only the glyphs the game uses.

Run from anywhere (paths are resolved relative to the project root):

    python3 scripts/subset-fonts.py

Inputs (TTF, SIL OFL 1.1):
    .fontsrc/ZCOOLQingKeHuangYou-Regular.ttf
    .fontsrc/VT323-Regular.ttf

Outputs:
    public/fonts/zcool.woff2|woff
    public/fonts/vt323.woff2|woff
    public/fonts/fonts.json   (records which extension was produced + char count)

WOFF2 is used when the `brotli` module is importable, otherwise WOFF (zlib).
Requires only the stdlib + fontTools.
"""

import json
import os
import sys

from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FONT_SRC_DIR = os.path.join(ROOT, ".fontsrc")
OUT_DIR = os.path.join(ROOT, "public", "fonts")

ZCOOL_SRC = os.path.join(FONT_SRC_DIR, "ZCOOLQingKeHuangYou-Regular.ttf")
VT323_SRC = os.path.join(FONT_SRC_DIR, "VT323-Regular.ttf")

SCAN_EXTS = (".js", ".css", ".html")

PRINTABLE_ASCII = "".join(chr(c) for c in range(0x20, 0x7F))

# Common CJK / typographic punctuation we always want, even if not (yet) used.
ZCOOL_SAFETY = "，。、！？：；（）【】《》“”‘’…—·～￥％"

# Extra glyphs for the pixel/terminal Latin font (missing ones are dropped).
VT323_EXTRA = "°℃%·×→←↑↓▲▼"


def detect_flavor():
    """Return (flavor, extension) depending on whether brotli is available."""
    try:
        import brotli  # noqa: F401

        return "woff2", ".woff2"
    except ImportError:
        return "woff", ".woff"


def iter_source_files():
    """Yield index.html plus every .js/.css/.html file under src/ (recursive)."""
    index_html = os.path.join(ROOT, "index.html")
    if os.path.isfile(index_html):
        yield index_html
    else:
        print("note: index.html not found, skipping", file=sys.stderr)

    src_dir = os.path.join(ROOT, "src")
    if not os.path.isdir(src_dir):
        print("note: src/ not found, skipping", file=sys.stderr)
        return
    for dirpath, dirnames, filenames in os.walk(src_dir):
        dirnames.sort()
        for name in sorted(filenames):
            if name.lower().endswith(SCAN_EXTS):
                yield os.path.join(dirpath, name)


def collect_chars():
    """Return the set of all characters used across the scanned sources."""
    chars = set()
    n_files = 0
    for path in iter_source_files():
        try:
            with open(path, "r", encoding="utf-8") as fh:
                text = fh.read()
        except (OSError, UnicodeDecodeError) as exc:
            print("warning: could not read %s: %s" % (path, exc), file=sys.stderr)
            continue
        n_files += 1
        chars.update(text)
    # Drop control characters (newline, tab, DEL, ...); they need no glyphs.
    chars = {c for c in chars if ord(c) >= 0x20 and ord(c) != 0x7F}
    return chars, n_files


def make_options(flavor):
    options = subset.Options()
    options.flavor = flavor
    options.desubroutinize = True
    options.hinting = False
    options.name_IDs = ["*"]  # keep every name record (license, copyright, ...)
    options.name_languages = ["*"]  # ... in every language
    options.notdef_outline = True
    return options


def subset_font(src, dst, text, flavor):
    options = make_options(flavor)
    font = subset.load_font(src, options)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    subset.save_font(font, dst, options)
    font.close()


def kb(path):
    return os.path.getsize(path) / 1024.0


def main():
    for src in (ZCOOL_SRC, VT323_SRC):
        if not os.path.isfile(src):
            sys.exit("error: missing source font: %s" % src)

    flavor, ext = detect_flavor()
    os.makedirs(OUT_DIR, exist_ok=True)

    chars, n_files = collect_chars()
    non_ascii = {c for c in chars if ord(c) > 0x7F}

    print("Scanned %d source files" % n_files)
    print("Unique chars collected: %d (%d non-ASCII)" % (len(chars), len(non_ascii)))
    print("Output flavor: %s" % flavor)

    zcool_text = "".join(sorted(non_ascii | set(PRINTABLE_ASCII) | set(ZCOOL_SAFETY)))
    vt323_text = "".join(sorted(set(PRINTABLE_ASCII) | set(VT323_EXTRA)))

    zcool_name = "zcool" + ext
    vt323_name = "vt323" + ext
    zcool_out = os.path.join(OUT_DIR, zcool_name)
    vt323_out = os.path.join(OUT_DIR, vt323_name)

    # Remove stale outputs of the other flavor so CSS can't pick up old files.
    for stale_ext in (".woff2", ".woff"):
        if stale_ext == ext:
            continue
        for base in ("zcool", "vt323"):
            stale = os.path.join(OUT_DIR, base + stale_ext)
            if os.path.isfile(stale):
                os.remove(stale)

    subset_font(ZCOOL_SRC, zcool_out, zcool_text, flavor)
    subset_font(VT323_SRC, vt323_out, vt323_text, flavor)

    manifest = {"zcool": zcool_name, "vt323": vt323_name, "chars": len(chars)}
    manifest_path = os.path.join(OUT_DIR, "fonts.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print("ZCOOL subset text: %d chars -> %s (%.1f KB)" % (len(set(zcool_text)), os.path.relpath(zcool_out, ROOT), kb(zcool_out)))
    print("VT323 subset text: %d chars -> %s (%.1f KB)" % (len(set(vt323_text)), os.path.relpath(vt323_out, ROOT), kb(vt323_out)))
    print("Manifest -> %s" % os.path.relpath(manifest_path, ROOT))


if __name__ == "__main__":
    main()
