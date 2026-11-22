/* 스파크·충격파·잔열·데미지 숫자 */
window.WBF = window.WBF || {};

WBF.Effects = (function () {
  function Layer() {
    this.parts = [];
    this.texts = [];
    this.waves = [];
    this.segs = [];
    this.pool = [];
    /* 대장장이 금속 스파크(파이터 간 충돌 전용) — 날카로운 문자 파편 */
    this.sparks = [];
    this.sparkPool = [];
    /* 접점 섬광 — 부딪힌 자리에 짧게 얹는 굵은 문자 */
    this.flashes = [];
    /* 총구 연기 — 셀 단위로 부풀며 흐르는 아스키 연기(오브젝트 풀) */
    this.smoke = [];
    this.smokePool = [];
    /* 불씨 — 총구에서 튄 아스키 불티(중력으로 가라앉는다) */
    this.embers = [];
    this.emberPool = [];
  }

  Layer.prototype.clear = function () {
    this.sparks.length = 0;
    this.flashes.length = 0;
    this.smoke.length = 0;
    this.embers.length = 0;
    this.parts.length = 0;
    this.texts.length = 0;
    this.waves.length = 0;
    this.segs.length = 0;
  };

  /* 스파크는 오브젝트 풀에서 꺼내 쓴다 — 충돌마다 새 객체를 만들지 않아 GC로 인한 끊김이 없다 */
  Layer.prototype.spark = function (x, y, count, color, speed) {
    var n = Math.max(1, Math.round(count * 0.35));
    var sp = (speed || 6) * 1.3;
    for (var i = 0; i < n; i++) {
      if (this.parts.length >= 160) break;
      var a = Math.random() * Math.PI * 2;
      var v = sp * (0.35 + Math.random());
      var life = 0.16 + Math.random() * 0.2;
      var o = this.pool.length ? this.pool.pop() : {};
      o.x = x;
      o.y = y;
      o.vx = Math.cos(a) * v;
      o.vy = Math.sin(a) * v;
      o.life = life;
      o.max = life;
      o.size = 1.4 + Math.random() * 2.6;
      o.color = color || '#ffffff';
      this.parts.push(o);
    }
  };

  /* 대장장이 금속 스파크 문자 — 진행 방향에 맞춰 '선(Line)' 형태를 고른다.
     가로로 길게 뻗으면 '='/'>'/'<', 사선이면 '\\'/'/', 수직이면 '|'/'^'.
     머리('*','+') 뒤에 같은 문자를 여러 칸 찍어 궤적이 선처럼 보이게 한다. */
  function axisGlyph(ux, uy, speed) {
    var ax = Math.abs(ux);
    var ay = Math.abs(uy);
    if (ax > ay * 1.5) {
      if (speed > 400) return ux > 0 ? '>' : '<';
      return '=';
    }
    if (ay > ax * 1.5) {
      return speed > 420 ? '^' : '|';
    }
    return ux * uy > 0 ? '\\' : '/';
  }

  /* 달궈진 쇠를 망치로 때릴 때 튀는 스파크.
     무작위 원형 확산이 아니라 **충돌 법선축**을 따라 양쪽으로 갈라져 선을 그리며 뻗는다.
     250~550px/s로 짧게(0.12~0.2초) 쏘아붙이고, 머리는 화이트/골드 중심의 단색이다(글로우 없음). */
  /* clear(파이터 반경)를 받으면 스폰 원점을 진행 방향으로 밀어낸다.
     충돌점은 두 몸통 사이에 끼어 있어서, 원점을 그대로 쓰면 꼬리 선이 몸통 문자에 묻힌다. */
  Layer.prototype.forge = function (x, y, nx, ny, count, colors, clear) {
    var n = Math.max(6, Math.round(count || 12));
    var base = Math.atan2(ny, nx);
    if (!isFinite(base)) base = 0;
    var push = (clear > 0 ? clear * 0.62 : 0) + 8;
    for (var i = 0; i < n; i++) {
      if (this.sparks.length >= 128) break;
      /* 법선축의 정·반대 방향으로 번갈아 뿜고, 좁은 각도 흔들림만 준다 */
      var side = (i % 2 === 0) ? 1 : -1;
      var a = base + (side > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.44;
      var v = 250 + Math.random() * 300;
      var life = 0.12 + Math.random() * 0.08;
      var o = this.sparkPool.length ? this.sparkPool.pop() : {};
      var ux = Math.cos(a);
      var uy = Math.sin(a);
      o.x = x + ux * push;
      o.y = y + uy * push;
      o.ux = ux;
      o.uy = uy;
      o.vx = ux * v;
      o.vy = uy * v;
      o.life = life;
      o.max = life;
      o.head = Math.random() < 0.62 ? '*' : '+';
      o.ch = axisGlyph(ux, uy, v);
      /* 꼬리 칸 수·간격: 빠를수록 길게 뻗어 선 형태가 또렷해진다 */
      o.tail = 3 + Math.round(Math.random() * 3);
      o.sp = 0.7 + Math.random() * 0.5;
      /* 화이트·골드 고대비가 3개 중 2개, 나머지만 파이터 색 */
      o.color = (i % 3 !== 2)
        ? (Math.random() < 0.5 ? '#ffffff' : '#ffdf70')
        : ((colors && colors.length) ? colors[i % colors.length] : '#ffffff');
      this.sparks.push(o);
    }
  };

  /* 접점 섬광 — 부딪힌 자리에 굵은 문자를 아주 짧게 얹는다(히트스탑 없음) */
  Layer.prototype.flash = function (x, y, color) {
    this.flashes.push({ x: x, y: y, life: 0.09, max: 0.09, color: color || '#ffffff' });
    while (this.flashes.length > 12) this.flashes.shift();
  };

  /* 총구 연기 — 총구 좌표에서 방향 dx,dy 로 뿜어 나와 위로 떠오르며 풀린다.
     굵은 문자에서 조각 문자로 흐려지는 것은 그릴 때 수명비로 고른다(여기서는 운동만). */
  Layer.prototype.muzzleSmoke = function (x, y, dx, dy, count, power) {
    var n = Math.max(3, Math.round(count || 12));
    var p = power || 1;
    var base = Math.atan2(dy, dx);
    for (var i = 0; i < n; i++) {
      if (this.smoke.length >= 96) break;
      var o = this.smokePool.length ? this.smokePool.pop() : {};
      var a = base + (Math.random() - 0.5) * 1.5;
      var v = (50 + Math.random() * 210) * p;
      o.x = x + (Math.random() - 0.5) * 7;
      o.y = y + (Math.random() - 0.5) * 7;
      o.vx = Math.cos(a) * v;
      o.vy = Math.sin(a) * v;
      o.life = 0.55 + Math.random() * 0.8;
      o.max = o.life;
      o.seed = Math.random();
      o.rise = 16 + Math.random() * 40;
      this.smoke.push(o);
    }
  };

  /* 불씨 — 총구 앞쪽 부채꼴로 튀어 오르며 밝은 노랑→주황→잿빛으로 식는다 */
  Layer.prototype.emberBurst = function (x, y, dx, dy, count, power) {
    var n = Math.max(4, Math.round(count || 14));
    var p = power || 1;
    var base = Math.atan2(dy, dx);
    for (var i = 0; i < n; i++) {
      if (this.embers.length >= 110) break;
      var o = this.emberPool.length ? this.emberPool.pop() : {};
      var a = base + (Math.random() - 0.5) * 1.7;
      var v = (90 + Math.random() * 330) * p;
      o.x = x + (Math.random() - 0.5) * 5;
      o.y = y + (Math.random() - 0.5) * 5;
      o.vx = Math.cos(a) * v;
      o.vy = Math.sin(a) * v - (30 + Math.random() * 70);
      o.life = 0.4 + Math.random() * 0.7;
      o.max = o.life;
      o.seed = Math.random();
      this.embers.push(o);
    }
  };

  Layer.prototype.text = function (x, y, value, color, size) {
    this.texts.push({
      x: x + (Math.random() - 0.5) * 14,
      y: y,
      vx: (Math.random() - 0.5) * 26,
      vy: -78 - Math.random() * 34,
      life: 0.85, max: 0.85,
      text: value,
      color: color || '#ffffff',
      size: size || 18
    });
    while (this.texts.length > 60) this.texts.shift();
  };

  /* 동심원 충격파 */
  Layer.prototype.wave = function (x, y, color, maxR, life) {
    this.waves.push({
      x: x, y: y, r: 6,
      maxR: maxR || 160,
      life: life || 0.55, max: life || 0.55,
      color: color || '#ffffff'
    });
    if (this.waves.length > 24) this.waves.shift();
  };

  /* 무기 잔열 궤적 */
  Layer.prototype.afterglow = function (x1, y1, x2, y2, color, life) {
    this.segs.push({
      x1: x1, y1: y1, x2: x2, y2: y2,
      color: color || '#ffffff',
      life: life || 0.3, max: life || 0.3
    });
    while (this.segs.length > 90) this.segs.shift();
  };

  /* 수명이 끝난 요소는 마지막 요소와 교체해 제거한다(배열 재배치 비용 없음) */
  Layer.prototype.removeAt = function (arr, i) {
    var last = arr.pop();
    if (i < arr.length) arr[i] = last;
    return last;
  };

  Layer.prototype.update = function (dt) {
    var i, p, t, w, d;
    for (i = this.parts.length - 1; i >= 0; i--) {
      p = this.parts[i];
      p.x += p.vx * dt * 7;
      p.y += p.vy * dt * 7;
      d = Math.max(0, 1 - 2.4 * dt);
      p.vx *= d;
      p.vy *= d;
      p.life -= dt;
      if (p.life <= 0) {
        this.removeAt(this.parts, i);
        if (this.pool.length < 64) this.pool.push(p);
      }
    }
    /* 금속 스파크: 짧은 수명 동안 강하게 감속하며 뻗는다 */
    for (i = this.sparks.length - 1; i >= 0; i--) {
      p = this.sparks[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      d = Math.max(0, 1 - 5.5 * dt);
      p.vx *= d;
      p.vy *= d;
      p.life -= dt;
      if (p.life <= 0) {
        this.removeAt(this.sparks, i);
        if (this.sparkPool.length < 64) this.sparkPool.push(p);
      }
    }
    for (i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].life -= dt;
      if (this.flashes[i].life <= 0) this.removeAt(this.flashes, i);
    }
    /* 연기: 빠르게 퍼졌다가 감속하며 위로 떠오른다 */
    for (i = this.smoke.length - 1; i >= 0; i--) {
      p = this.smoke[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      d = Math.max(0, 1 - 2.2 * dt);
      p.vx *= d;
      p.vy *= d;
      p.vy -= p.rise * dt * 0.5;
      p.life -= dt;
      if (p.life <= 0) {
        this.removeAt(this.smoke, i);
        if (this.smokePool.length < 64) this.smokePool.push(p);
      }
    }
    /* 불씨: 아래로 가라앉으며 가로 속도만 빠르게 준다 */
    for (i = this.embers.length - 1; i >= 0; i--) {
      p = this.embers[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt;
      p.vx *= Math.max(0, 1 - 1.5 * dt);
      p.vy *= Math.max(0, 1 - 0.7 * dt);
      p.life -= dt;
      if (p.life <= 0) {
        this.removeAt(this.embers, i);
        if (this.emberPool.length < 64) this.emberPool.push(p);
      }
    }
    for (i = this.texts.length - 1; i >= 0; i--) {
      t = this.texts[i];
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.vy *= Math.max(0, 1 - 2.6 * dt);
      t.life -= dt;
      if (t.life <= 0) this.removeAt(this.texts, i);
    }
    for (i = this.waves.length - 1; i >= 0; i--) {
      w = this.waves[i];
      w.r += (w.maxR - w.r) * Math.min(1, dt * 6);
      w.life -= dt;
      if (w.life <= 0) this.removeAt(this.waves, i);
    }
    for (i = this.segs.length - 1; i >= 0; i--) {
      this.segs[i].life -= dt;
      if (this.segs[i].life <= 0) this.removeAt(this.segs, i);
    }
  };

  /* 장면 레이어 (아스키 샘플링 대상) */
  Layer.prototype.draw = function (ctx) {
    var i;
    ctx.globalAlpha = 1;
    for (i = 0; i < this.segs.length; i++) {
      var s = this.segs[i];
      var sa = Math.max(0, s.life / s.max);
      ctx.globalAlpha = sa * 0.9;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2 + sa * 3;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }
    for (i = 0; i < this.waves.length; i++) {
      var w = this.waves[i];
      var wa = Math.max(0, w.life / w.max);
      ctx.globalAlpha = wa * 0.75;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = 1.6 + wa * 2.6;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      var a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.35 + a * 0.85), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /* 최상단 가독성 레이어 — 호출부에서 월드 변환을 적용한다 */
  Layer.prototype.drawTexts = function (ctx) {
    var i;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (i = 0; i < this.texts.length; i++) {
      var t = this.texts[i];
      var k = Math.max(0, t.life / t.max);
      ctx.globalAlpha = Math.min(1, k * 1.8);
      /* 한글 문구도 깨지지 않게 한글 시스템 폰트를 대체 글꼴로 둔다 */
      ctx.font = Math.max(7, Math.round(t.size * (0.55 + k * 0.2))) +
        'px "Press Start 2P", "VT323", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", monospace';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(3, 5, 8, 0.92)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  };

  return { Layer: Layer };
})();
