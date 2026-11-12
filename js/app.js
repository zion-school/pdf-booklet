/*
 * Copyright (c) 2026 Zion Nursery & Primary School, Kovaipudur
 * Copyright (c) 2026 Jabez Winston
 * SPDX-License-Identifier: MIT
 * Date: 26-Sep-2026
 */
/* UI wiring: settings → sheet preview and folding animation → booklet PDF on download. */
(function () {
  'use strict';

  const I = window.Imposition;
  const Thumbs = window.BookletThumbs;
  const $ = (id) => document.getElementById(id);
  const EXAMPLE_PAGES = 16;
  const CROP_MARGINS = { outer: 5, inner: 8, top: 5, bottom: 7 };
  const MODE_NAMES = { fold2: 'Fold 2', quarto: 'Quarto', cutstack: 'Cut & stack' };

  const state = {
    bytes: null,
    name: '',
    fileId: 0,
    pageCount: 0,
    pages: null, // per source page: { visible, rotation } (see BookletRender.pageInfo)
    pageSize: null, // most common displayed page size, [w, h] in points
    mixedSizes: false,
    cropCache: new Map(), // source page index → content box (auto-crop)
    cropJob: null,
    paper: 'auto',
    flip: 'short',
    flipTouched: false,
    scale: 'fit',
    busy: false,
  };

  // ---------------------------------------------------------------------------
  // Settings

  const num = (id) => Math.max(0, Number($(id).value) || 0);
  const currentMode = () => document.querySelector('input[name="mode"]:checked').value;

  /** The sheet for a mode: the chosen one, or what Auto picks for the loaded PDF. */
  function paperFor(mode) {
    if (state.paper !== 'auto') return { paper: state.paper, auto: false, exact: null };
    if (!state.pageSize) return { paper: 'A4', auto: true, exact: null };
    return { ...I.autoPaper(mode, ...state.pageSize), auto: true };
  }

  function scaleValue() {
    if (state.scale === 'actual') return 1;
    if (state.scale === 'custom') {
      const p = Number($('scale-pct').value);
      return p > 0 ? p / 100 : 1;
    }
    return null; // fit
  }

  function settings() {
    const mode = currentMode();
    return {
      mode,
      paper: paperFor(mode).paper,
      flip: state.flip,
      sheetsPerSignature: Math.floor(num('signature')),
      pages: $('pages').value,
      crop: $('crop').checked,
      guides: $('guides').checked,
      margins: { outer: num('m-outer'), inner: num('m-inner'), top: num('m-top'), bottom: num('m-bottom') },
      scale: scaleValue(),
    };
  }

  function selectionFor(o) {
    if (!state.bytes) return Array.from({ length: EXAMPLE_PAGES }, (_, i) => i);
    return I.parsePageRange(o.pages, state.pageCount);
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const round = (v, d = 1) => String(Math.round(v * 10 ** d) / 10 ** d);
  const percent = (s) => `${Math.round(s * 100)}%`;

  /** "A6 · 105 × 148 mm", "Letter · 8.5 × 11 in", "123 × 456 mm". */
  function sizeText(wMm, hMm, name, us) {
    const dims = us
      ? `${round(wMm / 25.4, 2)} × ${round(hMm / 25.4, 2)} in`
      : `${round(wMm)} × ${round(hMm)} mm`;
    return name ? `${name} · ${dims}` : dims;
  }

  const usPaper = (paper) => paper === 'Letter' || paper === 'Legal';

  function cellLabel(mode, paper) {
    const g = I.sheetGeometry(mode, paper);
    return g.pageName || sizeText(g.cellMm[0], g.cellMm[1], null, usPaper(paper));
  }

  /** "A4", "Letter landscape", or null for a size without a name (see Imposition.describeSize). */
  const sizeName = (d) => d.name && `${d.name}${d.landscape ? ' landscape' : ''}`;

  function sourceSizeName() {
    const d = I.describeSize(...state.pageSize);
    return sizeName(d) || sizeText(d.wMm, d.hMm);
  }

  // ---------------------------------------------------------------------------
  // Auto-crop: analysed as soon as it is switched on, so the previews show the crop.

  function ensureCrop(selection) {
    const cache = state.cropCache;
    const todo = [...new Set(selection.filter((i) => i !== null && !cache.has(i)))];
    if (!todo.length) return Promise.resolve();
    if (state.cropJob) return state.cropJob.then(() => ensureCrop(selection));
    const job = (async () => {
      const doc = await Thumbs.doc();
      const found = await window.BookletCrop.contentBoxes(doc, todo, {
        onProgress: (d, t) => { if (cache === state.cropCache) progress(d / t, `Finding page margins… ${d}/${t}`); },
      });
      found.forEach((box, idx) => cache.set(idx, box));
    })();
    state.cropJob = job;
    const done = () => { if (state.cropJob === job) state.cropJob = null; };
    job.then(done, done);
    return job;
  }

  /** Crop box per booklet position, or null while the analysis hasn't covered the selection. */
  function cropBoxesNow(selection) {
    if (selection.some((i) => i !== null && !state.cropCache.has(i))) return null;
    return window.BookletCrop.unionByParity(selection, state.cropCache);
  }

  function startCrop(selection) {
    if (state.cropJob) return; // its completion calls update(), which starts what is still missing
    const cache = state.cropCache;
    ensureCrop(selection).then(() => {
      if (cache !== state.cropCache) return;
      if (!state.busy) progressDone();
      update();
    }, (e) => {
      if (cache !== state.cropCache) return;
      console.error(e);
      progressDone();
      setStatus(`Could not find the page margins: ${describeError(e)}`, true);
    });
  }

  // ---------------------------------------------------------------------------
  // Render everything that depends on the settings

  function layoutContext(o, selection) {
    let boxes = null;
    if (o.crop && state.bytes) {
      boxes = cropBoxesNow(selection);
      if (!boxes) startCrop(selection);
    }
    return {
      mode: o.mode, flip: o.flip, selection, geo: I.sheetGeometry(o.mode, o.paper),
      pages: state.pages, boxes, margin: I.marginPt(o.margins), scale: o.scale,
    };
  }

  function update() {
    const o = settings();
    const hasFile = !!state.bytes;

    document.querySelectorAll('[data-size]').forEach((node) => {
      const p = paperFor(node.dataset.size).paper;
      node.textContent = `${p} → ${cellLabel(node.dataset.size, p)}`;
    });
    renderPaper(o);
    $('more-summary').textContent = moreSummary(o);

    $('file-chip').hidden = !hasFile;
    $('dropzone').hidden = hasFile;
    $('choose').hidden = hasFile;
    $('download').hidden = !hasFile;

    let selection;
    let plan;
    try {
      selection = selectionFor(o);
      plan = I.impose({ mode: o.mode, pageCount: selection.length, sheetsPerSignature: o.sheetsPerSignature });
    } catch (e) {
      $('headline').textContent = 'Check the page selection';
      $('subline').textContent = e.message;
      $('bar-row').hidden = true;
      $('download').disabled = true;
      return;
    }
    $('download').disabled = state.busy;

    const ctx = layoutContext(o, selection);
    renderScale(o, ctx);
    renderHeadline(o, plan, selection);
    window.BookletPreview.renderLayout($('sheets'), plan, ctx);
    window.BookletPreview.renderLegend($('legend'), plan, ctx);
    updateAnimation(o, plan, ctx);
  }

  function renderPaper(o) {
    const pick = paperFor(o.mode);
    document.querySelectorAll('[data-seg="paper"] button').forEach((b) => {
      b.classList.toggle('auto-pick', pick.auto && b.dataset.value === pick.paper);
    });

    $('src-row').hidden = !state.pageSize;
    if (state.pageSize) {
      const d = I.describeSize(...state.pageSize);
      $('src-size').textContent = sizeText(d.wMm, d.hMm, sizeName(d), d.us)
        + (state.mixedSizes ? ' (most pages)' : '');
    }
    const [pw, ph] = I.PAPER[o.paper];
    $('sheet-size').textContent = sizeText(pw, ph, o.paper, usPaper(o.paper));
    const geo = I.sheetGeometry(o.mode, o.paper);
    $('page-size').textContent = sizeText(geo.cellMm[0], geo.cellMm[1], geo.pageName, usPaper(o.paper));

    let hint = '';
    if (pick.auto && !state.pageSize) {
      hint = 'Auto picks the sheet that keeps your pages at their real size.';
    } else if (pick.auto) {
      hint = pick.exact
        ? `Auto: ${pick.paper} keeps your ${sourceSizeName()} pages at 100%.`
        : `Auto: no sheet here keeps ${sourceSizeName()} pages at 100%, so it uses ${pick.paper} and scales them.`;
    } else if (state.pageSize) {
      const a = I.autoPaper(o.mode, ...state.pageSize);
      if (a.exact && a.paper !== o.paper) hint = `${a.paper} would keep your pages at 100%.`;
    }
    $('paper-hint').textContent = hint;
    $('paper-hint').hidden = !hint;
  }

  /** Scale readout for a typical page: the first selected page of the most common size. */
  function renderScale(o, ctx) {
    $('custom-scale').hidden = state.scale !== 'custom';
    let text;
    if (!state.pages) {
      text = 'Fit fills each slot. 100% prints pages at their real size.';
    } else {
      const pos = ctx.selection.findIndex((src) => src !== null && sameSize(state.pages[src]));
      const at = pos >= 0 ? pos : ctx.selection.findIndex((src) => src !== null);
      if (at < 0) {
        text = '';
      } else {
        const pl = window.BookletPreview.placement(ctx, at + 1, ctx.selection[at]);
        text = `Pages print at ${percent(pl.s)}.`;
        if (o.scale !== null && pl.clipped) text += ` That is larger than the page slot, so the edges are cut off (Fit is ${percent(pl.fit)}).`;
        else if (o.scale !== null) text += ` Fit would be ${percent(pl.fit)}.`;
      }
    }
    $('scale-hint').textContent = text;
    $('scale-hint').hidden = !text;
  }

  function displayedSize(info) {
    const d = I.toDisplay(info.visible, info.visible, info.rotation);
    return [d.right, d.top];
  }

  function sameSize(info) {
    if (!info || !state.pageSize) return false;
    const [w, h] = displayedSize(info);
    return Math.abs(w - state.pageSize[0]) < 2 && Math.abs(h - state.pageSize[1]) < 2;
  }

  function renderHeadline(o, plan, selection) {
    const sheets = plural(plan.sheets, 'sheet');
    if (!state.bytes) {
      $('headline').textContent = 'Choose a PDF to start';
      $('subline').textContent = `Or drop one anywhere on this page. Below: how a ${EXAMPLE_PAGES}-page example is laid out.`;
      $('bar-row').hidden = true;
      return;
    }
    $('bar-row').hidden = false;
    $('bar-summary').textContent = `${plural(selection.length, 'page')} → ${sheets}` + (plan.blanks ? ` · ${plan.blanks} blank` : '');

    $('headline').textContent = `${plural(selection.length, 'page')} → ${sheets}`;
    const parts = [`${MODE_NAMES[o.mode]} on ${o.paper}${plan.signatures.length > 1 ? `, in ${plan.signatures.length} signatures` : ''}.`];
    if (plan.blanks) {
      parts.push(`${plural(plan.blanks, 'blank page')} ${plan.blanks === 1 ? 'is' : 'are'} added at the end to fill the last sheet.`);
    }
    const perSig = plan.signatures[0].sheets;
    if (o.mode === 'quarto' && perSig > 3) {
      parts.push(`Folding ${perSig} sheets twice is hard; try 1–2 sheets per signature.`);
    } else if (perSig > 12) {
      parts.push(`${perSig} sheets in one fold is thick; consider signatures.`);
    }
    $('subline').textContent = parts.join(' ');
  }

  function moreSummary(o) {
    const pages = o.pages.trim() ? `Pages ${o.pages.trim()}` : 'All pages';
    const sig = o.sheetsPerSignature > 0 ? `${plural(o.sheetsPerSignature, 'sheet')} per signature` : '1 signature';
    return [pages, sig, o.crop ? 'Crop on' : 'No crop', o.guides ? 'Guides on' : 'No guides'].join(' · ');
  }

  // ---------------------------------------------------------------------------
  // Folding animation (built only while its tab is showing)

  const anim = window.BookletAnimation.create({
    stage: $('stage'), steps: $('anim-steps'), play: $('anim-play'), prev: $('anim-prev'),
    next: $('anim-next'), note: $('anim-note'), speed: $('anim-speed'),
    count: $('anim-count'), title: $('anim-title'), detail: $('anim-detail'),
  });
  let animModel = null;
  const foldVisible = () => !$('panel-fold').hidden;

  function updateAnimation(o, plan, ctx) {
    const key = JSON.stringify([
      state.fileId, o.mode, o.paper, o.flip, o.sheetsPerSignature, o.scale, o.margins, ctx.selection, !!ctx.boxes,
    ]);
    animModel = { key, mode: o.mode, flip: o.flip, plan, ctx };
    if (foldVisible()) anim.setup(animModel);
  }

  // ---------------------------------------------------------------------------
  // File loading

  /** Most common displayed page size, and whether there are others. */
  function dominantSize(pages) {
    const counts = new Map();
    for (const info of pages) {
      const [w, h] = displayedSize(info);
      const k = `${Math.round(w)}x${Math.round(h)}`;
      const c = counts.get(k) || { n: 0, size: [w, h] };
      c.n += 1;
      counts.set(k, c);
    }
    const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
    return { size: best.size, mixed: counts.size > 1 };
  }

  async function loadFile(file) {
    if (!file || state.busy) return;
    setStatus('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
      const pages = doc.getPages().map(window.BookletRender.pageInfo);
      if (!pages.length) throw new Error('This PDF has no pages.');
      const dom = dominantSize(pages);
      Object.assign(state, {
        bytes, name: file.name, fileId: state.fileId + 1, pageCount: pages.length, pages,
        pageSize: dom.size, mixedSizes: dom.mixed, cropCache: new Map(), cropJob: null,
      });
      progressDone();
      Thumbs.open(bytes).catch((e) => {
        console.error(e);
        setStatus(`Page previews are not available for this PDF (${describeError(e)}). The booklet can still be made.`, true);
      });
      $('file-name').textContent = file.name;
      $('file-name').title = file.name;
      $('file-pages').textContent = plural(state.pageCount, 'page');
    } catch (e) {
      setStatus(describeError(e), true);
    }
    $('file').value = '';
    update();
  }

  function describeError(e) {
    const msg = String((e && e.message) || e);
    if (/encrypt/i.test(msg)) {
      return 'This PDF is encrypted. Remove the protection first (for example: qpdf --decrypt in.pdf out.pdf).';
    }
    if (/No PDF header|Failed to parse|Invalid PDF/i.test(msg)) return 'That file does not look like a PDF.';
    return `Something went wrong: ${msg}`;
  }

  // ---------------------------------------------------------------------------
  // Download: build the booklet and save it

  async function download() {
    if (!state.bytes || state.busy) return;
    const o = settings();
    let selection;
    try {
      selection = selectionFor(o);
    } catch (e) {
      return;
    }
    state.busy = true;
    $('download').disabled = true;
    setButton('Preparing…');
    setStatus('');
    try {
      let boxes = null;
      if (o.crop) {
        await ensureCrop(selection);
        boxes = cropBoxesNow(selection);
      }
      progress(0, 'Laying out sheets…');
      const { bytes, plan } = await window.BookletRender.buildBooklet(state.bytes, { ...o, selection, boxes }, (d, t) => {
        progress(d / t, `Laying out sheets… ${d}/${t}`);
        setButton(`Building… ${Math.round((100 * d) / t)}%`);
      });
      setButton('Saving…');
      const name = `${state.name.replace(/\.pdf$/i, '') || 'booklet'}-booklet.pdf`;
      save(bytes, name);
      progressDone();
      setStatus(`Saved ${name}: ${plural(plan.sides.length, 'page')}, for ${plural(plan.sheets, 'sheet')} printed on both sides.`);
    } catch (e) {
      console.error(e);
      progressDone();
      setStatus(describeError(e), true);
    } finally {
      state.busy = false;
      setButton('Download booklet');
      update();
    }
  }

  function save(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function setButton(text) {
    $('download-text').textContent = text;
  }

  function progress(fraction, text) {
    $('progress').hidden = false;
    $('progress').value = fraction;
    setStatus(text);
  }

  function progressDone() {
    $('progress').hidden = true;
    setStatus('');
  }

  function setStatus(text, error = false) {
    $('status').textContent = text;
    $('status').classList.toggle('error', error);
  }

  // ---------------------------------------------------------------------------
  // Controls

  function setSegment(name, value) {
    document.querySelectorAll(`[data-seg="${name}"] button`).forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.value === value));
    });
    state[name] = value;
  }

  document.querySelectorAll('[data-seg]').forEach((group) => {
    group.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      const name = group.dataset.seg;
      if (name === 'flip') state.flipTouched = true;
      if (name === 'scale' && b.dataset.value === 'custom' && state.scale !== 'custom') {
        // Start from the scale the pages have now.
        const pct = /(\d+)%/.exec($('scale-hint').textContent);
        if (pct) $('scale-pct').value = pct[1];
      }
      setSegment(name, b.dataset.value);
      update();
      if (name === 'scale' && b.dataset.value === 'custom') $('scale-pct').focus();
    });
  });

  function onModeChange() {
    if (!state.flipTouched) setSegment('flip', I.MODES[currentMode()].naturalFlip);
    update();
  }

  function onCropChange() {
    const ids = ['m-outer', 'm-inner', 'm-top', 'm-bottom'];
    if ($('crop').checked && ids.every((id) => num(id) === 0)) {
      ids.forEach((id) => { $(id).value = CROP_MARGINS[id.slice(2)]; });
    }
    update();
  }

  $('controls').addEventListener('input', (e) => {
    if (e.target.name === 'mode') onModeChange();
    else if (e.target.id === 'crop') onCropChange();
    else update();
  });

  document.querySelectorAll('.step').forEach((b) => {
    b.addEventListener('click', () => {
      $('signature').value = Math.max(0, Math.floor(num('signature')) + Number(b.dataset.step));
      update();
    });
  });

  function setMore(open) {
    $('more-panel').hidden = !open;
    $('more-toggle').hidden = open;
    $('more-toggle').setAttribute('aria-expanded', String(open));
    (open ? $('pages') : $('more-toggle')).focus();
  }
  $('more-toggle').addEventListener('click', () => setMore(true));
  $('more-done').addEventListener('click', () => setMore(false));

  // Tabs (arrow keys move between them, as in the ARIA tabs pattern).
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function selectTab(id, focus = false) {
    for (const t of tabs) {
      const on = t.id === id;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    }
    if (foldVisible() && animModel) anim.setup(animModel);
    anim.show(foldVisible());
  }
  tabs.forEach((t) => t.addEventListener('click', () => selectTab(t.id)));
  document.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectTab(tabs[(next + tabs.length) % tabs.length].id, true);
  });

  $('download').addEventListener('click', download);
  document.querySelectorAll('[data-pick-file]').forEach((b) => b.addEventListener('click', () => $('file').click()));
  $('file').addEventListener('change', (e) => loadFile(e.target.files[0]));

  // Accept a PDF dropped anywhere on the page instead of letting the browser open it.
  window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const file = [...(e.dataTransfer?.files || [])].find((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
    if (file) loadFile(file);
  });

  onModeChange();
})();
