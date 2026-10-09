"""Independent structural validator for Spring/Recoil SMF + SMT map files (Python stdlib only).

Usage: python tools/validate/smf.py <map.smf> [<map.smt>]
The SMT defaults to the tile file named in the SMF, next to the SMF. Prints a JSON report.
Exit code: 0 structurally valid, 1 invalid, 2 usage error.
"""
import json
import math
import os
import struct
import sys
from collections import Counter

SMF_MAGIC = b'spring map file\0'
SMT_MAGIC = b'spring tilefile\0'
SMF_HEADER = struct.Struct('<16s7i2f7i')  # 80 bytes
SMF_FIELDS = ('magic version mapid mapx mapy squareSize texelPerSquare tilesize minHeight maxHeight '
              'heightmapPtr typeMapPtr tilesPtr minimapPtr metalmapPtr featurePtr numExtraHeaders').split()
SMT_HEADER = struct.Struct('<16s4i')  # magic, version, numTiles, tileSize, compressionType
FEATURE = struct.Struct('<i5f')  # type, x, y, z, rotation, relativeSize
MINIMAP_BYTES = 699048  # 1024x1024 DXT1 plus 8 mip levels
TILE_BYTES = 680  # 32x32 DXT1 plus 3 mip levels
METAL_PIXEL_ELMOS = 16  # one metal-map pixel covers 2x2 squares of 8 elmos
MEH_VEGETATION = 1  # extra header type holding a grass map pointer


def cstring(buf, off):
    end = buf.index(b'\0', off)  # ValueError when the terminator is missing
    return buf[off:end].decode('latin-1'), end + 1


def check_header(h, errors):
    expected = {'magic': SMF_MAGIC, 'version': 1, 'squareSize': 8, 'texelPerSquare': 8, 'tilesize': 32}
    for key, want in expected.items():
        if h[key] != want:
            errors.append(f'header.{key} is {h[key]!r}, expected {want!r}')
    for key in ('mapx', 'mapy'):
        if h[key] <= 0 or h[key] % 128:
            errors.append(f'header.{key} is {h[key]}, expected a positive multiple of 128')
    for key in ('minHeight', 'maxHeight'):
        if not math.isfinite(h[key]):
            errors.append(f'header.{key} is not a finite number')


def parse_extra_headers(smf, h, sections, errors):
    extra, off = [], SMF_HEADER.size
    for i in range(h['numExtraHeaders']):
        size, kind = struct.unpack_from('<2i', smf, off)
        if size < 8:
            errors.append(f'extraHeaders: header {i} has size {size}, expected at least 8')
            break
        if kind == MEH_VEGETATION:
            (grass_ptr,) = struct.unpack_from('<i', smf, off + 8)
            sections['grassmap'] = (grass_ptr, h['mapx'] // 4 * h['mapy'] // 4)
        extra.append({'type': kind, 'size': size, 'offset': off})
        off += size
    sections['extraHeaders'] = (SMF_HEADER.size, off - SMF_HEADER.size)
    return extra


def parse_tiles(smf, h, sections, errors):
    ptr = h['tilesPtr']
    num_files, num_tiles = struct.unpack_from('<2i', smf, ptr)
    off, files = ptr + 8, []
    for _ in range(num_files):
        (count,) = struct.unpack_from('<i', smf, off)
        name, off = cstring(smf, off + 4)
        files.append({'name': name, 'count': count})
    n = h['mapx'] // 4 * h['mapy'] // 4
    index = struct.unpack_from(f'<{n}i', smf, off)
    sections['tiles'] = (ptr, off + 4 * n - ptr)
    if num_files < 1 or any(not f['name'] for f in files):
        errors.append(f'tiles: {num_files} tile files, expected at least one, each with a name')
    if sum(f['count'] for f in files) != num_tiles:
        errors.append(f'tiles: tile files hold {sum(f["count"] for f in files)} tiles but numTiles is {num_tiles}')
    bad = sum(1 for i in index if not 0 <= i < num_tiles)
    if bad:
        errors.append(f'tiles: {bad} tile indices outside 0..{num_tiles - 1}')
    return {'numTiles': num_tiles, 'files': files, 'indexMin': min(index), 'indexMax': max(index)}


def check_smt(f, declared, errors, warnings, label):
    head = f.read(SMT_HEADER.size)
    size = f.seek(0, os.SEEK_END)
    if len(head) < SMT_HEADER.size:
        errors.append(f'{label}: file is {size} bytes, smaller than the {SMT_HEADER.size}-byte header')
        return {'fileSize': size}
    magic, version, num_tiles, tile_size, compression = SMT_HEADER.unpack(head)
    info = {'magic': magic.decode('latin-1'), 'version': version, 'numTiles': num_tiles,
            'tileSize': tile_size, 'compressionType': compression, 'fileSize': size}
    expected = {'magic': SMT_MAGIC.decode('latin-1'), 'version': 1, 'tileSize': 32, 'compressionType': 1}
    for key, want in expected.items():
        if info[key] != want:
            errors.append(f'{label}: {key} is {info[key]!r}, expected {want!r}')
    if size != SMT_HEADER.size + num_tiles * TILE_BYTES:
        errors.append(f'{label}: file is {size} bytes, expected 32 + {num_tiles} * {TILE_BYTES}')
    if num_tiles < declared:
        errors.append(f'{label}: holds {num_tiles} tiles but the SMF uses {declared}')
    elif num_tiles > declared:
        warnings.append(f'{label}: holds {num_tiles} tiles, the SMF uses only {declared}')
    return info


def parse_features(smf, h, sections, errors):
    ptr = h['featurePtr']
    num_types, num_features = struct.unpack_from('<2i', smf, ptr)
    if num_types < 0 or num_features < 0:
        errors.append(f'features: negative counts ({num_types} types, {num_features} features)')
        return {}
    off, types = ptr + 8, []
    for _ in range(num_types):
        name, off = cstring(smf, off)
        types.append(name)
    records = [FEATURE.unpack_from(smf, off + i * FEATURE.size) for i in range(num_features)]
    sections['features'] = (ptr, off + num_features * FEATURE.size - ptr)
    width, depth = h['mapx'] * 8, h['mapy'] * 8
    bad_type = [r for r in records if not 0 <= r[0] < num_types]
    outside = [r for r in records if not (0 <= r[1] <= width and 0 <= r[3] <= depth)]  # NaN fails too
    if any(not t for t in types):
        errors.append('features: empty feature type name')
    if bad_type:
        errors.append(f'features: {len(bad_type)} features use a type index outside 0..{num_types - 1}')
    if outside:
        errors.append(f'features: {len(outside)} features outside the map (0..{width}, 0..{depth}),'
                      f' first at x={outside[0][1]}, z={outside[0][3]}')
    per_type = Counter(types[r[0]] for r in records if 0 <= r[0] < num_types)
    return {'types': types, 'count': num_features, 'perType': dict(per_type)}


def check_sections(sections, file_size, errors):
    for name, (ptr, size) in sections.items():
        if ptr < SMF_HEADER.size or ptr + size > file_size:
            errors.append(f'{name}: bytes {ptr}..{ptr + size} not inside {SMF_HEADER.size}..{file_size}')
    ordered = sorted(sections.items(), key=lambda s: s[1])  # by offset, empty sections first
    for (a, (pa, sa)), (b, (pb, _)) in zip(ordered, ordered[1:]):
        if pa + sa > pb:
            errors.append(f'{a} (bytes {pa}..{pa + sa}) overlaps {b} (starts at {pb})')


def metal_spots(metal, width, height):
    """8-connected components of non-zero metal-map pixels; x/z are the centroid in elmos."""
    seen = bytearray(len(metal))
    spots = []
    for start, value in enumerate(metal):
        if not value or seen[start]:
            continue
        seen[start] = 1
        stack, pixels, total, sum_x, sum_z = [start], 0, 0, 0, 0
        while stack:
            i = stack.pop()
            z, x = divmod(i, width)
            pixels, total, sum_x, sum_z = pixels + 1, total + metal[i], sum_x + x, sum_z + z
            for nz in (z - 1, z, z + 1):
                for nx in (x - 1, x, x + 1):
                    j = nz * width + nx
                    if 0 <= nx < width and 0 <= nz < height and metal[j] and not seen[j]:
                        seen[j] = 1
                        stack.append(j)
        spots.append({'x': round((sum_x / pixels + 0.5) * METAL_PIXEL_ELMOS),
                      'z': round((sum_z / pixels + 0.5) * METAL_PIXEL_ELMOS),
                      'pixels': pixels, 'sum': total})
    return spots


def validate(smf, open_smt):
    """smf: the SMF bytes. open_smt(tile_file_name) returns a binary file object or raises OSError."""
    errors, warnings = [], []
    report = {'valid': False, 'errors': errors, 'warnings': warnings, 'fileSize': len(smf)}
    if len(smf) < SMF_HEADER.size:
        errors.append(f'file is {len(smf)} bytes, smaller than the {SMF_HEADER.size}-byte header')
        return report
    h = dict(zip(SMF_FIELDS, SMF_HEADER.unpack_from(smf)))
    report['header'] = h | {'magic': h['magic'].decode('latin-1')}
    check_header(h, errors)
    if errors:  # every size below derives from a sane header
        return report

    mapx, mapy = h['mapx'], h['mapy']
    sections = {  # name -> (offset, size)
        'heightmap': (h['heightmapPtr'], (mapx + 1) * (mapy + 1) * 2),
        'typemap': (h['typeMapPtr'], mapx // 2 * mapy // 2),
        'minimap': (h['minimapPtr'], MINIMAP_BYTES),
        'metalmap': (h['metalmapPtr'], mapx // 2 * mapy // 2),
    }
    parsers = {'extraHeaders': parse_extra_headers, 'tiles': parse_tiles, 'features': parse_features}
    for name, parse in parsers.items():
        try:
            report[name] = parse(smf, h, sections, errors)
        except (struct.error, ValueError) as e:
            errors.append(f'{name}: truncated or malformed ({e})')
    check_sections(sections, len(smf), errors)
    report['sections'] = {name: {'offset': p, 'size': s} for name, (p, s) in sections.items()}

    for tile_file in report.get('tiles', {}).get('files', []):
        label = f'smt {tile_file["name"]}'
        try:
            with open_smt(tile_file['name']) as f:
                tile_file['smt'] = check_smt(f, tile_file['count'], errors, warnings, label)
        except OSError as e:
            errors.append(f'{label}: cannot open ({e})')

    ptr, size = sections['metalmap']
    if SMF_HEADER.size <= ptr <= len(smf) - size:
        spots = metal_spots(smf[ptr:ptr + size], mapx // 2, mapy // 2)
        report['metalSpots'] = {'count': len(spots), 'spots': spots}
    report['valid'] = not errors
    return report


def main(argv):
    if len(argv) not in (2, 3):
        print(__doc__, file=sys.stderr)
        return 2
    smf_path = argv[1]
    smt_override = argv[2] if len(argv) == 3 else None

    def open_smt(name):
        # shortcut: an explicit SMT path stands in for every tile file; fine while maps use one SMT.
        return open(smt_override or os.path.join(os.path.dirname(smf_path), name), 'rb')

    try:
        with open(smf_path, 'rb') as f:
            smf = f.read()
    except OSError as e:
        print(json.dumps({'smf': smf_path, 'valid': False, 'errors': [f'cannot open SMF ({e})']}, indent=2))
        return 1
    report = {'smf': os.path.abspath(smf_path), 'smtOverride': smt_override} | validate(smf, open_smt)
    print(json.dumps(report, indent=2))
    return 0 if report['valid'] else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
