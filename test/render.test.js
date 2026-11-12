/*
 * Copyright (c) 2026 Zion Nursery & Primary School, Kovaipudur
 * Copyright (c) 2026 Jabez Winston
 * SPDX-License-Identifier: MIT
 * Date: 26-Sep-2026
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, degrees } = require('../vendor/pdf-lib.min.js');
const { buildBooklet } = require('../js/render.js');
const I = require('../js/imposition.js');

async function source(count) {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= count; n++) {
    const page = doc.addPage(n === 3 ? [842, 595] : [595, 842]);
    if (n === 3) page.setRotation(degrees(90));
    if (n !== 5) page.drawRectangle({ x: 50, y: 50, width: 100, height: 100 }); // page 5: no content stream
  }
  return doc.save();
}

for (const mode of Object.keys(I.MODES)) {
  test(`buildBooklet ${mode}`, async () => {
    const src = await source(11);
    const { bytes, plan } = await buildBooklet(src, {
      mode, paper: 'A4', flip: 'long', sheetsPerSignature: 0, guides: true,
      margins: { outer: 5, inner: 8, top: 5, bottom: 7 },
    });
    const out = await PDFDocument.load(bytes);
    assert.equal(out.getPageCount(), plan.sides.length);
    const geo = I.sheetGeometry(mode, 'A4');
    for (const page of out.getPages()) {
      const { width, height } = page.getSize();
      assert.ok(Math.abs(width - geo.width) < 0.01 && Math.abs(height - geo.height) < 0.01);
    }
  });
}

test('selection with blanks and crop boxes', async () => {
  const src = await source(4);
  const { plan } = await buildBooklet(src, {
    mode: 'fold2', paper: 'A5', flip: 'short', selection: [0, null, 1, 2, 3],
    boxes: [{ left: 40, bottom: 40, right: 200, top: 200 }, null, null, null, null],
  });
  assert.equal(plan.pageCount, 5);
  assert.equal(plan.paddedCount, 8);
});

test('scaling past fit embeds only the part of each page that prints', async () => {
  const { PDFName, PDFDict, PDFArray } = require('../vendor/pdf-lib.min.js');
  const src = await source(4);
  for (const scale of [1, 1.5]) {
    const { bytes } = await buildBooklet(src, { mode: 'fold2', paper: 'A5', flip: 'short', scale });
    const out = await PDFDocument.load(bytes);
    const xobjects = out.getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict);
    const boxes = xobjects.entries().map(([, ref]) => out.context.lookup(ref).dict.lookup(PDFName.of('BBox'), PDFArray).asArray().map((n) => n.asNumber()));
    const geo = I.sheetGeometry('fold2', 'A5');
    // Page 1 is an A4 page (595 × 842) on the right of the first sheet's front: recto.
    const pl = I.placeInCell({ visible: { left: 0, bottom: 0, right: 595, top: 842 }, cellW: geo.cellW, cellH: geo.cellH, scale });
    const want = [pl.windowSrc.left, pl.windowSrc.bottom, pl.windowSrc.right, pl.windowSrc.top];
    assert.ok(boxes.some((b) => b.every((v, k) => Math.abs(v - want[k]) < 0.01)), `scale ${scale}: ${JSON.stringify(boxes)} has ${want}`);
    assert.ok(pl.clipped, 'an A4 page at 100% does not fit an A6 slot');
  }
});
