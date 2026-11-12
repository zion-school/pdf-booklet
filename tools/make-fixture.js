/*
 * Copyright (c) 2026 Zion Nursery & Primary School, Kovaipudur
 * Copyright (c) 2026 Jabez Winston
 * SPDX-License-Identifier: MIT
 * Date: 26-Sep-2026
 */
'use strict';
// Numbered test PDF: node tools/make-fixture.js [pages=20] [out=fixture.pdf]
// Each page shows a large "P<n>", a "TOP" marker with a triangle, and a frame inset from
// the page edge (white margin for auto-crop). Page 7 is landscape; page 9 is stored
// landscape with /Rotate 90 so it displays portrait.
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb, degrees } = require('../vendor/pdf-lib.min.js');

async function main() {
  const count = Number(process.argv[2] || 20);
  const out = process.argv[3] || 'fixture.pdf';
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const A4 = [595.28, 841.89];

  for (let n = 1; n <= count; n++) {
    const landscape = n === 7;
    const rotated = n === 9;
    const [w, h] = landscape || rotated ? [A4[1], A4[0]] : A4;
    const page = doc.addPage([w, h]);
    if (rotated) page.setRotation(degrees(90));

    // Draw in the displayed frame: for /Rotate 90 the displayed top is content x = 0.
    const dw = rotated ? h : w;
    const dh = rotated ? w : h;
    const at = (x, y) => (rotated ? { x: dh - y, y: x } : { x, y });
    const rot = rotated ? degrees(90) : degrees(0);
    const inset = 60;
    const color = n % 2 ? rgb(0.1, 0.3, 0.7) : rgb(0.7, 0.2, 0.1);

    const corner = at(inset, inset);
    page.drawRectangle({
      ...corner, width: dw - 2 * inset, height: dh - 2 * inset, rotate: rot,
      borderColor: color, borderWidth: 3,
    });
    const label = `P${n}`;
    const size = Math.min(dw, dh) / 3;
    const tw = font.widthOfTextAtSize(label, size);
    page.drawText(label, { ...at((dw - tw) / 2, dh / 2 - size / 3), size, font, color, rotate: rot });
    const top = 'TOP';
    const ts = 36;
    page.drawText(top, { ...at((dw - font.widthOfTextAtSize(top, ts)) / 2, dh - inset - 90), size: ts, font, color, rotate: rot });
    const tri = [at(dw / 2 - 25, dh - inset - 45), at(dw / 2 + 25, dh - inset - 45), at(dw / 2, dh - inset - 10)];
    page.drawSvgPath(`M ${tri[0].x} ${h - tri[0].y} L ${tri[1].x} ${h - tri[1].y} L ${tri[2].x} ${h - tri[2].y} Z`, {
      x: 0, y: h, color,
    });
  }

  fs.writeFileSync(out, await doc.save());
  console.log(`wrote ${out} (${count} pages)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
