/*
 * Copyright (c) 2026 Zion Nursery & Primary School, Kovaipudur
 * Copyright (c) 2026 Jabez Winston
 * SPDX-License-Identifier: MIT
 * Date: 26-Sep-2026
 */
/*
 * Auto-crop, after pdfbook2: find the inked area of each page and crop every page to the
 * union of those areas (odd and even pages separately), so all pages keep the same
 * position and scale. pdf.js renders the pages; pdfbook2 asks ghostscript's bbox device.
 * Browser only: needs a pdf.js document (BookletThumbs.doc()), BookletThumbs.paint and a canvas.
 */
(function (root) {
  'use strict';

  /**
   * Content box of each listed source page, in PDF user space.
   * @param {object} doc pdf.js document of the source PDF (left open)
   * @param {number[]} indices 0-based source page indices
   * @param {object} [o] scale: render scale (1 = 72 dpi); threshold: channel value below
   *   which a pixel counts as ink; onProgress(done, total)
   * @returns {Promise<Map<number, {group: string, box: {left,bottom,right,top}|null}>>}
   *   group identifies pages of the same size and rotation; box is null for empty pages
   */
  async function contentBoxes(doc, indices, o = {}) {
    const { scale = 1, threshold = 245, onProgress = () => {} } = o;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const boxes = new Map();
    for (let n = 0; n < indices.length; n++) {
      const page = await doc.getPage(indices[n] + 1);
      const vp = page.getViewport({ scale });
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await root.BookletThumbs.paint(page, vp, ctx);
      boxes.set(indices[n], {
        group: `${page.view.map(Math.round).join(',')}/${page.rotate}`,
        box: inkBox(ctx, canvas.width, canvas.height, threshold, vp),
      });
      page.cleanup();
      onProgress(n + 1, indices.length);
      if (n % 8 === 7) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
    }
    return boxes;
  }

  function inkBox(ctx, w, h, threshold, vp) {
    const px = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
        if (px[i] < threshold || px[i + 1] < threshold || px[i + 2] < threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    // One pixel of slack on each side; the renderer clips to the page box anyway.
    const [x1, y1] = vp.convertToPdfPoint(minX - 1, minY - 1);
    const [x2, y2] = vp.convertToPdfPoint(maxX + 2, maxY + 2);
    return { left: Math.min(x1, x2), bottom: Math.min(y1, y2), right: Math.max(x1, x2), top: Math.max(y1, y2) };
  }

  /**
   * One crop box per booklet position: the union of the content boxes of all odd
   * positions, and separately of all even positions (recto and verso pages usually have
   * mirrored margins). Unions only combine pages of the same size and rotation, so a
   * landscape insert doesn't widen the crop of the portrait pages. Empty pages take the
   * union of their group; null means "no crop".
   */
  function unionByParity(selection, boxes) {
    const unions = new Map();
    const keyOf = (pos, group) => `${pos % 2}|${group}`;
    selection.forEach((idx, pos) => {
      const info = idx === null ? null : boxes.get(idx);
      if (!info || !info.box) return;
      const b = info.box;
      const k = keyOf(pos, info.group);
      const u = unions.get(k);
      unions.set(k, u
        ? { left: Math.min(u.left, b.left), bottom: Math.min(u.bottom, b.bottom), right: Math.max(u.right, b.right), top: Math.max(u.top, b.top) }
        : { ...b });
    });
    return selection.map((idx, pos) => {
      const info = idx === null ? null : boxes.get(idx);
      if (!info) return null;
      return unions.get(keyOf(pos, info.group)) || unions.get(keyOf(pos + 1, info.group)) || null;
    });
  }

  root.BookletCrop = { contentBoxes, unionByParity };
})(typeof self !== 'undefined' ? self : this);
