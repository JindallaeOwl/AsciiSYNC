/* Swarm 커서 튜토리얼 연출 엔진
   Figma 협업 커서에서 영감을 받은 가상 포인터 군집. 게임 입력을 가로채지 않도록
   pointer-events:none 오버레이에 DOM으로만 그리고, 외부 라이브러리 없이
   requestAnimationFrame 루프로 2차 베지어 이동 · 도착 스프링 · 대기 부유(Boids 풍)를 처리한다.
   클릭·드래그 연출은 화면에 보여 주기만 하며 게임 상태나 실제 설정을 바꾸지 않는다.
   API: spawn / moveTo / click / say / guides / selectBox / showBox / hideBox / dismissAll */
window.WBF = window.WBF || {};

WBF.Swarm = (function () {
  'use strict';

  var MIN_GAP = 64;   /* 커서끼리 유지하는 최소 거리(px) */
  var CPS = 46;       /* 말풍선 타이핑 간격(ms/글자) */
  var FADE_MS = 380;  /* 말풍선을 닫을 때 옅어지는 시간(ms) — CSS 전이와 같은 값 */
  var THUMB_FADE_MS = 160;  /* 스크롤 썸이 옅어지는 시간(ms) — CSS .sw-thumb 전이와 같은 값 */
  var VOICE = [640, 740, 560];  /* 커서 순서별 대화 효과음 기본 음높이(Hz) */
  /* 꼭짓점들을 2차 곡선으로 이어 모서리를 둥글린 path 문자열을 만든다.
     radii는 꼭짓점별 반지름(px)이고, 이웃 변 길이의 50%를 넘지 않게 줄여
     짧은 변에서도 곡선이 겹치지 않는다. 50%까지 허용하면 폭이 같은 변의
     양 끝을 정확히 반원으로 깎아 둥근 끝단을 만들 수 있다. */
  function roundedPath(pts, radii) {
    var n = pts.length, d = '';
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
      var v1x = p0[0] - p1[0], v1y = p0[1] - p1[1];
      var v2x = p2[0] - p1[0], v2y = p2[1] - p1[1];
      var l1 = Math.sqrt(v1x * v1x + v1y * v1y) || 1;
      var l2 = Math.sqrt(v2x * v2x + v2y * v2y) || 1;
      var r = Math.min(radii[i], l1 * 0.5, l2 * 0.5);
      var ax = p1[0] + v1x / l1 * r, ay = p1[1] + v1y / l1 * r;
      var bx = p1[0] + v2x / l2 * r, by = p1[1] + v2y / l2 * r;
      d += (i === 0 ? 'M' : 'L') + ax.toFixed(2) + ' ' + ay.toFixed(2) +
        'Q' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2) + ' ' + bx.toFixed(2) + ' ' + by.toFixed(2);
    }
    return d + 'Z';
  }

  /* 화살표는 꼬리(다리) 없이 두 팔만 있는 V자 한 덩어리다.
     대칭축은 뾰족한 끝을 지나는 45° 대각선(y = x - 0.4)이고, 두 팔은 그 선에서
     위아래로 22.5°씩 벌어진다. 그래서 위쪽 팔과 아래쪽 팔의 모든 꼭짓점이
     대각선을 기준으로 정확히 거울 쌍이다(예: 위 바깥 끝 16.63,7.54 ↔ 아래
     바깥 끝 7.94,16.23). 팔 폭은 4.6px로 같고 끝단도 반원으로 둥글다.
     꼭짓점 순서: 뾰족한 끝 → 위 팔 바깥 → 위 팔 안쪽 → 안쪽 홈 →
     아래 팔 안쪽 → 아래 팔 바깥.
     뾰족한 끝 (1.8,1.4)은 CSS가 그만큼 당겨 커서 좌표와 정확히 겹친다. */
  var ARROW_PTS = [
    [1.80, 1.40],   /* V 꼭짓점 = 뾰족한 끝(커서 좌표) */
    [16.63, 7.54],  /* 위쪽 팔 바깥 끝 */
    [14.87, 11.80], /* 위쪽 팔 안쪽 끝 */
    [10.30, 9.90],  /* 안쪽 홈(대칭축 위) */
    [12.20, 14.47], /* 아래쪽 팔 안쪽 끝 */
    [7.94, 16.23]   /* 아래쪽 팔 바깥 끝 */
  ];
  /* 꼭짓점마다 둥글리기 반지름(px). 팔 끝 두 곳은 폭의 절반이라 반원으로
     깎이고, 뾰족한 끝은 1.2로만 둥글려 커서 지점이 무디지 않게 한다. */
  var ARROW_R = [1.2, 2.3, 2.3, 1.0, 2.3, 2.3];
  var ARROW = '<svg class="sw-arrow" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">' +
    '<path d="' + roundedPath(ARROW_PTS, ARROW_R) + '"></path></svg>';

  function nowMs() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeInOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function wait(ms) {
    return new Promise(function (res) { setTimeout(res, Math.max(0, Math.round(ms))); });
  }
  function vw() { return window.innerWidth || document.documentElement.clientWidth || 960; }
  function vh() { return window.innerHeight || document.documentElement.clientHeight || 540; }
  function isEl(v) { return !!(v && v.nodeType === 1); }

  /* 대상 해석: 선택자 · 엘리먼트 · {x,y} 좌표를 모두 받는다 */
  function resolveTarget(target, opts) {
    var el = null;
    if (typeof target === 'string') el = document.querySelector(target);
    else if (isEl(target)) el = target;

    if (el) {
      if (opts && opts.scroll && el.scrollIntoView) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      var r = el.getBoundingClientRect();
      /* 큰 요소는 한가운데보다 살짝 왼쪽 위를 가리켜 커서가 내용을 덮지 않게 한다 */
      var ax = r.width > 180 ? r.left + Math.min(r.width * 0.32, 130) : r.left + r.width / 2;
      var ay = r.height > 140 ? r.top + r.height * 0.34 : r.top + r.height / 2;
      return {
        el: el, rect: r, w: r.width, h: r.height,
        x: r.left + r.width / 2, y: r.top + r.height / 2, ax: ax, ay: ay
      };
    }
    /* 화면 사각형({left, top, width, height})을 그대로 대상으로 받는다.
       여러 줄에 걸친 영역을 드래그 선택으로 보여 줄 때 쓴다. */
    if (target && typeof target.left === 'number' && typeof target.top === 'number') {
      var rw = typeof target.width === 'number' ? target.width : (target.w || 0);
      var rh = typeof target.height === 'number' ? target.height : (target.h || 0);
      var rc = { left: target.left, top: target.top, width: rw, height: rh };
      return {
        el: null, rect: rc, w: rw, h: rh,
        x: rc.left + rw / 2, y: rc.top + rh / 2,
        ax: rc.left + rw / 2, ay: rc.top + rh / 2
      };
    }
    if (target && typeof target.x === 'number' && typeof target.y === 'number') {
      return { el: null, rect: null, w: 0, h: 0, x: target.x, y: target.y, ax: target.x, ay: target.y };
    }
    return null;
  }

  /* 넘치는 내용을 잘라 보여 주는 스크롤 컨테이너를 찾는다. 선택 영역은 이 경계를
     넘어서면 패널 위(경기장 화면)까지 그대로 그려지므로, 이 사각형으로 잘라야 한다. */
  function scrollClipOf(els) {
    var list = (els && els.length && els[0] && els[0].nodeType === 1) ? els : (els ? [els] : []);
    for (var i = 0; i < list.length; i++) {
      var e = list[i] ? list[i].parentElement : null;
      while (e && e !== document.body && e !== document.documentElement) {
        var cs = null;
        try { cs = window.getComputedStyle(e); } catch (err) { cs = null; }
        if (cs) {
          var cut = /^(auto|scroll|hidden)$/;
          var cutY = cut.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1;
          var cutX = cut.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1;
          if (cutY || cutX) return e;
        }
        e = e.parentElement;
      }
    }
    return null;
  }

  /* 사각형을 컨테이너 경계 안으로 잘라 낸다. 완전히 벗어났으면 null */
  function clampRectTo(rect, clipEl) {
    if (!rect || !clipEl || !clipEl.getBoundingClientRect) return rect;
    var c = clipEl.getBoundingClientRect();
    var l = Math.max(rect.left, c.left);
    var t = Math.max(rect.top, c.top);
    var r = Math.min(rect.left + rect.width, c.right);
    var b = Math.min(rect.top + rect.height, c.bottom);
    if (!(r > l) || !(b > t)) return null;
    return { left: l, top: t, width: r - l, height: b - t };
  }

  /* 창 밖으로 나간 사각형을 보이는 영역 안으로 당긴다. 화면 끝에 딱 붙은 요소를
     잡으면 여백·모서리 핸들이 화면 밖으로 밀려나 일부가 잘려 보이므로,
     그릴 때는 항상 보이는 창 안의 사각형을 쓴다. */
  function clampToWindow(rect) {
    if (!rect) return rect;
    var l = Math.max(rect.left, 0);
    var t = Math.max(rect.top, 0);
    var r = Math.min(rect.left + rect.width, vw());
    var b = Math.min(rect.top + rect.height, vh());
    if (!(r > l) || !(b > t)) return rect;
    return { left: l, top: t, width: r - l, height: b - t };
  }

  /* 창 안에서 실제로 보이는 사각형. innerWidth는 세로 스크롤바 폭까지 포함하므로
     화면 오른쪽 끝에 딱 맞춰 그리면 1px 테두리가 경계에 걸려 반쯤 잘려 보인다.
     스크롤바를 뺀 보이는 폭을 쓰고 1px 안쪽으로 줄여 네 변이 모두 보이게 한다. */
  function windowRect() {
    var cw = 0, ch = 0;
    try {
      cw = document.documentElement.clientWidth || 0;
      ch = document.documentElement.clientHeight || 0;
    } catch (errW) { cw = 0; ch = 0; }
    if (!(cw > 0)) cw = vw();
    if (!(ch > 0)) ch = vh();
    return { left: 0, top: 0, right: cw - 1, bottom: ch - 1 };
  }

  /* 사각형의 왼쪽 위(far 없음)·오른쪽 아래(far) 모서리 지점. 화살표 끝이 이 지점을
     가리키며, 화면 밖으로 나가지 않게 창 안으로 당긴다. */
  function cornerOf(rect, far) {
    var x = far ? rect.left + rect.width + 3 : rect.left - 3;
    var y = far ? rect.top + rect.height + 3 : rect.top - 3;
    return {
      x: clamp(x, 2, Math.max(2, vw() - 2)),
      y: clamp(y, 2, Math.max(2, vh() - 2))
    };
  }

  /* 여러 요소의 화면 사각형을 합친 영역. 스크롤이 움직이는 동안에도 매 프레임
     다시 재서 선택 영역이 내용을 따라가게 할 때 쓴다. clipEl을 넘기면 스크롤 컨테이너
     밖으로 밀려난 부분은 합치지 않아, 상자가 패널 경계를 넘어 그려지지 않는다. */
  function liveRectOf(els, pad, clipEl) {
    if (!els) return null;
    var list = (els.length && els.length > 0 && els[0] && els[0].nodeType === 1) ? els : [els];
    var cp = (clipEl && clipEl.getBoundingClientRect) ? clipEl.getBoundingClientRect() : null;
    var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!el || !el.getBoundingClientRect) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      var cl = r.left, ct = r.top, cr = r.right, cb = r.bottom;
      if (cp) {
        cl = Math.max(cl, cp.left); ct = Math.max(ct, cp.top);
        cr = Math.min(cr, cp.right); cb = Math.min(cb, cp.bottom);
        if (!(cr > cl) || !(cb > ct)) continue;  /* 패널 밖으로 완전히 나간 줄은 제외 */
      }
      if (cl < left) left = cl;
      if (ct < top) top = ct;
      if (cr > right) right = cr;
      if (cb > bottom) bottom = cb;
    }
    if (!(right > left)) return null;
    var p = typeof pad === 'number' ? pad : 3;
    return clampRectTo({
      left: left - p, top: top - p,
      width: right - left + p * 2, height: bottom - top + p * 2
    }, clipEl);
  }

  function create() {
    var layer = null;
    var cursors = [];
    var raf = 0;
    var lastT = 0;
    var beat = 0;        /* 루프가 마지막으로 돈 시각 */
    var watchTimer = 0;  /* 루프 감시 타이머 */
    var boxEl = null;
    var boxLabelEl = null;
    var boxTarget = null;
    var boxVisible = false;
    var boxParked = false;  /* 대상이 패널 밖으로 나가 잠시 감춘 상태(연결은 유지) */
    var guidesEl = null;
    var guideV = null;
    var guideH = null;
    var thumbEl = null;  /* 스크롤 바 드래그 시연용 썸 */
    var thumbGen = 0;    /* 썸 정리 타이머 세대 — 새 드래그가 시작되면 이전 정리를 취소한다 */
    var zSeq = 0;        /* 말하는 커서를 위로 올릴 때 쓰는 z 순번 */

    /* ---------- 레이어 ---------- */

    function ensureLayer() {
      if (layer) return layer;
      layer = document.createElement('div');
      layer.id = 'swarmLayer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);

      /* 피그마 스타일 선택 영역: 테두리 + 모서리 핸들 + 크기 라벨 */
      boxEl = document.createElement('div');
      boxEl.className = 'sw-box';
      for (var i = 0; i < 4; i++) {
        var hd = document.createElement('i');
        hd.className = 'sw-h sw-h' + i;
        boxEl.appendChild(hd);
      }
      boxLabelEl = document.createElement('span');
      boxLabelEl.className = 'sw-size';
      boxEl.appendChild(boxLabelEl);
      layer.appendChild(boxEl);

      /* 정렬 가이드 점선 */
      guidesEl = document.createElement('div');
      guidesEl.className = 'sw-guides';
      guideV = document.createElement('i');
      guideV.className = 'v';
      guideH = document.createElement('i');
      guideH.className = 'h';
      guidesEl.appendChild(guideV);
      guidesEl.appendChild(guideH);
      layer.appendChild(guidesEl);
      return layer;
    }

    function find(id) {
      for (var i = 0; i < cursors.length; i++) if (cursors[i].id === id) return cursors[i];
      return null;
    }

    /* ---------- 커서 ---------- */

    function spawn(id, opts) {
      ensureLayer();
      var exist = find(id);
      if (exist) return exist;
      var o = opts || {};
      var color = o.color || '#33ff66';
      var pitch = o.pitch || VOICE[cursors.length % VOICE.length];
      var x = typeof o.x === 'number' ? o.x : vw() * 0.5;
      var y = typeof o.y === 'number' ? o.y : vh() * 0.5;

      var el = document.createElement('div');
      el.className = 'sw-cursor';
      /* 이름표 배지 없이 화살표만 커서 요소에 붙인다 */
      el.innerHTML = ARROW;

      /* 말풍선은 커서 요소 안이 아니라 레이어에 따로 둔다. 커서는 소수점 단위로
         계속 움직이므로 말풍선을 그 안에 넣으면 작은 글자가 매 프레임 반픽셀
         위치에서 다시 그려져 흐릿하게 일렁인다. 레이어에 두고 정수 좌표로만
         옮기면 글자 래스터가 흔들리지 않는다. */
      var bubbleEl = document.createElement('div');
      bubbleEl.className = 'sw-bubble';
      /* 테두리 색은 inline borderColor 대신 --sw-bc 변수로 넘긴다.
         inline으로 칠하면 속삭임 말풍선(.whisper)의 '테두리 투명' 규칙을 inline이
         이겨 버려서, 실선 1px이 점선 사이 틈을 메워 그냥 실선처럼 보인다. */
      bubbleEl.style.setProperty('--sw-bc', color);
      layer.appendChild(bubbleEl);

      var arrow = el.querySelector('.sw-arrow');
      if (arrow) {
        arrow.style.fill = color;
        arrow.style.stroke = '#ffffff';
        arrow.style.strokeWidth = '1.7';
        arrow.style.strokeLinejoin = 'round';
        arrow.style.strokeLinecap = 'round';
      }
      layer.appendChild(el);

      var c = {
        id: id, name: o.name || id, color: color, pitch: pitch,
        x: x, y: y, vx: 0, vy: 0, rx: 0, ry: 0,
        /* 첫 draw에서 반드시 transform을 적용하도록 숫자로 시작한다(NaN 비교는 항상 false) */
        lastX: -99999, lastY: -99999,
        el: el, bubbleEl: bubbleEl,
        bubble: {
          text: '', n: 0, t0: 0, on: false, timer: 0, fadeTimer: 0, blipAt: 0,
          flip: false, below: false, w: 0, h: 0, lx: -99999, ly: -99999
        },
        move: null, settle: null, exiting: false,
        phase: Math.random() * 6.28,
        idle: {
          on: true, cx: x, cy: y,
          r: 26 + Math.random() * 20,
          a: Math.random() * 6.28,
          speed: 0.34 + Math.random() * 0.26
        }
      };
      cursors.push(c);
      draw(c, nowMs());
      startLoop();
      return c;
    }

    function beginMove(c, ex, ey, dur, curve, amp, done) {
      if (c.move && c.move.done) {
        var prev = c.move.done;
        c.move.done = null;
        prev();
      }
      var sx = c.x, sy = c.y;
      var dx = ex - sx, dy = ey - sy;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var mx = (sx + ex) / 2;
      var my = (sy + ey) / 2;
      /* 진행 방향의 수직으로 제어점을 밀어 완만한 곡선 궤적을 만든다 */
      var cx = clamp(mx - (dy / len) * len * curve, -90, vw() + 90);
      var cy = clamp(my + (dx / len) * len * curve, -90, vh() + 90);
      c.move = {
        sx: sx, sy: sy, cx: cx, cy: cy, ex: ex, ey: ey,
        t0: nowMs(), dur: Math.max(120, dur),
        ax: dx / len, ay: dy / len, amp: amp || 0,
        done: done || null
      };
      c.settle = null;
      c.rx = 0;
      c.ry = 0;
      c.vx = 0;
      c.vy = 0;
      c.idle.on = false;
    }

    function idleStep(c, f) {
      c.idle.a += 0.016 * f * c.idle.speed;
      var tx = c.idle.cx + Math.cos(c.idle.a) * c.idle.r;
      var ty = c.idle.cy + Math.sin(c.idle.a * 1.13) * c.idle.r * 0.55;
      var dx = tx - c.x, dy = ty - c.y;
      c.vx += dx * 0.0042 * f;
      c.vy += dy * 0.0042 * f;
      /* 서로 밀어내 최소 간격을 유지한다 */
      for (var j = 0; j < cursors.length; j++) {
        var o = cursors[j];
        if (o === c) continue;
        var ox = c.x - o.x;
        var oy = c.y - o.y;
        var d2 = ox * ox + oy * oy;
        if (d2 > MIN_GAP * MIN_GAP || d2 < 0.01) continue;
        var d = Math.sqrt(d2);
        var push = ((MIN_GAP - d) / MIN_GAP) * 0.9;
        c.vx += (ox / d) * push * f;
        c.vy += (oy / d) * push * f;
      }
      var damp = Math.pow(0.87, f);
      c.vx *= damp;
      c.vy *= damp;
      c.x += c.vx * f;
      c.y += c.vy * f;
      c.x = clamp(c.x, 4, vw() - 4);
      c.y = clamp(c.y, 4, vh() - 4);
    }

    function update(c, dt, t) {
      var f = clamp(dt * 60, 0, 3);

      /* 퇴장이 끝난 커서는 다시 그리지 않는다 */
      if (c.exiting && !c.move) return;

      if (c.move) {
        var m = c.move;
        var p = clamp((t - m.t0) / m.dur, 0, 1);
        var e = easeInOut(p);
        var mt = 1 - e;
        c.x = mt * mt * m.sx + 2 * mt * e * m.cx + e * e * m.ex;
        c.y = mt * mt * m.sy + 2 * mt * e * m.cy + e * e * m.ey;
        if (p >= 1) {
          c.move = null;
          /* 퇴장 중이던 커서는 화면 밖에 그대로 두고 대기 상태로 되돌리지 않는다.
             대기로 돌아가면 좌표 clamp에 걸려 화면 가장자리로 튀어 보인다. */
          if (c.exiting) {
            c.settle = null;
            c.idle.on = false;
            draw(c, t);
            c.el.style.visibility = 'hidden';
            return;
          }
          c.settle = { t0: t, amp: m.amp, ax: m.ax, ay: m.ay };
          c.idle.cx = c.x;
          c.idle.cy = c.y;
          c.idle.on = true;
          var done = m.done;
          m.done = null;
          if (done) done();
        }
      } else {
        if (c.settle) {
          var st = (t - c.settle.t0) / 1000;
          if (st > 0.65) {
            c.settle = null;
            c.rx = 0;
            c.ry = 0;
          } else {
            var off = c.settle.amp * Math.exp(-st * 8.5) * Math.sin(st * 28);
            c.rx = c.settle.ax * off;
            c.ry = c.settle.ay * off;
          }
        }
        if (c.idle.on) idleStep(c, f);
      }

      draw(c, t);
    }

    /* ---------- 속삭임 말풍선의 둥근 점선 테두리 ---------- */

    var DASH_RX = 8;  /* 모서리 반지름(px) — CSS .whisper의 border-radius와 같은 값 */

    /* 말풍선마다 SVG 둥근 사각형(stroke)을 하나 만들어 말풍선 위에 겹쳐 놓는다.
       점선이 꼭짓점 곡선을 따라 흐르므로 모서리에서 선이 끊기거나 비지 않는다. */
    function ensureDash(c) {
      if (c.dashEl && c.dashEl.parentNode === layer) return c.dashEl;
      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'sw-dash');
      svg.setAttribute('aria-hidden', 'true');
      /* 테두리 색은 말풍선과 같이 --sw-bc 변수로 넘긴다(요소가 달라 상속되지 않는다) */
      svg.style.setProperty('--sw-bc', c.color);
      var rc = document.createElementNS(ns, 'rect');
      svg.appendChild(rc);
      svg._l = -99999;  /* 다음 배치에서 반드시 위치·크기를 반영하게 한다 */
      c.dashEl = svg;
      c.dashRect = rc;
      layer.appendChild(svg);
      return svg;
    }

    /* 점선 사각형을 말풍선과 같은 정수 픽셀 사각형에 맞춘다. 값이 그대로면 DOM을 건드리지 않는다. */
    function placeDash(c, lx, ly, w, h) {
      var d = c.dashEl, rc = c.dashRect;
      if (!d || !rc) return;
      if (d._l === lx && d._t === ly && d._w === w && d._h === h) return;
      d._l = lx; d._t = ly; d._w = w; d._h = h;
      d.style.left = lx + 'px';
      d.style.top = ly + 'px';
      d.style.width = w + 'px';
      d.style.height = h + 'px';
      /* 테두리 상자 안쪽 1px 선 위에 놓이도록 반 픽셀 들인다 */
      rc.setAttribute('x', '0.5');
      rc.setAttribute('y', '0.5');
      rc.setAttribute('width', Math.max(0, w - 1).toFixed(1));
      rc.setAttribute('height', Math.max(0, h - 1).toFixed(1));
      /* 반지름이 짧은 변의 절반을 넘으면 곡선이 겹치므로 그 안으로 묶는다 */
      var r = Math.max(0, Math.min(DASH_RX, w * 0.5 - 0.5, h * 0.5 - 0.5));
      rc.setAttribute('rx', r.toFixed(1));
      rc.setAttribute('ry', r.toFixed(1));
    }

    /* 말풍선을 커서 옆에 '정수 픽셀' 좌표로 붙인다. 커서 좌표는 소수점이지만
       말풍선은 반올림한 값에만 놓아 글자가 다시 그려지지 않게 하고, 화면 밖으로
       나가지 않도록 당긴다. 반올림 결과가 같으면 DOM을 건드리지 않는다. */
    function placeBubble(c, x, y) {
      var b = c.bubble, el = c.bubbleEl;
      if (!el) return;
      var w = b.w || 0, h = b.h || 0;
      var left = b.flip ? x - 21 - w : x + 21;
      var top = b.below ? y + 26 : y - 13 - h;
      left = clamp(left, 4, Math.max(4, vw() - w - 4));
      top = clamp(top, 4, Math.max(4, vh() - h - 4));
      var lx = Math.round(left), ly = Math.round(top);
      if (lx !== b.lx || ly !== b.ly) {
        b.lx = lx; b.ly = ly;
        el.style.left = lx + 'px';
        el.style.top = ly + 'px';
      }
      /* 속삭임 말풍선의 둥근 점선 테두리도 같은 사각형에 겹쳐 놓는다.
         위치가 그대로여도 크기가 바뀌었을 수 있으므로 매번 맞춰 본다. */
      if (c.dashEl) placeDash(c, lx, ly, w, h);
    }

    function draw(c, t) {
      var bob = c.move ? 0 : Math.sin(t * 0.0016 + c.phase) * 0.9;
      var x = c.x + c.rx;
      var y = c.y + c.ry + bob;
      if (!(Math.abs(x - c.lastX) <= 0.05) || !(Math.abs(y - c.lastY) <= 0.05)) {
        c.lastX = x;
        c.lastY = y;
        c.el.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)';
      }
      if (c.scrollDrag) updateThumb(c);
      var b = c.bubble;
      if (b.on) {
        placeBubble(c, x, y);
        var n = Math.min(b.text.length, Math.floor((t - b.t0) / CPS));
        if (n !== b.n) {
          b.n = n;
          c.bubbleEl.textContent = b.text.slice(0, n);
          /* 타이핑되는 동안 짧은 대화 효과음. 여러 글자가 한 프레임에 찍혀도
             70ms 간격을 두어 기관총처럼 들리지 않게 한다. */
          if (n > 0 && t - b.blipAt > 70) {
            b.blipAt = t;
            if (WBF.Audio && WBF.Audio.talk) {
              try { WBF.Audio.talk(c.pitch, n); } catch (eSh) { }
            }
          }
        }
      }
    }

    /* ---------- 루프 ---------- */

    function startLoop() {
      beat = nowMs();
      if (!raf) {
        lastT = 0;
        raf = window.requestAnimationFrame(loop);
      }
      startWatch();
    }

    function loop() {
      raf = 0;
      if (!layer) return;
      var t = nowMs();
      var dt = lastT ? clamp((t - lastT) / 1000, 0.001, 0.05) : 0.016;
      lastT = t;
      beat = t;
      for (var i = 0; i < cursors.length; i++) {
        /* 한 커서의 예외로 루프가 멈춰 전부 얼어붙는 일을 막는다 */
        try { update(cursors[i], dt, t); } catch (err) { }
      }
      try { updateBox(); } catch (err2) { }
      if (cursors.length) raf = window.requestAnimationFrame(loop);
    }

    /* rAF가 끊겨도(탭 전환·예외) 커서가 굳은 채 남지 않도록 감시 후 재시작한다 */
    function startWatch() {
      if (watchTimer || !layer) return;
      watchTimer = window.setTimeout(function () { watchTimer = 0; watch(); }, 250);
    }

    function watch() {
      if (!layer) return;
      if (cursors.length && (!raf || nowMs() - beat > 400)) {
        if (raf && window.cancelAnimationFrame) window.cancelAnimationFrame(raf);
        raf = 0;
        lastT = 0;
        beat = nowMs();
        raf = window.requestAnimationFrame(loop);
      }
      startWatch();
    }

    /* ---------- 선택 영역 ---------- */

    function updateBox() {
      if (!boxVisible || !boxTarget || !boxEl) return;
      var rect = null;
      /* 스크롤 패널 경계. 상자가 이 선을 넘어 경기장 위로 통과하지 않게 한다 */
      var clipEl = boxTarget.clipEl || null;
      /* 상자를 가둘 수 있는 '보이는 영역': 스크롤 패널이 있으면 그 사각형, 없으면 창 전체 */
      var clipRect = (clipEl && clipEl.getBoundingClientRect) ? clipEl.getBoundingClientRect() : null;
      /* 상자를 가둘 수 있는 '보이는 영역'. 기본은 창 전체(스크롤바 제외, 1px 안쪽)이고,
         스크롤 패널이 있으면 패널 사각형과 창 사각형이 겹치는 부분을 쓴다.
         패널이 창보다 넓게 늘어나 있어도 상자가 화면 오른쪽 밖으로 나가
         오른쪽 테두리가 잘리지 않는다. */
      var bounds = windowRect();
      if (clipRect) {
        bounds = {
          left: Math.max(clipRect.left, bounds.left),
          top: Math.max(clipRect.top, bounds.top),
          right: Math.min(clipRect.right, bounds.right),
          bottom: Math.min(clipRect.bottom, bounds.bottom)
        };
      }

      /* 끄는 중: 누른 모서리에서 커서까지 영역이 매 프레임 자란다 */
      if (boxTarget.grow) {
        var gc = boxTarget.grow;
        /* 따라갈 요소가 있으면 지금 화면 위치를 다시 잰다(스크롤과 겹쳐 진행할 때) */
        var fr = null;
        if (boxTarget.follow) {
          fr = liveRectOf(boxTarget.follow, 3, clipEl);
          /* 패널 밖으로 완전히 밀려난 줄만 남았으면 닫지 않고 잠시 감춘다.
             다시 스크롤해 줄이 들어오면 커서를 따라 이어서 그린다. */
          if (!fr) { parkBox(); return; }
        } else {
          fr = clampRectTo(boxTarget.full, clipEl) || boxTarget.full;
        }
        var gw = clamp((gc.x + gc.rx) - fr.left, 0, fr.width);
        var gh = clamp((gc.y + gc.ry) - fr.top, 0, fr.height);
        rect = { left: fr.left, top: fr.top, width: gw, height: gh };
      } else if (boxTarget.follow) {
        rect = liveRectOf(boxTarget.follow, 3, clipEl);
        /* 대상 줄이 패널 안에 하나도 안 남아도 상자를 닫지 않는다.
           연결을 유지한 채 감추기만 하고, 줄이 다시 패널 안으로 들어오면
           같은 상자가 그 자리에서 다시 보인다. */
        if (!rect) { parkBox(); return; }
      } else if (boxTarget.el) {
        if (!boxTarget.el.isConnected) { hideBox(); return; }
        rect = clampRectTo(boxTarget.el.getBoundingClientRect(), clipEl) || boxTarget.rect;
      } else {
        rect = clampRectTo(boxTarget.rect, clipEl) || boxTarget.rect;
      }
      if (!rect) { parkBox(); return; }

      /* 보이는 영역 밖으로 나간 부분을 잘라 낸다. 경기장처럼 화면 끝에 딱 붙은 요소를
         잡으면 여백 3px 때문에 위·왼쪽 테두리와 모서리 핸들이 화면 밖으로 밀려나
         잘려 보이므로, 상자를 보이는 영역 안으로 당겨 온전히 보이게 한다. */
      var bl = Math.max(rect.left, bounds.left);
      var bt = Math.max(rect.top, bounds.top);
      var br = Math.min(rect.left + rect.width, bounds.right);
      var bb = Math.min(rect.top + rect.height, bounds.bottom);
      if (!(br > bl) || !(bb > bt)) { parkBox(); return; }
      if (bl !== rect.left || bt !== rect.top ||
        br !== rect.left + rect.width || bb !== rect.top + rect.height) {
        rect = { left: bl, top: bt, width: br - bl, height: bb - bt };
      }
      /* 끄는 중에는 크기 라벨을 지금 사각형 크기로 계속 맞춘다 */
      if (boxTarget.grow && boxLabelEl) {
        boxLabelEl.textContent = Math.round(rect.width) + ' \u00d7 ' + Math.round(rect.height);
      }

      var left = rect.left;
      var top = rect.top;
      boxEl.style.left = left.toFixed(1) + 'px';
      boxEl.style.top = top.toFixed(1) + 'px';
      boxEl.style.width = Math.max(0, rect.width).toFixed(1) + 'px';
      boxEl.style.height = Math.max(0, rect.height).toFixed(1) + 'px';

      /* 감춰 두었던 상자: 줄이 다시 패널 안으로 들어왔으니 위치를 맞춘 뒤 보여 준다 */
      if (boxParked) {
        boxParked = false;
        boxEl.style.transition = '';
        boxEl.classList.add('on');
      }

      /* 크기 라벨(상자 아래 16px)과 모서리 핸들(4px)은 상자 밖에 붙어 있어, 상자가
         스크롤 패널 경계에 닿으면 그대로 패널 밖으로 삐져나온다. 남은 여백을 보고
         라벨을 위쪽이나 안쪽으로 옮기고, 경계에 닿은 쪽 핸들은 숨긴다. */
      var bottomEdge = top + rect.height;
      var rightEdge = left + rect.width;
      var roomBelow = bounds.bottom - bottomEdge;
      var roomAbove = top - bounds.top;
      boxEl.classList.toggle('lab-up', roomBelow < 16 && roomAbove >= 18);
      boxEl.classList.toggle('lab-in', roomBelow < 16 && roomAbove < 18);
      boxEl.classList.toggle('edge-t', top <= bounds.top + 0.6);
      boxEl.classList.toggle('edge-b', bottomEdge >= bounds.bottom - 0.6);
      boxEl.classList.toggle('edge-l', left <= bounds.left + 0.6);
      boxEl.classList.toggle('edge-r', rightEdge >= bounds.right - 0.6);
    }

    /* 영역 선택이 끝난 자리를 흰색으로 짧게 점멸시킨다(강조).
       날카로운 플래시 대신 CSS가 한 번 은은히 밝아졌다 페이드로 사라진다.
       요소는 그 자리에서 만들고 수명이 끝나면 지운다. */
    var FLASH_MS = 420;

    function flashArea(rect, opts) {
      if (!layer || !rect) return;
      var o = opts || {};
      var r = clampToWindow(rect);
      if (!r || !(r.width > 1) || !(r.height > 1)) return;
      var f = document.createElement('div');
      f.className = 'sw-flash';
      f.setAttribute('aria-hidden', 'true');
      f.style.left = r.left.toFixed(1) + 'px';
      f.style.top = r.top.toFixed(1) + 'px';
      f.style.width = r.width.toFixed(1) + 'px';
      f.style.height = r.height.toFixed(1) + 'px';
      if (o.duration) f.style.animationDuration = Math.round(o.duration) + 'ms';
      layer.appendChild(f);
      var life = (o.duration || FLASH_MS) + 80;
      window.setTimeout(function () {
        if (f.parentNode) f.parentNode.removeChild(f);
      }, life);
    }

    function showBox(tgt, color, label) {
      if (!tgt || !layer) return;
      ensureLayer();
      resetBoxFade();
      /* 요소가 스크롤 패널 안이면 그 경계로 잘라 패널 밖까지 넘지 않게 한다 */
      tgt.clipEl = scrollClipOf([tgt.el]);
      boxTarget = tgt;
      boxVisible = true;
      boxParked = false;
      /* 선택 영역 테두리·핸들·라벨은 그 커서의 색을 그대로 쓴다 */
      var tint = color || '#33ff66';
      boxEl.style.color = tint;
      boxLabelEl.style.background = tint;
      boxLabelEl.textContent = label ||
        (Math.round(tgt.w) + ' \u00d7 ' + Math.round(tgt.h));
      updateBox();
      fadeBoxIn();
    }

    /* 새 선택 영역이 나타날 때, 이전 상자를 그대로 페이드아웃시키면 새 위치로
       순간이동해 다시 진해져 사라지는 것처럼 보인다. 그래서 이전 모양을 복사한
       잔상을 제자리에 남겨 옅어지게 하고, 원본은 곧바로 투명하게 되돌린다. */
    function resetBoxFade() {
      if (!boxEl) return;
      if (boxVisible && boxEl.classList.contains('on')) ghostBox();
      boxEl.classList.remove('on');
      boxEl.style.transition = 'none';
      boxEl.style.opacity = '0';
    }

    /* 제자리에서 옅어지는 이전 선택 영역 복사본 */
    function ghostBox() {
      if (!layer || !boxEl) return;
      var w = parseFloat(boxEl.style.width);
      var h = parseFloat(boxEl.style.height);
      if (!(w > 0) || !(h > 0)) return;
      var op = 1;
      try { op = parseFloat(window.getComputedStyle(boxEl).opacity); } catch (eOp) { op = 1; }
      if (!(op > 0.02)) return;  /* 이미 거의 사라진 상자는 복사하지 않는다 */

      var g = document.createElement('div');
      g.className = 'sw-box sw-ghost';
      g.setAttribute('aria-hidden', 'true');
      g.style.left = boxEl.style.left;
      g.style.top = boxEl.style.top;
      g.style.width = boxEl.style.width;
      g.style.height = boxEl.style.height;
      g.style.color = boxEl.style.color;
      g.style.opacity = String(op);
      var lbl = document.createElement('span');
      lbl.className = 'sw-size';
      lbl.style.background = boxEl.style.color || 'currentColor';
      lbl.textContent = boxLabelEl ? boxLabelEl.textContent : '';
      g.appendChild(lbl);
      layer.appendChild(g);
      g.getBoundingClientRect();  /* 1 → 0 전이가 실제로 재생되도록 리플로우 */
      g.style.opacity = '0';
      setTimeout(function () {
        if (g.parentNode) g.parentNode.removeChild(g);
      }, 380);
    }

    function fadeBoxIn() {
      if (!boxEl) return;
      boxEl.getBoundingClientRect(); /* 리플로우를 강제해 0 → 1 페이드가 실제로 재생된다 */
      boxEl.style.transition = '';
      boxEl.style.opacity = '';
      boxEl.classList.add('on');
    }

    /* 스크롤로 대상이 패널 밖에 완전히 나갔을 때 상자를 닫지 않고 잠시 감춘다.
       boxTarget·follow 연결은 그대로 두므로, 다시 스크롤해 줄이 패널 안으로
       돌아오면 같은 상자가 원래 위치·크기로 다시 나타난다. 감춘 동안에는
       화면에 아무것도 그리지 않으므로 패널 밖(경기장 위)으로 넘어가지 않는다. */
    function parkBox() {
      if (!boxVisible || !boxTarget) return;
      boxParked = true;
      if (boxEl) {
        boxEl.style.transition = 'opacity 120ms linear';
        boxEl.classList.remove('on');
      }
    }

    function hideBox() {
      boxVisible = false;
      boxTarget = null;
      boxParked = false;
      if (boxEl) {
        boxEl.classList.remove('dragging');
        /* 위치·크기는 그대로 두고 클래스만 빼서 그 자리에서 부드럽게 옅어진다 */
        boxEl.classList.remove('on');
      }
    }

    /* ---------- 연출 조각 ---------- */

    function ring(c) {
      if (!layer) return;
      var r = document.createElement('i');
      r.className = 'sw-ring';
      r.style.color = c.color;
      r.style.left = (c.x + c.rx).toFixed(1) + 'px';
      r.style.top = (c.y + c.ry).toFixed(1) + 'px';
      layer.appendChild(r);
      setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 620);
    }

    function bounce(el) {
      if (!el || !el.classList) return;
      el.classList.remove('sw-bounce');
      /* 같은 애니메이션을 연속으로 재시작하려면 리플로우가 필요하다 */
      if (el.offsetWidth === -1) return;
      el.classList.add('sw-bounce');
      setTimeout(function () { el.classList.remove('sw-bounce'); }, 360);
    }

    /* ---------- 공개 API ---------- */

    function moveTo(id, target, opts) {
      var c = find(id);
      if (!c || !layer) return Promise.resolve(null);
      var o = opts || {};
      var tgt = resolveTarget(target, o);
      if (!tgt) return Promise.resolve(null);

      var ex = tgt.ax + (o.dx || 0);
      var ey = tgt.ay + (o.dy || 0);
      var dx = ex - c.x, dy = ey - c.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      var dur = o.duration || clamp(360 + len * 0.55, 460, 1100);
      var curve = typeof o.curve === 'number' ? o.curve : 0.16;
      var amp = o.bounce === false ? 0 : 2.6;

      return new Promise(function (resolve) {
        beginMove(c, ex, ey, dur, curve, amp, function () { resolve(tgt); });
      });
    }

    function click(id, target, opts) {
      var c = find(id);
      if (!c || !layer) return Promise.resolve(null);
      var o = opts || {};
      return moveTo(id, target, {
        duration: o.duration, curve: o.curve, dx: o.dx, dy: o.dy, scroll: o.scroll
      }).then(function (tgt) {
        if (!tgt || !layer) return null;
        ring(c);
        /* 실제 요소가 없는 사각형 대상을 짚을 때도 눌림 손맛을 주려고 bounceEl을 받는다 */
        if (tgt.el || o.bounceEl) bounce(tgt.el || o.bounceEl);
        if (o.box !== false && tgt.rect) showBox(tgt, c.color, o.label);
        if (o.hold) return wait(o.hold);
        return null;
      });
    }

    /* ---------- 아스키 거품 ---------- */

    /* 속삭임 말풍선이 닫힐 때, 말풍선이 차지하던 자리의 글자를 작은 거품 문자로 바꿔
       위로 떠오르며 흩어지게 한다. 말풍선은 그 자리에서 빠르게 옅어지고,
       거품 조각만 남아 수명이 끝나면 스스로 지운다. */
    /* (거품 문자 방식은 없앴다. 기호를 억지로 쓰지 않고 1~3px 미세 입자만 띄운다) */
    /* 속삭임 말풍선이 닫힐 때, 점선 테두리가 미세한 가루가 되어 바깥으로 흩어진다.
       기호 글자 대신 1~2px짜리 입자만 써서 문장 길이와 상관없이 자연스럽다.
       말풍선은 그 자리에서 빠르게 옅어지고, 가루만 남아 수명이 끝나면 스스로 지운다. */
    var DUST_STEP = 10;   /* 점선 한 주기(선 4px + 틈 6px)와 같은 간격으로 입자를 놓는다 */
    var DUST_MAX = 140;

    /* 둥근 사각형 테두리를 따라 s(px)만큼 이동한 지점과 그 지점의 바깥쪽 법선을 돌려준다.
       점선이 도는 둥근 모서리를 그대로 따라가야 입자가 '선 위에서' 태어난 것처럼 보인다.
       순서: 위 변 → 오른쪽 위 곡선 → 오른쪽 변 → 오른쪽 아래 곡선 → 아래 변 →
       왼쪽 아래 곡선 → 왼쪽 변 → 왼쪽 위 곡선(시계 방향). */
    function edgePoint(w, h, r, s) {
      var ax = Math.max(0, w - r * 2), ay = Math.max(0, h - r * 2);
      var arc = Math.PI * r / 2;
      var segs = [
        [ax, function (d) { return { x: r + d, y: 0, nx: 0, ny: -1 }; }],
        [arc, function (d) {
          var a = -Math.PI / 2 + (r > 0 ? d / r : 0);
          return { x: w - r + Math.cos(a) * r, y: r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
        }],
        [ay, function (d) { return { x: w, y: r + d, nx: 1, ny: 0 }; }],
        [arc, function (d) {
          var a = (r > 0 ? d / r : 0);
          return { x: w - r + Math.cos(a) * r, y: h - r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
        }],
        [ax, function (d) { return { x: w - r - d, y: h, nx: 0, ny: 1 }; }],
        [arc, function (d) {
          var a = Math.PI / 2 + (r > 0 ? d / r : 0);
          return { x: r + Math.cos(a) * r, y: h - r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
        }],
        [ay, function (d) { return { x: 0, y: h - r - d, nx: -1, ny: 0 }; }],
        [arc, function (d) {
          var a = Math.PI + (r > 0 ? d / r : 0);
          return { x: r + Math.cos(a) * r, y: r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
        }]
      ];
      for (var i = 0; i < segs.length; i++) {
        var len = segs[i][0];
        if (len > 0 && s <= len) return segs[i][1](s);
        s -= len;
      }
      return { x: 0, y: 0, nx: 0, ny: -1 };
    }

    /* 속삭임 말풍선의 점선 테두리가 미세한 가루가 되어 바깥으로 흩어진다.
       기호 글자는 쓰지 않고 1~3px짜리 입자만 띄운다. 입자는 점선이 도는 둥근 둘레
       위에서 태어나 그 지점의 바깥 법선 방향으로 날아가며, 위로 조금 떠오르다
       사라진다. 말풍선은 그 자리에서 빠르게 옅어지고, 가루만 남아 수명이 끝나면
       컨테이너를 지운다. */
    function fizzDust(el, color) {
      if (!layer || !el) return;
      var rect = el.getBoundingClientRect();
      var w = rect.width, h = rect.height;
      if (!(w > 8) || !(h > 8)) return;
      /* 화면 밖으로 완전히 나간 자리면 가루를 띄우지 않는다 */
      if (rect.right < -20 || rect.left > vw() + 20 ||
        rect.bottom < -20 || rect.top > vh() + 20) return;

      var box = document.createElement('div');
      box.className = 'sw-dust';
      box.setAttribute('aria-hidden', 'true');
      box.style.left = rect.left.toFixed(1) + 'px';
      box.style.top = rect.top.toFixed(1) + 'px';
      box.style.width = w.toFixed(1) + 'px';
      box.style.height = h.toFixed(1) + 'px';
      box.style.zIndex = String(zSeq);
      layer.appendChild(box);

      /* 입자는 테두리 선 위에서 태어난다. 점선 사각형과 같은 안쪽 1px 선을 기준으로
         잡고, 점선 한 주기(10px)마다 하나씩 놓아 선이 그대로 가루로 풀리는 느낌을 준다. */
      var bw = Math.max(1, w - 1), bh = Math.max(1, h - 1);
      var rr = Math.max(0, Math.min(DASH_RX, bw * 0.5 - 0.5, bh * 0.5 - 0.5));
      var perim = 2 * Math.max(0, bw - rr * 2) + 2 * Math.max(0, bh - rr * 2) + 2 * Math.PI * rr;
      var n = Math.round(clamp(perim / DUST_STEP, 8, DUST_MAX));
      var longest = 0;

      for (var k = 0; k < n; k++) {
        /* 둘레를 고르게 나누되 조금씩 흩어 놓는다 */
        var s = perim * (k + Math.random() * 0.8) / n;
        var p = edgePoint(bw, bh, rr, s);
        var i = document.createElement('i');
        var size = 1 + Math.random() * 1.8;
        i.style.left = (p.x + 0.5 - size / 2).toFixed(1) + 'px';
        i.style.top = (p.y + 0.5 - size / 2).toFixed(1) + 'px';
        i.style.width = size.toFixed(2) + 'px';
        i.style.height = size.toFixed(2) + 'px';
        i.style.background = color || '#7fb8ff';
        /* 바깥 법선 방향으로 흩어지며 위로 살짝 떠오른다 */
        var out = 5 + Math.random() * 18;
        var dx = p.nx * out + (Math.random() - 0.5) * 8;
        var dy = p.ny * out - (5 + Math.random() * 22);
        i.style.setProperty('--dx', dx.toFixed(1) + 'px');
        i.style.setProperty('--dy', dy.toFixed(1) + 'px');
        i.style.setProperty('--o', (0.32 + Math.random() * 0.5).toFixed(2));
        i.style.setProperty('--sc', (0.4 + Math.random() * 0.7).toFixed(2));
        var dur = 640 + Math.random() * 520;
        var delay = Math.random() * 200;
        i.style.animationDuration = Math.round(dur) + 'ms';
        i.style.animationDelay = Math.round(delay) + 'ms';
        if (dur + delay > longest) longest = dur + delay;
        box.appendChild(i);
      }

      window.setTimeout(function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      }, Math.round(longest) + 140);
    }

    /* 예전 격자 거품 문자 방식은 제거했다. 지금은 fizzDust의 미세 입자만 쓴다. */

    /* 말풍선을 즉시 지우면 툭 사라진다. 그 자리에서 투명도만 내려 자연스럽게 닫고,
       FADE_MS가 지난 뒤에 내용과 클래스를 정리한다. */
    function fadeBubble(c) {
      var el = c && c.bubbleEl;
      if (!el) return;
      var b = c.bubble;
      if (b.timer) { clearTimeout(b.timer); b.timer = 0; }
      if (b.fadeTimer) { clearTimeout(b.fadeTimer); b.fadeTimer = 0; }
      if (!b.on && !el.classList.contains('on')) { el.textContent = ''; return; }
      b.on = false;
      /* 속삭임 말풍선은 사라지기 전에 글자가 거품 아스키로 풀려 위로 날아간다 */
      if (el.classList.contains('whisper')) {
        fizzDust(el, c.color);
        if (c.dashEl) c.dashEl.classList.remove('on');
      }
      el.classList.add('out');
      b.fadeTimer = setTimeout(function () {
        b.fadeTimer = 0;
        el.classList.remove('on');
        el.classList.remove('out');
        el.classList.remove('whisper');
        el.textContent = '';
      }, FADE_MS);
    }

    function say(id, msg, duration) {
      var c = find(id);
      if (!c || !layer) return Promise.resolve();
      var b = c.bubble;
      var o = (duration && typeof duration === 'object') ? duration : { duration: duration };
      if (b.timer) { clearTimeout(b.timer); b.timer = 0; }
      /* 앞 말풍선이 옅어지는 중이면 페이드를 취소하고 새 문장을 바로 띄운다 */
      if (b.fadeTimer) { clearTimeout(b.fadeTimer); b.fadeTimer = 0; }
      c.bubbleEl.classList.remove('out');
      b.text = String(msg);
      b.n = 0;
      b.t0 = nowMs();
      b.on = true;
      /* 완성 문장의 폭·높이를 먼저 재서 고정한다. 타이핑할 때마다 max-content
         폭을 다시 계산하면 줄바꿈 지점이 계속 바뀌어 읽는 중에 글이 흔들린다.
         재자마자 비우므로 화면에 완성 문장이 스쳐 보이지 않는다. */
      c.bubbleEl.style.width = '';
      c.bubbleEl.style.minHeight = '';
      c.bubbleEl.textContent = b.text;
      var bw = c.bubbleEl.offsetWidth;
      var bh = c.bubbleEl.offsetHeight;
      c.bubbleEl.textContent = '';
      if (bw > 0 && bh > 0) {
        c.bubbleEl.style.width = bw + 'px';
        c.bubbleEl.style.minHeight = bh + 'px';
      }
      b.w = bw;
      b.h = bh;
      /* 오른쪽·위쪽 공간이 모자라면 커서 반대편이나 아래로 띄운다 */
      b.flip = c.x + 21 + bw > vw() - 8;
      b.below = c.y - 13 - bh < 6;
      b.lx = -99999;
      b.ly = -99999;
      /* whisper:true면 반투명·점선(개미 행렬) 속삭임 말풍선으로 띄운다.
         점선이 둥근 모서리를 따라가야 하므로 SVG 둥근 사각형을 함께 띄운다. */
      var whisper = !!o.whisper;
      c.bubbleEl.classList.toggle('whisper', whisper);
      if (whisper) {
        ensureDash(c);
        c.dashEl.classList.add('on');
        c.dashEl._l = -99999;  /* 새 크기로 다시 배치한다 */
      } else if (c.dashEl) {
        c.dashEl.classList.remove('on');
      }
      placeBubble(c, c.x + c.rx, c.y + c.ry);
      c.bubbleEl.classList.add('on');
      /* 말하는 커서를 위로 올려 다른 커서가 말풍선을 가리지 않게 한다 */
      c.el.style.zIndex = String(++zSeq);
      c.bubbleEl.style.zIndex = String(zSeq);
      if (c.dashEl && whisper) c.dashEl.style.zIndex = String(zSeq);
      /* 타이핑이 끝난 뒤에도 읽을 시간을 넉넉히 남긴다(글자 수에 비례) */
      var typeMs = b.text.length * CPS;
      var ms = typeof o.duration === 'number'
        ? o.duration
        : Math.max(3400, typeMs + 1300 + b.text.length * 48);
      if (o.persist) return Promise.resolve();
      return new Promise(function (resolve) {
        b.timer = setTimeout(function () {
          b.timer = 0;
          fadeBubble(c);
          resolve();
        }, ms);
      });
    }

    /* 말풍선만 즉시 닫는다(커서는 그대로) */
    function hideBubble(id) {
      var c = find(id);
      if (!c) return;
      var b = c.bubble;
      fadeBubble(c);
    }

    function guides(target, opts) {
      var o = opts || {};
      if (!layer || !guidesEl) return Promise.resolve();
      var tgt = resolveTarget(target, o);
      if (!tgt) return Promise.resolve();
      guideV.style.left = Math.round(tgt.x) + 'px';
      guideH.style.top = Math.round(tgt.y) + 'px';
      guidesEl.classList.add('on');
      return wait(o.duration || 900).then(function () {
        if (guidesEl) guidesEl.classList.remove('on');
      });
    }

    /* 영역 드래그 선택(마퀴). 커서가 대상 왼쪽 위 모서리를 누른 채 반대 모서리까지 끌면
       선택 영역이 커서를 따라 실시간으로 자라고, 놓으면 그 크기로 남는다.
       실제 요소나 설정은 바꾸지 않고 보여 주기만 한다. */
    function selectBox(id, target, opts) {
      var c = find(id);
      if (!c || !layer) return Promise.resolve(null);
      var o = opts || {};
      /* follow: 스크롤과 겹쳐 잡을 때, 그 요소들의 실제 사각형을 계속 따라가는 선택 영역.
         요소 하나를 대상으로 잡았고 follow가 따로 없으면 그 요소를 그대로 따라간다. */
      var follow = o.follow || null;
      var tgt = resolveTarget(target, o);
      if (!follow && tgt && tgt.el) follow = [tgt.el];
      if (!tgt && follow) tgt = { el: null, rect: null, w: 0, h: 0 };
      if (!tgt) return Promise.resolve(null);
      /* 스크롤 컨테이너 경계. 넘치고 있는 줄까지 상자가 감싸 패널 밖으로 나가지 않게 한다 */
      var clipEl = follow ? scrollClipOf(follow) : null;
      var r = (follow && liveRectOf(follow, 3, clipEl)) || tgt.rect;
      if (!r) return Promise.resolve(null);
      /* natural은 요소의 실제 크기(라벨에 쓰는 값), full은 화면 안으로 당긴 사각형이다.
         경기장처럼 창 끝에 딱 붙은 요소는 여백 3px이 화면 밖으로 나가 테두리와
         모서리 핸들이 잘리므로, 당긴 사각형으로 그린다. */
      var natural = { width: r.width, height: r.height };
      var full = clampToWindow({ left: r.left, top: r.top, width: r.width, height: r.height });
      var label = o.label || null;
      var diag = Math.sqrt(full.width * full.width + full.height * full.height);
      var cnt = cornerOf(full);

      return moveTo(id, { x: cnt.x, y: cnt.y }, {
        duration: o.grabDuration || 480,
        curve: typeof o.grabCurve === 'number' ? o.grabCurve : -0.12
      }).then(function () {
        if (!layer) return null;
        /* 스크롤이 함께 움직였으면 지금 화면 위치로 다시 재서 그 자리에서 끈다 */
        if (follow) {
          var nowRect = liveRectOf(follow, 3, clipEl);
          if (nowRect) full = nowRect;
          /* 도착하는 사이 스크롤이 조금 더 움직여 모서리가 옮겨졌으면,
             끌기 시작점을 지금 모서리로 맞춰 화살표가 줄에서 떨어지지 않게 한다. */
          var cpt = cornerOf(full);
          var sx2 = cpt.x, sy2 = cpt.y;
          if ((sx2 - c.x) * (sx2 - c.x) + (sy2 - c.y) * (sy2 - c.y) > 16) {
            c.x = sx2;
            c.y = sy2;
            c.lastX = -99999;  /* 다음 draw에서 새 위치로 다시 그린다 */
            c.lastY = -99999;
            draw(c, nowMs());
          }
        }
        ring(c);
        /* 누른 순간 대상이 쫀득하게 눌린다. bounce:false면 눌림 없이 넘어간다
           (경기장처럼 큰 패널이 커졌다 작아지는 모션을 피할 때 쓴다) */
        if (o.bounce !== false && (tgt.el || o.bounceEl)) bounce(tgt.el || o.bounceEl);

        /* 0 크기에서 시작해 커서를 따라 자라는 선택 영역 */
        resetBoxFade();
        boxTarget = {
          rect: { left: full.left, top: full.top, width: 0, height: 0 },
          w: full.width, h: full.height,
          grow: c, full: full, follow: follow, clipEl: clipEl
        };
        boxVisible = true;
        boxParked = false;
        boxEl.style.color = c.color;
        boxLabelEl.style.background = c.color;
        boxLabelEl.textContent = label || '0 \u00d7 0';
        boxEl.classList.add('dragging');
        updateBox();
        fadeBoxIn();

        var cnt2 = cornerOf(full, true);
        return new Promise(function (resolve) {
          beginMove(c, cnt2.x, cnt2.y,
            o.duration || clamp(360 + diag * 0.5, 420, 1200),
            typeof o.curve === 'number' ? o.curve : 0.02, 0, resolve);
        });
      }).then(function () {
        if (!layer) return null;
        /* 손을 떼면 실제 크기로 맞춘 선택 영역이 남는다 */
        if (follow) {
          var fr2 = liveRectOf(follow, 3, clipEl) || full;
          boxTarget = { follow: follow, clipEl: clipEl, rect: fr2, w: fr2.width, h: fr2.height };
          /* 끄는 동안 스크롤이 더 움직였으면 화살표가 모서리에서 떨어져 있다.
             상자가 줄을 따라가도 화살표만 따로 놀지 않도록 지금 모서리로 다시 붙인다. */
          var edge2 = cornerOf(fr2, true);
          if ((edge2.x - c.x) * (edge2.x - c.x) + (edge2.y - c.y) * (edge2.y - c.y) > 64) {
            beginMove(c, edge2.x, edge2.y, 200, 0.02, 0, null);
          }
        } else {
          boxTarget = tgt.el
            ? { el: tgt.el, clipEl: scrollClipOf([tgt.el]), rect: full, w: full.width, h: full.height }
            : { rect: full, w: full.width, h: full.height };
        }
        if (boxEl) boxEl.classList.remove('dragging');
        updateBox();
        if (boxLabelEl) {
          boxLabelEl.textContent = label ||
            (Math.round(natural.width) + ' \u00d7 ' + Math.round(natural.height));
        }
        /* 영역 선택이 끝난 그 순간, 같은 자리를 흰색으로 짧게 점멸시켜 강조한다 */
        if (o.flash) flashArea(full);
        ring(c);
        if (o.hold) return wait(o.hold);
        return tgt;
      });
    }

    /* ---------- 스크롤 바 드래그 시연 ---------- */

    function ensureThumb() {
      if (thumbEl) return thumbEl;
      ensureLayer();
      thumbEl = document.createElement('div');
      thumbEl.className = 'sw-thumb';
      layer.appendChild(thumbEl);
      return thumbEl;
    }

    function scrollGeom(cont) {
      var r = cont.getBoundingClientRect();
      var trackTop = r.top + 4;
      var trackH = Math.max(12, r.height - 8);
      var maxScroll = Math.max(0, cont.scrollHeight - cont.clientHeight);
      var thumbH = maxScroll > 0
        ? Math.max(24, Math.min(trackH, trackH * cont.clientHeight / cont.scrollHeight))
        : trackH;
      return {
        r: r, trackTop: trackTop, trackH: trackH, thumbH: thumbH,
        maxScroll: maxScroll, maxShift: Math.max(0, trackH - thumbH)
      };
    }

    /* 커서 y좌표를 스크롤 비율로 환산해 썸과 실제 scrollTop을 함께 움직인다 */
    function updateThumb(c) {
      var s = c.scrollDrag;
      if (!s || !s.el) return;
      var ratio = s.geom.maxShift > 0
        ? clamp((c.y + c.ry - s.geom.trackTop - s.geom.thumbH / 2) / s.geom.maxShift, 0, 1)
        : 0;
      s.cont.scrollTop = ratio * s.geom.maxScroll;
      s.el.style.transform = 'translate3d(0,' + (s.geom.trackTop + s.geom.maxShift * ratio).toFixed(1) + 'px,0)';
    }

    /* 한 커서가 스크롤 바 썸을 잡고 끌며 실제 컨테이너를 스크롤한다 */
    function scrollDrag(id, container, opts) {
      var c = find(id);
      if (!c || !layer) return Promise.resolve(null);
      var cont = typeof container === 'string' ? document.querySelector(container) : container;
      if (!cont) return Promise.resolve(null);
      var o = opts || {};
      var g = scrollGeom(cont);
      if (g.maxScroll <= 1) return Promise.resolve(null);
      var to = clamp(typeof o.to === 'number' ? o.to : 1, 0, 1);
      var fromRatio = clamp(cont.scrollTop / g.maxScroll, 0, 1);
      var startY = g.trackTop + g.thumbH / 2 + g.maxShift * fromRatio;
      var endY = g.trackTop + g.thumbH / 2 + g.maxShift * to;
      var t = ensureThumb();
      thumbGen++;
      /* 앞선 드래그의 썸이 아직 옅어지는 중이면, 그 자리에서 새 색·새 위치로 바뀐
         막대가 잠깐 보인다. 전이 없이 완전히 감춘 뒤 새 위치로 옮겨 다시 띄운다. */
      t.classList.remove('on');
      t.style.transition = 'none';
      t.style.opacity = '0';
      t.style.height = g.thumbH.toFixed(1) + 'px';
      t.style.left = (g.r.right - 9).toFixed(1) + 'px';
      t.style.background = c.color;
      c.scrollDrag = { cont: cont, geom: g, el: t };
      updateThumb(c);
      t.getBoundingClientRect();  /* 감춘 채 새 위치를 먼저 반영해야 페이드인이 그 자리에서 시작된다 */
      t.style.opacity = '';
      t.style.transition = '';
      t.getBoundingClientRect();
      t.classList.add('on');

      return moveTo(id, { x: g.r.right - 12, y: startY }, {
        duration: o.grabDuration || 480, curve: -0.08
      }).then(function () {
        if (!c.scrollDrag) return null;
        ring(c);
        return new Promise(function (resolve) {
          beginMove(c, g.r.right - 12, endY, o.duration || 1500, 0.03, 0, resolve);
        });
      }).then(function () {
        /* 손을 뗀 뒤에도 커서가 썸을 붙들고 있으면, 커서의 대기 부유 움직임이
           매 프레임 scrollTop을 다시 계산해 줄이 미세하게 오르내린다. 썸 그림은
           hideScrollThumb까지 남겨 두고, 스크롤을 미는 연결만 끊는다. */
        if (c.scrollDrag) c.scrollDrag = null;
        if (o.hold) return wait(o.hold);
        return null;
      });
    }

    function hideScrollThumb() {
      for (var i = 0; i < cursors.length; i++) cursors[i].scrollDrag = null;
      if (!thumbEl) return;
      var el = thumbEl;
      /* 위치(transform)를 지우면 썸이 컨테이너 맨 위로 순간이동해, 옅어지는
         THUMB_FADE_MS 동안 엉뚱한 자리에 막대가 잠깐 보인다. 제자리에서 옅어진
         뒤에 정리한다. 그 사이 새 드래그가 썸을 다시 켜면 세대가 달라져 건너뛴다. */
      el.classList.remove('on');
      var gen = ++thumbGen;
      window.setTimeout(function () {
        if (gen !== thumbGen || !thumbEl) return;
        thumbEl.style.transition = 'none';
        thumbEl.style.transform = '';
        thumbEl.getBoundingClientRect();
        thumbEl.style.transition = '';
      }, THUMB_FADE_MS + 60);
    }

    function teardown() {
      if (raf) {
        if (window.cancelAnimationFrame) window.cancelAnimationFrame(raf);
        raf = 0;
      }
      if (watchTimer) { clearTimeout(watchTimer); watchTimer = 0; }
      for (var i = 0; i < cursors.length; i++) {
        if (cursors[i].bubble.timer) clearTimeout(cursors[i].bubble.timer);
        if (cursors[i].bubble.fadeTimer) clearTimeout(cursors[i].bubble.fadeTimer);
      }
      cursors.length = 0;
      if (thumbEl && thumbEl.parentNode) thumbEl.parentNode.removeChild(thumbEl);
      thumbEl = null;
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
      layer = null;
      boxEl = null;
      boxLabelEl = null;
      guidesEl = null;
      guideV = null;
      guideH = null;
      boxTarget = null;
      boxVisible = false;
      boxParked = false;
    }

    function dismissAll() {
      if (!layer) return Promise.resolve();
      var list = cursors.slice();
      if (!list.length) { teardown(); return Promise.resolve(); }
      var maxDur = 420;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        c.bubble.on = false;
        if (c.bubble.timer) { clearTimeout(c.bubble.timer); c.bubble.timer = 0; }
        if (c.bubbleEl) {
          c.bubbleEl.classList.remove('on');
          c.bubbleEl.textContent = '';
        }
        /* 가까운 화면 밖으로 흩어져 나간다 */
        var left = c.x < vw() * 0.5;
        var ex = left ? -110 : vw() + 110;
        var ey = clamp(c.y + (Math.random() * 140 - 70), -110, vh() + 110);
        var dur = 380 + Math.min(220, Math.abs(ex - c.x) * 0.2) + i * 55;
        if (dur > maxDur) maxDur = dur;
        c.exiting = true;
        beginMove(c, ex, ey, dur, (i % 2 ? 0.18 : -0.18), 0, null);
      }
      hideBox();
      if (guidesEl) guidesEl.classList.remove('on');
      return wait(maxDur - 40).then(function () { teardown(); });
    }

    return {
      spawn: spawn,
      moveTo: moveTo,
      click: click,
      say: say,
      hideBubble: hideBubble,
      guides: guides,
      selectBox: selectBox,
      scrollDrag: scrollDrag,
      hideScrollThumb: hideScrollThumb,
      showBox: showBox,
      hideBox: hideBox,
      dismissAll: dismissAll,
      find: find,
      count: function () { return cursors.length; }
    };
  }

  return { create: create };
})();
