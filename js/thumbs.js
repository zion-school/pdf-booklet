/*
 * Copyright (c) 2026 Zion Nursery & Primary School, Kovaipudur
 * Copyright (c) 2026 Jabez Winston
 * SPDX-License-Identifier: MIT
 * Date: 12-Nov-2026
 */
/*
 * Page images for the previews, rendered with pdf.js. One pdf.js document is kept per loaded
 * file (auto-crop uses it too). Pages render one at a time, only when something asks for
 * them, and are cached as JPEG object URLs. Images bound with bind() update themselves.
 * Browser only. Global: window.BookletThumbs.
 */
(function (root) {
  'use strict';

  // Longest side of a rendered page, in CSS pixels (times the device pixel ratio, up to 2).
  const TIERS = { small: 240, large: 560 };

  let pdfjsReady = null;
  let session = null; // { doc: Promise, cache: Map(key → url), queue: Map(key → {idx, tier}), closed }
  let pumping = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.append(s);
    });
  }

  /** Load pdf.js once. */
  function ensurePdfjs() {
    if (!pdfjsReady) {
      pdfjsReady = (async () => {
        if (!root.pdfjsLib) {
          // Loading the worker as a plain script lets pdf.js run on the main thread, which
          // also works when this page is opened straight from disk (file://).
          await loadScript('vendor/pdf.worker.min.js');
          await loadScript('vendor/pdf.min.js');
        }
        root.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
        return root.pdfjsLib;
      })();
      pdfjsReady.catch(() => { pdfjsReady = null; });
    }
    return pdfjsReady;
  }

  const key = (idx, tier) => `${idx}:${tier}`;

  /** Start a session for a new file. Returns the pdf.js document promise. */
  function open(bytes) {
    close();
    const s = { cache: new Map(), queue: new Map(), closed: false };
    s.doc = ensurePdfjs().then((pdfjs) => pdfjs.getDocument({
      data: bytes.slice(0), isEvalSupported: false, verbosity: 0,
    }).promise);
    s.doc.catch(() => {}); // reported by whoever awaits doc()
    session = s;
    return s.doc;
  }

  function close() {
    const s = session;
    if (!s) return;
    session = null;
    s.closed = true;
    s.queue.clear();
    s.doc.then((d) => d.destroy()).catch(() => {});
    for (const url of s.cache.values()) URL.revokeObjectURL(url);
  }

  /** The pdf.js document of the current file. */
  function doc() {
    return session ? session.doc : Promise.reject(new Error('No PDF loaded'));
  }

  /** Best available image for a page: the asked-for tier, else the other one, else null. */
  function url(idx, tier = 'small') {
    if (!session) return null;
    return session.cache.get(key(idx, tier)) || session.cache.get(key(idx, tier === 'small' ? 'large' : 'small')) || null;
  }

  /** Ask for a page image. Large requests go first. */
  function request(idx, tier = 'small') {
    const s = session;
    if (!s || s.cache.has(key(idx, tier)) || s.cache.has(key(idx, 'large'))) return;
    s.queue.set(key(idx, tier), { idx, tier });
    pump();
  }

  /** Drop a request that is no longer needed (for example, a sheet scrolled out of view). */
  function cancel(idx, tier = 'small') {
    if (session) session.queue.delete(key(idx, tier));
  }

  /** Show page idx in img, now if it is rendered and otherwise once it is. */
  function bind(img, idx, tier = 'small') {
    img.dataset.thumb = idx;
    img.dataset.tier = tier;
    const u = url(idx, tier);
    if (u) img.src = u;
  }

  function next(s) {
    for (const [k, item] of s.queue) {
      if (item.tier === 'large') { s.queue.delete(k); return item; }
    }
    const first = s.queue.entries().next().value;
    if (!first) return null;
    s.queue.delete(first[0]);
    return first[1];
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const s = session;
        const item = s && next(s);
        if (!item) break;
        if (s.cache.has(key(item.idx, 'large'))) continue; // already have something at least as good
        let u = null;
        try {
          u = await render(await s.doc, item.idx, item.tier);
        } catch (e) {
          console.warn(`Page ${item.idx + 1}: no preview`, e);
        }
        if (s.closed) {
          if (u) URL.revokeObjectURL(u);
          continue;
        }
        if (u) {
          s.cache.set(key(item.idx, item.tier), u);
          document.querySelectorAll(`img[data-thumb="${item.idx}"]`).forEach((img) => {
            if (img.dataset.tier === item.tier || !img.getAttribute('src')) img.src = u;
          });
        }
        await new Promise((r) => setTimeout(r, 0)); // let the page breathe between renders
      }
    } finally {
      pumping = false;
    }
  }

  async function render(pdf, idx, tier) {
    const page = await pdf.getPage(idx + 1);
    try {
      const base = page.getViewport({ scale: 1 });
      const px = TIERS[tier] * Math.min(2, root.devicePixelRatio || 1);
      const vp = page.getViewport({ scale: px / Math.max(base.width, base.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(vp.width));
      canvas.height = Math.max(1, Math.round(vp.height));
      await paint(page, vp, canvas.getContext('2d'));
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
      return blob ? URL.createObjectURL(blob) : null;
    } finally {
      page.cleanup();
    }
  }

  /** Render a pdf.js page onto the (already sized) canvas of ctx, on white. */
  function paint(page, vp, ctx) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    // Annotations are not carried into the booklet, so leave them out here too. The print
    // intent renders without requestAnimationFrame, which stalls in background tabs.
    return page.render({
      canvasContext: ctx, viewport: vp, intent: 'print', annotationMode: root.pdfjsLib.AnnotationMode.DISABLE,
    }).promise;
  }

  root.BookletThumbs = { open, doc, request, cancel, bind, paint };
})(typeof self !== 'undefined' ? self : this);
