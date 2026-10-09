'use strict';
// File I/O: CRC32, ZIP writer, PNG encode/decode (incl. 16-bit), project save/load, autosave.
var BMM = window.BMM || (window.BMM = {});

(function () {
  // ------------------------------------------------------------------ CRC32
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(data, crc) {
    let c = (crc === undefined ? 0 : crc) ^ 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  async function streamBytes(data, stream) {
    const s = new Blob([data]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const canCompress = typeof CompressionStream !== 'undefined';
  async function deflateRaw(data) { return streamBytes(data, new CompressionStream('deflate-raw')); }
  async function zlibDeflate(data) { return streamBytes(data, new CompressionStream('deflate')); }
  async function zlibInflate(data) { return streamBytes(data, new DecompressionStream('deflate')); }
  async function gzip(data) { return streamBytes(data, new CompressionStream('gzip')); }
  async function gunzip(data) { return streamBytes(data, new DecompressionStream('gzip')); }

  // ------------------------------------------------------------------ ZIP writer
  // files: [{ name, data: Uint8Array }]. Uses deflate when available (and worthwhile).
  async function makeZip(files, onProgress) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (let fi = 0; fi < files.length; fi++) {
      const f = files[fi];
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      let method = 0, body = f.data;
      if (canCompress && f.data.length > 64) {
        try {
          const c = await deflateRaw(f.data);
          if (c.length < f.data.length * 0.95) { method = 8; body = c; }
        } catch (e) { /* store */ }
      }
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, method, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, f.data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, body);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true); ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true);
      ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + body.length;
      if (onProgress) onProgress((fi + 1) / files.length);
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  // ------------------------------------------------------------------ PNG
  // channels: 1 (gray), 3 (rgb), 4 (rgba); data: Uint8Array or Uint16Array (16-bit).
  async function encodePNG(width, height, channels, data) {
    const bit16 = data instanceof Uint16Array;
    const bpp = channels * (bit16 ? 2 : 1);
    const stride = width * bpp;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      const o = y * (stride + 1);
      raw[o] = 0;
      if (bit16) {
        for (let x = 0; x < width * channels; x++) {
          const v = data[y * width * channels + x];
          raw[o + 1 + x * 2] = v >> 8; raw[o + 2 + x * 2] = v & 255;
        }
      } else {
        raw.set(data.subarray(y * stride, (y + 1) * stride), o + 1);
      }
    }
    const idat = await zlibDeflate(raw);
    const colorType = channels === 1 ? 0 : channels === 3 ? 2 : channels === 4 ? 6 : 4;
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width); dv.setUint32(4, height);
    ihdr[8] = bit16 ? 16 : 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
    return new Blob(chunks, { type: 'image/png' });
  }
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  // Decode non-interlaced PNG (gray/rgb/gray+a/rgba, 8 or 16 bit) into a single
  // luminance Float32Array in [0, 1]. Returns null if unsupported (caller falls back to canvas).
  async function decodePNGLuminance(buf) {
    const u8 = new Uint8Array(buf);
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (u8[i] !== sig[i]) return null;
    const dv = new DataView(buf);
    let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
    const idats = [];
    while (pos < u8.length) {
      const len = dv.getUint32(pos), type = String.fromCharCode(u8[pos + 4], u8[pos + 5], u8[pos + 6], u8[pos + 7]);
      const d = u8.subarray(pos + 8, pos + 8 + len);
      if (type === 'IHDR') { w = dv.getUint32(pos + 8); h = dv.getUint32(pos + 12); depth = d[8]; ctype = d[9]; interlace = d[12]; }
      else if (type === 'IDAT') idats.push(d);
      else if (type === 'IEND') break;
      pos += 12 + len;
    }
    const chans = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
    if (!chans || interlace || (depth !== 8 && depth !== 16)) return null;
    const total = idats.reduce((s, d) => s + d.length, 0);
    const z = new Uint8Array(total);
    let o = 0; for (const d of idats) { z.set(d, o); o += d.length; }
    const raw = await zlibInflate(z);
    const bpp = chans * depth / 8, stride = w * bpp;
    const img = new Uint8Array(stride * h);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)];
      const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      const cur = img.subarray(y * stride, (y + 1) * stride);
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
        let v = line[x];
        switch (f) {
          case 1: v += a; break;
          case 2: v += b; break;
          case 3: v += (a + b) >> 1; break;
          case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; break; }
        }
        cur[x] = v & 255;
      }
      prev = cur;
    }
    const out = new Float32Array(w * h);
    const max = depth === 16 ? 65535 : 255;
    const colorCh = chans >= 3 ? 3 : 1;
    for (let i = 0; i < w * h; i++) {
      let s = 0;
      for (let c = 0; c < colorCh; c++) {
        const off = i * bpp + c * (depth / 8);
        s += depth === 16 ? (img[off] << 8) | img[off + 1] : img[off];
      }
      out[i] = s / colorCh / max;
    }
    return { width: w, height: h, data: out, depth };
  }

  async function decodeImageLuminance(file) {
    const buf = await file.arrayBuffer();
    try {
      const png = await decodePNGLuminance(buf);
      if (png) return png;
    } catch (e) { console.warn('PNG decode failed, falling back to canvas', e); }
    const bmp = await createImageBitmap(new Blob([buf]));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const out = new Float32Array(c.width * c.height);
    for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 765;
    return { width: c.width, height: c.height, data: out, depth: 8 };
  }

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  // ------------------------------------------------------------------ Project files
  // Layout: "BMMP" | u32 version | u32 jsonLength | json | heights f32 | paintId u8 | paintW u8, gzipped.
  function serializeProject(map) {
    const meta = {
      sx: map.sx, sz: map.sz, symmetry: map.symmetry, settings: map.settings, texture: map.texture,
      objects: map.objects, nextId: map.nextId, nextGroup: map.nextGroup,
    };
    const json = new TextEncoder().encode(JSON.stringify(meta));
    const n = map.W * map.H;
    const out = new Uint8Array(12 + json.length + n * 6);
    const dv = new DataView(out.buffer);
    out.set([66, 77, 77, 80], 0);
    dv.setUint32(4, 1, true); dv.setUint32(8, json.length, true);
    out.set(json, 12);
    let o = 12 + json.length;
    out.set(new Uint8Array(map.heights.buffer, map.heights.byteOffset, n * 4), o); o += n * 4;
    out.set(map.paintId, o); o += n;
    out.set(map.paintW, o);
    return out;
  }
  function deserializeProject(bytes) {
    if (bytes[0] !== 66 || bytes[1] !== 77 || bytes[2] !== 77 || bytes[3] !== 80) throw new Error('Not a BAR Map Maker project file');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jl = dv.getUint32(8, true);
    const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + jl)));
    const map = new BMM.MapData(meta.sx, meta.sz);
    const n = map.W * map.H;
    let o = 12 + jl;
    map.heights.set(new Float32Array(bytes.slice(o, o + n * 4).buffer)); o += n * 4;
    map.paintId.set(bytes.subarray(o, o + n)); o += n;
    map.paintW.set(bytes.subarray(o, o + n));
    map.symmetry = meta.symmetry || 'none';
    map.settings = Object.assign(BMM.defaultSettings(), meta.settings);
    map.texture = Object.assign(BMM.Texture.defaultTextureSettings(meta.texture && meta.texture.palette), meta.texture);
    map.objects = meta.objects || [];
    map.nextId = meta.nextId || map.objects.length + 1;
    map.nextGroup = meta.nextGroup || map.objects.length + 1;
    return map;
  }
  async function saveProjectBlob(map) {
    const raw = serializeProject(map);
    const data = canCompress ? await gzip(raw) : raw;
    return new Blob([data], { type: 'application/octet-stream' });
  }
  async function loadProjectFile(buf) {
    let u8 = new Uint8Array(buf);
    if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = await gunzip(u8);
    return deserializeProject(u8);
  }

  // ------------------------------------------------------------------ Autosave (IndexedDB)
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('bar-map-maker', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbPut(key, value) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror = () => { db.close(); rej(tx.error); };
    });
  }
  async function idbGet(key) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readonly');
      const r = tx.objectStore('kv').get(key);
      r.onsuccess = () => { db.close(); res(r.result); };
      r.onerror = () => { db.close(); rej(r.error); };
    });
  }
  async function autosave(map) {
    try {
      const raw = serializeProject(map);
      const data = canCompress ? await gzip(raw) : raw;
      await idbPut('autosave', { time: Date.now(), name: map.settings.name, data });
    } catch (e) { console.warn('Autosave failed', e); }
  }
  async function loadAutosave() {
    try {
      const rec = await idbGet('autosave');
      if (!rec) return null;
      return { time: rec.time, name: rec.name, load: () => loadProjectFile(rec.data.buffer ? rec.data.buffer.slice(rec.data.byteOffset, rec.data.byteOffset + rec.data.byteLength) : rec.data) };
    } catch (e) { return null; }
  }

  BMM.IO = { crc32, makeZip, encodePNG, decodeImageLuminance, download, saveProjectBlob, loadProjectFile, autosave, loadAutosave, canCompress };
})();
