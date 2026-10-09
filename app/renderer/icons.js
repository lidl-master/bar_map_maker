// The one icon set: Lucide (ISC, npm `lucide`), 24×24 line icons in currentColor; size and stroke come from .icon in tokens.css.
// Icons are built with createElementNS from Lucide's node lists: no markup is ever parsed.
import ArrowDownToDot from '../../node_modules/lucide/dist/esm/icons/arrow-down-to-dot.mjs';
import ArrowDownToLine from '../../node_modules/lucide/dist/esm/icons/arrow-down-to-line.mjs';
import ArrowRight from '../../node_modules/lucide/dist/esm/icons/arrow-right.mjs';
import ArrowUpFromLine from '../../node_modules/lucide/dist/esm/icons/arrow-up-from-line.mjs';
import AudioWaveform from '../../node_modules/lucide/dist/esm/icons/audio-waveform.mjs';
import Box from '../../node_modules/lucide/dist/esm/icons/box.mjs';
import Check from '../../node_modules/lucide/dist/esm/icons/check.mjs';
import ChevronDown from '../../node_modules/lucide/dist/esm/icons/chevron-down.mjs';
import CircleAlert from '../../node_modules/lucide/dist/esm/icons/circle-alert.mjs';
import CircleCheck from '../../node_modules/lucide/dist/esm/icons/circle-check.mjs';
import CircleDot from '../../node_modules/lucide/dist/esm/icons/circle-dot.mjs';
import Clock from '../../node_modules/lucide/dist/esm/icons/clock.mjs';
import Columns2 from '../../node_modules/lucide/dist/esm/icons/columns-2.mjs';
import Copy from '../../node_modules/lucide/dist/esm/icons/copy.mjs';
import Crosshair from '../../node_modules/lucide/dist/esm/icons/crosshair.mjs';
import Dice5 from '../../node_modules/lucide/dist/esm/icons/dice-5.mjs';
import Equal from '../../node_modules/lucide/dist/esm/icons/equal.mjs';
import Eraser from '../../node_modules/lucide/dist/esm/icons/eraser.mjs';
import FileOutput from '../../node_modules/lucide/dist/esm/icons/file-output.mjs';
import Flag from '../../node_modules/lucide/dist/esm/icons/flag.mjs';
import Flame from '../../node_modules/lucide/dist/esm/icons/flame.mjs';
import FolderOpen from '../../node_modules/lucide/dist/esm/icons/folder-open.mjs';
import Footprints from '../../node_modules/lucide/dist/esm/icons/footprints.mjs';
import HardDriveDownload from '../../node_modules/lucide/dist/esm/icons/hard-drive-download.mjs';
import Info from '../../node_modules/lucide/dist/esm/icons/info.mjs';
import Keyboard from '../../node_modules/lucide/dist/esm/icons/keyboard.mjs';
import Layers from '../../node_modules/lucide/dist/esm/icons/layers.mjs';
import LoaderCircle from '../../node_modules/lucide/dist/esm/icons/loader-circle.mjs';
import Lock from '../../node_modules/lucide/dist/esm/icons/lock.mjs';
import MapPlus from '../../node_modules/lucide/dist/esm/icons/map-plus.mjs';
import Minus from '../../node_modules/lucide/dist/esm/icons/minus.mjs';
import Mountain from '../../node_modules/lucide/dist/esm/icons/mountain.mjs';
import MountainSnow from '../../node_modules/lucide/dist/esm/icons/mountain-snow.mjs';
import Mouse from '../../node_modules/lucide/dist/esm/icons/mouse.mjs';
import MousePointer2 from '../../node_modules/lucide/dist/esm/icons/mouse-pointer-2.mjs';
import Paintbrush from '../../node_modules/lucide/dist/esm/icons/paintbrush.mjs';
import Plus from '../../node_modules/lucide/dist/esm/icons/plus.mjs';
import Redo2 from '../../node_modules/lucide/dist/esm/icons/redo-2.mjs';
import RotateCcw from '../../node_modules/lucide/dist/esm/icons/rotate-ccw.mjs';
import Scan from '../../node_modules/lucide/dist/esm/icons/scan.mjs';
import Spline from '../../node_modules/lucide/dist/esm/icons/spline.mjs';
import Square from '../../node_modules/lucide/dist/esm/icons/square.mjs';
import SquareCenterlineDashedVertical from '../../node_modules/lucide/dist/esm/icons/square-centerline-dashed-vertical.mjs';
import Tag from '../../node_modules/lucide/dist/esm/icons/tag.mjs';
import Trash from '../../node_modules/lucide/dist/esm/icons/trash.mjs';
import Trees from '../../node_modules/lucide/dist/esm/icons/trees.mjs';
import TriangleAlert from '../../node_modules/lucide/dist/esm/icons/triangle-alert.mjs';
import TriangleRight from '../../node_modules/lucide/dist/esm/icons/triangle-right.mjs';
import Undo2 from '../../node_modules/lucide/dist/esm/icons/undo-2.mjs';
import Users from '../../node_modules/lucide/dist/esm/icons/users.mjs';
import X from '../../node_modules/lucide/dist/esm/icons/x.mjs';

const ICONS = {
  'arrow-down-to-dot': ArrowDownToDot, 'arrow-down-to-line': ArrowDownToLine, 'arrow-right': ArrowRight,
  'arrow-up-from-line': ArrowUpFromLine, 'audio-waveform': AudioWaveform, box: Box, check: Check,
  'chevron-down': ChevronDown, 'circle-alert': CircleAlert, 'circle-check': CircleCheck, 'circle-dot': CircleDot,
  clock: Clock, 'columns-2': Columns2, copy: Copy, crosshair: Crosshair, 'dice-5': Dice5, equal: Equal, eraser: Eraser,
  'file-output': FileOutput, flag: Flag, flame: Flame, 'folder-open': FolderOpen, footprints: Footprints,
  'hard-drive-download': HardDriveDownload, info: Info, keyboard: Keyboard, layers: Layers,
  'loader-circle': LoaderCircle, lock: Lock, 'map-plus': MapPlus, minus: Minus, mountain: Mountain,
  'mountain-snow': MountainSnow, mouse: Mouse, 'mouse-pointer-2': MousePointer2, paintbrush: Paintbrush, plus: Plus,
  'redo-2': Redo2, 'rotate-ccw': RotateCcw, scan: Scan, spline: Spline, square: Square,
  'square-centerline-dashed-vertical': SquareCenterlineDashedVertical, tag: Tag, trash: Trash, trees: Trees,
  'triangle-alert': TriangleAlert, 'triangle-right': TriangleRight, 'undo-2': Undo2, users: Users, x: X,
};

const NS = 'http://www.w3.org/2000/svg';

/** An <svg class="icon"> for a Lucide icon name; extra classes (e.g. 'spin') are appended. */
export function icon(name, className = '') {
  const nodes = ICONS[name];
  if (!nodes) throw new Error(`unknown icon "${name}"`);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of nodes) {
    const child = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) child.setAttribute(key, value);
    svg.append(child);
  }
  return svg;
}

/** Replaces every <i data-icon="name"> placeholder in the static markup with its icon. */
export function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll('i[data-icon]')) node.replaceWith(icon(node.dataset.icon, node.className));
}

/** The icon's paths for drawing on a canvas (2D view markers); only <path> nodes, in the 24×24 box. */
export const iconPaths = (name) => ICONS[name].filter(([tag]) => tag === 'path').map(([, { d }]) => new Path2D(d));
