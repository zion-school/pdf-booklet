/*
 * Copyright (c) 2026 Zion Nursery & Primary School, Kovaipudur
 * Copyright (c) 2026 Jabez Winston
 * SPDX-License-Identifier: MIT
 * Date: 26-Sep-2026
 */
/*
 * Sheet diagrams: one card per sheet with its front and back, showing which page lands in
 * which slot, upside-down slots, blanks, and fold/cut lines, exactly as the PDF prints them.
 * With a PDF loaded, each slot shows the real page, placed, cropped and scaled as printed.
 * Global: window.BookletPreview.
 */
(function (root) {
  'use strict';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const pct = (v) => `${Math.round(v * 100000) / 1000}%`;

  /** Source page index printed in a slot, or null for a blank. */
  const srcOf = (ctx, sl) => (sl.page ? ctx.selection[sl.page - 1] ?? null : null);

  /**
   * How booklet page `page` (1-based position) is placed in its slot, or null when there is
   * no PDF to place (the numbered example).
   * @param {object} ctx { geo, pages: [{visible, rotation}] | null, boxes, margin (pt), scale }
   */
  function placement(ctx, page, src) {
    const info = ctx.pages && ctx.pages[src];
    if (!info) return null;
    const box = ctx.boxes && ctx.boxes[page - 1];
    return root.Imposition.placeInCell({
      ...info,
      crop: box ? root.Imposition.clipBox(box, info.visible) : null,
      cellW: ctx.geo.cellW, cellH: ctx.geo.cellH,
      margin: ctx.margin, recto: page % 2 === 1, scale: ctx.scale,
    });
  }

  /**
   * The printed content of one slot: a full-size layer (turned 180° for upside-down slots)
   * holding the page's window and image, or a blank.
   * @param {object} ctx see placement(); also selection, tier ('small' | 'large')
   * @param {{page: number|null, rot: number}} sl booklet position and rotation
   */
  function cellContent(ctx, sl, className = 'cell') {
    const src = srcOf(ctx, sl);
    const blank = src === null;
    const cell = el('div', `${className}${blank ? ' blank' : ''}`);
    if (blank) {
      cell.append(el('span', 'blank-tag', 'Blank'));
      return cell;
    }
    const layer = el('div', `cell-layer${sl.rot ? ' flipped' : ''}`);
    const pl = placement(ctx, sl.page, src);
    if (!pl) {
      layer.append(el('span', 'cell-num', String(src + 1)));
    } else {
      const { geo } = ctx;
      const w = pl.window;
      const win = el('div', 'win');
      win.style.left = pct(w.x / geo.cellW);
      win.style.top = pct((geo.cellH - w.y - w.h) / geo.cellH);
      win.style.width = pct(w.w / geo.cellW);
      win.style.height = pct(w.h / geo.cellH);
      win.append(el('span', 'ph', String(src + 1)));
      const img = el('img');
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.style.left = pct((pl.page.x - w.x) / w.w);
      img.style.top = pct((w.y + w.h - pl.page.y - pl.page.h) / w.h);
      img.style.width = pct(pl.page.w / w.w);
      img.style.height = pct(pl.page.h / w.h);
      root.BookletThumbs.bind(img, src, ctx.tier);
      win.append(img);
      layer.append(win, el('span', 'folio', String(src + 1)));
    }
    cell.append(layer);
    return cell;
  }

  const EAGER = 24; // cards filled straight away; the rest when they come near the viewport
  let observer = null;

  /** Fill cards and load page images only for sheets near the viewport. */
  function watch(container, cards) {
    if (observer) observer.disconnect();
    observer = null;
    const lazy = cards.filter((c) => c._fill || c._pages.length);
    if (!lazy.length) return;
    const scroller = container.closest('.workspace');
    const rootEl = scroller && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY) ? scroller : null;
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const card = e.target;
        if (e.isIntersecting && card._fill) {
          card._fill();
          card._fill = null;
        }
        for (const src of card._pages) {
          if (e.isIntersecting) root.BookletThumbs.request(src, 'small');
          else root.BookletThumbs.cancel(src, 'small');
        }
      }
    }, { root: rootEl, rootMargin: '600px 0px' });
    lazy.forEach((c) => observer.observe(c));
  }

  /**
   * @param {HTMLElement} container
   * @param {object} plan from Imposition.impose
   * @param {object} ctx mode, flip, selection (0-based source indices or null), geo, and the
   *   placement fields (see placement())
   */
  function renderLayout(container, plan, ctx) {
    const frag = document.createDocumentFragment();
    const cards = [];

    for (let i = 0; i < plan.sides.length; i += 2) {
      const front = plan.sides[i];
      const back = plan.sides[i + 1];
      const card = el('article', 'sheet');
      const head = el('div', 'sheet-head');
      const title = `Sheet ${front.sheet + 1}` + (plan.signatures.length > 1 ? ` · signature ${front.sig + 1}` : '');
      head.append(el('h2', '', title), el('span', '', `PDF p. ${i + 1}–${i + 2}`));
      const sides = el('div', 'sides');
      const figures = [sideFigure(front, ctx, 'Front'), sideFigure(back, ctx, 'Back')];
      sides.append(...figures.map((f) => f.fig));
      card.append(head, sides);
      card._fill = () => figures.forEach((f) => f.fill());
      if (cards.length < EAGER) {
        card._fill();
        card._fill = null;
      }
      card._pages = ctx.pages
        ? [...new Set([front, back].flatMap((sd) => sd.slots).map((sl) => srcOf(ctx, sl)).filter((src) => src !== null))]
        : [];
      cards.push(card);
      frag.append(card);
    }
    container.replaceChildren(frag);
    container.classList.toggle('real', !!ctx.pages);
    watch(container, cards);
  }

  /** An empty sheet side, with fill() to draw its slots. */
  function sideFigure(sd, ctx, face) {
    const { geo } = ctx;
    const fig = el('figure', 'side');
    const paper = el('div', 'sheet-paper');
    paper.style.setProperty('--cols', geo.cols);
    paper.style.setProperty('--rows', geo.rows);
    paper.style.setProperty('--ratio', `${geo.width} / ${geo.height}`);
    const slots = root.Imposition.finalSlots(sd, ctx.mode, ctx.flip);
    const labels = slots.map((sl) => {
      const src = srcOf(ctx, sl);
      return { col: sl.col, row: sl.row, text: src === null ? 'blank' : `${src + 1}${sl.rot ? ' upside down' : ''}` };
    });
    labels.sort((a, b) => a.row - b.row || a.col - b.col);
    paper.setAttribute('role', 'img');
    paper.setAttribute('aria-label', `${face}: ${labels.map((l) => l.text).join(', ')}`);
    fig.append(paper, el('figcaption', '', face));

    function fill() {
      for (const sl of slots) {
        const cell = cellContent(ctx, sl);
        cell.style.gridColumn = sl.col + 1;
        cell.style.gridRow = sl.row + 1;
        paper.append(cell);
      }
      paper.append(el('div', 'line v'));
      if (ctx.mode === 'quarto') paper.append(el('div', 'line h'));
      if (ctx.mode === 'cutstack') paper.append(el('div', 'line h cut'));
    }
    return { fig, fill };
  }

  /** Legend entries that apply to the current layout. */
  function renderLegend(container, plan, ctx) {
    const I = root.Imposition;
    const item = (keyClass, text, keyText) => {
      const span = el('span');
      const key = el('span', keyClass, keyText);
      key.setAttribute('aria-hidden', 'true');
      span.append(key, text);
      return span;
    };
    const flipped = plan.sides.some((sd) => I.finalSlots(sd, ctx.mode, ctx.flip).some((s) => s.rot));
    const blanks = plan.blanks > 0 || ctx.selection.some((s) => s === null);
    const items = [item('key-fold', 'Fold')];
    if (ctx.mode === 'cutstack') items.push(item('key-cut', 'Cut'));
    if (flipped) items.push(item('key-flip', 'Printed upside down, on purpose', '7'));
    if (blanks) items.push(item('key-blank', 'Blank page'));
    items.push(el('span', '', 'Numbers are pages of your PDF.'));
    container.replaceChildren(...items);
  }

  root.BookletPreview = { renderLayout, renderLegend, cellContent, placement };
})(typeof self !== 'undefined' ? self : this);
