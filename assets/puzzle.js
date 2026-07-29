/* ============================================================
   puzzle.js v2 — jigsaw-piece shaped surfaces with multiple
   connectors per edge, each at an arbitrary offset.

   Markup:
     <div class="puzzle" data-sides="top|right|bottom|left">
       <div class="puzzle__content">…</div>
     </div>

   Each "side" is a comma-separated list of connectors. A
   connector is "value[@offset]" where:
     value:  1  = tab (sticks out)
            -1  = blank (notch cut in)
             0  = flat / no connector
     offset: 0.0 to 1.0 along the edge (default 0.5 = centered).
             For TOP and BOTTOM, offset 0 = left, 1 = right.
             For LEFT and RIGHT, offset 0 = top, 1 = bottom.

   Examples:
     "0|1|0|-1"               → tab centered on right, blank centered on left
     "0|1@0.3|0|-1@0.3"       → connectors shifted up
     "1@0.4|1@0.5,-1@0.85|0|0" → right edge has TWO connectors

   Backward-compatible: old "v,v,v,v" comma form still parsed.

   data-tab: half-width of the bump in px (default 22).
   ============================================================ */

(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];

  function parseConnector(token) {
    const [valStr, offStr] = token.trim().split('@');
    let v = parseInt(valStr, 10);
    if (v !== 1 && v !== -1) v = 0;
    let o = offStr != null ? parseFloat(offStr) : 0.5;
    if (!isFinite(o)) o = 0.5;
    o = Math.max(0.05, Math.min(0.95, o));
    return { v, o };
  }

  function parseSides(raw) {
    const out = { top: [], right: [], bottom: [], left: [] };
    if (!raw) return out;
    // Detect format: "|" separates sides in new format; "," separates sides in old.
    const sideParts = raw.includes('|') ? raw.split('|') : raw.split(',');
    for (let i = 0; i < 4; i++) {
      const sideStr = (sideParts[i] || '0').trim();
      // Multiple connectors comma-separated within new format only.
      const connectors = sideStr.split(',').map(parseConnector);
      out[SIDE_NAMES[i]] = connectors.filter(c => c.v !== 0);
    }
    return out;
  }

  function buildPuzzlePath(w, h, sides, tab) {
    // Clockwise traversal: top (L→R), right (T→B), bottom (R→L), left (B→T)
    const origins = [[0, 0], [w, 0], [w, h], [0, h]];
    const dirs    = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // along edge
    const outs    = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // outward normal
    const lengths = [w, h, w, h];
    const ends    = [[w, 0], [w, h], [0, h], [0, 0]];

    let d = `M 0 0 `;

    for (let side = 0; side < 4; side++) {
      const o = origins[side];
      const dir = dirs[side];
      const out = outs[side];
      const len = lengths[side];
      const end = ends[side];

      // Translate offset (always 0=natural-start, 1=natural-end)
      // to traversal position (depending on direction of edge traversal).
      const reversed = side >= 2; // bottom & left are traversed reversed
      const connectors = sides[SIDE_NAMES[side]]
        .map(c => ({
          v: c.v,
          pos: reversed ? len * (1 - c.o) : len * c.o
        }))
        // Keep only connectors whose bump fits cleanly on the edge.
        .filter(c => c.pos > tab + 4 && c.pos < len - tab - 4)
        .sort((a, b) => a.pos - b.pos);

      let prevEnd = 0;
      for (const c of connectors) {
        const enter = c.pos - tab;
        const exit  = c.pos + tab;
        if (enter < prevEnd + 2) continue; // overlap with previous bump
        prevEnd = exit;

        // Line up to the entry point of this bump
        const enterX = o[0] + dir[0] * enter;
        const enterY = o[1] + dir[1] * enter;
        d += `L ${enterX} ${enterY} `;

        // Bump curve. s = +1 outward, -1 inward
        const s = c.v;
        const cx = o[0] + dir[0] * c.pos;
        const cy = o[1] + dir[1] * c.pos;

        const pt = (along, outAmt) => [
          cx + dir[0] * along + out[0] * s * outAmt,
          cy + dir[1] * along + out[1] * s * outAmt
        ];

        const p1 = pt(-tab,        tab * 0.45);
        const p2 = pt(-tab * 1.35, tab * 1.05);
        const p3 = pt(-tab * 0.45, tab * 1.35);
        const p4 = pt(-tab * 0.15, tab * 1.55);
        const p5 = pt( tab * 0.15, tab * 1.55);
        const p6 = pt( tab * 0.45, tab * 1.35);
        const p7 = pt( tab * 1.35, tab * 1.05);
        const p8 = pt( tab,        tab * 0.45);
        const p9 = pt( tab,        0);

        d += `C ${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]} ${p3[0]} ${p3[1]} `;
        d += `C ${p4[0]} ${p4[1]} ${p5[0]} ${p5[1]} ${p6[0]} ${p6[1]} `;
        d += `C ${p7[0]} ${p7[1]} ${p8[0]} ${p8[1]} ${p9[0]} ${p9[1]} `;
      }

      // Line to the end of this edge (start of next)
      d += `L ${end[0]} ${end[1]} `;
    }

    return d + 'Z';
  }

  function applyEdgeClasses(el, sides) {
    SIDE_NAMES.forEach(name => {
      const conns = sides[name];
      const hasTab = conns.some(c => c.v === 1);
      const hasBlank = conns.some(c => c.v === -1);
      el.classList.toggle('puzzle--' + name + '-tab', hasTab);
      el.classList.toggle('puzzle--' + name + '-blank', hasBlank);
    });
  }

  function renderPuzzle(el) {
    const rect = el.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    if (w < 4 || h < 4) return;
    const tab = parseFloat(el.dataset.tab) || 22;
    const sides = parseSides(el.dataset.sides);
    applyEdgeClasses(el, sides);

    let svg = el.querySelector(':scope > svg.puzzle__shape');
    let path;
    if (!svg) {
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.classList.add('puzzle__shape');
      svg.setAttribute('preserveAspectRatio', 'none');
      path = document.createElementNS(SVG_NS, 'path');
      path.classList.add('puzzle__path');
      svg.appendChild(path);
      el.insertBefore(svg, el.firstChild);
    } else {
      path = svg.querySelector('path');
    }

    const pad = tab * 1.8;
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`);
    svg.style.left = `${-pad}px`;
    svg.style.top = `${-pad}px`;
    svg.style.width = `${w + 2 * pad}px`;
    svg.style.height = `${h + 2 * pad}px`;

    path.setAttribute('d', buildPuzzlePath(w, h, sides, tab));
    if (el.dataset.fill) path.style.fill = el.dataset.fill;
    if (el.dataset.stroke) path.style.stroke = el.dataset.stroke;
  }

  const ro = new ResizeObserver(entries => {
    entries.forEach(e => renderPuzzle(e.target));
  });

  function initAll(root) {
    (root || document).querySelectorAll('.puzzle').forEach(el => {
      renderPuzzle(el);
      ro.observe(el);
    });
  }

  window.Puzzle = { init: initAll, render: renderPuzzle, buildPath: buildPuzzlePath };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initAll());
  } else {
    initAll();
  }
})();
