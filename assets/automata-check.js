/* PPJ_AutomataCheck — provjera determinističnosti, pretvorba korisničkog automata u DKA
 * i egzaktna provjera ekvivalentnosti jeziku pomoću produkt-automata.
 * Ovisi o window.PPJ_Regex (ili require('./regex.js') u Nodeu).
 */
(function (root, factory) {
  var RX = (typeof module === 'object' && module && module.exports) ? require('./regex.js') : root.PPJ_Regex;
  var api = factory(RX);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PPJ_AutomataCheck = api;
})(this, function (RX) {
  'use strict';

  function normRanges(rs) {
    var a = rs.map(function (r) { return [r[0], r[1]]; }).sort(function (x, y) { return x[0] - y[0]; });
    var out = [];
    a.forEach(function (r) {
      var l = out[out.length - 1];
      if (l && r[0] <= l[1] + 1) { if (r[1] > l[1]) l[1] = r[1]; } else out.push(r);
    });
    return out;
  }

  function uniqSorted(a) {
    a = a.slice().sort(function (x, y) { return x - y; });
    return a.filter(function (x, i) { return i === 0 || x !== a[i - 1]; });
  }

  function rangesIntersect(a, b) {
    var i = 0, j = 0;
    while (i < a.length && j < b.length) {
      var lo = Math.max(a[i][0], b[j][0]);
      var hi = Math.min(a[i][1], b[j][1]);
      if (lo <= hi) return true;
      if (a[i][1] < b[j][1]) i++; else j++;
    }
    return false;
  }

  // Parsira oznaku prijelaza koju upiše korisnik:
  // "ε", "\e", "" -> { eps: true, set: null }
  // "a", "a, b", "a-z", "[0-9]", "0..7", "a|b" -> { eps: false, set: [[lo, hi], ...] }
  function parseTransitionLabel(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || s === 'ε' || s === '\\e' || s.toLowerCase() === 'eps') {
      return { eps: true, set: null };
    }
    // Ako izgleda kao regex klasa znakova [ ... ] ili pojedinačni escape
    if (/^\[.*\]$/.test(s) || /^\\[dwsntr]$/.test(s)) {
      var p = RX.parse(s);
      if (p.ast.t === 'set') return { eps: false, set: p.ast.set };
    }
    // Podrška za liste odvojene zarezom ili crtom (npr. "a, b", "0-9", "a|b")
    var parts = s.split(/\s*,\s*|\s*\|\s*/).filter(function (x) { return x.length > 0; });
    if (parts.length === 0) return { eps: true, set: null };
    var ranges = [], hasEps = false;
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (part === 'ε' || part === '\\e' || part.toLowerCase() === 'eps') {
        hasEps = true;
        continue;
      }
      var mRange = /^([\s\S])-([\s\S])$/.exec(part);
      if (mRange) {
        var c1 = mRange[1].codePointAt(0), c2 = mRange[2].codePointAt(0);
        if (c1 > c2) throw new Error('Obrnut raspon "' + part + '" u oznaci prijelaza.');
        ranges.push([c1, c2]);
        continue;
      }
      var mDots = /^([\s\S])\.\.([\s\S])$/.exec(part);
      if (mDots) {
        var d1 = mDots[1].codePointAt(0), d2 = mDots[2].codePointAt(0);
        if (d1 > d2) throw new Error('Obrnut raspon "' + part + '" u oznaci prijelaza.');
        ranges.push([d1, d2]);
        continue;
      }
      if (/^\[.*\]$/.test(part) || /^\\[dwsntr]$/.test(part)) {
        var pr = RX.parse(part);
        if (pr.ast.t === 'set') { pr.ast.set.forEach(function (r) { ranges.push(r); }); continue; }
      }
      var chars = Array.from(part);
      if (chars.length === 1) {
        var cp = chars[0].codePointAt(0);
        ranges.push([cp, cp]);
      } else {
        throw new Error('Oznaka "' + part + '" mora biti jedan znak, raspon (npr. a-z) ili ε.');
      }
    }
    if (hasEps && ranges.length > 0) {
      throw new Error('Ne miješaj ε i znakove u istom prijelazu — dodaj zaseban ε-prijelaz.');
    }
    if (hasEps) return { eps: true, set: null };
    return { eps: false, set: normRanges(ranges) };
  }

  // Pretvara korisnički automat { states: [{id, label, start, accepting}], transitions: [{from, to, label}] }
  // u interni NFA objekt s mapom stanja.
  function compileUserAutomaton(auto) {
    var states = auto.states || [];
    var transitions = auto.transitions || [];
    if (!states.length) return { error: 'Automat nema nijedno stanje.' };

    var starts = states.filter(function (s) { return !!s.start; });
    if (starts.length === 0) return { error: 'Automat nema označeno početno stanje.' };
    if (starts.length > 1) return { error: 'Automat smije imati samo jedno početno stanje (trenutno ih je ' + starts.length + ').' };

    var idToIdx = {};
    states.forEach(function (s, idx) { idToIdx[s.id] = idx; });

    var acceptSet = {};
    states.forEach(function (s, idx) { if (s.accepting) acceptSet[idx] = true; });

    var edges = [];
    for (var i = 0; i < transitions.length; i++) {
      var tr = transitions[i];
      if (!(tr.from in idToIdx) || !(tr.to in idToIdx)) continue;
      var parsed;
      try {
        parsed = parseTransitionLabel(tr.label);
      } catch (e) {
        return { error: e.message };
      }
      edges.push({
        from: idToIdx[tr.from],
        to: idToIdx[tr.to],
        set: parsed.eps ? null : parsed.set,
        raw: tr.label,
        fromLabel: states[idToIdx[tr.from]].label || ('q' + idToIdx[tr.from]),
        toLabel: states[idToIdx[tr.to]].label || ('q' + idToIdx[tr.to])
      });
    }

    var nfa = {
      n: states.length,
      start: idToIdx[starts[0].id],
      acceptSet: acceptSet,
      edges: edges,
      states: states
    };
    RX.indexNFA(nfa);
    return { nfa: nfa, idToIdx: idToIdx };
  }

  function checkDeterminism(nfa) {
    var errs = [];
    nfa.edges.forEach(function (e) {
      if (!e.set) {
        errs.push('DKA ne smije sadržavati ε-prijelaze (' + e.fromLabel + ' → ' + e.toLabel + ').');
      }
    });
    for (var s = 0; s < nfa.n; s++) {
      var out = nfa._out[s];
      for (var i = 0; i < out.length; i++) {
        var ei = nfa.edges[out[i]];
        if (!ei.set) continue;
        for (var j = i + 1; j < out.length; j++) {
          var ej = nfa.edges[out[j]];
          if (!ej.set) continue;
          if (rangesIntersect(ei.set, ej.set)) {
            errs.push('Nedeterminizam u stanju ' + (nfa.states[s].label || ('q' + s)) +
              ': prijelazi "' + ei.raw + '" i "' + ej.raw + '" preklapaju se.');
          }
        }
      }
    }
    return { ok: errs.length === 0, errors: errs };
  }

  function computeAtomsFromEdges(edgesList) {
    var sets = [], keys = {};
    edgesList.forEach(function (e) {
      if (!e.set) return;
      var k = JSON.stringify(e.set);
      if (!(k in keys)) { keys[k] = sets.length; sets.push(e.set); }
    });
    var pts = [0];
    sets.forEach(function (s) {
      s.forEach(function (r) {
        pts.push(r[0]);
        if (r[1] + 1 <= RX.MAXCP) pts.push(r[1] + 1);
      });
    });
    pts = uniqSorted(pts);
    var groups = {}, order = [];
    pts.forEach(function (lo, i) {
      var hi = (i + 1 < pts.length ? pts[i + 1] : RX.MAXCP + 1) - 1;
      var sig = [];
      sets.forEach(function (s, si) { if (RX.inRanges(s, lo)) sig.push(si); });
      if (!sig.length) return;
      var key = sig.join(',');
      if (!groups[key]) { groups[key] = { ranges: [], sig: sig }; order.push(groups[key]); }
      groups[key].ranges.push([lo, hi]);
    });
    var atoms = order.map(function (g) {
      var rs = normRanges(g.ranges);
      return { ranges: rs, label: RX.describeSet(rs) };
    });
    atoms.sort(function (a, b) { return a.ranges[0][0] - b.ranges[0][0]; });
    return atoms;
  }

  // Konstrukcija podskupova koja podržava proizvoljan acceptSet
  function nfaToDFA(nfa, maxStates) {
    maxStates = maxStates || 300;
    RX.indexNFA(nfa);
    var atoms = computeAtomsFromEdges(nfa.edges);
    var atomsOfEdge = nfa.edges.map(function (e) {
      if (!e.set) return null;
      var res = [];
      atoms.forEach(function (a, k) { if (RX.inRanges(e.set, a.ranges[0][0])) res.push(k); });
      return res;
    });
    var states = [], map = {}, trans = [];
    function addState(set) {
      var key = set.join(',');
      map[key] = states.length;
      var acc = set.some(function (s) { return !!nfa.acceptSet[s]; });
      states.push({ set: set, accepting: acc });
      trans.push([]);
      return states.length - 1;
    }
    var start = RX.epsClosure(nfa, [nfa.start]);
    addState(start);
    for (var i = 0; i < states.length; i++) {
      for (var k = 0; k < atoms.length; k++) {
        var moved = [];
        states[i].set.forEach(function (s) {
          nfa._out[s].forEach(function (ei) {
            if (atomsOfEdge[ei] && atomsOfEdge[ei].indexOf(k) >= 0) moved.push(nfa.edges[ei].to);
          });
        });
        moved = uniqSorted(moved);
        var to;
        if (!moved.length) to = -1;
        else {
          var clo = RX.epsClosure(nfa, moved);
          var key = clo.join(',');
          if (key in map) to = map[key];
          else {
            if (states.length >= maxStates) throw new Error('Korisnički automat daje previše DKA stanja (> ' + maxStates + ').');
            to = addState(clo);
          }
        }
        trans[i][k] = to;
      }
    }
    return { nfa: nfa, atoms: atoms, states: states, trans: trans, start: 0 };
  }

  function pickRepChar(atom) {
    var prefer = 'ab01cxyz23456789defghijklmnopqrstuvwABCDEFGHIJKLMNOPQRSTUVWXYZ_+-=.';
    for (var i = 0; i < prefer.length; i++) {
      var cp = prefer.codePointAt(i);
      if (RX.inRanges(atom.ranges, cp)) return prefer[i];
    }
    return String.fromCodePoint(atom.ranges[0][0]);
  }

  function runUserAutomaton(auto, str) {
    var comp = compileUserAutomaton(auto);
    if (comp.error) return { error: comp.error };
    var nfa = comp.nfa;
    var cps = Array.from(String(str)).map(function (c) { return c.codePointAt(0); });
    var R = RX.epsClosure(nfa, [nfa.start]);
    var trace = [{ R: R, ch: null }];
    cps.forEach(function (cp) {
      R = RX.stepNFA(nfa, R, cp);
      trace.push({ R: R, ch: String.fromCodePoint(cp) });
    });
    return {
      trace: trace,
      accepts: R.some(function (s) { return !!nfa.acceptSet[s]; }),
      nfa: nfa
    };
  }

  // Egzaktna provjera ekvivalentnosti produkt-automatom (+ determinizam ako je mode === 'dfa').
  function checkEquivalence(targetRegexStr, userAuto, mode) {
    mode = mode || 'nfa';
    var parsed = RX.parse(targetRegexStr);
    var th = RX.thompson(parsed.ast);
    var targetDFA = RX.buildDFA(th.nfa, 300);

    var comp = compileUserAutomaton(userAuto);
    if (comp.error) {
      return { ok: false, equivalent: false, error: comp.error };
    }
    var userNFA = comp.nfa;

    if (mode === 'dfa') {
      var det = checkDeterminism(userNFA);
      if (!det.ok) {
        return {
          ok: true,
          equivalent: false,
          determinismErrors: det.errors,
          reason: det.errors[0]
        };
      }
    }

    var userDFA;
    try {
      userDFA = nfaToDFA(userNFA, 300);
    } catch (e) {
      return { ok: false, equivalent: false, error: e.message };
    }

    // Zajednički atomi nad rubovima obaju automata
    var atoms = computeAtomsFromEdges(th.nfa.edges.concat(userNFA.edges));

    // BFS po produkt-automatu (qt, qu), -1 je zamka (∅)
    var seen = {};
    var queue = [{ qt: targetDFA.start, qu: userDFA.start, word: '' }];
    seen[targetDFA.start + ',' + userDFA.start] = true;
    var head = 0;

    while (head < queue.length) {
      var cur = queue[head++];
      var accT = cur.qt >= 0 && targetDFA.states[cur.qt].accepting;
      var accU = cur.qu >= 0 && userDFA.states[cur.qu].accepting;
      if (accT !== accU) {
        var disp = cur.word === '' ? 'ε (prazan niz)' : '"' + RX.vis(cur.word) + '"';
        var msg = accU
          ? 'Tvoj automat prihvaća niz ' + disp + ', a ne bi smio.'
          : 'Tvoj automat odbacuje niz ' + disp + ', a trebao bi ga prihvaćati.';
        return {
          ok: true,
          equivalent: false,
          counterexample: cur.word,
          targetAccepts: accT,
          userAccepts: accU,
          reason: msg
        };
      }
      for (var k = 0; k < atoms.length; k++) {
        var cp = atoms[k].ranges[0][0];
        var nt = -1;
        if (cur.qt >= 0) {
          var it = RX.atomIndexOf(targetDFA, cp);
          nt = it >= 0 ? targetDFA.trans[cur.qt][it] : -1;
        }
        var nu = -1;
        if (cur.qu >= 0) {
          var iu = RX.atomIndexOf(userDFA, cp);
          nu = iu >= 0 ? userDFA.trans[cur.qu][iu] : -1;
        }
        var key = nt + ',' + nu;
        if (!seen[key]) {
          seen[key] = true;
          queue.push({ qt: nt, qu: nu, word: cur.word + pickRepChar(atoms[k]) });
        }
      }
    }

    return {
      ok: true,
      equivalent: true,
      reason: 'Automat je u potpunosti ekvivalentan traženom jeziku!'
    };
  }

  return {
    parseTransitionLabel: parseTransitionLabel,
    compileUserAutomaton: compileUserAutomaton,
    checkDeterminism: checkDeterminism,
    nfaToDFA: nfaToDFA,
    runUserAutomaton: runUserAutomaton,
    checkEquivalence: checkEquivalence,
    computeAtomsFromEdges: computeAtomsFromEdges
  };
});
