/* 아트 시트 기반 아스키 유체
   - 평상시: 모든 셀 입자가 아트 시트 위치에 고정된다(렌더러가 셀 버퍼로 1셀 1문자를 출력하므로 형태가 칼같이 선명).
   - 충격: 충격 지점 근처 셀 30~50%가 0.25~0.4초 동안 진행 방향으로 흩날린다(모래폭풍).
   - 재조립: 자유 시간이 끝나면 강한 스프링 인력으로 앵커에 빨려 들어와 원래 무기 모양으로 복원된다.
   - 별도 폭죽 파티클은 없다. 흩어지는 것은 본체 문자 입자 그 자체다. */
window.WBF = window.WBF || {};

WBF.Fluid = (function () {
  var TAU = Math.PI * 2;
  var tmp = { x: 0, y: 0 };
  /* 흩날림 유지 시간(초) — 요구 사양 0.25~0.40초 고정 범위 */
  var FREE_MIN = 0.14;
  var FREE_MAX = 0.24;

  /* 셀 → 회전된 월드 오프셋 */
  function anchorOf(f, p, out) {
    var cw = f.cellW || 6.4;
    var chh = f.cellH || 11.5;
    var sheet = f.sheet;
    var lx = (p.sc - sheet.cc) * cw;
    var ly = (p.sr - sheet.cr) * chh;
    var ang = f.shapeAngle || 0;
    var ca = Math.cos(ang), sa = Math.sin(ang);
    out.x = lx * ca - ly * sa;
    out.y = lx * sa + ly * ca;
    return out;
  }

  /* 시트 셀 수만큼 입자를 만든다(1셀 1입자) */
  function attach(f) {
    /* 렌더러가 레이아웃 때 남긴 셀 피치로 시트를 만든다(셰이딩 아트는 피치마다 칸 배치가 다르다) */
    var pitch = WBF.cellPitch;
    var sheet = WBF.Shapes.sheetFor(f.typeId, pitch && pitch.fw, pitch && pitch.fh);
    f.sheet = sheet;
    var cells = sheet.cells;
    var list = [];
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      list.push({
        idx: i,
        sc: cell.c, sr: cell.r, ch: cell.ch, tier: cell.tier,
        x: 0, y: 0, vx: 0, vy: 0,
        st: 0, free: 0
      });
    }
    f.fluid = list;
    f.vac = new Uint8Array(cells.length);
    /* 피치(셀 크기)는 렌더러가 매 프레임 실제 셀 피치로 동기화한다. 최초값만 기본값을 준다 */
    if (!f.cellW) f.cellW = 6.4;
    if (!f.cellH) f.cellH = 11.5;
  }

  /* 최근접 셀 선택용 재사용 버퍼 — 충돌마다 배열을 만들거나 정렬하지 않는다(GC 끊김 방지) */
  var SEL_P = [];
  var SEL_D = [];
  var SEL_AX = [];
  var SEL_AY = [];

  function swapSel(i, j) {
    var tp = SEL_P[i]; SEL_P[i] = SEL_P[j]; SEL_P[j] = tp;
    var td = SEL_D[i]; SEL_D[i] = SEL_D[j]; SEL_D[j] = td;
    var tx = SEL_AX[i]; SEL_AX[i] = SEL_AX[j]; SEL_AX[j] = tx;
    var ty = SEL_AY[i]; SEL_AY[i] = SEL_AY[j]; SEL_AY[j] = ty;
  }

  /* 충격: 가까운 셀부터 10~18%를 떼어내 진행 방향으로 흩뿌린다 */
  function shatter(f, dx, dy, power, hx, hy) {
    var parts = f.fluid;
    if (!parts || !parts.length) return;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var bx = dx / len, by = dy / len;
    var pw = Math.min(2.4, Math.max(0.6, power || 1));
    var want = Math.max(2, Math.round(parts.length * (0.10 + 0.04 * Math.min(2, pw))));
    var pos = f.body.position;
    var hasHit = (hx !== undefined && hx !== null);
    var n = 0;
    var i, j, d, a, p, ex, ey;

    /* 삽입 정렬로 상위 want개만 유지: 할당도, 전체 정렬도 없다 */
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (p.st !== 0) continue;
      a = anchorOf(f, p, tmp);
      if (hasHit) {
        ex = pos.x + a.x - hx;
        ey = pos.y + a.y - hy;
        d = ex * ex + ey * ey;
      } else {
        d = Math.random() * 9000;
      }
      if (n < want) {
        j = n++;
      } else if (d < SEL_D[want - 1]) {
        j = want - 1;
      } else {
        continue;
      }
      SEL_P[j] = p;
      SEL_D[j] = d;
      SEL_AX[j] = a.x;
      SEL_AY[j] = a.y;
      while (j > 0 && SEL_D[j - 1] > SEL_D[j]) {
        swapSel(j - 1, j);
        j--;
      }
    }
    if (!n) return;

    var base = Math.atan2(by, bx);
    for (i = 0; i < n; i++) {
      var pt = SEL_P[i];
      pt.st = 1;
      pt.free = FREE_MIN + Math.random() * (FREE_MAX - FREE_MIN);
      pt.x = SEL_AX[i];
      pt.y = SEL_AY[i];
      var ang = base + (Math.random() - 0.5) * 1.5;
      var sp = (60 + Math.random() * 110) * (0.7 + pw * 0.3);
      /* 진행 방향 성분 + 수직 확산으로 모래가 부채꼴로 뿌려진다 */
      var side = (Math.random() - 0.5) * 70;
      pt.vx = Math.cos(ang) * sp + bx * 90 - by * side;
      pt.vy = Math.sin(ang) * sp + by * 90 + bx * side;
      f.vac[pt.idx] = 1;
    }
    SEL_P.length = 0;
    SEL_D.length = 0;
    SEL_AX.length = 0;
    SEL_AY.length = 0;
  }

  /* 피격: 맞은 지점 반대(몸통 중심) 방향으로 본체 문자가 흩날린다 */
  function splash(f, hx, hy, power) {
    var c = f.body.position;
    var dx = c.x - hx;
    var dy = c.y - hy;
    if (!dx && !dy) { dx = 1; dy = 0; }
    shatter(f, dx, dy, power, hx, hy);
  }

  /* 벽·기물 반사 충격 */
  function splat(f, dx, dy, power) {
    shatter(f, dx, dy, power);
  }

  /* 파괴: 전 셀 폭산 */
  function burst(f, power) {
    var parts = f.fluid;
    if (!parts) return;
    var pc = power || 1;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var a = anchorOf(f, p, tmp);
      if (p.st === 0) { p.x = a.x; p.y = a.y; }
      var ang = Math.random() * TAU;
      var s = (60 + Math.random() * 150) * pc;
      p.vx += Math.cos(ang) * s;
      p.vy += Math.sin(ang) * s;
      p.st = 1;
      p.free = FREE_MIN + Math.random() * (FREE_MAX - FREE_MIN);
      f.vac[p.idx] = 1;
    }
  }

  /* 자유 흩날림 → 자기장 재조립 */
  function step(f, dt, time) {
    var parts = f.fluid;
    if (!parts || !parts.length) return;
    var flyD = Math.exp(-6.0 * dt);
    var snapD = Math.exp(-8.0 * dt);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.st === 0) continue;
      var a = anchorOf(f, p, tmp);
      if (p.st === 1) {
        p.free -= dt;
        p.vx *= flyD;
        p.vy *= flyD;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.free <= 0) p.st = 2;
      } else {
        p.vx += (a.x - p.x) * 900 * dt;
        p.vy += (a.y - p.y) * 900 * dt;
        p.vx *= snapD;
        p.vy *= snapD;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        var ddx = a.x - p.x, ddy = a.y - p.y;
        if (ddx * ddx + ddy * ddy < 4.5) {
          p.st = 0;
          p.x = a.x;
          p.y = a.y;
          p.vx = 0;
          p.vy = 0;
          f.vac[p.idx] = 0;
        }
      }
    }
  }

  /* 광전사 성장: 시트는 그대로 두고 충돌 반경·피해만 커진다 */
  function grow(f) {}

  return {
    attach: attach,
    step: step,
    shatter: shatter,
    splash: splash,
    splat: splat,
    burst: burst,
    grow: grow
  };
})();
