/* ascii 커서 — 포인터를 따라다니며, 움직일 때마다 문자 조합이 계속 바뀐다.
   포인터 연출일 뿐이며 클릭·게임 규칙에는 영향을 주지 않는다. */
(function () {
  'use strict';

  var mq = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
  if (mq && !mq.matches) return;            // 터치 중심 기기: 기본 커서 유지
  if (!document.body) return;

  var docEl = document.documentElement;

  /* ---------- 문자 세트 ---------- */
  /* 3줄 × 5칸 격자 위에 그리는 **십자** 커서. 문자는 가운데 행·열 7칸에만 찍히고
     나머지 칸은 자리만 차지한 채 비어 있다(네모 블록이 아니다).
     중심·세로팔·가로팔이 각자 문자 세트를 갖고, 움직이는 동안 계속 갈아 끼워진다. */
  var ROWS = 3, COLS = 5, CR = 1, CC = 2;
  var CENTER_CH = ['X', '#', 'x', '*', '@', '+', '%', '&', 'H', '8', 'K'];
  var ARM_V = ['|', 'I', 'l', '!', '1', 'i'];
  var ARM_H = ['-', '=', '~', '_', ':', '+'];
  var IDLE_CH = '+';
  var IDLE_BODY = '·';

  /* ---------- 커서 DOM (블록 격자 · 칸마다 span 재사용) ---------- */
  var wrap = document.createElement('div');
  wrap.id = 'asciiCursor';
  wrap.setAttribute('aria-hidden', 'true');

  var box = document.createElement('div');
  box.className = 'ac-box';

  var cells = [];
  for (var rr = 0; rr < ROWS; rr++) {
    var rowEl = document.createElement('div');
    rowEl.className = 'ac-r';
    rowEl.style.display = 'flex';
    rowEl.style.columnGap = '0px';
    for (var cc = 0; cc < COLS; cc++) {
      var kind = 'blank';
      if (rr === CR && cc === CC) kind = 'center';
      else if (cc === CC) kind = 'v';
      else if (rr === CR) kind = 'h';
      /* 십자 형태: 가운데 행 전체 + 가운데 열 전체(7칸)만 문자로 채운다.
         나머지 칸은 폭만 차지하고 비어 있으며, 속도와 상관없이 드러나지 않는다. */
      var onCross = (rr === CR) || (cc === CC);
      var cellEl = document.createElement('span');
      cellEl.className = 'ac-c';
      cellEl.style.display = 'block';
      cellEl.style.width = '1ch';
      cellEl.style.height = '1.12em';
      cellEl.style.lineHeight = '1.12em';
      cellEl.style.textAlign = 'center';
      cellEl.style.whiteSpace = 'pre';
      cellEl.style.color = '#8fa0ad';
      var initCh = onCross ? ((kind === 'center') ? IDLE_CH : IDLE_BODY) : '';
      cellEl.textContent = initCh;
      rowEl.appendChild(cellEl);
      cells.push({ el: cellEl, r: rr, c: cc, i: cells.length, kind: kind, part: onCross, ch: initCh });
    }
    box.appendChild(rowEl);
  }
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  box.style.fontFamily = "'Courier New', ui-monospace, monospace";
  box.style.fontSize = '13px';
  box.style.fontWeight = '700';
  box.style.whiteSpace = 'pre';
  wrap.appendChild(box);

  /* 칸 종류(중심·세로팔·가로팔)마다 다른 문자 세트에서 고른다. */
  function chipFor(ce, g) {
    if (ce.kind === 'center') return CENTER_CH[(g + 3) % CENTER_CH.length];
    if (ce.kind === 'v') return ARM_V[(g + ce.r * 3) % ARM_V.length];
    if (ce.kind === 'h') return ARM_H[(g + ce.c + ce.r) % ARM_H.length];
    return '';
  }
  document.body.appendChild(wrap);

  /* ---------- 먼지 궤적 DOM (재사용 8개 · 한 글자 입자) ---------- */
  var DUST_MAX = 8;
  var DUST_CHARS = ['.', '·', '*', '+', '-', '\\', ':'];
  var trailWrap = document.createElement('div');
  trailWrap.id = 'asciiTrail';
  trailWrap.setAttribute('aria-hidden', 'true');
  document.body.appendChild(trailWrap);

  var dusts = [];
  for (var i = 0; i < DUST_MAX; i++) {
    var del = document.createElement('div');
    del.className = 'ac-dust';
    del.textContent = '.';
    trailWrap.appendChild(del);
    dusts.push({ el: del, x: 0, y: 0, vx: 0, vy: 0, life: 0 });
  }
  var dustNext = 0;

  /* ---------- 상태 ---------- */
  var px = 0, py = 0;
  var hasPos = false;
  var posDirty = false;
  var visible = false;
  var dist = 0;          // 직전 프레임 이후 이동한 픽셀
  var speed = 0;         // 16ms 기준 이동량(px)
  var acc = 0;           // 문자 순환 누적
  var dustAcc = 0;
  var lastDX = 0, lastDY = 0;
  var dustTurn = 0;
  var lastTime = 0;
  var wasMoving = false;
  var hitT = 0;
  var lastG = -1;
  var lastTint = '';

  var FADE_MS = 190;
  var fadeTimer = 0;

  function clearDust() {
    for (var k = 0; k < DUST_MAX; k++) {
      dusts[k].life = 0;
      dusts[k].el.style.opacity = '0';
    }
  }

  function show() {
    if (fadeTimer) {                 /* 페이드아웃 중에 다시 들어오면 즉시 표시 */
      clearTimeout(fadeTimer);
      fadeTimer = 0;
      clearDust();
    }
    wrap.classList.remove('ac-out');
    trailWrap.classList.remove('ac-out');
    wrap.style.opacity = '1';
    trailWrap.style.opacity = '1';
    if (visible) return;
    visible = true;
    docEl.classList.add('ascii-cursor');
    posDirty = true;
  }

  /* 창 밖으로 나가면 커서·먼지를 190ms 페이드아웃한 뒤 기본 커서로 돌린다. */
  function hide() {
    if (!visible || fadeTimer) return;
    visible = false;
    wrap.classList.add('ac-out');
    trailWrap.classList.add('ac-out');
    wrap.style.opacity = '0';
    trailWrap.style.opacity = '0';
    fadeTimer = window.setTimeout(function () {
      fadeTimer = 0;
      wrap.classList.remove('ac-out');
      trailWrap.classList.remove('ac-out');
      docEl.classList.remove('ascii-cursor');
      clearDust();
    }, FADE_MS);
  }

  function dustTf(d, s) {
    return 'translate3d(' + d.x.toFixed(1) + 'px,' + d.y.toFixed(1) + 'px,0)'
      + ' translate(-50%,-50%) scale(' + s.toFixed(2) + ')';
  }

  /* 지나간 자리에 조각 문자 하나를 먼지처럼 남긴다 */
  function spawnDust() {
    var d = dusts[dustNext];
    dustNext = (dustNext + 1) % DUST_MAX;
    dustTurn = (dustTurn + 1) % DUST_CHARS.length;
    var jx = (Math.random() - 0.5) * 4;
    var jy = (Math.random() - 0.5) * 4;
    d.el.textContent = DUST_CHARS[dustTurn];
    d.x = px + jx;
    d.y = py + jy;
    var a = Math.random() * Math.PI * 2;
    var sp = 4 + Math.random() * 10;
    d.vx = Math.cos(a) * sp * 0.5;
    d.vy = Math.sin(a) * sp * 0.5 - 6;   /* 살짝 떠오른다 */
    d.life = 1;
    d.el.style.opacity = '0.55';
    d.el.style.transform = dustTf(d, 1);
    lastDX = px;
    lastDY = py;
  }

  /* ---------- 입력 ---------- */
  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    if (!hasPos) {
      hasPos = true;
      px = e.clientX;
      py = e.clientY;
    } else {
      var dx = e.clientX - px;
      var dy = e.clientY - py;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > 200) d = 0;            // 창 전환 같은 큰 점프는 속도로 치지 않는다
      dist += d;
      px = e.clientX;
      py = e.clientY;
    }
    posDirty = true;
    show();
  }, { passive: true });

  window.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch') return;
    px = e.clientX;
    py = e.clientY;
    hasPos = true;
    posDirty = true;
    show();
    acc += 5.5;                      // 클릭 순간 문자 조합이 한 번 튄다
    hitT = 150;                      // 클릭 반짝임
    lastDX = px;
    lastDY = py;
  }, { passive: true });

  document.addEventListener('pointerout', function (e) {
    if (!e.relatedTarget) hide();     // 창 밖으로 나가면 기본 커서로 돌린다
  }, true);

  /* ---------- 그리기 ---------- */
  function step(now) {
    var dt = lastTime ? now - lastTime : 16;
    lastTime = now;
    if (dt < 1) dt = 1;
    if (dt > 120) dt = 120;

    if (visible) {
      var inst = dist * (16 / dt);
      dist = 0;
      speed = speed * 0.8 + inst * 0.2;   // 이동이 멈추면 몇 프레임에 걸쳐 0으로
      if (speed < 0.05) speed = 0;

      var moving = speed >= 0.6;

      if (posDirty) {
        wrap.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0)';
        posDirty = false;
      }

      if (moving) acc += (dt / 1000) * (7 + Math.min(34, speed * 3));

      var g = Math.floor(acc);

      if (hitT > 0) hitT -= dt;
      if (hitT < 0) hitT = 0;

      /* 색은 이동 중·정지·클릭 반짝임 세 가지만 있고, 속도가 빨라져도 모양은 그대로다. */
      var tint = hitT > 0 ? '#fff3b0' : (moving ? '#d6e3ee' : '#8fa0ad');

      /* 문자 인덱스나 색이 실제로 바뀐 경우에만 칸 DOM을 갱신한다.
         십자 7칸 외에는 문자를 넣지 않는다. */
      if (g !== lastG || moving !== wasMoving || tint !== lastTint) {
        lastG = g;
        lastTint = tint;
        for (var mi = 0; mi < cells.length; mi++) {
          var ce = cells[mi];
          var on = ce.part;
          var nc = '';
          if (on) {
            nc = (moving || hitT > 0)
              ? chipFor(ce, g)
              : (ce.kind === 'center' ? IDLE_CH : IDLE_BODY);
          }
          if (nc !== ce.ch) {
            ce.ch = nc;
            ce.el.textContent = nc;
          }
          if (on) ce.el.style.color = tint;
        }
      }
      wasMoving = moving;

      /* 먼지 궤적: 지나간 자리에 조각 문자를 남긴다 */
      if (moving) {
        dustAcc += dt;
        var ddx = px - lastDX;
        var ddy = py - lastDY;
        if (dustAcc >= 26 && ddx * ddx + ddy * ddy > 9) {   /* 3px 이상 벌어졌을 때 */
          dustAcc = 0;
          spawnDust();
        }
      } else {
        dustAcc = 0;
      }

      for (var j = 0; j < DUST_MAX; j++) {
        var d = dusts[j];
        if (d.life <= 0) continue;
        d.life -= dt / 330;
        if (d.life <= 0) {
          d.life = 0;
          d.el.style.opacity = '0';
          continue;
        }
        var drag = 1 - dt * 0.004;
        d.vx *= drag;
        d.vy *= drag;
        d.x += d.vx * dt / 1000;
        d.y += d.vy * dt / 1000;
        d.el.style.opacity = (d.life * d.life * 0.6).toFixed(2);
        d.el.style.transform = dustTf(d, 0.6 + d.life * 0.4);
      }
    }

    window.requestAnimationFrame(step);
  }

  window.requestAnimationFrame(step);
})();
