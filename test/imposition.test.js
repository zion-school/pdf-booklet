/*
 * Copyright (c) 2026 Zion Nursery & Primary School, Kovaipudur
 * Copyright (c) 2026 Jabez Winston
 * SPDX-License-Identifier: MIT
 * Date: 26-Sep-2026
 */
'use strict';
// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../js/imposition.js');

// ---------------------------------------------------------------------------
// Reference data from pdfbook4-logic.txt: (k, n, N, i)

test('quarto formula matches the reference table in pdfbook4-logic.txt', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pdfbook4-logic.txt'), 'utf8');
  const rows = [...src.matchAll(/\((\d+),(\d+),(\d+),(\d+)\)/g)].map((m) => m.slice(1).map(Number));
  assert.equal(rows.length, 80);
  for (const [k, n, N, i] of rows) {
    assert.equal(I.quartoF(k, n), N, `f(${k},${n})`);
    assert.equal(I.quartoG(k, n), i, `g(${k},${n})`);
  }
});

// ---------------------------------------------------------------------------
// Physical model: lay the printed sheets in front of you, fold them, read the booklet.
// A panel is one grid cell of one sheet layer. `up` is the face towards the viewer, read
// directly; `down` is the face away from the viewer, read after turning the panel over a
// vertical axis, as a reader turns a leaf. rot is how far the content is turned (0 = upright).

const turn = (f, by) => ({ page: f.page, rot: (f.rot + by) % 360 });

function buildSheet(front, back, mode, flip) {
  const m = I.MODES[mode];
  const panels = new Map();
  for (const s of I.finalSlots(front, mode, flip)) {
    panels.set(`${s.col},${s.row}`, { col: s.col, row: s.row, up: { page: s.page, rot: s.rot } });
  }
  const vertical = flip === m.naturalFlip; // natural flip turns the sheet over a vertical axis
  for (const s of I.finalSlots(back, mode, flip)) {
    const col = vertical ? m.cols - 1 - s.col : s.col;
    const row = vertical ? s.row : m.rows - 1 - s.row;
    const p = panels.get(`${col},${row}`);
    assert.ok(p && !p.down, 'back slot must sit behind exactly one front slot');
    p.down = { page: s.page, rot: vertical ? s.rot : (s.rot + 180) % 360 };
  }
  return [...panels.values()];
}

// Fold the half with col/row == `moving` back behind the rest.
function foldBack(stack, axis, moving) {
  const key = axis === 'vertical' ? 'col' : 'row';
  const flipRot = axis === 'vertical' ? 0 : 180;
  const stay = stack.map((layer) => layer.filter((p) => p[key] !== moving).map((p) => ({ ...p, [key]: 0 })));
  const moved = stack
    .map((layer) => layer.filter((p) => p[key] === moving).map((p) => ({
      ...p, [key]: 0, up: turn(p.down, flipRot), down: turn(p.up, flipRot),
    })))
    .reverse();
  return [...stay, ...moved];
}

// Turn a stack of one-row strips 180° in the plane.
function spin(stack, cols) {
  return stack.map((layer) => layer.map((p) => ({
    ...p, col: cols - 1 - p.col, row: 0, up: turn(p.up, 180), down: turn(p.down, 180),
  })));
}

function assemble(plan, flip) {
  const { mode } = plan;
  const leaves = [];
  for (const sig of plan.signatures) {
    const sides = plan.sides.filter((s) => s.sig === sig.index);
    let stack = [];
    for (let i = 0; i < sides.length; i += 2) {
      assert.equal(sides[i].face, 'front');
      assert.equal(sides[i + 1].face, 'back');
      assert.equal(sides[i].sheet, sides[i + 1].sheet);
      stack.push(buildSheet(sides[i], sides[i + 1], mode, flip)); // first printed sheet on top
    }
    if (mode === 'fold2') {
      stack = foldBack(stack, 'vertical', 0);
    } else if (mode === 'quarto') {
      stack = foldBack(stack, 'horizontal', 0); // top half back and down
      stack = foldBack(stack, 'vertical', 0); // left half behind the right
    } else if (mode === 'cutstack') {
      // Cut each sheet; its bottom half, turned upright, goes under its top half.
      stack = stack.flatMap((l) => [
        l.filter((p) => p.row === 0),
        ...spin([l.filter((p) => p.row === 1)], 2),
      ]);
      stack = foldBack(stack, 'vertical', 0);
    }
    for (const layer of stack) {
      assert.equal(layer.length, 1, 'every layer folds down to one leaf');
      leaves.push(layer[0]);
    }
  }
  return leaves;
}

for (const mode of Object.keys(I.MODES)) {
  for (const flip of ['long', 'short']) {
    test(`${mode}, ${flip}-edge flip: folded booklet reads 1..N upright`, () => {
      for (let pageCount = 1; pageCount <= 90; pageCount += 1) {
        for (const sheetsPerSignature of [0, 1, 2, 3, 5]) {
          const plan = I.impose({ mode, pageCount, sheetsPerSignature });
          assert.equal(plan.paddedCount % I.MODES[mode].perSheet, 0);
          assert.ok(plan.blanks < I.MODES[mode].perSheet * Math.max(1, plan.signatures.length));
          const leaves = assemble(plan, flip);
          assert.equal(leaves.length * 2, plan.paddedCount);
          leaves.forEach((leaf, j) => {
            const recto = 2 * j + 1;
            const verso = 2 * j + 2;
            const expect = (n) => ({ page: n <= pageCount ? n : null, rot: 0 });
            const where = `${mode} pages=${pageCount} sig=${sheetsPerSignature} leaf ${j + 1}`;
            assert.deepEqual(leaf.up, expect(recto), `${where} recto`);
            assert.deepEqual(leaf.down, expect(verso), `${where} verso`);
          });
        }
      }
    });
  }
}

test('large single-signature quarto', () => {
  for (const k of [10, 29, 30]) {
    const plan = I.impose({ mode: 'quarto', pageCount: 8 * k });
    const leaves = assemble(plan, 'long');
    assert.deepEqual(leaves.map((l) => l.up.page), Array.from({ length: 4 * k }, (_, j) => 2 * j + 1));
  }
});

test('cut & stack matches pdfcpu booklet n=4 (16 pages, A4)', () => {
  // From `pdfcpu booklet -- "formsize:A4" out.pdf 4 in.pdf`, sides as [TL, TR, BL, BR].
  const pdfcpu = [[16, 1, 3, 14], [2, 15, 13, 4], [12, 5, 7, 10], [6, 11, 9, 8]];
  const plan = I.impose({ mode: 'cutstack', pageCount: 16 });
  assert.deepEqual(plan.sides.map((s) => s.slots.map((sl) => sl.page)), pdfcpu);
  assert.deepEqual(plan.sides.map((s) => s.slots.map((sl) => sl.rot)), pdfcpu.map(() => [0, 0, 180, 180]));
});

test('signature split', () => {
  const plan = I.impose({ mode: 'fold2', pageCount: 30, sheetsPerSignature: 3 });
  assert.deepEqual(plan.signatures.map((s) => [s.firstPage, s.sheets]), [[1, 3], [13, 3], [25, 2]]);
  assert.equal(plan.paddedCount, 32);
  assert.equal(plan.blanks, 2);
});

test('sheet geometry names the booklet page size', () => {
  assert.equal(I.sheetGeometry('fold2', 'A4').pageName, 'A5');
  assert.equal(I.sheetGeometry('fold2', 'A5').pageName, 'A6');
  assert.equal(I.sheetGeometry('quarto', 'A4').pageName, 'A6');
  assert.equal(I.sheetGeometry('cutstack', 'A3').pageName, 'A5');
  const g = I.sheetGeometry('fold2', 'A4');
  assert.ok(Math.abs(g.width - 841.89) < 0.01 && Math.abs(g.height - 595.28) < 0.01);
});

test('parsePageRange', () => {
  assert.deepEqual(I.parsePageRange('', 3), [0, 1, 2]);
  assert.deepEqual(I.parsePageRange('all', 2), [0, 1]);
  assert.deepEqual(I.parsePageRange('1-3, 5', 6), [0, 1, 2, 4]);
  assert.deepEqual(I.parsePageRange('4-', 6), [3, 4, 5]);
  assert.deepEqual(I.parsePageRange('-2', 6), [0, 1]);
  assert.deepEqual(I.parsePageRange('3-1', 6), [2, 1, 0]);
  assert.deepEqual(I.parsePageRange('1,b,2', 6), [0, null, 1]);
  assert.deepEqual(I.parsePageRange('odd', 5), [0, 2, 4]);
  assert.deepEqual(I.parsePageRange('even', 5), [1, 3]);
  assert.throws(() => I.parsePageRange('7', 6), /out of range/);
  assert.throws(() => I.parsePageRange('x', 6), /Bad page range/);
  assert.throws(() => I.parsePageRange('0', 6), /out of range/);
});

// ---------------------------------------------------------------------------
// Page size detection and placement

const pt = (mm) => mm * I.PT_PER_MM;

test('autoPaper picks the sheet that keeps pages at 100%, else A4 or Letter', () => {
  const cases = [
    ['fold2', 105, 148, 'A5', true],
    ['quarto', 105, 148, 'A4', true],
    ['cutstack', 105, 148, 'A4', true],
    ['fold2', 148, 210, 'A4', true],
    ['fold2', 210, 297, 'A3', true],
    ['quarto', 148, 210, 'A3', true],
    ['quarto', 210, 297, 'A4', false],
    ['fold2', 139.7, 215.9, 'Letter', true],
    ['fold2', 215.9, 279.4, 'Letter', false],
    ['fold2', 297, 210, 'A4', false], // landscape pages never match a portrait slot
    ['fold2', 152.4, 228.6, 'A4', false], // 6 × 9 in: not a US paper size
  ];
  for (const [mode, w, h, paper, exact] of cases) {
    assert.deepEqual(I.autoPaper(mode, pt(w), pt(h)), { paper, exact }, `${mode} ${w}×${h}`);
  }
});

test('describeSize names sizes in either orientation', () => {
  assert.equal(I.describeSize(pt(105), pt(148)).name, 'A6');
  const letter = I.describeSize(792, 612);
  assert.deepEqual([letter.name, letter.landscape, letter.us], ['Letter', true, true]);
  assert.equal(I.describeSize(pt(100), pt(100)).name, null);
  assert.equal(I.sheetGeometry('fold2', 'Letter').pageName, 'Half Letter');
});

test('toDisplay and fromDisplay are inverses for every rotation', () => {
  const V = { left: 10, bottom: 20, right: 310, top: 520 };
  const b = { left: 40, bottom: 70, right: 200, top: 300 };
  for (const r of [0, 90, 180, 270]) {
    const d = I.toDisplay(b, V, r);
    assert.ok(d.right > d.left && d.top > d.bottom, `r=${r} keeps the box ordered`);
    assert.deepEqual(I.fromDisplay(d, V, r), b, `r=${r}`);
  }
  // /Rotate 90 is clockwise: the page's left edge ends up on top.
  assert.deepEqual(I.toDisplay({ left: 10, bottom: 20, right: 11, top: 520 }, V, 90), { left: 0, right: 500, bottom: 299, top: 300 });
});

test('placeInCell with fit reproduces the original placement', () => {
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
  const V = { left: 0, bottom: 0, right: 595, top: 842 };
  const crop = { left: 50, bottom: 80, right: 500, top: 760 };
  const margin = I.marginPt({ outer: 5, inner: 12, top: 4, bottom: 8 });
  const cellW = 300;
  const cellH = 420;
  for (const rotation of [0, 90, 180, 270]) {
    for (const recto of [true, false]) {
      for (const box of [null, crop]) {
        const b = box || V;
        const bw = b.right - b.left;
        const bh = b.top - b.bottom;
        const [dw, dh] = rotation % 180 ? [bh, bw] : [bw, bh];
        const left = recto ? margin.inner : margin.outer;
        const right = recto ? margin.outer : margin.inner;
        const cw = cellW - left - right;
        const ch = cellH - margin.top - margin.bottom;
        const s = Math.min(cw / dw, ch / dh);
        const pl = I.placeInCell({ visible: V, crop: box, rotation, cellW, cellH, margin, recto, scale: null });
        const msg = `rot ${rotation} recto ${recto} crop ${!!box}`;
        near(pl.s, s, msg);
        near(pl.window.x, left + (cw - dw * s) / 2, msg);
        near(pl.window.y, margin.bottom + (ch - dh * s) / 2, msg);
        near(pl.window.w, dw * s, msg);
        near(pl.window.h, dh * s, msg);
        for (const k of ['left', 'bottom', 'right', 'top']) near(pl.windowSrc[k], b[k], `${msg} ${k}`);
        assert.equal(pl.clipped, false);
      }
    }
  }
});

test('placeInCell past fit crops evenly and maps the window back to the page', () => {
  const V = { left: 0, bottom: 0, right: 200, top: 300 };
  const pl = I.placeInCell({ visible: V, cellW: 100, cellH: 150, scale: 1 });
  assert.equal(pl.fit, 0.5);
  assert.equal(pl.clipped, true);
  assert.deepEqual(pl.window, { x: 0, y: 0, w: 100, h: 150 });
  assert.deepEqual(pl.windowSrc, { left: 50, bottom: 75, right: 150, top: 225 });
  assert.deepEqual(pl.page, { x: -50, y: -75, w: 200, h: 300 });

  // Any rotation: the window, read back through toDisplay, is the part of the page it shows.
  const margin = { outer: 6, inner: 14, top: 3, bottom: 9 };
  for (const rotation of [0, 90, 180, 270]) {
    for (const scale of [1, 1.5]) {
      const p = I.placeInCell({ visible: V, rotation, cellW: 150, cellH: 180, margin, recto: false, scale });
      const d = I.toDisplay(p.windowSrc, V, rotation);
      const msg = `rot ${rotation} scale ${scale}`;
      assert.ok(Math.abs(p.page.x + d.left * scale - p.window.x) < 1e-9, msg);
      assert.ok(Math.abs(p.page.y + d.bottom * scale - p.window.y) < 1e-9, msg);
      assert.ok(Math.abs((d.right - d.left) * scale - p.window.w) < 1e-9, msg);
      assert.ok(Math.abs((d.top - d.bottom) * scale - p.window.h) < 1e-9, msg);
      // The window fills the content area: the page is larger than the slot either way.
      assert.ok(Math.abs(p.window.x - margin.outer) < 1e-9 && Math.abs(p.window.w - (150 - 20)) < 1e-9, msg);
    }
  }
});
