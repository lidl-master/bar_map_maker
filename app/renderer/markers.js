// Resource markers, drawn the same way on the 2D map and as 3D billboards (view3d.js turns them into sprites):
// start positions are the strongest mark (28 px team badges), metal spots small rings, geo vents orange flame discs.
import { iconPaths } from './icons.js';

export const TEAM_COLORS = ['#3d8bff', '#ff4d4d', '#38d86b', '#ffd23f', '#c05cff', '#ff8f2e', '#2ee6e6', '#ff66c4',
  '#9be04c', '#7a7aff', '#d9a066', '#ffffff', '#8c8c8c', '#4cc9a0', '#e05c8c', '#b0b0ff'];

/** Marker diameters in CSS px; also the spacing below which markers are nudged apart in 2D. */
export const MARKER_SIZE = { start: 28, metal: 13, geo: 18 };

export const SELECT = '#7aa5ff';
export const HOVER = 'rgba(255, 255, 255, 0.9)';
const INK = '#0e1014';
const FONT = '"Inter", "Segoe UI", sans-serif';
const FLAME = iconPaths('flame');

// Light team colours (yellow, cyan, white…) carry dark numbers.
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
const teamColor = (team) => TEAM_COLORS[team % TEAM_COLORS.length];
const teamText = (team) => (luminance(teamColor(team)) > 0.6 ? INK : '#ffffff');

function disc(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/** A selection (accent) or hover (white) ring around a marker of radius r. */
export function markerRing(ctx, x, y, r, color) {
  disc(ctx, x, y, r + 3);
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Team badge: a 28-px disc in the team colour, 2-px white outline, soft shadow, the team number in bold. */
export function drawStart(ctx, x, y, team) {
  const r = MARKER_SIZE.start / 2 - 1;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  disc(ctx, x, y, r);
  ctx.fillStyle = teamColor(team);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.font = `700 13px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = teamText(team);
  ctx.fillText(String(team + 1), x, y + 0.5);
}

/** Metal spot: a 13-px ring with a centre dot, outlined dark so it reads on any ground. */
export function drawMetal(ctx, x, y) {
  const r = MARKER_SIZE.metal / 2;
  disc(ctx, x, y, r);
  ctx.fillStyle = 'rgba(14, 16, 20, 0.72)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(14, 16, 20, 0.9)';
  ctx.stroke();
  disc(ctx, x, y, r - 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#e9edf5';
  ctx.stroke();
  disc(ctx, x, y, 1.75);
  ctx.fillStyle = '#e9edf5';
  ctx.fill();
}

/** A metal value next to its spot: 11-px semibold on a dark pill, left-aligned to the right of the glyph. */
export function drawMetalLabel(ctx, x, y, text) {
  ctx.font = `600 11px ${FONT}`;
  const w = Math.ceil(ctx.measureText(text).width) + 8, left = x + MARKER_SIZE.metal / 2 + 3;
  ctx.beginPath();
  ctx.roundRect(left, y - 8, w, 16, 4);
  ctx.fillStyle = 'rgba(14, 16, 20, 0.82)';
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, left + 4, y + 0.5);
}

/** Geothermal vent: an 18-px orange disc with a white flame. */
export function drawGeo(ctx, x, y) {
  const r = MARKER_SIZE.geo / 2 - 1, f = 12 / 24;
  disc(ctx, x, y, r);
  ctx.fillStyle = '#e8702a';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(14, 16, 20, 0.85)';
  ctx.stroke();
  ctx.save();
  ctx.translate(x - 12 * f, y - 12 * f);
  ctx.scale(f, f);
  ctx.lineWidth = 1.5 / f; // 1.5 screen px, like the UI icons
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.strokeStyle = '#ffffff';
  for (const p of FLAME) ctx.stroke(p);
  ctx.restore();
}

/** draw(ctx, x, y, team) per marker type; team only matters for starts. */
export const DRAW_MARKER = { start: drawStart, metal: drawMetal, geo: drawGeo };

/** A marker alone on a transparent canvas, `scale` × its CSS size (3D sprite textures). */
export function markerCanvas(type, team = 0, scale = 2) {
  const size = MARKER_SIZE[type] + 8, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  DRAW_MARKER[type](ctx, size / 2, size / 2, team);
  return canvas;
}
