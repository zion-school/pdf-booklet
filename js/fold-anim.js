/*
 * Copyright (c) 2026 Zion Nursery & Primary School, Kovaipudur
 * Copyright (c) 2026 Jabez Winston
 * SPDX-License-Identifier: MIT
 * Date: 12-Nov-2026
 */
/*
 * Folding animation: the printed sheets, with their real pages, in 3D. They get stacked,
 * folded (and cut), stapled, step by step and slowly, so you can follow along with your own
 * printouts. CSS 3D transforms, tweened on requestAnimationFrame.
 *
 * Each mode has a "rig": nested elements whose transforms depend on a few parameters
 * (fan, turn, fold, cut, ...). A timeline is a list of frames, each setting some parameters.
 * Each element keeps the same list of transform functions in every frame, so the browser
 * interpolates the angles themselves.
 *
 * Physical model, as in test/imposition.test.js: the back of a sheet is what you see after
 * turning it over a vertical axis, which is the back as laid out for the mode's natural
 * duplex flip. With the other flip the PDF turns every back by 180°, and the printer turns it
 * back, so the paper in the user's hands is the same either way.
 *
 * Global: window.BookletAnimation.
 */
(function (root) {
  'use strict';

  const SHOW_MAX = 4; // sheets shown at most (the outermost ones of the first signature)
  const STAGE_W = 800;
  const STAGE_H = 540;
  const LONG = 420; // longer side of a sheet, logical px
  const D = 2; // gap between layers of a stack
  const AXIS = -D / 2; // depth of a fold axis: half a gap below the layer that folds
  const FAN_Z = 10; // gap between sheets fanned out
  const SPEED = { slow: 1, normal: 1.9 };
  const STEP_PAUSE = 1100;

  const reduceMotion = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function div(className, parent) {
    const node = document.createElement('div');
    node.className = className;
    if (parent) parent.append(node);
    return node;
  }

  function place(node, x, y, w, h) {
    Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    return node;
  }

  const NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

  /** Interpolate the numbers of two strings that differ only in their numbers. */
  function lerpText(a, b, t) {
    const from = a.match(NUMBER) || [];
    const to = b.match(NUMBER) || [];
    if (from.length !== to.length) return t < 0.5 ? a : b;
    let i = 0;
    return b.replace(NUMBER, () => {
      const v = Number(from[i]) + (Number(to[i]) - Number(from[i])) * t;
      i += 1;
      return String(Math.round(v * 1000) / 1000);
    });
  }

  // Slow in, slow out.
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

  const tr = (x, y, z) => `translate3d(${x}px, ${y}px, ${z}px)`;
  const cam = ({ rx = 0, ry = 0, rz = 0, tx = 0, ty = 0, zoom = 1 }) => (
    `scale(${zoom}) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) ${tr(tx, ty, 0)}`
  );

  // ---------------------------------------------------------------------------
  // Model: which pages are on which face of the sheets shown.

  function sheetModel(m) {
    const I = root.Imposition;
    const mode = I.MODES[m.mode];
    const sides = m.plan.sides.filter((s) => s.sig === 0);
    const total = sides.length / 2;
    const n = Math.min(SHOW_MAX, total);
    const sheets = [];
    for (let i = 0; i < n; i++) {
      const at = (sd) => {
        const map = new Map();
        for (const sl of I.finalSlots(sd, m.mode, mode.naturalFlip)) map.set(`${sl.col},${sl.row}`, sl);
        return map;
      };
      const front = at(sides[2 * i]);
      const back = at(sides[2 * i + 1]);
      sheets.push({
        front: (col, row) => front.get(`${col},${row}`),
        back: (col, row) => back.get(`${mode.cols - 1 - col},${row}`), // behind front (col, row)
      });
    }
    const k = LONG / Math.max(m.ctx.geo.width, m.ctx.geo.height);
    return {
      n, total, sheets, cols: mode.cols, rows: mode.rows,
      W: m.ctx.geo.width * k, H: m.ctx.geo.height * k,
    };
  }

  // ---------------------------------------------------------------------------
  // Rigs

  function makeFace(m, sl) {
    return root.BookletPreview.cellContent({ ...m.ctx, tier: 'large' }, sl || { page: null, rot: 0 }, 'a-cell');
  }

  /**
   * One cell of a sheet as a two-sided panel. Marks (labels, staples, ...) go inside a face,
   * never beside it: Chrome may paint a sibling into the parent's layer, which then shows
   * through from behind.
   */
  function panel(m, sheet, col, row, className, x, y, w, h, parent) {
    const p = place(div(`a-panel ${className}`, parent), x, y, w, h);
    p.front = div('a-face a-front', p);
    p.front.append(makeFace(m, sheet.front(col, row)));
    div('a-face a-back', p).append(makeFace(m, sheet.back(col, row)));
    return p;
  }

  function label(face, i) {
    const node = div('a-label', face);
    node.textContent = `Sheet ${i + 1}`;
    return node;
  }

  /** Ring around page 1 and staples on the spine, drawn on the cover. */
  function coverMarks(cover) {
    const ring = div('a-ring', cover.front);
    const staples = [div('a-staple', cover.front), div('a-staple', cover.front)];
    staples[0].style.top = '22%';
    staples[1].style.top = '66%';
    return { ring, staples };
  }

  /**
   * What every rig shares: the sheet model, depths in the stack and fanned out, the cameras
   * for the fanned-out sheets, and the parts of a pose that every mode has.
   * @param {number} layers layers per sheet in the final stack (2 when sheets are cut)
   */
  function rigBase(m, camEl, layers = 1) {
    const M = sheetModel(m);
    const { W, H, n } = M;
    const fx = W * 0.06;
    const fy = Math.max(H * 0.1, 30); // room for the label of the sheet behind
    const cx = -((n - 1) * fx) / 2;
    const cy = ((n - 1) * fy) / 2;
    const cams = {
      fan: { rx: 24, tx: cx, ty: cy, zoom: 0.92 },
      print: { rx: 24, tx: W / 2 + cx, ty: cy, zoom: Math.min(0.92, (STAGE_W - 40) / (2 * W + (n - 1) * fx)) },
      stack: { rx: 26, zoom: 1 },
    };
    const stackZ = (j) => (n * layers - 1 - j) * D;
    const fanZ = (i) => (n - 1 - i) * FAN_Z;
    return {
      M, W, H, n, fy, cy, cams, stackZ, fanZ,
      /** Sheet i fanned out by P.fan, at depth z; the top sheet turns over by P.turn. */
      at: (i, P, z = P.fan ? fanZ(i) : stackZ(i), dy = 0) => (
        `${tr(P.fan * i * fx, -P.fan * i * fy + dy, z)} translateX(${-W / 2}px) rotateY(${i ? 0 : P.turn}deg) translateX(${W / 2}px)`
      ),
      /** Adds the ring and staples on the cover and the camera to a pose. */
      finish(out, P, marks) {
        out.push([marks.ring, 'scale(1)', P.ring]);
        for (const s of marks.staples) out.push([s, `scaleY(${P.staples ? 1 : 0.2})`, P.staples]);
        out.push([camEl, cam(cams[P.cam])]);
        return out;
      },
    };
  }

  const RIGS = {
    fold2(camEl, m) {
      const B = rigBase(m, camEl);
      const { W, H } = B;
      Object.assign(B.cams, {
        fold: { rx: 20, ry: 42, tx: 0, zoom: 0.95 },
        spine: { rx: 14, ry: -24, tx: -W / 4, zoom: 1.35 },
        cover: { rx: 8, ry: -8, tx: -W / 4, zoom: 1.45 },
      });
      const sheets = B.M.sheets.map((sh, i) => {
        const sheet = place(div('a-sheet', camEl), -W / 2, -H / 2, W, H);
        const L = panel(m, sh, 0, 0, 'left', 0, 0, W / 2, H, sheet);
        const R = panel(m, sh, 1, 0, 'right', W / 2, 0, W / 2, H, sheet);
        L.style.transformOrigin = `100% 50% ${AXIS - B.stackZ(i)}px`;
        return { sheet, L, R, label: label(R.front, i) };
      });
      const marks = coverMarks(sheets[0].R);
      return {
        M: B.M,
        pose(P) {
          const out = [];
          sheets.forEach((s, i) => {
            out.push([s.sheet, B.at(i, P)]);
            out.push([s.L, `rotateY(${-P.fold}deg)`]);
            out.push([s.label, 'scale(1)', P.labels]);
          });
          return B.finish(out, P, marks);
        },
        steps: [
          printStep(m),
          stackStep(),
          foldStep({ ring: 0, cam: 'fold' }, { fold: 180 }),
          stapleStep(),
          doneStep(),
        ],
      };
    },

    quarto(camEl, m) {
      const B = rigBase(m, camEl);
      const { W, H, n } = B;
      const axis2 = AXIS - n * D; // second fold (vertical), below the result of the first
      Object.assign(B.cams, {
        // Looking down from above, so the top half is seen swinging back over.
        foldH: { rx: -36, ry: -14, zoom: 0.9 },
        foldV: { rx: 20, ry: 42, tx: 0, ty: -H / 4, zoom: 1.25 },
        spine: { rx: 14, ry: -24, tx: -W / 4, ty: -H / 4, zoom: 1.9 },
        slit: { rx: 34, ry: -20, tx: -W / 4, ty: -H / 4, zoom: 1.9 },
        cover: { rx: 8, ry: -8, tx: -W / 4, ty: -H / 4, zoom: 2 },
      });
      const sheets = B.M.sheets.map((sh, i) => {
        const sheet = place(div('a-sheet', camEl), -W / 2, -H / 2, W, H);
        const colL = place(div('a-col', sheet), 0, 0, W / 2, H);
        const colR = place(div('a-col', sheet), W / 2, 0, W / 2, H);
        colL.style.transformOrigin = `100% 50% ${axis2 - B.stackZ(i)}px`;
        const TL = panel(m, sh, 0, 0, 'tl', 0, 0, W / 2, H / 2, colL);
        panel(m, sh, 0, 1, 'bl', 0, H / 2, W / 2, H / 2, colL);
        const TR = panel(m, sh, 1, 0, 'tr', 0, 0, W / 2, H / 2, colR);
        const BR = panel(m, sh, 1, 1, 'br', 0, H / 2, W / 2, H / 2, colR);
        for (const p of [TL, TR]) p.style.transformOrigin = `50% 100% ${AXIS - B.stackZ(i)}px`;
        return { sheet, colL, TL, TR, BR, label: label(TR.front, i) };
      });
      const marks = coverMarks(sheets[0].BR);
      const slit = div('a-slit', sheets[0].BR.front);
      return {
        M: B.M,
        pose(P) {
          const out = [];
          sheets.forEach((s, i) => {
            out.push([s.sheet, B.at(i, P)]);
            out.push([s.colL, `rotateY(${-P.fold2}deg)`]);
            out.push([s.TL, `rotateX(${P.fold1}deg)`]);
            out.push([s.TR, `rotateX(${P.fold1}deg)`]);
            out.push([s.label, 'scale(1)', P.labels]);
          });
          out.push([slit, `scaleX(${P.slit})`, P.slit ? 1 : 0]);
          return B.finish(out, P, marks);
        },
        steps: [
          printStep(m),
          stackStep(),
          {
            title: 'Fold the top half down',
            detail: 'Fold the top half back and down, behind the bottom half. The upside-down pages turn the right way up.',
            frames: [{ dur: 1500, P: { ring: 0, cam: 'foldH' }, hold: 300 }, { dur: 4600, P: { fold1: 180 } }],
          },
          foldStep({ cam: 'foldV' }, { fold2: 180 }),
          stapleStep(),
          {
            title: 'Slit the top edge',
            detail: 'Cut open the folded top edge with a paper knife, so the pages can turn.',
            frames: [{ dur: 1600, P: { cam: 'slit' } }, { dur: 2600, P: { slit: 1 } }],
          },
          doneStep(),
        ],
      };
    },

    cutstack(camEl, m) {
      const B = rigBase(m, camEl, 2); // half-sheets in the final stack: sheet s gives layers 2s (top) and 2s+1
      const { W, H, n, fy, cy, cams } = B;
      const gap = H * 0.12;
      const peek = H * 0.06;
      Object.assign(cams, {
        cut: { rx: 24, tx: cams.fan.tx, ty: cy - gap / 2, zoom: Math.min(0.92, (STAGE_H - 30) / (H + gap + (n - 1) * fy)) },
        tuck: { rx: 24, tx: cams.fan.tx, ty: H / 4 + cy, zoom: 1.05 },
        stack: { rx: 26, ty: H / 4, zoom: 1.25 },
        fold: { rx: 20, ry: 42, ty: H / 4, zoom: 1.25 },
        spine: { rx: 14, ry: -24, tx: -W / 4, ty: H / 4, zoom: 1.8 },
        cover: { rx: 8, ry: -8, tx: -W / 4, ty: H / 4, zoom: 1.95 },
      });
      const halves = B.M.sheets.map((sh, s) => {
        const top = place(div('a-half', camEl), -W / 2, -H / 2, W, H / 2);
        const bottom = place(div('a-half', camEl), -W / 2, 0, W, H / 2);
        const TL = panel(m, sh, 0, 0, 'tl', 0, 0, W / 2, H / 2, top);
        const TR = panel(m, sh, 1, 0, 'tr', W / 2, 0, W / 2, H / 2, top);
        panel(m, sh, 0, 1, 'bl', 0, 0, W / 2, H / 2, bottom);
        const BR = panel(m, sh, 1, 1, 'br', W / 2, 0, W / 2, H / 2, bottom);
        TL.style.transformOrigin = `100% 50% ${AXIS - B.stackZ(2 * s)}px`;
        // After the bottom half is turned round, BR is on the left and folds back about its
        // own left edge (the spine).
        BR.style.transformOrigin = `0% 50% ${AXIS - B.stackZ(2 * s + 1)}px`;
        return { top, bottom, TL, TR, BR, label: label(TR.front, s) };
      });
      const marks = coverMarks(halves[0].TR);
      // The cut line runs across both cells of the top sheet's top half, left cell first.
      const cutlines = [div('a-cutline', halves[0].TL.front), div('a-cutline', halves[0].TR.front)];
      return {
        M: B.M,
        pose(P) {
          const out = [];
          halves.forEach((h, s) => {
            const zT = P.fan ? B.fanZ(s) : B.stackZ(2 * s);
            const zB = P.tuck ? (P.fan ? B.fanZ(s) - FAN_Z / 2 : B.stackZ(2 * s + 1)) : B.fanZ(s);
            const yB = P.tuck ? (P.fan ? -H / 2 + peek : -H / 2) : P.cut * gap;
            out.push([h.top, `${B.at(s, P, zT)} rotateZ(0deg)`]);
            out.push([h.bottom, `${B.at(s, P, zB, yB)} rotateZ(${P.spin}deg)`]);
            out.push([h.TL, `rotateY(${-P.fold}deg)`]);
            out.push([h.BR, `rotateY(${P.fold}deg)`]);
            out.push([h.label, 'scale(1)', P.labels]);
          });
          out.push([cutlines[0], `scaleX(${Math.min(P.cutline, 1)})`, P.cut ? 0 : 1]);
          out.push([cutlines[1], `scaleX(${Math.max(P.cutline - 1, 0)})`, P.cut ? 0 : 1]);
          return B.finish(out, P, marks);
        },
        steps: [
          printStep(m),
          {
            title: 'Cut the sheets in half',
            detail: 'Cut every sheet along the middle line.',
            frames: [{ dur: 1300, P: { cutline: 1 }, hold: 0 }, { dur: 1300, P: { cutline: 2 } }, { dur: 2600, P: { cut: 1, cam: 'cut' } }],
          },
          {
            title: 'Turn the bottom halves round',
            detail: 'Rotate each bottom half 180°, flat on the table. Don’t flip it over.',
            frames: [{ dur: 3600, P: { spin: 180 } }],
          },
          {
            title: 'Put each one under its top half',
            detail: 'Slide each bottom half under the top half from the same sheet.',
            frames: [{ dur: 3400, P: { tuck: 1, cam: 'tuck' } }],
          },
          { ...stackStep(), detail: 'Keep them in print order: sheet 1’s halves on top, page 1 facing up.' },
          foldStep({ ring: 0, cam: 'fold' }, { fold: 180 }),
          stapleStep(),
          doneStep(),
        ],
      };
    },
  };

  function printStep(m) {
    return {
      title: 'Print on both sides',
      detail: `Duplex, flip on ${m.flip} edge, at actual size (100%), not “Fit to page”. Every sheet has pages on its front and back.`,
      frames: [
        { dur: 3400, P: { turn: -180, cam: 'print' }, hold: 1400 },
        { dur: 3400, P: { turn: 0, cam: 'fan' } },
      ],
    };
  }

  function stackStep() {
    return {
      title: 'Stack the sheets',
      detail: 'Sheet 1 on top, page 1 facing up.',
      frames: [{ dur: 2800, P: { fan: 0, labels: 0, ring: 1, cam: 'stack' } }],
    };
  }

  function foldStep(look, fold) {
    return {
      title: 'Fold in half',
      detail: 'Fold the left half back, behind the right half.',
      frames: [{ dur: 1500, P: look, hold: 300 }, { dur: 4600, P: fold }],
    };
  }

  function stapleStep() {
    return {
      title: 'Staple the spine',
      detail: 'Two staples through the fold.',
      frames: [{ dur: 2200, P: { cam: 'spine' } }, { dur: 900, P: { staples: 1 } }],
    };
  }

  function doneStep() {
    return {
      title: 'Done',
      detail: 'Page 1 is the cover, and the pages run in order.',
      frames: [{ dur: 2400, P: { ring: 1, cam: 'cover' } }],
    };
  }

  const START = {
    fan: 1, labels: 1, turn: 0, ring: 0, fold: 0, fold1: 0, fold2: 0,
    cutline: 0, cut: 0, spin: 0, tuck: 0, staples: 0, slit: 0, cam: 'fan',
  };

  // ---------------------------------------------------------------------------
  // Player

  /**
   * @param {object} ui elements: stage, steps (ol), play, prev, next, note, speed (container
   *   of [data-speed] buttons), and the caption: count, title, detail
   */
  function create(ui) {
    const st = {
      frames: [], // [{ step, dur, hold, pose }]
      steps: [],
      cur: 0, // frame currently shown (or being animated to)
      step: 0,
      token: 0,
      running: false,
      paused: false,
      auto: false,
      tween: null, // { items, dur, elapsed, resolve, reject }
      rate: SPEED.slow,
      key: null,
      shown: false,
      played: false,
    };

    const fit = div('a-fit');
    const view = div('a-view', fit);
    const camEl = div('a-cam', view);
    ui.stage.replaceChildren(fit);

    function resize() {
      const k = ui.stage.clientWidth / STAGE_W;
      if (k > 0) fit.style.transform = `scale(${k})`;
    }
    new ResizeObserver(resize).observe(ui.stage);

    function setup(model) {
      const key = model.key;
      if (key === st.key) return;
      st.key = key;
      stop();
      camEl.replaceChildren();
      const rig = RIGS[model.mode](camEl, model);

      // Frames: frame 0 is the starting pose; every later frame is a move that belongs to a step.
      let P = { ...START };
      const frames = [{ step: 0, dur: 0, hold: 0, pose: rig.pose(P) }];
      const steps = [...rig.steps];
      if (model.plan.signatures.length > 1) {
        steps.push({
          title: 'Repeat for each signature',
          detail: `Do this for each of the ${model.plan.signatures.length} signatures, then stack them in order and sew or glue the spine.`,
          frames: [{ dur: 600, P: {} }],
        });
      }
      steps.forEach((s, k) => {
        for (const f of s.frames) {
          P = { ...P, ...f.P };
          frames.push({ step: k, dur: f.dur, hold: f.hold ?? 500, pose: rig.pose(P) });
        }
      });
      st.frames = frames;
      st.steps = steps;
      renderSteps();

      const notes = [];
      if (model.plan.signatures.length > 1) notes.push(`Signature 1 of ${model.plan.signatures.length}.`);
      if (rig.M.n < rig.M.total) notes.push(`Showing the outer ${rig.M.n} of its ${rig.M.total} sheets; the rest fold the same way.`);
      ui.note.textContent = notes.join(' ');
      ui.note.hidden = !notes.length;

      // Real page images for the faces shown.
      // (Faces may start with the small images the Sheets tab already loaded.)
      camEl.querySelectorAll('img[data-thumb]').forEach((img) => root.BookletThumbs.request(Number(img.dataset.thumb), 'large'));

      snap(0);
      st.step = 0;
      st.played = false;
      highlight();
      if (st.shown) autoplay();
    }

    function renderSteps() {
      const items = st.steps.map((s, k) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'a-step';
        b.dataset.step = k;
        b.innerHTML = `<span class="num">${k + 1}</span><b></b>`;
        b.querySelector('b').textContent = s.title;
        li.append(b);
        return li;
      });
      ui.steps.replaceChildren(...items);
    }

    function highlight() {
      ui.steps.querySelectorAll('.a-step').forEach((b) => {
        const k = Number(b.dataset.step);
        if (k === st.step) b.setAttribute('aria-current', 'step');
        else b.removeAttribute('aria-current');
        b.classList.toggle('done', k < st.step);
      });
      const cur = st.steps[st.step];
      if (cur) {
        ui.count.textContent = `Step ${st.step + 1} of ${st.steps.length}`;
        ui.title.textContent = cur.title;
        ui.detail.textContent = cur.detail;
      }
      const atEnd = !st.running && st.cur === st.frames.length - 1;
      ui.play.textContent = st.running && !st.paused ? 'Pause' : atEnd ? 'Replay' : 'Play';
      ui.play.setAttribute('aria-pressed', String(st.running && !st.paused));
      ui.prev.disabled = st.step === 0 && st.cur === 0;
      ui.next.disabled = st.step >= st.steps.length - 1;
    }

    // Tweens run on requestAnimationFrame and set plain inline styles every frame. (Chrome
    // ignores backface-visibility inside an element whose transform it animates on the
    // compositor, as Web Animations and CSS transitions do, so faces would show through.)
    // The numbers inside matching transform strings are interpolated.
    let raf = 0;
    let last = 0;

    function tick(now) {
      raf = 0;
      const tw = st.tween;
      if (!tw || st.paused) { last = 0; return; }
      if (last) tw.elapsed += (now - last) * st.rate;
      last = now;
      const t = Math.min(1, tw.elapsed / tw.dur);
      const e = ease(t);
      for (const it of tw.items) {
        it.el.style.transform = t < 1 ? lerpText(it.fromT, it.toT, e) : it.toT;
        if (it.op !== '') it.el.style.opacity = t < 1 ? String(it.fromO + (Number(it.op) - it.fromO) * e) : it.op;
      }
      if (t >= 1) {
        st.tween = null;
        last = 0;
        tw.resolve();
        return;
      }
      raf = requestAnimationFrame(tick);
    }

    function wake() {
      if (!raf && st.tween && !st.paused) raf = requestAnimationFrame(tick);
    }

    function run(items, dur) {
      return new Promise((resolve, reject) => {
        st.tween = { items, dur, elapsed: 0, resolve, reject };
        last = 0;
        wake();
      });
    }

    /** Show a frame's pose, animated over dur ms. Resolves when done, rejects if cancelled. */
    function apply(pose, dur) {
      const items = [];
      for (const [el, transform, opacity] of pose) {
        const op = opacity === undefined ? '' : String(opacity);
        if (dur > 0 && (el.style.transform !== transform || el.style.opacity !== op)) {
          items.push({
            el, fromT: el.style.transform || transform, toT: transform, op,
            fromO: el.style.opacity === '' ? 1 : Number(el.style.opacity),
          });
          if (op === '') el.style.opacity = '';
        } else {
          el.style.transform = transform;
          el.style.opacity = op;
        }
      }
      return dur > 0 ? run(items, dur) : Promise.resolve();
    }

    const wait = (ms) => (ms > 0 ? run([], ms) : Promise.resolve());

    function cancelTween() {
      const tw = st.tween;
      st.tween = null;
      if (tw) tw.reject(new Error('cancelled'));
    }

    function pause() {
      st.paused = true;
      st.auto = false;
    }

    function resume() {
      st.paused = false;
      wake();
    }

    function snap(j) {
      cancelTween();
      apply(st.frames[j].pose, 0);
      st.cur = j;
    }

    function stop() {
      st.token++;
      cancelTween();
      st.running = false;
      st.paused = false;
    }

    const firstFrame = (k) => st.frames.findIndex((f, j) => j > 0 && f.step === k);

    /** Show step k from its start, then keep going while auto is on. */
    async function go(k) {
      stop();
      const token = st.token;
      const motion = !reduceMotion();
      st.running = true;
      let j = firstFrame(k) - 1;
      snap(j);
      st.step = k;
      highlight();
      try {
        for (;;) {
          while (j + 1 < st.frames.length && st.frames[j + 1].step === st.step) {
            j += 1;
            st.cur = j;
            await apply(st.frames[j].pose, motion ? st.frames[j].dur : 0);
            if (token !== st.token) return;
            if (motion) await wait(st.frames[j].hold);
            if (token !== st.token) return;
          }
          if (!st.auto || st.step + 1 >= st.steps.length) break;
          await wait(motion ? STEP_PAUSE : 2200);
          if (token !== st.token) return;
          st.step += 1;
          highlight();
        }
      } catch (e) {
        return; // cancelled
      }
      if (token !== st.token) return;
      st.running = false;
      if (st.step + 1 >= st.steps.length) st.auto = false;
      highlight();
    }

    function autoplay() {
      if (st.played || reduceMotion()) return;
      st.played = true;
      st.auto = true;
      go(0);
    }

    ui.play.addEventListener('click', () => {
      if (st.running && !st.paused) {
        pause();
      } else if (st.running && st.paused) {
        st.auto = true;
        resume();
      } else {
        st.auto = true;
        const atEnd = st.cur === st.frames.length - 1;
        go(atEnd ? 0 : st.cur === 0 ? 0 : Math.min(st.step + 1, st.steps.length - 1));
        return;
      }
      highlight();
    });
    ui.prev.addEventListener('click', () => {
      st.auto = false;
      go(Math.max(0, st.step - 1));
    });
    ui.next.addEventListener('click', () => {
      st.auto = false;
      go(Math.min(st.step + 1, st.steps.length - 1));
    });
    ui.steps.addEventListener('click', (e) => {
      const b = e.target.closest('.a-step');
      if (!b) return;
      st.auto = false;
      go(Number(b.dataset.step));
    });
    ui.speed.addEventListener('click', (e) => {
      const b = e.target.closest('[data-speed]');
      if (!b) return;
      st.rate = SPEED[b.dataset.speed];
      ui.speed.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });

    return {
      setup,
      /** The tab became visible (or hidden). Plays once on first show. */
      show(visible) {
        st.shown = visible;
        if (visible) autoplay();
        else if (st.running && !st.paused) {
          pause();
          highlight();
        }
      },
    };
  }

  root.BookletAnimation = { create };
})(typeof self !== 'undefined' ? self : this);
