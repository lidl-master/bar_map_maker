// The one icon set: Lucide (ISC, npm `lucide`), 24×24 line icons in currentColor; size and stroke come from .icon in tokens.css.
// Icons are built with createElementNS from Lucide's node lists: no markup is ever parsed.
import ArrowDownToLine from '../../node_modules/lucide/dist/esm/icons/arrow-down-to-line.mjs';
import ArrowRight from '../../node_modules/lucide/dist/esm/icons/arrow-right.mjs';
import ArrowUpFromLine from '../../node_modules/lucide/dist/esm/icons/arrow-up-from-line.mjs';
import AudioWaveform from '../../node_modules/lucide/dist/esm/icons/audio-waveform.mjs';
import Box from '../../node_modules/lucide/dist/esm/icons/box.mjs';
import Check from '../../node_modules/lucide/dist/esm/icons/check.mjs';
import Circle from '../../node_modules/lucide/dist/esm/icons/circle.mjs';
import CircleAlert from '../../node_modules/lucide/dist/esm/icons/circle-alert.mjs';
import CircleCheck from '../../node_modules/lucide/dist/esm/icons/circle-check.mjs';
import CircleDot from '../../node_modules/lucide/dist/esm/icons/circle-dot.mjs';
import Clock from '../../node_modules/lucide/dist/esm/icons/clock.mjs';
import Columns2 from '../../node_modules/lucide/dist/esm/icons/columns-2.mjs';
import Crop from '../../node_modules/lucide/dist/esm/icons/crop.mjs';
import Crosshair from '../../node_modules/lucide/dist/esm/icons/crosshair.mjs';
import Dice5 from '../../node_modules/lucide/dist/esm/icons/dice-5.mjs';
import Equal from '../../node_modules/lucide/dist/esm/icons/equal.mjs';
import FilePlus from '../../node_modules/lucide/dist/esm/icons/file-plus.mjs';
import Flag from '../../node_modules/lucide/dist/esm/icons/flag.mjs';
import Flame from '../../node_modules/lucide/dist/esm/icons/flame.mjs';
import FolderOpen from '../../node_modules/lucide/dist/esm/icons/folder-open.mjs';
import HardDriveDownload from '../../node_modules/lucide/dist/esm/icons/hard-drive-download.mjs';
import ImageIcon from '../../node_modules/lucide/dist/esm/icons/image.mjs';
import Info from '../../node_modules/lucide/dist/esm/icons/info.mjs';
import Keyboard from '../../node_modules/lucide/dist/esm/icons/keyboard.mjs';
import LoaderCircle from '../../node_modules/lucide/dist/esm/icons/loader-circle.mjs';
import Lock from '../../node_modules/lucide/dist/esm/icons/lock.mjs';
import Minus from '../../node_modules/lucide/dist/esm/icons/minus.mjs';
import MountainSnow from '../../node_modules/lucide/dist/esm/icons/mountain-snow.mjs';
import Mouse from '../../node_modules/lucide/dist/esm/icons/mouse.mjs';
import MousePointer2 from '../../node_modules/lucide/dist/esm/icons/mouse-pointer-2.mjs';
import Package from '../../node_modules/lucide/dist/esm/icons/package.mjs';
import Paintbrush from '../../node_modules/lucide/dist/esm/icons/paintbrush.mjs';
import Plus from '../../node_modules/lucide/dist/esm/icons/plus.mjs';
import Redo2 from '../../node_modules/lucide/dist/esm/icons/redo-2.mjs';
import Route from '../../node_modules/lucide/dist/esm/icons/route.mjs';
import Scan from '../../node_modules/lucide/dist/esm/icons/scan.mjs';
import Scaling from '../../node_modules/lucide/dist/esm/icons/scaling.mjs';
import Sparkles from '../../node_modules/lucide/dist/esm/icons/sparkles.mjs';
import Square from '../../node_modules/lucide/dist/esm/icons/square.mjs';
import Trash from '../../node_modules/lucide/dist/esm/icons/trash.mjs';
import Trees from '../../node_modules/lucide/dist/esm/icons/trees.mjs';
import TriangleAlert from '../../node_modules/lucide/dist/esm/icons/triangle-alert.mjs';
import TriangleRight from '../../node_modules/lucide/dist/esm/icons/triangle-right.mjs';
import Undo2 from '../../node_modules/lucide/dist/esm/icons/undo-2.mjs';
import Users from '../../node_modules/lucide/dist/esm/icons/users.mjs';
import WavesHorizontal from '../../node_modules/lucide/dist/esm/icons/waves-horizontal.mjs';
import X from '../../node_modules/lucide/dist/esm/icons/x.mjs';

const ICONS = {
  'arrow-down-to-line': ArrowDownToLine, 'arrow-right': ArrowRight, 'arrow-up-from-line': ArrowUpFromLine,
  'audio-waveform': AudioWaveform, box: Box, check: Check, circle: Circle, 'circle-alert': CircleAlert, 'circle-check': CircleCheck,
  'circle-dot': CircleDot, clock: Clock, 'columns-2': Columns2, crop: Crop, crosshair: Crosshair, 'dice-5': Dice5, equal: Equal, 'file-plus': FilePlus,
  flag: Flag, flame: Flame, 'folder-open': FolderOpen, 'hard-drive-download': HardDriveDownload, image: ImageIcon, info: Info,
  keyboard: Keyboard, 'loader-circle': LoaderCircle, lock: Lock, minus: Minus, 'mountain-snow': MountainSnow, mouse: Mouse,
  'mouse-pointer-2': MousePointer2, package: Package, paintbrush: Paintbrush, plus: Plus, 'redo-2': Redo2, route: Route,
  scaling: Scaling, scan: Scan, sparkles: Sparkles, square: Square, trash: Trash, trees: Trees, 'triangle-alert': TriangleAlert,
  'triangle-right': TriangleRight, 'undo-2': Undo2, users: Users, 'waves-horizontal': WavesHorizontal, x: X,
};

const NS = 'http://www.w3.org/2000/svg';

/** An <svg class="icon"> for a Lucide icon name; extra classes (e.g. 'lg') are appended. */
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
