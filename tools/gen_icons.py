#!/usr/bin/env python3
"""Génère les icônes Casto Tools (assets/icons/icon{16,32,48,128}.png).

Carré bleu Castorama à coins arrondis, "C" blanc, tiret jaune dans
l'ouverture du C — clin d'œil au logo castorama. Aucune dépendance
externe (PNG écrit à la main via zlib), rendu supersamplé 4x.

Usage : python3 tools/gen_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

BLUE = (13, 109, 184)     # --casto-blue
YELLOW = (255, 221, 0)    # --casto-yellow
WHITE = (255, 255, 255)

SIZES = (16, 32, 48, 128)
SS = 4  # facteur de supersampling


def color_at(u, v):
    """Couleur RGBA du point (u, v) dans [0,1]², ou None si transparent."""
    # Carré à coins arrondis
    r = 0.14
    cx = min(max(u, r), 1 - r)
    cy = min(max(v, r), 1 - r)
    if math.hypot(u - cx, v - cy) > r:
        return None

    # Tiret jaune (dans l'ouverture du C, à droite, à mi-hauteur)
    if 0.58 <= u <= 0.90 and 0.425 <= v <= 0.575:
        return YELLOW + (255,)

    # Anneau du "C" : centre légèrement à gauche, ouverture vers la droite
    ccx, ccy, radius, half_t = 0.42, 0.5, 0.26, 0.095
    dx, dy = u - ccx, v - ccy
    dist = math.hypot(dx, dy)
    if abs(dist - radius) <= half_t:
        angle = math.degrees(math.atan2(dy, dx))
        if abs(angle) > 48:  # en dehors de l'ouverture
            return WHITE + (255,)

    return BLUE + (255,)


def render(size):
    buf = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    u = (x + (sx + 0.5) / SS) / size
                    v = (y + (sy + 0.5) / SS) / size
                    c = color_at(u, v)
                    if c:
                        for i in range(4):
                            acc[i] += c[i]
            n = SS * SS
            off = (y * size + x) * 4
            a = acc[3] // n
            if a:
                # couleurs prémultipliées → repassées en droit par l'alpha moyen
                buf[off:off + 4] = bytes((acc[0] // n * 255 // max(a, 1) if a < 255 else acc[0] // n,
                                          acc[1] // n * 255 // max(a, 1) if a < 255 else acc[1] // n,
                                          acc[2] // n * 255 // max(a, 1) if a < 255 else acc[2] // n,
                                          a))
    return buf


def write_png(path, size, rgba):
    def chunk(typ, data):
        return (struct.pack('>I', len(data)) + typ + data
                + struct.pack('>I', zlib.crc32(typ + data) & 0xFFFFFFFF))

    raw = b''.join(b'\x00' + bytes(rgba[y * size * 4:(y + 1) * size * 4])
                   for y in range(size))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    path.write_bytes(png)


def main():
    out_dir = Path(__file__).resolve().parent.parent / 'assets' / 'icons'
    out_dir.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = out_dir / f'icon{size}.png'
        write_png(path, size, render(size))
        print(f'écrit : {path}')


if __name__ == '__main__':
    main()
