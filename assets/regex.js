/* PPJ_Regex — zajednička logika simulacija: regularni izrazi -> ε-NKA (Thompson) -> DKA
 * (konstrukcija podskupova), simulacija automata, kombinirani ε-NKA i simulator leksičkog
 * analizatora (S. Srbljić, "Prevođenje programskih jezika", pogl. 2.9-2.10).
 * Obična skripta bez modula: izlaže window.PPJ_Regex, a u Nodeu i module.exports.
 * Sve su funkcije čiste (bez DOM-a); crtanje daje SVG kao tekst (renderScene).
 *
 * Sintaksa izraza: unija |, ulančavanje, * + ?, grupiranje (), klase [a-z0-9] i [^...],
 * . (bilo koji znak osim \n), \e ili ε = prazan niz, \n \t \r \d \w \s, \x = doslovni znak x.
 * Prazna alternativa (a| , (|a) , ()) također je ε. Razmak je običan znak.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PPJ_Regex = api;
})(this, function () {
  'use strict';

  var MAXCP = 0x10FFFF;

  function RegexError(message, pos) {
    var e = new Error(message);
    e.name = 'RegexError';
    e.pos = pos;
    return e;
  }

  /* ---------------------------------------------------------------- skupovi znakova */
  // skup = sortirani spojeni popis raspona [lo, hi] (kodne točke)
  function normRanges(rs) {
    var a = rs.map(function (r) { return [r[0], r[1]]; }).sort(function (x, y) { return x[0] - y[0]; });
    var out = [];
    a.forEach(function (r) {
      var l = out[out.length - 1];
      if (l && r[0] <= l[1] + 1) { if (r[1] > l[1]) l[1] = r[1]; } else out.push(r);
    });
    return out;
  }
  function negRanges(rs) {
    var a = normRanges(rs), out = [], prev = 0;
    a.forEach(function (r) {
      if (r[0] > prev) out.push([prev, r[0] - 1]);
      prev = r[1] + 1;
    });
    if (prev <= MAXCP) out.push([prev, MAXCP]);
    return out;
  }
  function inRanges(rs, c) {
    for (var i = 0; i < rs.length; i++) { if (c >= rs[i][0] && c <= rs[i][1]) return true; if (c < rs[i][0]) return false; }
    return false;
  }
  function countRanges(rs) { var t = 0; rs.forEach(function (r) { t += r[1] - r[0] + 1; }); return t; }

  var DIGIT = [[48, 57]], WORD = [[48, 57], [65, 90], [95, 95], [97, 122]], SPACE = [[9, 13], [32, 32]];

  function cpName(c) {
    if (c === 32) return '␣';
    if (c === 10) return '\\n';
    if (c === 9) return '\\t';
    if (c === 13) return '\\r';
    if (c < 32 || c === 127) return '\\x' + (c < 16 ? '0' : '') + c.toString(16);
    return String.fromCodePoint(c);
  }
  function rangesBody(rs) {
    return rs.map(function (r) {
      if (r[0] === r[1]) return cpName(r[0]);
      if (r[1] === r[0] + 1) return cpName(r[0]) + cpName(r[1]);
      return cpName(r[0]) + '-' + cpName(r[1]);
    }).join('');
  }
  // čitljiva oznaka skupa znakova (za oznake prijelaza i stupce tablice)
  function describeSet(rs) {
    var total = countRanges(rs);
    if (total === 1) return cpName(rs[0][0]);
    if (total === MAXCP + 1) return 'bilo koji';
    if (total > (MAXCP + 1) / 2) return '[^' + rangesBody(negRanges(rs)) + ']';
    return '[' + rangesBody(rs) + ']';
  }
  // vidljivi prikaz niza (razmak, novi redak, tab)
  function vis(s) {
    return String(s).replace(/ /g, '␣').replace(/\n/g, '⏎').replace(/\t/g, '⇥').replace(/\r/g, '↵');
  }
  function fmtSet(a) { return a.length ? '{' + a.join(', ') + '}' : '∅'; }
  function escXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------------------------------------------------------------- parser */
  // Čvorovi AST-a: set{set} | eps | cat{items} | alt{items} | star/plus/opt{arg}; a,b = raspon u izrazu.
  function parse(src) {
    var cs = Array.from(String(src)), n = cs.length, i = 0;

    function mk(t, props, a, b) {
      var o = { t: t, a: a, b: b, text: cs.slice(a, b).join('') };
      for (var k in props) o[k] = props[k];
      return o;
    }
    function setNode(rs, a, b) { return mk('set', { set: normRanges(rs) }, a, b); }

    function parseAlt() {
      var start = i, items = [parseCat()];
      while (i < n && cs[i] === '|') { i++; items.push(parseCat()); }
      if (items.length === 1) return items[0];
      return mk('alt', { items: items }, start, i);
    }
    function parseCat() {
      var start = i, items = [];
      while (i < n && cs[i] !== '|' && cs[i] !== ')') items.push(parsePostfix());
      if (items.length === 0) return mk('eps', {}, start, start);
      if (items.length === 1) return items[0];
      return mk('cat', { items: items }, start, i);
    }
    function parsePostfix() {
      var start = i, node = parseAtom();
      while (i < n && (cs[i] === '*' || cs[i] === '+' || cs[i] === '?')) {
        var op = cs[i++];
        node = mk(op === '*' ? 'star' : op === '+' ? 'plus' : 'opt', { arg: node }, start, i);
      }
      return node;
    }
    function parseAtom() {
      var c = cs[i], start = i;
      if (c === '(') {
        i++;
        var inner = parseAlt();
        if (i >= n || cs[i] !== ')') throw RegexError('Nedostaje zatvorena zagrada ")" za otvorenu zagradu na položaju ' + (start + 1) + '.', start);
        i++;
        inner.a = start; inner.b = i; inner.text = cs.slice(start, i).join('');
        return inner;
      }
      if (c === '*' || c === '+' || c === '?') throw RegexError('Operator "' + c + '" na položaju ' + (i + 1) + ' nema operand.', i);
      if (c === '[') return parseClass();
      if (c === '\\') return parseEscape();
      if (c === '.') { i++; return setNode(negRanges([[10, 10]]), start, i); }
      if (c === 'ε') { i++; return mk('eps', {}, start, i); }
      i++;
      var cp = c.codePointAt(0);
      return setNode([[cp, cp]], start, i);
    }
    function parseEscape() {
      var start = i;
      i++;
      if (i >= n) throw RegexError('Znak "\\" na kraju izraza nema što escapeirati.', start);
      var e = cs[i++];
      switch (e) {
        case 'e': return mk('eps', {}, start, i);
        case 'n': return setNode([[10, 10]], start, i);
        case 't': return setNode([[9, 9]], start, i);
        case 'r': return setNode([[13, 13]], start, i);
        case 'd': return setNode(DIGIT, start, i);
        case 'w': return setNode(WORD, start, i);
        case 's': return setNode(SPACE, start, i);
      }
      if (/[A-Za-z0-9]/.test(e)) throw RegexError('Nepoznata escape-sekvenca "\\' + e + '" na položaju ' + (start + 1) + '.', start);
      var cp = e.codePointAt(0);
      return setNode([[cp, cp]], start, i);
    }
    function classAtom() {
      // vraća {cp} ili {set}
      var c = cs[i], start = i;
      if (c === '\\') {
        i++;
        if (i >= n) throw RegexError('Znak "\\" na kraju izraza.', start);
        var e = cs[i++];
        if (e === 'd') return { set: DIGIT };
        if (e === 'w') return { set: WORD };
        if (e === 's') return { set: SPACE };
        if (e === 'n') return { cp: 10 };
        if (e === 't') return { cp: 9 };
        if (e === 'r') return { cp: 13 };
        if (/[A-Za-z0-9]/.test(e)) throw RegexError('Escape-sekvenca "\\' + e + '" nije dozvoljena unutar klase znakova.', start);
        return { cp: e.codePointAt(0) };
      }
      i++;
      return { cp: c.codePointAt(0) };
    }
    function parseClass() {
      var start = i;
      i++;
      var neg = false, items = [];
      if (cs[i] === '^') { neg = true; i++; }
      for (;;) {
        if (i >= n) throw RegexError('Nedostaje "]" za klasu znakova koja počinje na položaju ' + (start + 1) + '.', start);
        if (cs[i] === ']') {
          if (items.length === 0) throw RegexError('Prazna klasa znakova "[]" na položaju ' + (start + 1) + '.', start);
          i++;
          break;
        }
        var lo = classAtom();
        if (cs[i] === '-' && i + 1 < n && cs[i + 1] !== ']') {
          i++;
          var hiPos = i, hi = classAtom();
          if (lo.set || hi.set) throw RegexError('Neispravan raspon u klasi znakova (položaj ' + (hiPos + 1) + ').', hiPos);
          if (lo.cp > hi.cp) throw RegexError('Raspon "' + String.fromCodePoint(lo.cp) + '-' + String.fromCodePoint(hi.cp) + '" je obrnut (početak je veći od kraja).', hiPos);
          items.push([lo.cp, hi.cp]);
        } else if (lo.set) {
          lo.set.forEach(function (r) { items.push(r); });
        } else items.push([lo.cp, lo.cp]);
      }
      var rs = normRanges(items);
      if (neg) rs = negRanges(rs);
      if (!rs.length) throw RegexError('Klasa znakova ne sadrži nijedan znak.', start);
      return setNode(rs, start, i);
    }

    var ast = parseAlt();
    if (i < n) throw RegexError('Neočekivana zatvorena zagrada ")" na položaju ' + (i + 1) + '.', i);
    return { ast: ast, chars: cs, src: String(src) };
  }

  /* ---------------------------------------------------------------- Thompsonova konstrukcija */
  // Svaki (pod)automat ima točno jedno početno (bez ulaznih bridova izvana) i jedno prihvatljivo
  // stanje. Brojevi stanja dodjeljuju se redom izgradnje po izrazu (slijeva nadesno), pa je
  // početno stanje 0, a prihvatljivo zadnje. Ulančavanje spaja ε-prijelazom.
  // Vraća {nfa:{n,start,accept,edges}, root:frag, order:[frag u poretku izgradnje]}.
  function thompson(ast, base) {
    base = base || 0;
    var n = base, edges = [], order = [];
    function newState() { return n++; }
    function addEdge(from, to, set) { edges.push({ from: from, to: to, set: set || null }); return edges.length - 1; }

    function build(node) {
      var f = { kind: node.t, node: node, kids: [], ownStates: [], ownEdges: [], s: -1, f: -1 };
      var i, k;
      switch (node.t) {
        case 'set':
        case 'eps':
          f.s = newState(); f.f = newState();
          f.ownStates.push(f.s, f.f);
          f.ownEdges.push(addEdge(f.s, f.f, node.t === 'set' ? node.set : null));
          break;
        case 'cat':
          for (i = 0; i < node.items.length; i++) f.kids.push(build(node.items[i]));
          for (i = 0; i + 1 < f.kids.length; i++) f.ownEdges.push(addEdge(f.kids[i].f, f.kids[i + 1].s, null));
          f.s = f.kids[0].s; f.f = f.kids[f.kids.length - 1].f;
          break;
        case 'alt':
          f.s = newState();
          for (i = 0; i < node.items.length; i++) f.kids.push(build(node.items[i]));
          f.f = newState();
          f.ownStates.push(f.s, f.f);
          f.kids.forEach(function (c) { f.ownEdges.push(addEdge(f.s, c.s, null)); });
          f.kids.forEach(function (c) { f.ownEdges.push(addEdge(c.f, f.f, null)); });
          break;
        case 'star':
        case 'plus':
        case 'opt':
          f.s = newState();
          k = build(node.arg);
          f.kids.push(k);
          f.f = newState();
          f.ownStates.push(f.s, f.f);
          f.ownEdges.push(addEdge(f.s, k.s, null));
          f.ownEdges.push(addEdge(k.f, f.f, null));
          if (node.t !== 'opt') f.ownEdges.push(addEdge(k.f, k.s, null));   // povratni ε-prijelaz
          if (node.t !== 'plus') f.ownEdges.push(addEdge(f.s, f.f, null));  // preskakanje
          break;
        default:
          throw new Error('Nepoznat čvor ' + node.t);
      }
      order.push(f);
      return f;
    }
    var rootFrag = build(ast);
    return { nfa: { n: n, start: rootFrag.s, accept: rootFrag.f, edges: edges }, root: rootFrag, order: order };
  }

  function indexNFA(nfa) {
    if (nfa._out) return nfa;
    var out = [], i;
    for (i = 0; i < nfa.n; i++) out.push([]);
    nfa.edges.forEach(function (e, idx) { out[e.from].push(idx); });
    nfa._out = out;
    return nfa;
  }
  function uniqSorted(a) {
    a = a.slice().sort(function (x, y) { return x - y; });
    return a.filter(function (x, i) { return i === 0 || x !== a[i - 1]; });
  }
  function epsClosure(nfa, set) {
    indexNFA(nfa);
    var seen = {}, stack = [], res = [];
    set.forEach(function (s) { if (!seen[s]) { seen[s] = 1; stack.push(s); res.push(s); } });
    while (stack.length) {
      var t = stack.pop();
      nfa._out[t].forEach(function (ei) {
        var e = nfa.edges[ei];
        if (!e.set && !seen[e.to]) { seen[e.to] = 1; stack.push(e.to); res.push(e.to); }
      });
    }
    return uniqSorted(res);
  }
  function moveChar(nfa, set, cp) {
    indexNFA(nfa);
    var res = [];
    set.forEach(function (s) {
      nfa._out[s].forEach(function (ei) {
        var e = nfa.edges[ei];
        if (e.set && inRanges(e.set, cp)) res.push(e.to);
      });
    });
    return uniqSorted(res);
  }
  function stepNFA(nfa, set, cp) { return epsClosure(nfa, moveChar(nfa, set, cp)); }

  /* ---------------------------------------------------------------- DKA (konstrukcija podskupova) */
  // Abeceda se dijeli na "atome": skupove znakova koje nijedan prijelaz ne razlikuje.
  function computeAtoms(nfa) {
    var sets = [], keys = {};
    nfa.edges.forEach(function (e) {
      if (!e.set) return;
      var k = JSON.stringify(e.set);
      if (!(k in keys)) { keys[k] = sets.length; sets.push(e.set); }
    });
    var pts = [0];
    sets.forEach(function (s) { s.forEach(function (r) { pts.push(r[0]); if (r[1] + 1 <= MAXCP) pts.push(r[1] + 1); }); });
    pts = uniqSorted(pts);
    var groups = {}, order = [];
    pts.forEach(function (lo, i) {
      var hi = (i + 1 < pts.length ? pts[i + 1] : MAXCP + 1) - 1;
      var sig = [];
      sets.forEach(function (s, si) { if (inRanges(s, lo)) sig.push(si); });
      if (!sig.length) return;
      var key = sig.join(',');
      if (!groups[key]) { groups[key] = { ranges: [], sig: sig }; order.push(groups[key]); }
      groups[key].ranges.push([lo, hi]);
    });
    var atoms = order.map(function (g) {
      var rs = normRanges(g.ranges);
      return { ranges: rs, label: describeSet(rs) };
    });
    atoms.sort(function (a, b) { return a.ranges[0][0] - b.ranges[0][0]; });
    return atoms;
  }
  function atomIndexOf(dfa, cp) {
    for (var k = 0; k < dfa.atoms.length; k++) if (inRanges(dfa.atoms[k].ranges, cp)) return k;
    return -1;
  }
  function buildDFA(nfa, maxStates) {
    maxStates = maxStates || 200;
    indexNFA(nfa);
    var atoms = computeAtoms(nfa);
    var atomsOfEdge = nfa.edges.map(function (e) {
      if (!e.set) return null;
      var res = [];
      atoms.forEach(function (a, k) { if (inRanges(e.set, a.ranges[0][0])) res.push(k); });
      return res;
    });
    var states = [], map = {}, trans = [], steps = [];
    function addState(set) {
      var key = set.join(',');
      map[key] = states.length;
      states.push({ set: set, accepting: set.indexOf(nfa.accept) >= 0 });
      trans.push([]);
      return states.length - 1;
    }
    var start = epsClosure(nfa, [nfa.start]);
    addState(start);
    steps.push({ type: 'init', from: -1, atom: -1, moved: [nfa.start], closure: start, to: 0, isNew: true });
    for (var i = 0; i < states.length; i++) {
      for (var k = 0; k < atoms.length; k++) {
        var moved = [];
        states[i].set.forEach(function (s) {
          nfa._out[s].forEach(function (ei) {
            if (atomsOfEdge[ei] && atomsOfEdge[ei].indexOf(k) >= 0) moved.push(nfa.edges[ei].to);
          });
        });
        moved = uniqSorted(moved);
        var to, clo = [], isNew = false;
        if (!moved.length) to = -1;
        else {
          clo = epsClosure(nfa, moved);
          var key = clo.join(',');
          if (key in map) to = map[key];
          else {
            if (states.length >= maxStates) throw RegexError('DKA ima više od ' + maxStates + ' stanja; izraz je prevelik za prikaz.', 0);
            to = addState(clo); isNew = true;
          }
        }
        trans[i][k] = to;
        steps.push({ type: 'trans', from: i, atom: k, moved: moved, closure: clo, to: to, isNew: isNew });
      }
    }
    return { nfa: nfa, atoms: atoms, states: states, trans: trans, start: 0, steps: steps };
  }

  /* ---------------------------------------------------------------- simulacija nad nizom */
  // Trag: trace[0] = početno stanje, trace[k] = stanje nakon k-tog znaka.
  function runNFA(nfa, str) {
    var cps = Array.from(String(str)).map(function (c) { return c.codePointAt(0); });
    var R = epsClosure(nfa, [nfa.start]);
    var trace = [{ R: R, ch: null }];
    cps.forEach(function (cp) {
      R = stepNFA(nfa, R, cp);
      trace.push({ R: R, ch: String.fromCodePoint(cp) });
    });
    return { trace: trace, accepts: R.indexOf(nfa.accept) >= 0 };
  }
  function runDFA(dfa, str) {
    var cps = Array.from(String(str)).map(function (c) { return c.codePointAt(0); });
    var q = dfa.start, trace = [{ q: q, ch: null, atom: null }];
    cps.forEach(function (cp) {
      var k = -1;
      if (q >= 0) { k = atomIndexOf(dfa, cp); q = k >= 0 ? dfa.trans[q][k] : -1; }
      trace.push({ q: q, ch: String.fromCodePoint(cp), atom: k });
    });
    return { trace: trace, accepts: q >= 0 && dfa.states[q].accepting };
  }

  function atomChars(atom) {
    var prefer = 'abcdefghijklmnopqrstuvwxyz0123456789_.+-ABCXYZ', res = [];
    Array.from(prefer).forEach(function (ch) { if (inRanges(atom.ranges, ch.codePointAt(0))) res.push(ch); });
    if (!res.length) res.push(String.fromCodePoint(atom.ranges[0][0]));
    return res;
  }
  // nasumični primjer niza koji DKA prihvaća (want=true) ili odbacuje (want=false); null ako ne nađe
  function sampleString(dfa, want, rnd) {
    rnd = rnd || Math.random;
    function pick(a) { return a[Math.floor(rnd() * a.length)]; }
    for (var attempt = 0; attempt < 200; attempt++) {
      var q = dfa.start, s = '', len = 0;
      for (;;) {
        var cand = [];
        dfa.atoms.forEach(function (a, k) { if (dfa.trans[q][k] >= 0) cand.push(k); });
        var acc = dfa.states[q].accepting;
        if (len >= 12 || !cand.length || (len > 0 && rnd() < (acc ? 0.4 : 0.05))) break;
        var k = pick(cand), ch = pick(atomChars(dfa.atoms[k]));
        s += ch; q = dfa.trans[q][k]; len++;
      }
      var accNow = dfa.states[q].accepting;
      if (want && accNow && (s.length > 0 || attempt > 100)) return s;
      if (!want) {
        if (!accNow && s.length > 0) return s;
        if (accNow && attempt > 20) return s + '#';
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- raspored i crtanje (SVG) */
  var RN = 15;            // polumjer stanja ε-NKA
  var GAP_CAT = 56, MARG_ALT = 64, MARG_LOOP = 52, GAPV = 12;

  function line(x1, y1, x2, y2) {
    return [[x1, y1], [x1 + (x2 - x1) / 3, y1 + (y2 - y1) / 3], [x1 + 2 * (x2 - x1) / 3, y1 + 2 * (y2 - y1) / 3], [x2, y2]];
  }
  function scurve(x1, y1, x2, y2) {
    var m = (x1 + x2) / 2;
    return [[x1, y1], [m, y1], [m, y2], [x2, y2]];
  }
  function shiftL(L, dx, dy) {
    return {
      w: L.w, up: L.up, down: L.down,
      nodes: L.nodes.map(function (n) { return { id: n.id, x: n.x + dx, y: n.y + dy }; }),
      edges: L.edges.map(function (e) {
        return { idx: e.idx, poly: e.poly, pts: e.pts.map(function (p) { return [p[0] + dx, p[1] + dy]; }), lab: [e.lab[0] + dx, e.lab[1] + dy] };
      })
    };
  }
  function edgeLabel(e) { return e.set ? describeSet(e.set) : 'ε'; }

  // Rekurzivni raspored dijela automata: početno stanje u (0,0), prihvatljivo u (w,0);
  // "up"/"down" = koliko se sadržaj proteže iznad/ispod osnovne crte.
  function layoutFrag(frag, edges) {
    if (frag._L) return frag._L;
    var L, i;
    switch (frag.kind) {
      case 'set':
      case 'eps': {
        var lab = edgeLabel(edges[frag.ownEdges[0]]);
        var len = Math.max(66, lab.length * 7.4 + 26);
        L = { w: len, up: 26, down: 22,
          nodes: [{ id: frag.s, x: 0, y: 0 }, { id: frag.f, x: len, y: 0 }],
          edges: [{ idx: frag.ownEdges[0], pts: line(0, 0, len, 0), lab: [len / 2, -8] }] };
        break;
      }
      case 'cat': {
        var x = 0, nodes = [], es = [], up = 26, down = 22;
        frag.kids.forEach(function (k, ix) {
          var Lk = shiftL(layoutFrag(k, edges), x, 0);
          nodes = nodes.concat(Lk.nodes); es = es.concat(Lk.edges);
          up = Math.max(up, Lk.up); down = Math.max(down, Lk.down);
          x += Lk.w;
          if (ix < frag.kids.length - 1) {
            es.push({ idx: frag.ownEdges[ix], pts: line(x, 0, x + GAP_CAT, 0), lab: [x + GAP_CAT / 2, -8] });
            x += GAP_CAT;
          }
        });
        L = { w: x, up: up, down: down, nodes: nodes, edges: es };
        break;
      }
      case 'alt': {
        var kl = frag.kids.map(function (k) { return layoutFrag(k, edges); });
        var Wi = Math.max.apply(null, kl.map(function (l) { return l.w; }));
        var ys = [0];
        for (i = 1; i < kl.length; i++) ys.push(ys[i - 1] + kl[i - 1].down + GAPV + kl[i].up);
        var cy = (ys[0] + ys[ys.length - 1]) / 2, W = Wi + 2 * MARG_ALT, bus = MARG_ALT / 2;
        var nn = [{ id: frag.s, x: 0, y: 0 }, { id: frag.f, x: W, y: 0 }], ee = [];
        kl.forEach(function (l, ix) {
          var dy = ys[ix] - cy, dx = MARG_ALT;
          var sl = shiftL(l, dx, dy);
          nn = nn.concat(sl.nodes); ee = ee.concat(sl.edges);
          // ulazni i izlazni ε-prijelazi vode se pravokutno uz "sabirnicu" lijevo/desno od grana
          ee.push({ idx: frag.ownEdges[ix], poly: true, pts: [[0, 0], [bus, 0], [bus, dy], [dx, dy]], lab: [(bus + dx) / 2 + 2, dy - 8] });
          var xe = dx + l.w, xb = W - bus;
          ee.push({ idx: frag.ownEdges[kl.length + ix], poly: true, pts: [[xe, dy], [xb, dy], [xb, 0], [W, 0]], lab: [(xe + xb) / 2, dy - 8] });
        });
        L = { w: W, up: Math.max(26, cy - ys[0] + kl[0].up), down: Math.max(22, ys[ys.length - 1] - cy + kl[kl.length - 1].down), nodes: nn, edges: ee };
        break;
      }
      case 'star':
      case 'plus':
      case 'opt': {
        var Lk2 = layoutFrag(frag.kids[0], edges), W2 = Lk2.w + 2 * MARG_LOOP;
        var sl2 = shiftL(Lk2, MARG_LOOP, 0);
        var n2 = [{ id: frag.s, x: 0, y: 0 }, { id: frag.f, x: W2, y: 0 }].concat(sl2.nodes), e2 = sl2.edges.slice();
        var own = frag.ownEdges, up2 = Lk2.up, down2 = Lk2.down;
        e2.push({ idx: own[0], pts: line(0, 0, MARG_LOOP, 0), lab: [MARG_LOOP / 2, -8] });
        e2.push({ idx: own[1], pts: line(MARG_LOOP + Lk2.w, 0, W2, 0), lab: [MARG_LOOP + Lk2.w + MARG_LOOP / 2, -8] });
        var oi = 2;
        if (frag.kind !== 'opt') {   // povratni brid ispod
          var d = Lk2.down + 10, xf = MARG_LOOP + Lk2.w, xs = MARG_LOOP;
          e2.push({ idx: own[oi++], poly: true, pts: [[xf, 0], [xf, d], [xs, d], [xs, 0]], lab: [(xf + xs) / 2, d + 15] });
          down2 = Math.max(down2, d + 22);
        }
        if (frag.kind !== 'plus') {  // preskakanje iznad
          var d2 = Lk2.up + 10;
          e2.push({ idx: own[oi++], poly: true, pts: [[0, 0], [0, -d2], [W2, -d2], [W2, 0]], lab: [W2 / 2, -d2 - 5] });
          up2 = Math.max(up2, d2 + 18);
        }
        L = { w: W2, up: up2, down: down2, nodes: n2, edges: e2 };
        break;
      }
      default: throw new Error('layout: nepoznat čvor');
    }
    frag._L = L;
    return L;
  }

  // Scena: {w,h,nodes:[{id,x,y,label,cls,r,ring}],edges:[{pts,label,lab,cls,rEnd}],texts:[{x,y,text,cls,anchor}],starts:[{x,y,r}]}
  // items: [{frag, caption, dx?}]; opt: {active:Set|obj, hiEdges:Set, final:Set, acceptLabels:{id:txt}, edgesOf:fn(item)->edges}
  function setHas(s, v) { if (!s) return false; if (typeof s.has === 'function') return s.has(v); return !!s[v]; }

  function forestScene(items, opt) {
    opt = opt || {};
    var marginL = opt.marginL != null ? opt.marginL : 46, y0 = 14, scene = { nodes: [], edges: [], texts: [], starts: [] }, maxW = 0;
    items.forEach(function (it) {
      var edges = it.edges;
      var L = layoutFrag(it.frag, edges);
      var capH = it.caption ? 20 : 0;
      var by = y0 + capH + L.up;
      var sl = shiftL(L, (it.dx != null ? it.dx : marginL), by);
      if (it.caption) scene.texts.push({ x: (it.dx != null ? it.dx : marginL) - RN, y: y0 + 11, text: it.caption, cls: 'cap', anchor: 'start' });
      var finals = {};
      finals[it.frag.f] = true;
      sl.nodes.forEach(function (n) {
        var cls = [];
        if (finals[n.id] || setHas(opt.final, n.id)) cls.push('final');
        if (setHas(opt.active, n.id)) cls.push('active');
        scene.nodes.push({ id: n.id, x: n.x, y: n.y, label: String(n.id), cls: cls.join(' '), r: RN, ring: !!(finals[n.id] || setHas(opt.final, n.id)) });
        if (opt.acceptLabels && finals[n.id] && opt.acceptLabels[n.id]) {
          scene.texts.push({ x: n.x + RN + 6, y: n.y - RN + 2, text: opt.acceptLabels[n.id], cls: 'acc', anchor: 'start' });
          maxW = Math.max(maxW, n.x + RN + 14 + opt.acceptLabels[n.id].length * 7);
        }
      });
      sl.edges.forEach(function (e) {
        var ed = edges[e.idx];
        var key = it.hiKey != null ? it.hiKey + ':' + e.idx : e.idx;
        scene.edges.push({ pts: e.pts, poly: e.poly, label: edgeLabel(ed), lab: e.lab, cls: setHas(opt.hiEdges, key) ? 'active' : '', rEnd: RN + 2, from: ed.from, to: ed.to });
      });
      if (!it.noStart) scene.starts.push({ x: sl.nodes[0] ? findNode(sl.nodes, it.frag.s).x : marginL, y: by, r: RN });
      maxW = Math.max(maxW, (it.dx != null ? it.dx : marginL) + L.w + 70);
      y0 = by + L.down + 18;
    });
    scene.w = Math.max(maxW, 200);
    scene.h = y0;
    return scene;
  }
  function findNode(ns, id) { for (var i = 0; i < ns.length; i++) if (ns[i].id === id) return ns[i]; return { x: 0, y: 0 }; }

  // ε-NKA jednog izraza (res = thompson(...)); opt kao u forestScene
  function nfaScene(res, opt) {
    return forestScene([{ frag: res.root, edges: res.nfa.edges }], opt);
  }
  // korak izgradnje: stog dijelova nakon obrade k čvorova (k = 0..order.length)
  function buildStack(res, k) {
    var st = [];
    for (var i = 0; i < k; i++) {
      var f = res.order[i];
      if (f.kids.length) st.splice(st.length - f.kids.length, f.kids.length);
      st.push(f);
    }
    return st;
  }
  function buildStepScene(res, k) {
    var st = buildStack(res, k), cur = k > 0 ? res.order[k - 1] : null;
    var hiS = {}, hiE = {};
    if (cur) {
      cur.ownStates.forEach(function (s) { hiS[s] = true; });
      cur.ownEdges.forEach(function (e) { hiE[e] = true; });
    }
    var items = st.map(function (f) {
      return { frag: f, edges: res.nfa.edges, caption: st.length > 1 ? (f.node.text === '' ? 'ε' : f.node.text) : null };
    });
    return forestScene(items, { active: hiS, hiEdges: hiE });
  }

  // Kombinirani ε-NKA (Slika 2.18): p0 lijevo, dijelovi pravila složeni okomito
  function combinedScene(lx, opt) {
    opt = opt || {};
    var items = [], acceptLabels = {};
    var okRules = lx.rules.filter(function (r) { return r.ok; });
    okRules.forEach(function (r) {
      items.push({ frag: r.frag, edges: r.thompson.nfa.edges, caption: 'r' + r.index + ': ' + (r.src === '' ? 'ε' : r.src), dx: 150, noStart: true, hiKey: r.index });
      acceptLabels[r.accept] = 'r' + r.index + (r.discard ? ' (odbaci)' : ' → ' + (r.cls || '?'));
    });
    var hiEdges = {};
    var scene = forestScene(items, { active: opt.active, acceptLabels: acceptLabels });
    // ε-prijelazi iz p0
    var ys = [];
    okRules.forEach(function (r) {
      var n = null;
      for (var i = 0; i < scene.nodes.length; i++) if (scene.nodes[i].id === r.start) n = scene.nodes[i];
      if (n) ys.push(n);
    });
    var cy = ys.length ? (ys[0].y + ys[ys.length - 1].y) / 2 : 40;
    var px = 50;
    scene.nodes.push({ id: 0, x: px, y: cy, label: '0', cls: setHas(opt.active, 0) ? 'active' : '', r: RN, ring: false });
    scene.starts.push({ x: px, y: cy, r: RN });
    ys.forEach(function (n) {
      scene.edges.push({ pts: scurve(px, cy, n.x, n.y), label: 'ε', lab: [(px + n.x) / 2, (cy + n.y) / 2 - 8], cls: '', rEnd: RN + 2 });
    });
    scene.w = Math.max(scene.w, 300);
    return scene;
  }

  // DKA scena: step = broj obrađenih koraka konstrukcije (zadano: svi); opt.current = označeno stanje,
  // opt.hiEdge = [from, atom]
  function dfaScene(dfa, opt) {
    opt = opt || {};
    var upto = opt.step == null ? dfa.steps.length : opt.step;
    var seen = {}, edgesAgg = {}, edgeList = [], hiPair = null;
    for (var i = 0; i < upto; i++) {
      var st = dfa.steps[i];
      seen[st.to >= 0 ? st.to : -1] = true;
      if (st.type === 'init') { seen[0] = true; continue; }
      if (st.to >= 0) {
        var key = st.from + '>' + st.to;
        if (!edgesAgg[key]) { edgesAgg[key] = { from: st.from, to: st.to, labels: [] }; edgeList.push(edgesAgg[key]); }
        edgesAgg[key].labels.push(dfa.atoms[st.atom].label);
      }
    }
    if (opt.hiEdge && upto > 0) {
      var last = dfa.steps[upto - 1];
      if (last && last.type === 'trans' && last.to >= 0) hiPair = last.from + '>' + last.to;
    }
    var visible = [];
    for (var s = 0; s < dfa.states.length; s++) if (seen[s]) visible.push(s);
    if (upto > 0 && visible.indexOf(0) < 0) visible.unshift(0);
    // razine (BFS od 0)
    var level = {}, queue = [0], head = 0;
    level[0] = 0;
    var adj = {};
    edgeList.forEach(function (e) { (adj[e.from] = adj[e.from] || []).push(e.to); });
    while (head < queue.length) {
      var u = queue[head++];
      (adj[u] || []).forEach(function (v) { if (level[v] == null) { level[v] = level[u] + 1; queue.push(v); } });
    }
    var byLevel = {}, maxLevel = 0;
    visible.forEach(function (v) {
      var lv = level[v] == null ? 0 : level[v];
      level[v] = lv;
      (byLevel[lv] = byLevel[lv] || []).push(v);
      maxLevel = Math.max(maxLevel, lv);
    });
    var RD = 19, DX = 128, DY = 96, maxCount = 1;
    Object.keys(byLevel).forEach(function (lv) { maxCount = Math.max(maxCount, byLevel[lv].length); });
    var pos = {}, rank = {}, H = maxCount * DY + 80;
    Object.keys(byLevel).forEach(function (lv) {
      var arr = byLevel[lv];
      arr.forEach(function (v, ix) { rank[v] = ix; pos[v] = { x: 62 + lv * DX, y: H / 2 + (ix - (arr.length - 1) / 2) * DY }; });
    });
    var scene = { nodes: [], edges: [], texts: [], starts: [], w: 62 + maxLevel * DX + 70, h: H };
    visible.forEach(function (v) {
      var acc = dfa.states[v].accepting;
      scene.nodes.push({ id: v, x: pos[v].x, y: pos[v].y, label: 'D' + v, cls: (acc ? 'final ' : '') + (opt.current === v ? 'active' : ''), r: RD, ring: acc });
    });
    if (visible.length) scene.starts.push({ x: pos[0].x, y: pos[0].y, r: RD });
    var pair = {};
    edgeList.forEach(function (e) { pair[e.from + '>' + e.to] = true; });
    edgeList.forEach(function (e) {
      var a = pos[e.from], b = pos[e.to], label = e.labels.join(', '), pts, lab;
      if (e.from === e.to) {
        var sg = rank[e.from] > 0 ? 1 : -1;   // petlja ispod čvora ako iznad njega ima drugog čvora
        pts = [[a.x - 9, a.y + sg * (RD - 2)], [a.x - 34, a.y + sg * (RD + 38)], [a.x + 34, a.y + sg * (RD + 38)], [a.x + 9, a.y + sg * (RD - 2)]];
        lab = [a.x, a.y + sg * (RD + 33) + (sg > 0 ? 10 : 0)];
      } else {
        var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy), nx = -dy / len, ny = dx / len, o = 0;
        var back = level[e.to] <= level[e.from];
        if (pair[e.to + '>' + e.from]) o = 26;
        else if (level[e.to] - level[e.from] >= 2 || level[e.to] === level[e.from]) o = 34;
        if (back) o = Math.max(o, 30 + 20 * (level[e.from] - level[e.to]));
        var c1 = [a.x + dx / 3 + nx * o * 1.33, a.y + dy / 3 + ny * o * 1.33], c2 = [a.x + 2 * dx / 3 + nx * o * 1.33, a.y + 2 * dy / 3 + ny * o * 1.33];
        pts = [[a.x, a.y], c1, c2, [b.x, b.y]];
        var sgn = o >= 0 ? 1 : -1;
        lab = [(a.x + b.x) / 2 + nx * (o * 0.75 + sgn * 11), (a.y + b.y) / 2 + ny * (o * 0.75 + sgn * 11) + 4];
      }
      scene.edges.push({ pts: pts, label: label, lab: lab, cls: (hiPair === e.from + '>' + e.to) ? 'active' : '', rEnd: RD + 2, rStart: e.from === e.to ? 0 : 0 });
    });
    return scene;
  }

  function f1(x) { return Math.round(x * 10) / 10; }
  // izlomljena linija sa zaobljenim kutovima
  function roundedPath(p, rr) {
    var d = 'M' + f1(p[0][0]) + ',' + f1(p[0][1]);
    for (var i = 1; i < p.length - 1; i++) {
      var a = p[i - 1], b = p[i], c = p[i + 1];
      var l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
      var r1 = Math.min(rr, l1 / 2), r2 = Math.min(rr, l2 / 2);
      var p1 = [b[0] - (b[0] - a[0]) / l1 * r1, b[1] - (b[1] - a[1]) / l1 * r1];
      var p2 = [b[0] + (c[0] - b[0]) / l2 * r2, b[1] + (c[1] - b[1]) / l2 * r2];
      d += ' L' + f1(p1[0]) + ',' + f1(p1[1]) + ' Q' + f1(b[0]) + ',' + f1(b[1]) + ' ' + f1(p2[0]) + ',' + f1(p2[1]);
    }
    return d + ' L' + f1(p[p.length - 1][0]) + ',' + f1(p[p.length - 1][1]);
  }
  function renderScene(scene, opt) {
    opt = opt || {};
    var id = opt.id || 'g', pad = 8;
    var minW = Math.round(Math.min(scene.w + pad, opt.minWidth || 700) * (opt.minScale || 0.72));
    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + escXml(opt.label || 'Graf automata') + '" viewBox="0 0 ' + f1(scene.w + pad) + ' ' + f1(scene.h + pad) +
      '" width="' + f1(scene.w + pad) + '" style="width:100%;max-width:' + f1(scene.w + pad) + 'px;min-width:' + minW + 'px;height:auto">');
    parts.push('<defs><marker id="' + id + '-a" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M0,0L10,5L0,10z" class="arr"/></marker>' +
      '<marker id="' + id + '-h" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto"><path d="M0,0L10,5L0,10z" class="arr act"/></marker></defs>');
    scene.edges.forEach(function (e) {
      var p = e.pts.map(function (q) { return [q[0], q[1]]; }), r = e.rEnd || (RN + 2), m = p.length;
      var dx = p[m - 1][0] - p[m - 2][0], dy = p[m - 1][1] - p[m - 2][1], l = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / l, uy = dy / l;
      p[m - 1] = [p[m - 1][0] - ux * r, p[m - 1][1] - uy * r];
      if (!e.poly) p[m - 2] = [p[m - 2][0] - ux * r, p[m - 2][1] - uy * r];
      var act = e.cls === 'active', d;
      if (e.poly) d = roundedPath(p, 9);
      else d = 'M' + f1(p[0][0]) + ',' + f1(p[0][1]) + ' C' + f1(p[1][0]) + ',' + f1(p[1][1]) + ' ' + f1(p[2][0]) + ',' + f1(p[2][1]) + ' ' + f1(p[3][0]) + ',' + f1(p[3][1]);
      parts.push('<path class="edge ' + (e.cls || '') + '" d="' + d + '" marker-end="url(#' + id + (act ? '-h' : '-a') + ')"/>');
    });
    scene.starts.forEach(function (s) {
      parts.push('<path class="edge" d="M' + f1(s.x - s.r - 30) + ',' + f1(s.y) + ' L' + f1(s.x - s.r - 2) + ',' + f1(s.y) + '" marker-end="url(#' + id + '-a)"/>');
    });
    scene.nodes.forEach(function (n) {
      parts.push('<g class="gn" data-id="' + n.id + '"><circle class="node ' + (n.cls || '') + '" cx="' + f1(n.x) + '" cy="' + f1(n.y) + '" r="' + n.r + '"/>' +
        (n.ring ? '<circle class="ring" cx="' + f1(n.x) + '" cy="' + f1(n.y) + '" r="' + (n.r - 4.5) + '"/>' : '') +
        '<text class="nid" x="' + f1(n.x) + '" y="' + f1(n.y + 4) + '" text-anchor="middle">' + escXml(n.label) + '</text></g>');
    });
    scene.edges.forEach(function (e) {
      parts.push('<text class="lbl' + (e.cls === 'active' ? ' act' : '') + '" x="' + f1(e.lab[0]) + '" y="' + f1(e.lab[1]) + '" text-anchor="middle">' + escXml(e.label) + '</text>');
    });
    scene.texts.forEach(function (t) {
      parts.push('<text class="' + (t.cls || '') + '" x="' + f1(t.x) + '" y="' + f1(t.y) + '" text-anchor="' + (t.anchor || 'start') + '">' + escXml(t.text) + '</text>');
    });
    parts.push('</svg>');
    return parts.join('');
  }

  /* ---------------------------------------------------------------- kombinirani NKA i leksička analiza */
  // rules: [{src, cls, discard}] — redoslijed = prioritet. Nevaljana pravila se preskaču (r.ok=false).
  function buildLexer(rules) {
    var lx = { rules: [], n: 1, edges: [], start: 0, acceptRule: {} };
    var base = 1;
    rules.forEach(function (r, idx) {
      var info = { index: idx + 1, src: String(r.src), cls: r.cls || '', discard: !!r.discard, ok: false, error: null, pos: null };
      try {
        var p = parse(info.src), t = thompson(p.ast, base);
        info.ok = true; info.start = t.root.s; info.accept = t.root.f; info.nstates = t.nfa.n - base;
        info.frag = t.root; info.thompson = t; info.chars = p.chars;
        t.nfa.edges.forEach(function (e) { lx.edges.push(e); });
        lx.acceptRule[info.accept] = info.index;
        base = t.nfa.n;
      } catch (e) {
        if (e && e.name === 'RegexError') { info.error = e.message; info.pos = e.pos; } else throw e;
      }
      lx.rules.push(info);
    });
    lx.n = base;
    lx.rules.forEach(function (r) { if (r.ok) lx.edges.push({ from: 0, to: r.start, set: null }); });
    indexNFA(lx);
    var clo0 = epsClosure(lx, [0]);
    lx.rules.forEach(function (r) { if (r.ok) r.matchesEmpty = clo0.indexOf(r.accept) >= 0; });
    return lx;
  }

  function ruleTag(lx, i) {
    var r = lx.rules[i - 1];
    return r.discard ? 'r' + i + ' (odbaci)' : 'r' + i + ' (' + (r.cls || '?') + ')';
  }
  function clsOf(lx, i) {
    var r = lx.rules[i - 1];
    return r.discard ? 'odbaci' : (r.cls || '?');
  }

  // Simulator iz poglavlja 2.9.7 (N1-N5): vraća {steps, tokens}.
  // Kazaljke su 1-bazirane kao u knjizi: Početak, Završetak (zadnji pročitani znak), Posljednji
  // (zadnji znak najduljeg prepoznatog prefiksa; 0 = nema), Izraz (pravilo; 0 = nema).
  function lexTrace(lx, input, maxLen) {
    var cs = Array.from(String(input)), n = cs.length;
    if (maxLen && n > maxLen) { cs = cs.slice(0, maxLen); n = cs.length; }
    var steps = [], out = [];
    var clo0 = epsClosure(lx, [0]);
    var pocetak = 1, zavrsetak = 0, posljednji = 0, izraz = 0, R = clo0, hist = [];

    function snap(kind, extra) {
      var s = { kind: kind, pocetak: pocetak, zavrsetak: zavrsetak, posljednji: posljednji, izraz: izraz, R: R,
        accepting: [], nout: out.length, n: n, text: '' };
      for (var k in extra) s[k] = extra[k];
      steps.push(s);
      return s;
    }
    function lexeme(a, b) { return cs.slice(a - 1, b).join(''); }
    function q(s) { return "'" + vis(s) + "'"; }

    snap('init', { text: 'Početno stanje: R = ε-okruženje(p0), Početak = 1, Završetak = 0, Posljednji i Izraz još nisu postavljeni.' });
    while (pocetak <= n) {
      for (;;) {
        if (R.length === 0 || zavrsetak >= n) break;
        var ch = cs[zavrsetak];
        zavrsetak++;
        R = stepNFA(lx, R, ch.codePointAt(0));
        var acc = [];
        R.forEach(function (s) { if (lx.acceptRule[s]) acc.push(lx.acceptRule[s]); });
        acc = uniqSorted(acc);
        var txt = 'Pročitan znak ' + q(ch) + ' (poz. ' + zavrsetak + '). ';
        if (acc.length) {
          izraz = acc[0]; posljednji = zavrsetak;
          hist.push({ end: zavrsetak, rules: acc, lexeme: lexeme(pocetak, zavrsetak), winner: acc[0] });
          txt += 'Prihvaćaju ' + acc.map(function (i) { return ruleTag(lx, i); }).join(' i ') + ': prepoznat prefiks ' + q(lexeme(pocetak, zavrsetak)) +
            '; Posljednji = ' + posljednji + ', Izraz = r' + izraz + (acc.length > 1 ? ' (prvo je navedeno u popisu).' : '.');
        } else if (R.length === 0) {
          txt += 'Nema aktivnih stanja — čitanje staje.';
        } else {
          txt += 'Nijedno pravilo ne prihvaća taj prefiks, ali ima aktivnih stanja pa čitanje nastavlja.';
        }
        snap('read', { ch: ch, accepting: acc, text: txt });
      }
      // ---- zaustavljanje: odluka
      var reason = R.length === 0 ? 'Nema aktivnih stanja (R = ∅)' : 'Kraj ulaza';
      var dec = { reason: R.length === 0 ? 'empty' : 'end', cands: hist.slice(), error: false, rewind: null, winner: izraz };
      var dtxt;
      if (!izraz) {
        dec.error = true;
        dtxt = reason + ' i nijedan prefiks ostatka ulaza ne zadovoljava nijedno pravilo (Izraz = 0). Pogreška: znak ' + q(cs[pocetak - 1]) +
          ' (poz. ' + pocetak + ') se izbacuje i analiza se nastavlja od sljedećeg znaka.';
        snap('stop', { text: dtxt, decision: dec });
        out.push({ error: true, text: cs[pocetak - 1], from: pocetak, to: pocetak });
        pocetak = pocetak + 1; zavrsetak = pocetak - 1; posljednji = 0; izraz = 0; R = clo0; hist = [];
        snap('error', { text: 'Oporavak od pogreške: izbačen znak ' + q(out[out.length - 1].text) + '; Početak = ' + pocetak + ', R = ε-okruženje(p0).' });
      } else {
        var last = hist[hist.length - 1];
        dtxt = reason + '. ';
        var shorter = hist.slice(0, hist.length - 1);
        if (shorter.length) {
          var diffs = shorter.filter(function (h) { return h.winner !== last.winner; }).reverse();
          var same = shorter.length - diffs.length;
          dtxt += 'Najdulje podudaranje: ' + q(last.lexeme) + ' (' + clsOf(lx, last.winner) + ') pobjeđuje ' +
            (diffs.length ? diffs.slice(0, 3).map(function (h) { return q(h.lexeme) + ' (' + clsOf(lx, h.winner) + ')'; }).join(', ') +
              (diffs.length > 3 ? ' i druga kraća' : '') + (same ? ' te kraća podudaranja istog pravila' : '')
              : 'sva kraća prepoznata podudaranja (' + shorter.length + ')') + '. ';
        } else {
          dtxt += 'Jedino podudaranje: ' + q(last.lexeme) + ' (' + clsOf(lx, last.winner) + '). ';
        }
        if (last.rules.length > 1) {
          dtxt += 'Pravila ' + last.rules.map(function (i) { return ruleTag(lx, i); }).join(' i ') + ' prihvaćaju isti niz ' + q(last.lexeme) +
            ' (jednaka duljina) — prednost ima ono koje je prvo u popisu: ' + ruleTag(lx, last.winner) + '. ';
        }
        if (zavrsetak > posljednji) {
          dec.rewind = { from: zavrsetak, to: posljednji };
          dtxt += 'Završetak se vraća s ' + zavrsetak + ' na Posljednji = ' + posljednji + '; pročitani znakovi ' + q(lexeme(posljednji + 1, zavrsetak)) + ' analiziraju se ponovno.';
        }
        snap('stop', { text: dtxt, decision: dec });
        var tk = { error: false, text: lexeme(pocetak, posljednji), from: pocetak, to: posljednji, rule: izraz, cls: lx.rules[izraz - 1].cls, discard: lx.rules[izraz - 1].discard, rewind: !!dec.rewind };
        out.push(tk);
        pocetak = posljednji + 1; zavrsetak = posljednji; var doneRule = izraz; posljednji = 0; izraz = 0; R = clo0; hist = [];
        snap('emit', { token: tk, text: tk.discard
          ? 'Jedinka ' + q(tk.text) + ' odbačena (akcija pravila r' + doneRule + ': odbaci). Početak = ' + pocetak + '; analiza ide dalje.'
          : 'Izdana jedinka ' + q(tk.text) + ' klase ' + (tk.cls || '?') + ' (pravilo r' + doneRule + '). Početak = Posljednji + 1 = ' + pocetak + '; Završetak = ' + zavrsetak + '.' });
      }
    }
    snap('done', { text: 'Svi znakovi ulaza su analizirani — kraj rada simulatora.' });
    return { steps: steps, tokens: out, chars: cs };
  }

  return {
    parse: parse, thompson: thompson, indexNFA: indexNFA, epsClosure: epsClosure, moveChar: moveChar, stepNFA: stepNFA,
    computeAtoms: computeAtoms, buildDFA: buildDFA, atomIndexOf: atomIndexOf, runNFA: runNFA, runDFA: runDFA,
    sampleString: sampleString, atomChars: atomChars,
    buildLexer: buildLexer, lexTrace: lexTrace,
    layoutFrag: layoutFrag, forestScene: forestScene, nfaScene: nfaScene, buildStack: buildStack, buildStepScene: buildStepScene,
    combinedScene: combinedScene, dfaScene: dfaScene, renderScene: renderScene,
    describeSet: describeSet, vis: vis, fmtSet: fmtSet, escXml: escXml, inRanges: inRanges, RN: RN,
    MAXCP: MAXCP
  };
});
