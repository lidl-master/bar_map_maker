"""Tests for tools/validate/smf.py. Run: python -m unittest discover -s tests/tools -p "test_*.py" """
import io
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

VALIDATOR = Path(__file__).resolve().parents[2] / 'tools' / 'validate' / 'smf.py'
sys.path.insert(0, str(VALIDATOR.parent))
import smf  # noqa: E402

MAPX = MAPY = 128
N_TILES = 4
SMT_NAME = 'tiny.smt'
# (x, z, value) metal pixels: a 2x2 block plus a diagonal neighbour (one 8-connected spot), and a lone pixel
METAL = ((10, 10, 10), (11, 10, 10), (10, 11, 10), (11, 11, 10), (12, 12, 5), (40, 40, 7))


def build_map():
    """A tiny valid 128x128-square map. Returns (smf bytearray, smt bytes, section offsets)."""
    metal = bytearray(MAPX // 2 * MAPY // 2)
    for x, z, value in METAL:
        metal[z * MAPX // 2 + x] = value
    n_index = MAPX // 4 * MAPY // 4
    tiles = (struct.pack('<3i', 1, N_TILES, N_TILES) + SMT_NAME.encode() + b'\0'
             + struct.pack(f'<{n_index}i', *(i % N_TILES for i in range(n_index))))
    features = (struct.pack('<2i', 1, 2) + b'GeoVent\0'
                + smf.FEATURE.pack(0, 100.0, 0.0, 200.0, 0.0, 1.0) + smf.FEATURE.pack(0, 512.0, 0.0, 512.0, 0.0, 1.0))
    body = {'heightmap': bytes((MAPX + 1) * (MAPY + 1) * 2), 'typemap': bytes(MAPX // 2 * MAPY // 2),
            'minimap': bytes(smf.MINIMAP_BYTES), 'metalmap': bytes(metal), 'tiles': tiles, 'features': features}
    offsets, off = {}, smf.SMF_HEADER.size
    for name, part in body.items():
        offsets[name] = off
        off += len(part)
    header = smf.SMF_HEADER.pack(smf.SMF_MAGIC, 1, 1234, MAPX, MAPY, 8, 8, 32, 0.0, 100.0,
                                 offsets['heightmap'], offsets['typemap'], offsets['tiles'],
                                 offsets['minimap'], offsets['metalmap'], offsets['features'], 0)
    smt = smf.SMT_HEADER.pack(smf.SMT_MAGIC, 1, N_TILES, 32, 1) + bytes(N_TILES * smf.TILE_BYTES)
    return bytearray(header + b''.join(body.values())), smt, offsets


def validate(smf_bytes, smt):
    def open_smt(name):
        if name != SMT_NAME:
            raise FileNotFoundError(name)
        return io.BytesIO(smt)
    return smf.validate(bytes(smf_bytes), open_smt)


class ValidMap(unittest.TestCase):
    def test_valid_map_reports_no_errors(self):
        report = validate(*build_map()[:2])
        self.assertEqual(report['errors'], [])
        self.assertTrue(report['valid'])
        self.assertEqual(report['features'], {'types': ['GeoVent'], 'count': 2, 'perType': {'GeoVent': 2}})
        self.assertEqual(report['tiles']['files'][0]['smt']['numTiles'], N_TILES)

    def test_metal_spots_are_8_connected_components(self):
        spots = validate(*build_map()[:2])['metalSpots']
        self.assertEqual(spots['count'], 2)
        self.assertEqual(spots['spots'][0], {'x': 181, 'z': 181, 'pixels': 5, 'sum': 45})
        self.assertEqual(spots['spots'][1], {'x': 648, 'z': 648, 'pixels': 1, 'sum': 7})


class BrokenMaps(unittest.TestCase):
    def assertError(self, report, fragment):
        self.assertFalse(report['valid'])
        self.assertTrue(any(fragment in e for e in report['errors']), report['errors'])

    def test_bad_magic(self):
        data, smt, _ = build_map()
        data[0:6] = b'broken'
        self.assertError(validate(data, smt), 'header.magic')

    def test_map_size_not_multiple_of_128(self):
        data, smt, _ = build_map()
        struct.pack_into('<i', data, 24, 100)  # mapx
        self.assertError(validate(data, smt), 'header.mapx')

    def test_tile_index_out_of_range(self):
        data, smt, off = build_map()
        struct.pack_into('<i', data, off['tiles'] + 12 + len(SMT_NAME) + 1, N_TILES)
        self.assertError(validate(data, smt), '1 tile indices outside 0..3')

    def test_truncated_smt(self):
        data, smt, _ = build_map()
        self.assertError(validate(data, smt[:-10]), 'expected 32 + 4 * 680')

    def test_smt_with_fewer_tiles_than_smf_uses(self):
        data, _, _ = build_map()
        smt = smf.SMT_HEADER.pack(smf.SMT_MAGIC, 1, 2, 32, 1) + bytes(2 * smf.TILE_BYTES)
        self.assertError(validate(data, smt), 'holds 2 tiles but the SMF uses 4')

    def test_missing_smt(self):
        data, smt, off = build_map()
        data[off['tiles'] + 12] = ord('X')  # tile file name no longer matches
        self.assertError(validate(data, smt), 'cannot open')

    def test_feature_outside_map(self):
        data, smt, off = build_map()
        struct.pack_into('<f', data, off['features'] + 8 + len(b'GeoVent\0') + 4, 5000.0)  # first feature x
        self.assertError(validate(data, smt), '1 features outside the map')

    def test_truncated_smf(self):
        data, smt, _ = build_map()
        self.assertError(validate(data[:-30], smt), 'features')

    def test_section_pointer_past_end_of_file(self):
        data, smt, _ = build_map()
        struct.pack_into('<i', data, 68, len(data))  # metalmapPtr
        self.assertError(validate(data, smt), 'metalmap: bytes')


class CommandLine(unittest.TestCase):
    def run_cli(self, data, smt):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'tiny.smf').write_bytes(data)
            Path(tmp, SMT_NAME).write_bytes(smt)
            return subprocess.run([sys.executable, '-I', str(VALIDATOR), str(Path(tmp, 'tiny.smf'))],
                                  capture_output=True, text=True)

    def test_exit_code_and_json(self):
        data, smt, _ = build_map()
        ok = self.run_cli(data, smt)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertTrue(json.loads(ok.stdout)['valid'])
        data[0:6] = b'broken'
        bad = self.run_cli(data, smt)
        self.assertEqual(bad.returncode, 1, bad.stderr)
        self.assertFalse(json.loads(bad.stdout)['valid'])


if __name__ == '__main__':
    unittest.main()
