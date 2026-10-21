// CRISWAY guidebook — book viewer. Static, no dependencies.
// Desktop/landscape: closed cover -> two-page spreads -> closed back cover.
// Narrow/portrait: one page at a time. Pages turn with a 3D flip.
(function () {
  'use strict';

  var PAGE_W = 794, PAGE_H = 1123, DURATION = 850;
  var root = document.documentElement;
  var body = document.body;
  var book = document.getElementById('book');
  var toolbar = document.querySelector('.toolbar');
  var counter = document.getElementById('counter');
  var prevBtn = document.getElementById('prev');
  var nextBtn = document.getElementById('next');
  var fsBtn = document.getElementById('present');
  var printBtn = document.getElementById('print');
  var sheets = Array.prototype.slice.call(book.querySelectorAll('.sheet'));
  var N = sheets.length;               // 16
  var LEAVES = N / 2;                  // 8 (spread states 0..LEAVES)
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- Photos ----------
  // Each frame first tries its local file (data-src, in assets/img/).
  // If that file doesn't exist, it falls back to the online photo (data-remote).
  document.querySelectorAll('.ph[data-src]').forEach(function (frame) {
    var sources = [frame.getAttribute('data-src'), frame.getAttribute('data-remote')]
      .filter(Boolean);
    (function tryNext(i) {
      if (i >= sources.length) return;
      var img = new Image();
      img.onload = function () {
        frame.style.backgroundImage = 'url("' + sources[i] + '")';
        frame.classList.add('loaded');
      };
      img.onerror = function () { tryNext(i + 1); };
      img.src = sources[i];
    })(0);
  });

  // ---------- Build the stage (sheets stay in document order) ----------
  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }
  var stage = el('div', 'bk-stage');
  book.insertBefore(stage, sheets[0]);
  var stackL = el('div', 'bk-stack bk-stack-l off', stage);
  var stackR = el('div', 'bk-stack bk-stack-r', stage);
  var ribbon = el('div', 'bk-ribbon', stage);
  sheets.forEach(function (s) { stage.appendChild(s); });
  var verso = el('div', 'bk-verso', stage);
  var zoneP = el('div', 'bk-zone bk-zone-p', stage);
  var zoneN = el('div', 'bk-zone bk-zone-n', stage);
  el('span', 'bk-curl', zoneP);
  el('span', 'bk-curl', zoneN);
  [stackL, stackR, ribbon, verso, zoneP, zoneN].forEach(function (n) { n.setAttribute('aria-hidden', 'true'); });
  var progress = el('div', 'bk-progress');
  el('i', '', progress);
  progress.setAttribute('aria-hidden', 'true');
  body.insertBefore(progress, toolbar.nextSibling);
  body.classList.add('bk-on');

  // ---------- State ----------
  // page: 1-based "focus" page, shared by both modes so switching keeps position.
  var mode = 'spread';
  var page = 1;
  var busy = false, queued = 0, raf = 0, finishNow = null;
  var swiped = false;
  var want = 0;                  // exact page requested via goTo / hash

  function stateOf(p) {            // spread state for a page number
    if (mode === 'single') return p - 1;
    if (p <= 1) return 0;
    if (p >= N) return LEAVES;
    return Math.floor(p / 2);
  }
  function pageOf(st) {
    if (mode === 'single') return st + 1;
    if (st <= 0) return 1;
    if (st >= LEAVES) return N;
    return st * 2;
  }
  function maxState() { return mode === 'single' ? N - 1 : LEAVES; }
  function sheet(n) { return n >= 1 && n <= N ? sheets[n - 1] : null; }
  // Spread state -> visible left/right sheets
  function leftOf(st) { return st >= 1 ? sheet(st === LEAVES ? N : st * 2) : null; }
  function rightOf(st) { return st < LEAVES ? sheet(st === 0 ? 1 : st * 2 + 1) : null; }

  // ---------- Fit / scale ----------
  function fit() {
    var tb = toolbar.offsetHeight;
    root.style.setProperty('--tb', tb + 'px');
    var W = window.innerWidth, H = window.innerHeight - tb;
    var newMode = (W >= 860 && W / Math.max(1, H) >= 1.15) ? 'spread' : 'single';
    var s;
    if (newMode === 'spread') {
      var mx = Math.max(40, W * 0.05), my = Math.max(30, H * 0.06);
      s = Math.min((W - 2 * mx) / (PAGE_W * 2 + 40), (H - 2 * my) / (PAGE_H * 1.06));
    } else {
      s = Math.min((W - 32 - 14) / PAGE_W, (H - 44) / (PAGE_H * 1.05));
    }
    s = Math.max(0.15, s);
    root.style.setProperty('--s', s.toFixed(4));
    root.style.setProperty('--pw', (PAGE_W * s).toFixed(2) + 'px');
    root.style.setProperty('--ph', (PAGE_H * s).toFixed(2) + 'px');
    root.style.setProperty('--persp', Math.round(PAGE_W * s * 5.5) + 'px');
    if (newMode !== mode) {
      if (finishNow) finishNow();
      mode = newMode;
    }
    body.classList.toggle('bk-spread', mode === 'spread');
    body.classList.toggle('bk-single', mode === 'single');
    body.classList.remove('bk-anim');
    render(stateOf(page));
    requestAnimationFrame(function () { body.classList.add('bk-anim'); });
  }

  // ---------- Page-block thickness ----------
  function thickness() { return Math.max(4, Math.min(15, PAGE_W * parseFloat(root.style.getPropertyValue('--s')) * 0.026)); }
  function stackShadow(fraction, dir) {
    var T = Math.max(1, Math.round(thickness() * fraction));
    var parts = [];
    for (var j = 1; j <= T; j++) {
      var c = j === T ? '#B9AD94' : (j % 2 ? '#F6F2EA' : '#D8CFBC');
      parts.push((dir * j) + 'px ' + (j * 0.6).toFixed(1) + 'px 0 0 ' + c);
    }
    parts.push((dir * T * 0.6).toFixed(1) + 'px ' + (T * 0.6 + 22).toFixed(1) + 'px 46px rgba(0,0,0,.55)');
    parts.push((dir * 2) + 'px ' + (T * 0.6 + 4).toFixed(1) + 'px 10px rgba(0,0,0,.35)');
    return parts.join(',');
  }
  function setStacks(leftLeaves, rightLeaves) {
    if (mode === 'single') {
      stackL.classList.add('off');
      stackR.classList.remove('off');
      stackR.style.boxShadow = stackShadow(Math.max(0.12, rightLeaves), 1);
      return;
    }
    stackL.classList.toggle('off', leftLeaves <= 0);
    stackR.classList.toggle('off', rightLeaves <= 0);
    if (leftLeaves > 0) stackL.style.boxShadow = stackShadow(Math.max(0.12, leftLeaves / LEAVES), -1);
    if (rightLeaves > 0) stackR.style.boxShadow = stackShadow(Math.max(0.12, rightLeaves / LEAVES), 1);
  }
  function singleLeaves(st) { return (st === 0 || st === N - 1) ? 1 : (N - 1 - st) / (N - 1); }

  // ---------- Render a resting state ----------
  function render(st) {
    st = Math.max(0, Math.min(maxState(), st));
    if (want && stateOf(want) === st) page = want;  // keep a deep-linked odd page inside its spread
    else if (stateOf(page) !== st) page = pageOf(st);
    var shown = [];
    sheets.forEach(function (s) { s.classList.remove('bk-l', 'bk-r', 'bk-flip'); s.style.transform = ''; s.style.removeProperty('--sh'); });
    verso.classList.remove('on');
    verso.style.transform = '';
    if (mode === 'single') {
      sheets[st].classList.add('bk-r');
      shown.push(sheets[st]);
      stage.style.setProperty('--shift', '0px');
      setStacks(0, singleLeaves(st));
    } else {
      var L = leftOf(st), R = rightOf(st);
      if (L) { L.classList.add('bk-l'); shown.push(L); }
      if (R) { R.classList.add('bk-r'); shown.push(R); }
      stage.style.setProperty('--shift', st === 0 ? 'calc(var(--pw) * -0.5)' : st === LEAVES ? 'calc(var(--pw) * 0.5)' : '0px');
      setStacks(st, LEAVES - st);
    }
    sheets.forEach(function (s) {
      var on = shown.indexOf(s) >= 0;
      if (on) { s.removeAttribute('aria-hidden'); s.inert = false; }
      else { s.setAttribute('aria-hidden', 'true'); s.inert = true; }
    });
    var atStart = st === 0, atEnd = st === maxState();
    body.classList.toggle('bk-closed', mode === 'spread' && (atStart || atEnd));
    zoneP.hidden = atStart;
    zoneN.hidden = atEnd;
    prevBtn.disabled = atStart;
    nextBtn.disabled = atEnd;
    ribbon.classList.toggle('on', !atStart && !atEnd);
    progress.style.setProperty('--p', (st / maxState()).toFixed(3));
    counter.textContent = label(st);
    var h = '#' + sheets[page - 1].id;
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function label(st) {
    if (st === 0) return 'Cover';
    if (st === maxState()) return 'Back cover';
    if (mode === 'single') return (st + 1) + ' / ' + N;
    return (st * 2) + '–' + (st * 2 + 1) + ' / ' + N;
  }

  // ---------- Turning ----------
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function turn(dir, keepWant) {
    if (!keepWant) want = 0;
    if (busy) { queued = dir; return; }
    var from = stateOf(page), to = from + dir;
    if (to < 0 || to > maxState()) return;
    if (reduceMotion.matches) return fade(to);
    busy = true;
    body.classList.add('bk-busy');

    var front, back, under, cover, useVerso = false;
    var f0, f1, b0, b1;          // rotation ranges (deg)
    sheets.forEach(function (s) { s.inert = true; });

    if (mode === 'spread') {
      if (dir > 0) {
        front = rightOf(from); back = leftOf(to); under = rightOf(to); cover = leftOf(from);
        f0 = 0; f1 = -180; b0 = 180; b1 = 0;
        if (under) under.classList.add('bk-r');
        back.classList.add('bk-l');
      } else {
        front = leftOf(from); back = rightOf(to); under = leftOf(to); cover = rightOf(from);
        f0 = 0; f1 = 180; b0 = -180; b1 = 0;
        if (under) under.classList.add('bk-l');
        back.classList.add('bk-r');
      }
      setStacks(Math.min(from, to), Math.min(LEAVES - from, LEAVES - to));
      stage.style.setProperty('--shift', to === 0 ? 'calc(var(--pw) * -0.5)' : to === LEAVES ? 'calc(var(--pw) * 0.5)' : '0px');
    } else {
      useVerso = true;
      verso.classList.toggle('board', false);
      if (dir > 0) {
        front = sheets[from]; under = sheets[to];
        f0 = 0; f1 = -180; b0 = 180; b1 = 0;
        under.classList.add('bk-r');
      } else {
        front = sheets[to]; under = sheets[from];
        front.classList.add('bk-r');
        f0 = -180; f1 = 0; b0 = 0; b1 = 180;
      }
      back = verso;
      verso.classList.add('on');
      setStacks(0, singleLeaves(Math.max(from, to)));
    }
    front.classList.add('bk-flip');
    if (back !== verso) back.classList.add('bk-flip');
    [front, back, under].forEach(function (s) { if (s && s !== verso) { s.removeAttribute('aria-hidden'); } });

    var start = 0, done = false;
    function frame(now) {
      if (!start) start = now;
      var t = Math.min(1, (now - start) / DURATION);
      apply(t);
      if (t < 1) raf = requestAnimationFrame(frame);
      else end();
    }
    function apply(t) {
      var e = ease(t);
      front.style.transform = 'rotateY(' + (f0 + (f1 - f0) * e).toFixed(2) + 'deg)';
      back.style.transform = 'rotateY(' + (b0 + (b1 - b0) * e).toFixed(2) + 'deg)';
      // the side of the leaf facing away from the light darkens as it rises
      var lift = Math.sin(Math.PI * e);            // 0 -> 1 -> 0
      var frontShade = (mode === 'single' && dir < 0) ? (1 - e) : e;
      front.style.setProperty('--sh', (Math.min(1, frontShade * 1.8) * 0.75 * (0.35 + 0.65 * lift)).toFixed(3));
      back.style.setProperty('--sh', (Math.min(1, (1 - frontShade) * 1.8) * 0.75 * (0.35 + 0.65 * lift)).toFixed(3));
      if (under) under.style.setProperty('--sh', (mode === 'single' && dir < 0 ? e : 1 - e) * 0.55 * lift + '');
      if (cover) cover.style.setProperty('--sh', (e * 0.45 * lift).toFixed(3));
      if (useVerso) {
        // single page: the turned leaf's blank reverse fades as it lies down off-page
        var a = Math.abs(b0 + (b1 - b0) * e);       // 180 = edge-on at spine side, 0 = flat to the left
        verso.style.opacity = Math.min(1, a / 50).toFixed(3);
      }
    }
    function end() {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      finishNow = null;
      body.classList.remove('bk-busy');
      busy = false;
      render(to);
      if (queued) { var q = queued; queued = 0; turn(q); }
    }
    finishNow = function () { queued = 0; end(); };
    apply(0);
    raf = requestAnimationFrame(frame);
  }

  function fade(to) {
    busy = true;
    stage.classList.add('bk-fading');
    setTimeout(function () {
      render(to);
      stage.classList.remove('bk-fading');
      stage.classList.add('bk-fadein');
      setTimeout(function () {
        stage.classList.remove('bk-fadein');
        busy = false;
        if (queued) { var q = queued; queued = 0; turn(q); }
      }, 200);
    }, 140);
  }

  function goTo(p) {
    if (finishNow) finishNow();
    queued = 0;
    p = Math.max(1, Math.min(N, p));
    want = p;
    var target = stateOf(p);
    var cur = stateOf(page);
    if (target === cur) { page = p; render(cur); return; }
    if (Math.abs(target - cur) === 1) return turn(target - cur, true);
    if (reduceMotion.matches) return fade(target);
    // jump: land one state short, then turn the final leaf so the move still reads as a page turn
    render(target - (target > cur ? 1 : -1));
    turn(target > cur ? 1 : -1, true);
  }

  // ---------- Controls ----------
  prevBtn.addEventListener('click', function () { turn(-1); });
  nextBtn.addEventListener('click', function () { turn(1); });
  printBtn.addEventListener('click', function () { window.print(); });

  // #present becomes a fullscreen toggle (hidden where fullscreen is unavailable, e.g. iPhone)
  var fsIcon = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path></svg>';
  function fsLabel() {
    var on = !!document.fullscreenElement;
    fsBtn.innerHTML = fsIcon + '<span class="bk-label">' + (on ? 'Exit full screen' : 'Full screen') + '</span>';
    fsBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  if (root.requestFullscreen && document.fullscreenEnabled !== false) {
    fsLabel();
    fsBtn.addEventListener('click', function () {
      if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
      else root.requestFullscreen().catch(function () {});
    });
    document.addEventListener('fullscreenchange', function () { fsLabel(); fit(); });
  } else {
    fsBtn.hidden = true;
  }

  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    var tag = (t && t.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) {
      // checkboxes (packing list) keep Space; page keys still turn
      if (t.type !== 'checkbox' || e.key === ' ') return;
    }
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': e.preventDefault(); turn(1); break;
      case 'ArrowLeft': case 'PageUp': e.preventDefault(); turn(-1); break;
      case ' ':
        if (tag === 'BUTTON' || tag === 'A' || tag === 'LABEL') return;
        e.preventDefault(); turn(e.shiftKey ? -1 : 1); break;
      case 'Home': e.preventDefault(); goTo(1); break;
      case 'End': e.preventDefault(); goTo(N); break;
    }
  });

  // Edge zones: only the outer margins of the book, above the page content
  zoneN.addEventListener('click', function (e) { e.stopPropagation(); if (!swiped) turn(1); });
  zoneP.addEventListener('click', function (e) { e.stopPropagation(); if (!swiped) turn(-1); });
  // A closed book opens (or re-opens from the back) when clicked anywhere on it
  stage.addEventListener('click', function (e) {
    if (swiped || mode !== 'spread') return;
    if (e.target.closest('label, input, a, button, select, textarea')) return;
    var st = stateOf(page);
    if (st === 0) turn(1);
    else if (st === LEAVES) turn(-1);
  });

  // Swipe (touch / pen / mouse drag)
  var sx = 0, sy = 0, st0 = 0, tracking = false;
  stage.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    tracking = true; swiped = false;
    sx = e.clientX; sy = e.clientY; st0 = Date.now();
  });
  stage.addEventListener('pointerup', function (e) {
    if (!tracking) return;
    tracking = false;
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - st0 < 900) {
      swiped = true;
      turn(dx < 0 ? 1 : -1);
      setTimeout(function () { swiped = false; }, 0);
    }
  });
  stage.addEventListener('pointercancel', function () { tracking = false; });

  // Deep links: #p5 opens the spread holding page 5; brand link (#p1) closes the book
  window.addEventListener('hashchange', function () {
    var i = sheets.findIndex(function (s) { return '#' + s.id === location.hash; });
    if (i >= 0 && i + 1 !== page) goTo(i + 1);
  });

  // ---------- Print: settle any turn; styles.css prints all 16 sheets in order ----------
  window.addEventListener('beforeprint', function () {
    if (finishNow) finishNow();
    sheets.forEach(function (s) { s.style.transform = ''; s.style.removeProperty('--sh'); s.inert = false; });
  });
  window.addEventListener('afterprint', function () { render(stateOf(page)); });

  // ---------- Init ----------
  var resizeT = 0;
  window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(fit, 80); });
  window.addEventListener('orientationchange', function () { setTimeout(fit, 120); });

  var startIdx = sheets.findIndex(function (s) { return '#' + s.id === location.hash; });
  page = want = startIdx >= 0 ? startIdx + 1 : 1;
  fit();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { root.style.setProperty('--tb', toolbar.offsetHeight + 'px'); });
})();
