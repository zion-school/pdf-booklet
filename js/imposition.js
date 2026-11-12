/*
 * Copyright (c) 2026 Zion Nursery & Primary School, Kovaipudur
 * Copyright (c) 2026 Jabez Winston
 * SPDX-License-Identifier: MIT
 * Date: 26-Sep-2026
 */
/*
 * Booklet imposition: page order and sheet geometry. Pure logic, no DOM, no PDF library.
 * Loads as a browser global (window.Imposition) or as a CommonJS module (Node tests).
 *
 * Conventions
 *   - Pages are 1-based positions in the booklet sequence; null is a blank slot.
 *   - Slot positions: fold2 uses L, R; the 4-up modes use TL, TR, BL, BR.
 *   - rot is the in-plane rotation (0 or 180) of the page inside its slot as printed.
 *   - Back sides are laid out for the mode's natural duplex flip, i.e. turning the sheet
 *     over a vertical axis: short edge for fold2 (landscape sheet), long edge for the
 *     4-up modes (portrait sheet). finalSlots() adds the 180° turn for the other flip.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Imposition = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PT_PER_MM = 72 / 25.4;

  // Sheet sizes in mm, portrait (short side first).
  const PAPER = {
    A3: [297, 420],
    A4: [210, 297],
    A5: [148, 210],
    Letter: [215.9, 279.4],
    Legal: [215.9, 355.6],
  };

  // Named sizes (portrait, mm) used to describe source and booklet pages.
  const NAMED = {
    ...PAPER, A2: [420, 594], A6: [105, 148], A7: [74, 105], 'Half Letter': [139.7, 215.9], Tabloid: [279.4, 431.8],
  };
  const US_SIZES = new Set(['Half Letter', 'Letter', 'Legal', 'Tabloid']);
  const MATCH_MM = 2.5; // a page "fits at 100%" when the slot is within this of its size

  const MODES = {
    fold2: { perSheet: 4, cols: 2, rows: 1, landscape: true, naturalFlip: 'short' }, // fold once
    quarto: { perSheet: 8, cols: 2, rows: 2, landscape: false, naturalFlip: 'long' }, // fold twice, slit
    cutstack: { perSheet: 8, cols: 2, rows: 2, landscape: false, naturalFlip: 'long' }, // cut, stack, fold once
  };

  const POS = { L: [0, 0], R: [1, 0], TL: [0, 0], TR: [1, 0], BL: [0, 1], BR: [1, 1] };
  const QUAD = ['TL', 'TR', 'BL', 'BR'];

  // ---------------------------------------------------------------------------
  // Fold-4 quarto: port of pdfbook4-logic.txt.
  // k sheets stacked and folded twice hold 8k pages. For page n (1..8k):
  //   quartoF gives the output slot N (1..8k), 4 slots per sheet side in the order TL, TR, BL, BR;
  //   quartoG is 1 when the page sits in the top row, which is printed upside down.
  // The formula lists the innermost sheet first, back (inner forme) before front.

  function quartoG(k, n) {
    return 2 * k + 1 <= n && n <= 6 * k ? 1 : 0;
  }

  function quartoF(k, n) {
    if (quartoG(k, n) === 1) {
      const idx = n - (2 * k + 1); // 0-based index in the top-row block
      const m = idx < 2 * k ? idx : 4 * k - 1 - idx;
      const sub = idx % 2 === 0 ? 1 : 2;
      return 4 * m + sub;
    }
    const j = n <= 2 * k ? n - 1 : 2 * k + (n - (6 * k + 1));
    const m = n <= 2 * k ? 2 * k - 1 - j : j - 2 * k;
    const sub = j % 2 === 0 ? 4 : 3;
    return 4 * m + sub;
  }

  // ---------------------------------------------------------------------------
  // Layouts for one signature of S sheets (local pages 1..M). Each returns the sheet
  // sides in print order, outermost sheet first, front (the side holding page 1) first.

  function side(sheet, face, slots) {
    return { sheet, face, slots };
  }

  function slot(pos, page, rot = 0) {
    return { pos, page, rot };
  }

  const LAYOUTS = {
    fold2(S) {
      const M = 4 * S;
      const sides = [];
      for (let s = 0; s < S; s++) {
        sides.push(side(s, 'front', [slot('L', M - 2 * s), slot('R', 2 * s + 1)]));
        sides.push(side(s, 'back', [slot('L', 2 * s + 2), slot('R', M - 2 * s - 1)]));
      }
      return sides;
    },

    quarto(k) {
      const raw = Array.from({ length: 2 * k }, () => new Array(4));
      for (let n = 1; n <= 8 * k; n++) {
        const N = quartoF(k, n) - 1;
        raw[Math.floor(N / 4)][N % 4] = slot(QUAD[N % 4], n, quartoG(k, n) ? 180 : 0);
      }
      // Reverse so the outermost sheet prints first, front before back.
      return raw.reverse().map((slots, i) => side(i >> 1, i % 2 ? 'back' : 'front', slots));
    },

    cutstack(S) {
      // Same order as `pdfcpu booklet ... 4` (btype booklet). The whole signature is an
      // ordinary 2-up booklet of 2S folios (folio f = the half-sheet with pages M-2f and 2f+1
      // on its front). Sheet s carries folio 2s on its top half, upright, and folio 2s+1 on
      // its bottom half, rotated 180° as a strip (so its two slots swap as well).
      // Cut each sheet, turn the bottom half upright, put it under the top half, keep the
      // sheets in print order, fold once.
      const M = 8 * S;
      const sides = [];
      for (let s = 0; s < S; s++) {
        const t = 2 * s;
        const b = 2 * s + 1;
        sides.push(side(s, 'front', [
          slot('TL', M - 2 * t), slot('TR', 2 * t + 1),
          slot('BL', 2 * b + 1, 180), slot('BR', M - 2 * b, 180),
        ]));
        sides.push(side(s, 'back', [
          slot('TL', 2 * t + 2), slot('TR', M - 2 * t - 1),
          slot('BL', M - 2 * b - 1, 180), slot('BR', 2 * b + 2, 180),
        ]));
      }
      return sides;
    },
  };

  // ---------------------------------------------------------------------------

  /**
   * Split pageCount pages into signatures and impose each one.
   * sheetsPerSignature <= 0 puts everything in a single signature.
   * The last signature may have fewer sheets; blanks pad its end.
   */
  function impose({ mode, pageCount, sheetsPerSignature = 0 }) {
    const m = MODES[mode];
    if (!m) throw new Error(`Unknown mode: ${mode}`);
    if (!(pageCount > 0)) throw new Error('No pages to impose');

    const totalSheets = Math.ceil(pageCount / m.perSheet);
    const sigSheets = sheetsPerSignature > 0 ? Math.floor(sheetsPerSignature) : totalSheets;
    const signatures = [];
    const sides = [];
    let start = 0;
    let sheetBase = 0;

    for (let left = totalSheets; left > 0; left -= sigSheets) {
      const S = Math.min(sigSheets, left);
      const sig = signatures.length;
      signatures.push({ index: sig, firstPage: start + 1, sheets: S });
      for (const sd of LAYOUTS[mode](S)) {
        sides.push({
          sig,
          sheet: sheetBase + sd.sheet,
          face: sd.face,
          slots: sd.slots.map((sl) => {
            const p = start + sl.page;
            return { pos: sl.pos, page: p <= pageCount ? p : null, rot: sl.rot };
          }),
        });
      }
      start += S * m.perSheet;
      sheetBase += S;
    }

    return {
      mode,
      pageCount,
      paddedCount: start,
      blanks: start - pageCount,
      sheets: sheetBase,
      signatures,
      sides,
    };
  }

  /** Slots of a side with grid cell and rotation as actually printed for the chosen duplex flip. */
  function finalSlots(sd, mode, flip) {
    const m = MODES[mode];
    const turn = sd.face === 'back' && flip && flip !== m.naturalFlip;
    return sd.slots.map((sl) => {
      let [col, row] = POS[sl.pos];
      let rot = sl.rot;
      if (turn) {
        col = m.cols - 1 - col;
        row = m.rows - 1 - row;
        rot = (rot + 180) % 360;
      }
      return { col, row, rot, page: sl.page };
    });
  }

  /** Sheet and slot sizes in points. */
  function sheetGeometry(mode, paper) {
    const m = MODES[mode];
    const [shortMm, longMm] = PAPER[paper] || PAPER.A4;
    const [wMm, hMm] = m.landscape ? [longMm, shortMm] : [shortMm, longMm];
    const cellWmm = wMm / m.cols;
    const cellHmm = hMm / m.rows;
    return {
      width: wMm * PT_PER_MM,
      height: hMm * PT_PER_MM,
      cols: m.cols,
      rows: m.rows,
      cellW: cellWmm * PT_PER_MM,
      cellH: cellHmm * PT_PER_MM,
      cellMm: [cellWmm, cellHmm],
      pageName: nameSize(cellWmm, cellHmm),
    };
  }

  function nameSize(w, h) {
    for (const [name, [a, b]] of Object.entries(NAMED)) {
      if (Math.abs(w - a) < 1.5 && Math.abs(h - b) < 1.5) return name;
    }
    return null;
  }

  /**
   * Describe a page size given in points: { name, landscape, us, wMm, hMm }.
   * name is null for sizes that aren't listed in NAMED (either orientation).
   */
  function describeSize(wPt, hPt) {
    const wMm = wPt / PT_PER_MM;
    const hMm = hPt / PT_PER_MM;
    const landscape = wMm > hMm + 0.5;
    const name = landscape ? nameSize(hMm, wMm) : nameSize(wMm, hMm);
    return { name, landscape, us: US_SIZES.has(name), wMm, hMm };
  }

  /**
   * The sheet that prints pages of this size (points, as displayed) at 100% in this mode,
   * or a fallback that scales them: Letter for US page sizes, otherwise A4.
   * @returns {{paper: string, exact: boolean}}
   */
  function autoPaper(mode, wPt, hPt) {
    const w = wPt / PT_PER_MM;
    const h = hPt / PT_PER_MM;
    for (const paper of Object.keys(PAPER)) {
      const [cw, ch] = sheetGeometry(mode, paper).cellMm;
      if (Math.abs(cw - w) <= MATCH_MM && Math.abs(ch - h) <= MATCH_MM) return { paper, exact: true };
    }
    return { paper: describeSize(wPt, hPt).us ? 'Letter' : 'A4', exact: false };
  }

  // ---------------------------------------------------------------------------
  // Placing a page in its slot. Shared by the PDF renderer and the on-screen previews.
  // Boxes are {left, bottom, right, top}. The displayed frame is the page as a viewer shows
  // it after /Rotate (clockwise), with its origin at the displayed bottom-left corner.

  const normRot = (a) => (((Math.round(a || 0) % 360) + 360) % 360);

  /** Intersection of box and limit; limit itself when they don't overlap usefully. */
  function clipBox(box, limit) {
    const b = {
      left: Math.max(box.left, limit.left),
      bottom: Math.max(box.bottom, limit.bottom),
      right: Math.min(box.right, limit.right),
      top: Math.min(box.top, limit.top),
    };
    return b.right - b.left > 1 && b.top - b.bottom > 1 ? b : limit;
  }

  /** A box in user space → the displayed frame of a page with visible box V and rotation r. */
  function toDisplay(b, V, r) {
    switch (r) {
      case 90: return { left: b.bottom - V.bottom, right: b.top - V.bottom, bottom: V.right - b.right, top: V.right - b.left };
      case 180: return { left: V.right - b.right, right: V.right - b.left, bottom: V.top - b.top, top: V.top - b.bottom };
      case 270: return { left: V.top - b.top, right: V.top - b.bottom, bottom: b.left - V.left, top: b.right - V.left };
      default: return { left: b.left - V.left, right: b.right - V.left, bottom: b.bottom - V.bottom, top: b.top - V.bottom };
    }
  }

  /** Inverse of toDisplay. */
  function fromDisplay(d, V, r) {
    switch (r) {
      case 90: return { left: V.right - d.top, right: V.right - d.bottom, bottom: V.bottom + d.left, top: V.bottom + d.right };
      case 180: return { left: V.right - d.right, right: V.right - d.left, bottom: V.top - d.top, top: V.top - d.bottom };
      case 270: return { left: V.left + d.bottom, right: V.left + d.top, bottom: V.top - d.right, top: V.top - d.left };
      default: return { left: V.left + d.left, right: V.left + d.right, bottom: V.bottom + d.bottom, top: V.bottom + d.top };
    }
  }

  /** Margins in mm → points. */
  function marginPt(mg = {}) {
    return {
      outer: (mg.outer || 0) * PT_PER_MM, inner: (mg.inner || 0) * PT_PER_MM,
      top: (mg.top || 0) * PT_PER_MM, bottom: (mg.bottom || 0) * PT_PER_MM,
    };
  }

  /**
   * Where a page lands in its slot, in the slot's upright frame (points, origin bottom-left).
   * The binding edge is on the left for recto (odd) pages and on the right for verso pages.
   * The caller turns the result by the slot rotation.
   *
   * @param {object} p
   *   visible: the page's visible box (CropBox ∩ MediaBox), user space
   *   crop: optional box to show instead of the whole page (clipped to visible by the caller)
   *   rotation: the page's /Rotate
   *   cellW, cellH: slot size; margin: {outer, inner, top, bottom} in points; recto: boolean
   *   scale: null to fit the content area, or a factor (1 = actual size)
   * @returns {{s, fit, clipped, placed, page, window, windowSrc}}
   *   placed: the crop box as placed; page: the whole visible page as placed (it may extend
   *   past the slot); window: the part of `placed` inside the content area, which is all that
   *   prints; windowSrc: the window in the page's user space. Rects are {x, y, w, h}.
   */
  function placeInCell({ visible: V, crop, rotation = 0, cellW, cellH, margin = {}, recto = true, scale = null }) {
    const r = normRot(rotation);
    const vd = toDisplay(V, V, r);
    const cd = toDisplay(crop || V, V, r);
    const dw = cd.right - cd.left;
    const dh = cd.top - cd.bottom;

    const left = (recto ? margin.inner : margin.outer) || 0;
    const right = (recto ? margin.outer : margin.inner) || 0;
    const bottom = margin.bottom || 0;
    const aw = Math.max(cellW - left - right, 1);
    const ah = Math.max(cellH - bottom - (margin.top || 0), 1);
    const fit = Math.min(aw / dw, ah / dh);
    const s = scale > 0 ? scale : fit;

    const placed = { x: left + (aw - dw * s) / 2, y: bottom + (ah - dh * s) / 2, w: dw * s, h: dh * s };
    const page = { x: placed.x - cd.left * s, y: placed.y - cd.bottom * s, w: vd.right * s, h: vd.top * s };
    const x0 = Math.max(placed.x, left);
    const x1 = Math.min(placed.x + placed.w, left + aw);
    const y0 = Math.max(placed.y, bottom);
    const y1 = Math.min(placed.y + placed.h, bottom + ah);
    const win = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const windowSrc = fromDisplay({
      left: cd.left + (x0 - placed.x) / s, right: cd.left + (x1 - placed.x) / s,
      bottom: cd.bottom + (y0 - placed.y) / s, top: cd.bottom + (y1 - placed.y) / s,
    }, V, r);
    const clipped = placed.w > aw + 0.01 || placed.h > ah + 0.01;
    return { s, fit, clipped, placed, page, window: win, windowSrc };
  }

  /**
   * pdfcpu-style page selection over pages 1..total, returned as 0-based page indices.
   * Accepts "1-12, 15, 20-", "-5", "10-1" (reversed), "even", "odd", and "b" for a blank page
   * (returned as null). Empty or "all" selects everything.
   */
  function parsePageRange(spec, total) {
    const text = String(spec ?? '').trim().toLowerCase();
    const all = Array.from({ length: total }, (_, i) => i);
    if (text === '' || text === 'all') return all;

    const out = [];
    for (const raw of text.split(/[,;\s]+/).filter(Boolean)) {
      if (raw === 'b' || raw === 'blank') { out.push(null); continue; }
      if (raw === 'odd' || raw === 'even') {
        out.push(...all.filter((i) => (i % 2 === 0) === (raw === 'odd')));
        continue;
      }
      const m = /^(\d*)-(\d*)$/.exec(raw) || /^(\d+)()$/.exec(raw);
      if (!m) throw new Error(`Bad page range: "${raw}"`);
      const single = !raw.includes('-');
      const a = m[1] === '' ? 1 : Number(m[1]);
      const b = single ? a : m[2] === '' ? total : Number(m[2]);
      for (const p of [a, b]) {
        if (p < 1 || p > total) throw new Error(`Page ${p} is out of range (1–${total})`);
      }
      const step = a <= b ? 1 : -1;
      for (let p = a; p !== b + step; p += step) out.push(p - 1);
    }
    if (out.length === 0) throw new Error('Page selection is empty');
    return out;
  }

  return {
    PT_PER_MM, PAPER, MODES,
    quartoF, quartoG, impose, finalSlots, sheetGeometry, parsePageRange,
    describeSize, autoPaper, normRot, clipBox, toDisplay, fromDisplay, marginPt, placeInCell,
  };
});
