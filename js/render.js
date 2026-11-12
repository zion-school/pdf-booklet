/*
 * Copyright (c) 2026 Zion Nursery & Primary School, Kovaipudur
 * Copyright (c) 2026 Jabez Winston
 * SPDX-License-Identifier: MIT
 * Date: 26-Sep-2026
 */
/*
 * Builds the imposed booklet PDF with pdf-lib. Source pages are embedded as Form XObjects,
 * so the output stays vector. Browser global: window.BookletRender; Node: require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../vendor/pdf-lib.min.js'), require('./imposition.js'));
  } else {
    root.BookletRender = factory(root.PDFLib, root.Imposition);
  }
})(typeof self !== 'undefined' ? self : this, function (PDFLib, Imposition) {
  'use strict';

  const { PDFDocument, degrees, rgb } = PDFLib;
  const { normRot } = Imposition;
  const GUIDE = { thickness: 0.4, color: rgb(0.55, 0.55, 0.55) };
  const DASH = [5, 4];

  const toBox = ({ x, y, width, height }) => ({
    left: Math.min(x, x + width), bottom: Math.min(y, y + height),
    right: Math.max(x, x + width), top: Math.max(y, y + height),
  });

  /** Visible box of a page: CropBox clipped to MediaBox, as {left, bottom, right, top}. */
  function pageBox(page) {
    return Imposition.clipBox(toBox(page.getCropBox()), toBox(page.getMediaBox()));
  }

  /** What placement needs to know about a source page. */
  function pageInfo(page) {
    return { visible: pageBox(page), rotation: normRot(page.getRotation().angle) };
  }

  /**
   * @param {Uint8Array|ArrayBuffer} srcBytes source PDF
   * @param {object} o
   *   mode: 'fold2' | 'quarto' | 'cutstack'
   *   paper: key of Imposition.PAPER
   *   flip: 'long' | 'short' (printer duplex setting)
   *   sheetsPerSignature: number, 0 = one signature
   *   selection: array of 0-based source page indices or null (blank); default all pages
   *   margins: {outer, inner, top, bottom} in mm
   *   scale: null to fit each page to its slot, or a factor (1 = actual size); pages larger
   *     than the slot are cropped evenly
   *   guides: boolean
   *   boxes: optional array (per selection position) of {left,bottom,right,top} crop boxes
   * @param {(done:number, total:number) => void} [onProgress]
   * @returns {Promise<{bytes: Uint8Array, plan: object}>}
   */
  async function buildBooklet(srcBytes, o, onProgress = () => {}) {
    const src = await PDFDocument.load(srcBytes, { updateMetadata: false });
    const srcPages = src.getPages();
    const selection = o.selection || srcPages.map((_, i) => i);
    const plan = Imposition.impose({ mode: o.mode, pageCount: selection.length, sheetsPerSignature: o.sheetsPerSignature });
    const geo = Imposition.sheetGeometry(o.mode, o.paper);
    const margin = Imposition.marginPt(o.margins);

    // Embed every non-blank selected page in one call so shared resources are copied once.
    // Each page is embedded with just the part that prints (its window) as the bounding box,
    // which clips crop boxes and pages scaled past their slot.
    const used = [];
    selection.forEach((idx, pos) => {
      if (idx === null || idx === undefined) return;
      const page = srcPages[idx];
      if (!page.node.Contents()) return; // page without content stream: leave the slot blank
      const info = pageInfo(page);
      const crop = o.boxes && o.boxes[pos] ? Imposition.clipBox(o.boxes[pos], info.visible) : null;
      const pl = Imposition.placeInCell({
        ...info, crop, cellW: geo.cellW, cellH: geo.cellH, margin, recto: pos % 2 === 0, scale: o.scale,
      });
      used.push({ pos, page, pl, rotation: info.rotation });
    });

    const out = await PDFDocument.create();
    const embedded = await out.embedPages(used.map((u) => u.page), used.map((u) => u.pl.windowSrc));
    const byPos = new Map(used.map((u, i) => [u.pos, { ...u, xobj: embedded[i] }]));

    for (let n = 0; n < plan.sides.length; n++) {
      const sheet = out.addPage([geo.width, geo.height]);
      for (const sl of Imposition.finalSlots(plan.sides[n], o.mode, o.flip)) {
        const item = sl.page && byPos.get(sl.page - 1);
        if (item) placePage(sheet, item, sl, geo);
      }
      if (o.guides) drawGuides(sheet, o.mode, geo);
      onProgress(n + 1, plan.sides.length);
      if (n % 64 === 63) await new Promise((r) => setTimeout(r, 0)); // let progress repaint
    }

    out.setTitle(`${src.getTitle() || 'Booklet'} (booklet)`);
    out.setProducer('pdf-booklet');
    out.setCreator('pdf-booklet');
    return { bytes: await out.save(), plan };
  }

  /**
   * Draw one source page into its slot. placeInCell lays it out in the slot's upright frame;
   * here the result is turned by the slot rotation.
   */
  function placePage(sheet, item, sl, geo) {
    const { xobj, pl, rotation } = item;
    const box = pl.windowSrc;
    const s = pl.s;
    let { x: lx, y: ly, w: rw, h: rh } = pl.window;
    if (sl.rot === 180) {
      lx = geo.cellW - lx - rw;
      ly = geo.cellH - ly - rh;
    }
    const X = sl.col * geo.cellW + lx;
    const Y = geo.height - (sl.row + 1) * geo.cellH + ly;

    // pdf-lib scales, then rotates counter-clockwise about (x, y). /Rotate is clockwise.
    const theta = normRot(sl.rot - rotation);
    const W = (box.right - box.left) * s;
    const H = (box.top - box.bottom) * s;
    const offset = { 0: [0, 0], 90: [H, 0], 180: [W, H], 270: [0, W] }[theta];
    sheet.drawPage(xobj, { x: X + offset[0], y: Y + offset[1], xScale: s, yScale: s, rotate: degrees(theta) });
  }

  function drawGuides(sheet, mode, geo) {
    const { width: w, height: h } = geo;
    const line = (x1, y1, x2, y2, dashed) => sheet.drawLine({
      start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, ...GUIDE, dashArray: dashed ? DASH : undefined,
    });
    line(w / 2, 0, w / 2, h, true); // spine fold
    if (mode === 'quarto') line(0, h / 2, w, h / 2, true); // head fold, slit after folding
    if (mode === 'cutstack') line(0, h / 2, w, h / 2, false); // cut
  }

  return { buildBooklet, pageInfo };
});
