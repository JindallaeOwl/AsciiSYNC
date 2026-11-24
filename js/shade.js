/* 셰이딩 아트 굽기(Bake) — WBF.ART 원본(도형·재질·두께)을 각도별 셀 시트로 굽는다.

   1) 셀 하나를 3×4 서브블록(각 2×2 샘플)으로 나눠 도형이 덮는 모양을 잰다.
   2) 가장자리 칸: 실제 아틀라스 글꼴로 잰 글리프 덮임표와 비교해 가장 닮은 문자를 고른다
      (오른쪽 위로 기운 덮임 → '/', 아래쪽 띠 → '_' …). 꽉 찬 칸: 밝기 램프 문자.
   3) 두께(높이) 기울기 → 법선 → 반사 벡터의 화면 y로 크롬 3띠(하늘·어두운 띠·바닥) 색을 고른다.
      빛은 화면에 고정이므로 파이터가 돌면 광택이 글자 위를 미끄러진다.
   결과는 1셀 1문자 데이터(셀 오프셋·글리프·우선순위·색)일 뿐이고 그리기는 렌더러 셀 버퍼가 한다.
   굽기는 각도 단계별로 처음 쓸 때 한 번만 하고, 렌더러가 레이아웃(셀 피치·글꼴)이 바뀔 때 버린다. */
window.WBF = window.WBF || {};

WBF.Shade = (function () {
  var TAU = Math.PI * 2;
  var REF_W = 6;          /* 원본 좌표의 참조 셀 피치(px) */
  var REF_H = 11;
  var SX = 3;             /* 셀당 서브블록 열·행 */
  var SY = 4;
  var SS = 2;             /* 서브블록당 샘플(SS×SS) */
  var ANGLES = 32;        /* 회전 단계 수 */
  var FULL = 0.86;        /* 덮임 평균이 이 이상이면 내부 칸(램프 문자) */
  var MIN_COVER = 0.1;    /* 이보다 적게 덮인 칸은 비운다 */
  var VIEW_BIAS = -0.35;  /* 평평한 면(정면)이 하늘 쪽 밝은 색에 오도록 반사 y를 민다 */
  var P_STRUCT = 1;
  var P_OUTER = 2;

  /* 가장자리 모양 맞추기 후보 / 내부 밝기 램프 */
  var SHAPE_CH = ['/', '\\', '|', '-', '_', '(', ')', '[', ']', '<', '>', '^', 'v',
    "'", ',', '.', ':', ';', '~', '=', '+', '*', 'o', '#'];
  var RAMP = ['=', '+', '*', '#', '%', '@'];

  /* ---------- 색 ---------- */
  function hexRgb(h) {
    var v = parseInt(h.replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function mixRgb(a, b, k) {
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }
  var W3 = [255, 255, 255];
  var K3 = [0, 0, 0];
  /* '#hex' | 'sig' | 'sig+0.6' | 'sig-0.7' */
  function colorSpec(s, sig) {
    if (s.charAt(0) === '#') return hexRgb(s);
    var m = /^sig([+-])?([0-9.]+)?$/.exec(s);
    if (!m || !m[1]) return sig.slice();
    var k = parseFloat(m[2]) || 0;
    return mixRgb(sig, m[1] === '+' ? W3 : K3, k);
  }
  /* 반사 벡터 화면 y(-1 위 … +1 아래) → 색. 띠 경계가 짧아 크롬처럼 또렷하게 갈린다 */
  function envStops(env, sig) {
    var sky = colorSpec(env[0], sig);
    var band = colorSpec(env[1], sig);
    var floor = colorSpec(env[2], sig);
    return [
      [-1.0, mixRgb(sky, W3, 0.35)],
      [-0.32, sky],
      [-0.12, mixRgb(sky, band, 0.55)],
      [-0.06, band],
      [0.1, band],
      [0.2, floor],
      [1.0, mixRgb(floor, K3, 0.25)]
    ];
  }
  function envAt(stops, t) {
    if (t <= stops[0][0]) return stops[0][1];
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i - 1];
        var b = stops[i];
        return mixRgb(a[1], b[1], (t - a[0]) / (b[0] - a[0]));
      }
    }
    return stops[stops.length - 1][1];
  }

  /* ---------- 도형 ---------- */
  function buildPoly(pts, mirror) {
    var out = pts.slice();
    if (mirror) {
      for (var i = pts.length - 1; i >= 0; i--) {
        var p = pts[i];
        if ((i === 0 || i === pts.length - 1) && p[1] === 0) continue;
        out.push([p[0], -p[1]]);
      }
    }
    return out;
  }

  /* 원본 → 계산용 구조(한 번만) */
  var prepared = {};
  function prepare(typeId) {
    if (prepared[typeId] !== undefined) return prepared[typeId];
    var src = WBF.ART && WBF.ART[typeId];
    if (!src) { prepared[typeId] = null; return null; }
    var parts = [];
    var ext = 0;
    for (var i = 0; i < src.parts.length; i++) {
      var sp = src.parts[i];
      var part = { mat: src.materials[sp.mat], matKey: sp.mat };
      part.grain = sp.grain !== undefined ? sp.grain : part.mat.grain;
      if (sp.shape.circle) {
        var c = sp.shape.circle;
        part.kind = 0;
        part.cx = c[0]; part.cy = c[1]; part.r = c[2];
        part.x0 = c[0] - c[2]; part.x1 = c[0] + c[2]; part.y0 = c[1] - c[2]; part.y1 = c[1] + c[2];
        ext = Math.max(ext, Math.sqrt(c[0] * c[0] + c[1] * c[1]) + c[2]);
      } else {
        var poly = buildPoly(sp.shape.poly, sp.shape.mirror);
        part.kind = 1;
        part.xs = new Float32Array(poly.length);
        part.ys = new Float32Array(poly.length);
        part.x0 = 1e9; part.x1 = -1e9; part.y0 = 1e9; part.y1 = -1e9;
        for (var j = 0; j < poly.length; j++) {
          part.xs[j] = poly[j][0];
          part.ys[j] = poly[j][1];
          part.x0 = Math.min(part.x0, poly[j][0]); part.x1 = Math.max(part.x1, poly[j][0]);
          part.y0 = Math.min(part.y0, poly[j][1]); part.y1 = Math.max(part.y1, poly[j][1]);
          ext = Math.max(ext, Math.sqrt(poly[j][0] * poly[j][0] + poly[j][1] * poly[j][1]));
        }
      }
      parts.push(part);
    }
    var res = { parts: parts, ext: ext, src: src };
    prepared[typeId] = res;
    return res;
  }

  /* 부위 안쪽 거리(안이면 양수, 밖이면 음수) */
  function inside(part, x, y) {
    if (part.kind === 0) {
      var dx = x - part.cx;
      var dy = y - part.cy;
      return part.r - Math.sqrt(dx * dx + dy * dy);
    }
    var xs = part.xs;
    var ys = part.ys;
    var n = xs.length;
    var inPoly = false;
    var best = 1e9;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = xs[i], yi = ys[i], xj = xs[j], yj = ys[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inPoly = !inPoly;
      var ex = xj - xi;
      var ey = yj - yi;
      var l2 = ex * ex + ey * ey || 1;
      var t = ((x - xi) * ex + (y - yi) * ey) / l2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      var qx = xi + ex * t - x;
      var qy = yi + ey * t - y;
      var d2 = qx * qx + qy * qy;
      if (d2 < best) best = d2;
    }
    var d = Math.sqrt(best);
    return inPoly ? d : -d;
  }

  /* 안/밖만 판정(거리 계산 없음) */
  function contains(part, x, y) {
    if (x < part.x0 || x > part.x1 || y < part.y0 || y > part.y1) return false;
    if (part.kind === 0) {
      var dx = x - part.cx;
      var dy = y - part.cy;
      return dx * dx + dy * dy < part.r * part.r;
    }
    var xs = part.xs;
    var ys = part.ys;
    var n = xs.length;
    var c = false;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      if ((ys[i] > y) !== (ys[j] > y) && x < (xs[j] - xs[i]) * (y - ys[i]) / (ys[j] - ys[i]) + xs[i]) c = !c;
    }
    return c;
  }

  /* 맨 앞(목록 뒤쪽) 부위부터 찾는다 */
  function hit(prep, x, y) {
    for (var i = prep.parts.length - 1; i >= 0; i--) {
      if (contains(prep.parts[i], x, y)) return i;
    }
    return -1;
  }

  /* 한 점의 크롬 반사 색(원본 좌표 x,y, 부위 part) → out[0..2]에 더한다 */
  function shadeAt(part, x, y, ca, sa, stops, out) {
    var e = 0.9;
    var gx = (height(part, x + e, y) - height(part, x - e, y)) / (2 * e);
    var gy = (height(part, x, y + e) - height(part, x, y - e)) / (2 * e);
    var nx = -gx, ny = -gy, nz = 1;
    var inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    nx *= inv; ny *= inv; nz *= inv;
    /* 법선을 화면으로 회전 → 보는 방향(0,0,1)의 반사 벡터 화면 y */
    var ry = 2 * nz * (nx * sa + ny * ca) + VIEW_BIAS;
    var c = envAt(stops, ry);
    out[0] += c[0];
    out[1] += c[1];
    out[2] += c[2];
  }

  function height(part, x, y) {
    var d = inside(part, x, y);
    if (d <= 0) return 0;
    var m = part.mat;
    var u = Math.min(1, d / m.W);
    var h = m.profile === 'dome' ? m.H * Math.sqrt(u) : m.H * u;
    if (m.stripe) h += m.stripe[0] * Math.sin(x * TAU / m.stripe[1]);
    if (m.rim) {
      var z = (d - m.rim[1]) / m.rim[2];
      h += m.rim[0] * Math.exp(-z * z);
    }
    return h;
  }

  /* ---------- 글리프 덮임표 ----------
     렌더러 아틀라스와 같은 글꼴·스프라이트 크기·기준점으로 글자를 그려 3×4 덮임을 잰다.
     덮임은 글자마다 최댓값 1로 정규화해 '모양'만 비교한다. */
  function glyphTable(font, spW, spH, gidx) {
    var cv = document.createElement('canvas');
    cv.width = spW;
    cv.height = spH;
    var g = cv.getContext('2d', { willReadFrequently: true });
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    var list = [];
    for (var i = 0; i < SHAPE_CH.length; i++) {
      var ch = SHAPE_CH[i];
      if (!gidx[ch]) continue;
      g.clearRect(0, 0, spW, spH);
      g.fillText(ch, spW / 2, spH * 0.56);
      var data = g.getImageData(0, 0, spW, spH).data;
      var v = new Float32Array(SX * SY);
      for (var y = 0; y < spH; y++) {
        var by = Math.min(SY - 1, (y * SY / spH) | 0);
        for (var x = 0; x < spW; x++) {
          var bx = Math.min(SX - 1, (x * SX / spW) | 0);
          v[by * SX + bx] += data[(y * spW + x) * 4 + 3];
        }
      }
      var mx = 0;
      for (var k = 0; k < v.length; k++) if (v[k] > mx) mx = v[k];
      if (mx <= 0) continue;
      for (k = 0; k < v.length; k++) v[k] /= mx;
      list.push({ gi: gidx[ch], v: v });
    }
    var ramp = [];
    for (i = 0; i < RAMP.length; i++) ramp.push(gidx[RAMP[i]] || gidx['#']);
    return { list: list, ramp: ramp, gidx: gidx, ramps: {} };
  }

  /* 재질별 램프 문자열 → 글리프 번호 배열(덮임표에 캐시) */
  function rampGi(tab, str) {
    var r = tab.ramps[str];
    if (r) return r;
    r = [];
    for (var i = 0; i < str.length; i++) r.push(tab.gidx[str.charAt(i)] || tab.gidx['#']);
    tab.ramps[str] = r;
    return r;
  }

  function bestShape(tab, cover) {
    var best = -1;
    var bd = 1e9;
    for (var i = 0; i < tab.list.length; i++) {
      var v = tab.list[i].v;
      var d = 0;
      for (var k = 0; k < v.length; k++) {
        var e = cover[k] - v[k];
        d += e * e;
      }
      if (d < bd) { bd = d; best = tab.list[i].gi; }
    }
    return best;
  }

  /* 기존 문자 시트의 (열,행) → 유체 입자 번호 */
  function sheetIndex(sheet) {
    if (sheet._idx) return sheet._idx;
    var map = new Int16Array(sheet.cols * sheet.rows);
    map.fill(-1);
    for (var i = 0; i < sheet.cells.length; i++) {
      map[sheet.cells[i].r * sheet.cols + sheet.cells[i].c] = i;
    }
    sheet._idx = map;
    return map;
  }

  /* ---------- 굽기 ----------
     opt: { fw, fh, sig:[r,g,b], tab(glyphTable), sheet(유체 시트: 입자 대응용), scale(배율, 기본 1) }
     결과: { n, dc, dr, gi, prio, r, g, b, src } — dc/dr는 파이터가 있는 셀 기준 정수 오프셋 */
  var cover = new Float32Array(SX * SY);
  var col = [0, 0, 0];
  var votes = new Int32Array(32);
  /* 결 방향(화면 각도 0~π) → 선 문자. +y가 아래이므로 시계 방향 45°는 '\' */
  var GRAIN_CH = ['=', '\\', '|', '/'];
  /* 재질 팔레트를 뽑는 반사 y 위치(하늘 밝은 쪽 → 바닥 어두운 쪽 8곳) */
  var PAL_T = [-1.0, -0.55, -0.3, -0.12, 0.02, 0.18, 0.5, 1.0];

  function bake(typeId, aIdx, opt) {
    var prep = prepare(typeId);
    if (!prep) return null;
    var fw = opt.fw;
    var fh = opt.fh;
    var scale = opt.scale || 1;
    /* 원본 좌표는 월드 px다(충돌 반경과 같은 단위). 셀 피치(fw·fh)와 무관하게 실루엣의 월드 크기가
       고정되므로, 셀이 작아질수록 같은 실루엣에 칸이 더 들어가 디테일이 올라간다.
       배율: 분열 자식(0.72)·JUGGERNAUT 과열 팽창(1.22)처럼 같은 원본을 크게/작게 굽는다 */
    var kx = scale;
    var ky = scale;
    var ang = aIdx * TAU / ANGLES;
    var ca = Math.cos(ang);
    var sa = Math.sin(ang);
    var R = prep.ext * Math.max(kx, ky);
    var nc = Math.ceil(R / fw) + 1;
    var nr = Math.ceil(R / fh) + 1;
    var sheet = opt.sheet;
    var sidx = sheet ? sheetIndex(sheet) : null;
    var parts = prep.parts;
    var nParts = parts.length;
    var envCache = {};
    var palCache = {};
    var reach = R + Math.sqrt(fw * fw + fh * fh);
    var reach2 = reach * reach;

    var cap = (2 * nc + 1) * (2 * nr + 1);
    var oDc = new Int16Array(cap);
    var oDr = new Int16Array(cap);
    var oGi = new Int16Array(cap);
    var oPr = new Int8Array(cap);
    var oR = new Uint8Array(cap);
    var oG = new Uint8Array(cap);
    var oB = new Uint8Array(cap);
    var oSrc = new Int16Array(cap);
    var n = 0;
    var NSX = SX * SS;
    var NSY = SY * SS;
    var wS = 1 / (SS * SS);

    for (var dr = -nr; dr <= nr; dr++) {
      for (var dc = -nc; dc <= nc; dc++) {
        /* 원점에서 너무 먼 칸은 바로 건너뛴다 */
        var ccx = dc * fw, ccy = dr * fh;
        if (ccx * ccx + ccy * ccy > reach2) continue;
        cover.fill(0);
        for (var vv = 0; vv < nParts; vv++) votes[vv] = 0;
        var cnt = 0;
        col[0] = col[1] = col[2] = 0;
        var nShade = 0;
        for (var by = 0; by < SY; by++) {
          for (var bx = 0; bx < SX; bx++) {
            var hitPart = -1;
            var hx = 0, hy = 0;
            for (var sy = 0; sy < SS; sy++) {
              var wy = (dr + ((by * SS + sy) + 0.5) / NSY - 0.5) * fh;
              for (var sx = 0; sx < SS; sx++) {
                var wx = (dc + ((bx * SS + sx) + 0.5) / NSX - 0.5) * fw;
                /* 화면 → 원본: 역회전 후 참조 px로 */
                var lx = (wx * ca + wy * sa) / kx;
                var ly = (-wx * sa + wy * ca) / ky;
                var pi = hit(prep, lx, ly);
                if (pi < 0) continue;
                cover[by * SX + bx] += wS;
                cnt++;
                if (hitPart < 0) { hitPart = pi; hx = lx; hy = ly; }
              }
            }
            /* 서브블록마다 한 점에서 반사 색을 재 평균한다(능선 한가운데 한 점만 재면 평평하게 읽힌다) */
            if (hitPart >= 0) {
              votes[hitPart]++;
              var hp = parts[hitPart];
              var st = envCache[hp.matKey];
              if (!st) st = envCache[hp.matKey] = envStops(hp.mat.env, opt.sig);
              shadeAt(hp, hx, hy, ca, sa, st, col);
              nShade++;
            }
          }
        }
        if (!cnt) continue;
        var mean = cnt / (NSX * NSY);
        if (mean < MIN_COVER) continue;
        col[0] /= nShade; col[1] /= nShade; col[2] /= nShade;

        /* 색 종류 묶기: 칸을 가장 많이 덮은 부위 재질의 크롬 3띠에서 뽑은 8색 팔레트 중
           가장 가까운 색으로 맞춘다. 연속 색을 그대로 두면 글자 색 아틀라스(192행)가 넘쳐
           행을 계속 다시 그리게 된다(4종 동시 경기에서 초당 수백 번). */
        var pd = 0;
        for (vv = 1; vv < nParts; vv++) if (votes[vv] > votes[pd]) pd = vv;
        var pal = palCache[parts[pd].matKey];
        if (!pal) {
          var pst = envCache[parts[pd].matKey];
          if (!pst) pst = envCache[parts[pd].matKey] = envStops(parts[pd].mat.env, opt.sig);
          pal = palCache[parts[pd].matKey] = [];
          for (var pt = 0; pt < PAL_T.length; pt++) pal.push(envAt(pst, PAL_T[pt]));
        }
        var pBest = 0;
        var pDist = 1e9;
        for (var pk = 0; pk < pal.length; pk++) {
          var e0 = pal[pk][0] - col[0], e1 = pal[pk][1] - col[1], e2 = pal[pk][2] - col[2];
          var ed = e0 * e0 + e1 * e1 + e2 * e2;
          if (ed < pDist) { pDist = ed; pBest = pk; }
        }
        col[0] = pal[pBest][0]; col[1] = pal[pBest][1]; col[2] = pal[pBest][2];

        var gi;
        var prio;
        if (mean >= FULL) {
          /* 내부 칸: 칸을 가장 많이 덮은 부위의 재질로 채움 문자를 고른다 */
          var pb = 0;
          for (vv = 1; vv < nParts; vv++) if (votes[vv] > votes[pb]) pb = vv;
          var fm = parts[pb].mat;
          var fg = parts[pb].grain;
          if (fg !== undefined) {
            /* 결: 원본 결 각도 + 회전 → 화면 방향에 맞는 선 문자(밝기는 색이 맡는다) */
            var th = (fg + ang) % Math.PI;
            if (th < 0) th += Math.PI;
            gi = opt.tab.gidx[GRAIN_CH[Math.round(th / (Math.PI / 4)) % 4]];
          } else {
            var ramp = fm.ramp ? rampGi(opt.tab, fm.ramp) : opt.tab.ramp;
            var L = (0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2]) / 255;
            var ri = Math.min(ramp.length - 1, Math.max(0, (L * ramp.length) | 0));
            gi = ramp[ri];
          }
          prio = P_STRUCT;
        } else {
          gi = bestShape(opt.tab, cover);
          prio = P_OUTER;
        }
        if (gi <= 0) continue;

        /* 셀 중심이 기존 문자 시트의 어느 칸인지 → 흩날린 입자 자리를 비우는 데 쓴다 */
        var src = -1;
        if (sidx) {
          var cxw = dc * fw;
          var cyw = dr * fh;
          /* 유체 시트는 배율 1로 구운 칸이므로 배율로 나눠 같은 부위의 칸을 찾는다 */
          var sc = Math.round((cxw * ca + cyw * sa) / (fw * scale)) + sheet.cc;
          var sr = Math.round((-cxw * sa + cyw * ca) / (fh * scale)) + sheet.cr;
          if (sc >= 0 && sr >= 0 && sc < sheet.cols && sr < sheet.rows) src = sidx[sr * sheet.cols + sc];
        }

        oDc[n] = dc;
        oDr[n] = dr;
        oGi[n] = gi;
        oPr[n] = prio;
        oR[n] = col[0];
        oG[n] = col[1];
        oB[n] = col[2];
        oSrc[n] = src;
        n++;
      }
    }
    return { n: n, dc: oDc, dr: oDr, gi: oGi, prio: oPr, r: oR, g: oG, b: oB, src: oSrc };
  }

  /* ---------- 유체 시트 ----------
     원본을 각도 0·배율 1·지금 셀 피치(fw·fh, 월드 px)로 구워 손으로 쓴 문자 시트와 같은 형식
     { cols, rows, cc, cr, cells[{c, r, ch, tier}], fw, fh, art }으로 돌려준다. 유체 입자(1칸 1입자)와
     흩날림 문자, 기존 그리기 경로가 이 시트를 쓴다. 셀 피치마다 칸 배치가 달라지므로 피치별로
     캐시하고, 렌더러는 피치가 바뀌면 유체를 다시 붙인다. 문자는 기본 글꼴로 잰 덮임표로 고른다. */
  var sheetCache = {};
  var sheetTab = null;
  var sheetChars = null;
  function sheetFromArt(typeId, fw, fh) {
    fw = fw || REF_W;
    fh = fh || REF_H;
    var key = typeId + '|' + fw.toFixed(4) + '|' + fh.toFixed(4);
    if (sheetCache[key]) return sheetCache[key];
    var prep = prepare(typeId);
    if (!prep) return null;
    var chars = [' '];
    var gidx = {};
    function addCh(ch) {
      if (gidx[ch] === undefined) { gidx[ch] = chars.length; chars.push(ch); }
    }
    var i;
    for (i = 0; i < SHAPE_CH.length; i++) addCh(SHAPE_CH[i]);
    for (i = 0; i < RAMP.length; i++) addCh(RAMP[i]);
    for (i = 0; i < GRAIN_CH.length; i++) addCh(GRAIN_CH[i]);
    var mats = prep.src.materials;
    for (var mk in mats) {
      if (mats[mk].ramp) for (i = 0; i < mats[mk].ramp.length; i++) addCh(mats[mk].ramp.charAt(i));
    }
    /* 덮임표는 문자 집합이 같으면 한 번만 만든다(모든 원본의 램프 문자가 들어간 뒤 고정) */
    if (!sheetTab || sheetChars !== chars.join('')) {
      sheetTab = glyphTable('700 20px "JetBrains Mono","Courier New",monospace', 12, 22, gidx);
      sheetChars = chars.join('');
    }
    var tab = sheetTab;
    var bk = bake(typeId, 0, { fw: fw, fh: fh, sig: [255, 255, 255], tab: tab, sheet: null });
    var minC = 0, maxC = 0, minR = 0, maxR = 0;
    for (i = 0; i < bk.n; i++) {
      if (bk.dc[i] < minC) minC = bk.dc[i];
      if (bk.dc[i] > maxC) maxC = bk.dc[i];
      if (bk.dr[i] < minR) minR = bk.dr[i];
      if (bk.dr[i] > maxR) maxR = bk.dr[i];
    }
    var cells = [];
    for (i = 0; i < bk.n; i++) {
      cells.push({
        c: bk.dc[i] - minC,
        r: bk.dr[i] - minR,
        ch: chars[bk.gi[i]] || '#',
        tier: bk.prio[i] >= P_OUTER ? 3 : 2
      });
    }
    var sh = { id: typeId, cols: maxC - minC + 1, rows: maxR - minR + 1, cc: -minC, cr: -minR, cells: cells,
      fw: fw, fh: fh, art: true };
    sheetCache[key] = sh;
    return sh;
  }

  /* 각도(라디안) → 단계 번호 */
  function angleIndex(a) {
    var k = Math.round((a / TAU) * ANGLES) % ANGLES;
    return k < 0 ? k + ANGLES : k;
  }

  return {
    has: function (typeId) { return !!(WBF.ART && WBF.ART[typeId]); },
    bake: bake,
    sheetFromArt: sheetFromArt,
    glyphTable: glyphTable,
    angleIndex: angleIndex,
    ANGLES: ANGLES,
    SHAPE_CH: SHAPE_CH
  };
})();
