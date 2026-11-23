/* 셀 버퍼(Cell Buffer) 아스키 렌더러 — Overdraw 제거판

   핵심 규칙
   1) 1셀 = 1문자. 같은 칸에 여러 슬롯이 들어오면 우선순위가 가장 높은 하나만 남는다(Overwrite/Priority).
      P_FRAME(-1) < P_FILL(0) < P_STRUCT(1) < P_OUTER(2) < P_ENERGY(3)
   2) 글자는 셀 크기의 94%로만 그린다. 어떤 경우에도 이웃 칸을 침범하지 않는다(자간/행간 확보).
   3) 파이터 실루엣은 아트 시트(문자 행렬)를 1셀 1입자로 매핑한다. 회전 시 빈틈(Aliasing)은
      셀 중심 → 시트 로컬 좌표로 되돌리는 역매핑(Inverse Rotation Mapping) 패스로 메운다.
   4) 모든 요소(본체·탄환·이펙트·프레임)가 같은 셀 버퍼를 거치므로 겹침이 구조적으로 불가능하다.
   5) RENDER_MODE=블록이면 같은 셀 버퍼를 문자 대신 단색 사각형으로 칠해 실루엣만 남긴다(규칙·판정 불변).
*/
window.WBF = window.WBF || {};

WBF.Ascii = (function () {
  var GLYPHS = [' ', '.', ':', '~', '-', '=', '+', '*', 'o', '&', '#', '%', '@',
    '>', '<', '/', '\\', '|', 'v', '^', '─', '│', '┌', '┐', '└', '┘', '·', '_', 'X',
    /* 셰이딩 아트(js/shade.js) 가장자리 모양 맞추기용 — 기존 인덱스를 바꾸지 않게 뒤에 붙인다 */
    '(', ')', '[', ']', "'", ',', ';', '"'];
  var GIDX = {};
  for (var _g = 0; _g < GLYPHS.length; _g++) GIDX[GLYPHS[_g]] = _g;

  var FONT_FAMILY = '"JetBrains Mono","Fira Code","Courier New",monospace';

  /* 셀 점유 우선순위 */
  var EMPTY = -100;
  var P_FRAME = -1;
  var P_FILL = 0;
  var P_STRUCT = 1;
  var P_OUTER = 2;
  var P_ENERGY = 3;

  var WHITE = { r: 255, g: 255, b: 255 };

  var HEX = {};
  function rgb(hex) {
    var c = HEX[hex];
    if (c) return c;
    var v = parseInt(String(hex).replace('#', ''), 16);
    if (isNaN(v)) v = 0xffffff;
    c = { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
    HEX[hex] = c;
    return c;
  }

  function mix(sig, base, k) {
    return {
      r: Math.round(base * (1 - k) + sig.r * k),
      g: Math.round(base * (1 - k) + sig.g * k),
      b: Math.round(base * (1 - k) + sig.b * k)
    };
  }

  /* 아트 시트 → 로컬 격자(글리프 인덱스 + 등급). 역매핑 패스에서 사용 */
  function sheetGrid(sheet) {
    if (sheet._grid) return sheet._grid;
    var w = sheet.cols, h = sheet.rows;
    var gi = new Int16Array(w * h);
    var tier = new Uint8Array(w * h);
    var cells = sheet.cells || [];
    for (var i = 0; i < cells.length; i++) {
      var k = cells[i].r * w + cells[i].c;
      gi[k] = GIDX[cells[i].ch] || 0;
      tier[k] = cells[i].tier || 2;
    }
    sheet._grid = { w: w, h: h, gi: gi, tier: tier };
    return sheet._grid;
  }

  function Renderer(game) {
    this.game = game;
    this.canvas = game.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = 0;
    this.cssH = 0;
    this.fontPx = game.cellPx || 10;
    this.size = 10;
    this.cols = 0;
    this.rows = 0;
    this.fw = 6;
    this.fh = 11;
    this.invFw = 1 / 6;
    this.invFh = 1 / 11;
    this.ox = 0;
    this.oy = 0;
    this.cellCssW = 6;
    this.cellCssH = 11;
    this.drawW = 0;
    this.drawH = 0;
    this.wsx = 1;
    this.wsy = 1;
    this.total = 0;
    this.gx = new Float32Array(1);
    this.gy = new Float32Array(1);
    this.noise = new Float32Array(1);

    /* 셀 버퍼 */
    this.cbGi = new Int16Array(1);
    this.cbPrio = new Int8Array(1);
    this.cbR = new Uint8Array(1);
    this.cbG = new Uint8Array(1);
    this.cbB = new Uint8Array(1);
    this.cbGlow = new Uint8Array(1);
    /* 클리어 연출용 스크래치 버퍼(alloc에서 실제 크기로 다시 만든다) */
    this.scGi = new Int16Array(1);
    this.scPrio = new Int8Array(1);
    this.scR = new Uint8Array(1);
    this.scG = new Uint8Array(1);
    this.scB = new Uint8Array(1);

    /* 글리프 아틀라스 */
    this.atlas = null;
    this.glowAtlas = null;
    this.bgCanvas = null;
    this.wvAtlas = null;
    this.wvN = 0;
    this.atlasFont = '';
    this.rowMap = {};
    this.rowN = 0;
    this.ATLAS_ROWS = 192;
    this.glowMap = {};
    this.glowN = 0;
    this.GLOW_ROWS = 64;
    this.spW = 6;
    this.spH = 11;
    this.gw2 = 13;
    this.gh2 = 22;
    this.halfW = 3;
    this.halfH = 5;

    /* 셰이딩 아트: 원본(WBF.ART)이 있는 파이터는 각도별로 구운 시트를 그린다(K 키로 기존 방식과 비교) */
    this.artShade = !/[?&]art=sheet(&|$)/.test(window.location.search);
    this.shadeCache = {};
    this.shadeTab = null;

    /* 배경 클릭 리플 — 여백 파동장에 부호 있는 파면을 더한다 */
    var self = this;
    this.ripples = [];
    this.canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return; /* 좌클릭(주 버튼)에만 리플을 만든다 */
      var rect = self.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      self.addRipple((e.clientX - rect.left) * (self.cssW / rect.width),
        (e.clientY - rect.top) * (self.cssH / rect.height));
    }, { passive: true });

    this.resize(game.cssW, game.cssH);
  }

  /* ---------- 격자 크기 ---------- */

  Renderer.prototype.resize = function (cssW, cssH) {
    this.cssW = Math.max(120, cssW);
    this.cssH = Math.max(90, cssH);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.layout();
  };

  Renderer.prototype.layout = function () {
    var view = this.game.view || { k: 1, ox: 0, oy: 0 };
    var drawW = Math.max(120, WBF.world.W * view.k);
    var drawH = Math.max(80, WBF.world.H * view.k);
    var cellH = Math.max(9, Math.round(this.fontPx + 1));
    var cellW = Math.max(5, Math.round(this.fontPx * 0.62));
    var cols = Math.max(40, Math.floor(drawW / cellW));
    var rows = Math.max(20, Math.floor(drawH / cellH));
    var changed = (cols !== this.cols || rows !== this.rows);

    this.cols = cols;
    this.rows = rows;
    this.fw = WBF.world.W / cols;
    this.fh = WBF.world.H / rows;
    this.invFw = 1 / this.fw;
    this.invFh = 1 / this.fh;
    this.cellCssW = drawW / cols;
    this.cellCssH = drawH / rows;
    this.ox = view.ox;
    this.oy = view.oy;
    this.wsx = drawW / WBF.world.W;
    this.wsy = drawH / WBF.world.H;
    this.drawW = drawW;
    this.drawH = drawH;
    /* 글리프는 셀 안쪽에만 들어가도록 크기를 제한한다 */
    this.size = Math.max(7, Math.min(this.cellCssH * 0.98, this.cellCssW * 1.34));

    if (changed) this.alloc(cols, rows);

    for (var c = 0; c < this.cols; c++) this.gx[c] = this.ox + (c + 0.5) * this.cellCssW;
    for (var r = 0; r < this.rows; r++) this.gy[r] = this.oy + (r + 0.5) * this.cellCssH;

    this.resetAtlas();
    /* 셀 피치·글꼴이 바뀌었으니 구운 시트와 글리프 덮임표를 버린다(다음에 쓸 때 다시 굽는다) */
    this.shadeCache = {};
    this.shadeTab = null;
    this.buildBackground();
    this.buildWaveField();
  };

  Renderer.prototype.alloc = function (cols, rows) {
    var t = cols * rows;
    var i;
    this.total = t;
    this.cbGi = new Int16Array(t);
    this.cbPrio = new Int8Array(t);
    this.cbR = new Uint8Array(t);
    this.cbG = new Uint8Array(t);
    this.cbB = new Uint8Array(t);
    this.cbGlow = new Uint8Array(t);
    /* 셀 변위(충격파 왜곡)용 스크래치: 매 프레임 새로 만들지 않고 .set()으로만 채운다 */
    this.scGi = new Int16Array(t);
    this.scPrio = new Int8Array(t);
    this.scR = new Uint8Array(t);
    this.scG = new Uint8Array(t);
    this.scB = new Uint8Array(t);
    this.noise = new Float32Array(t);
    for (i = 0; i < t; i++) this.noise[i] = Math.random();
    this.gx = new Float32Array(cols);
    this.gy = new Float32Array(rows);
    this.cbPrio.fill(EMPTY);
  };

  /* ---------- 글리프 아틀라스 ---------- */

  Renderer.prototype.resetAtlas = function () {
    var dpr = this.dpr;
    this.spW = Math.max(4, Math.round(this.cellCssW * dpr));
    this.spH = Math.max(5, Math.round(this.cellCssH * dpr));
    this.halfW = this.cellCssW / 2;
    this.halfH = this.cellCssH / 2;
    this.ATLAS_ROWS = 192;
    this.atlasFont = '700 ' + Math.max(7, this.size * dpr).toFixed(1) + 'px ' + FONT_FAMILY;

    if (!this.atlas) {
      this.atlas = document.createElement('canvas');
      this.glowAtlas = document.createElement('canvas');
      this.bgCanvas = document.createElement('canvas');
    }

    this.atlas.width = GLYPHS.length * this.spW;
    this.atlas.height = this.ATLAS_ROWS * this.spH;
    this.actx2 = this.atlas.getContext('2d');
    this.rowMap = {};
    this.rowN = 0;

    this.GLOW_ROWS = 64;
    this.gw2 = Math.max(6, Math.round(this.spW * 2.2));
    this.gh2 = Math.max(8, Math.round(this.spH * 2.2));
    this.glowAtlas.width = GLYPHS.length * this.gw2;
    this.glowAtlas.height = this.GLOW_ROWS * this.gh2;
    this.gactx = this.glowAtlas.getContext('2d');
    this.glowMap = {};
    this.glowN = 0;

    this.bgCtx = this.bgCanvas.getContext('2d');
  };

  /* 한 행 = 한 가지 색(4bit 양자화) × 전 글리프 */
  Renderer.prototype.addRow = function (kr, kg, kb) {
    var row = this.rowN++;
    var y = row * this.spH;
    var x2 = this.actx2;
    x2.clearRect(0, y, this.atlas.width, this.spH);
    x2.font = this.atlasFont;
    x2.textAlign = 'center';
    x2.textBaseline = 'middle';
    x2.fillStyle = 'rgb(' + ((kr << 4) + 8) + ',' + ((kg << 4) + 8) + ',' + ((kb << 4) + 8) + ')';
    for (var i = 1; i < GLYPHS.length; i++) {
      x2.fillText(GLYPHS[i], i * this.spW + this.spW / 2, y + this.spH * 0.56);
    }
    return row;
  };

  Renderer.prototype.rowFor = function (r, g, b) {
    var kr = r >> 4, kg = g >> 4, kb = b >> 4;
    var key = (kr << 8) | (kg << 4) | kb;
    var row = this.rowMap[key];
    if (row !== undefined) return row;
    if (this.rowN >= this.ATLAS_ROWS) return -1;
    row = this.addRow(kr, kg, kb);
    this.rowMap[key] = row;
    return row;
  };

  /* 헤일로(가짜 글로우) — blur/filter 없이 반투명 글자를 겹쳐 만든다 */
  Renderer.prototype.addGlow = function (kr, kg, kb) {
    var row = this.glowN++;
    var y = row * this.gh2;
    var x2 = this.gactx;
    x2.clearRect(0, y, this.glowAtlas.width, this.gh2);
    x2.font = this.atlasFont;
    x2.textAlign = 'center';
    x2.textBaseline = 'middle';
    x2.fillStyle = 'rgb(' + ((kr << 4) + 8) + ',' + ((kg << 4) + 8) + ',' + ((kb << 4) + 8) + ')';
    var dx = this.spW * 0.5;
    var dy = this.spH * 0.45;
    for (var i = 1; i < GLYPHS.length; i++) {
      var cx = i * this.gw2 + this.gw2 / 2;
      var cy = y + this.gh2 * 0.56;
      x2.globalAlpha = 0.2;
      x2.fillText(GLYPHS[i], cx - dx, cy);
      x2.fillText(GLYPHS[i], cx + dx, cy);
      x2.fillText(GLYPHS[i], cx, cy - dy);
      x2.fillText(GLYPHS[i], cx, cy + dy);
      x2.globalAlpha = 0.42;
      x2.fillText(GLYPHS[i], cx, cy);
    }
    x2.globalAlpha = 1;
    return row;
  };

  Renderer.prototype.glowFor = function (r, g, b) {
    var kr = r >> 4, kg = g >> 4, kb = b >> 4;
    var key = (kr << 8) | (kg << 4) | kb;
    var row = this.glowMap[key];
    if (row !== undefined) return row;
    if (this.glowN >= this.GLOW_ROWS) return -1;
    row = this.addGlow(kr, kg, kb);
    this.glowMap[key] = row;
    return row;
  };

  /* 정적 배경 레이어(노이즈 점) — 화면 크기가 바뀔 때만 다시 그린다 */
  Renderer.prototype.buildBackground = function () {
    var w = this.canvas.width;
    var h = this.canvas.height;
    this.bgCanvas.width = w;
    this.bgCanvas.height = h;
    var b = this.bgCtx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalAlpha = 1;
    b.fillStyle = '#050507';
    b.fillRect(0, 0, w, h);
    b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    b.font = '700 ' + Math.max(7, this.size).toFixed(1) + 'px ' + FONT_FAMILY;
    b.textAlign = 'center';
    b.textBaseline = 'middle';
    b.fillStyle = '#161e29';
    var cols = this.cols, rows = this.rows;
    var noise = this.noise, gx = this.gx, gy = this.gy;
    for (var r = 0; r < rows; r++) {
      var base = r * cols;
      for (var c = 0; c < cols; c++) {
        if (noise[base + c] > 0.984) b.fillText('.', gx[c], gy[r]);
      }
    }
  };

  /* ---------- 여백 파동 배경 ----------
     경기장(월드) 사각형 바깥의 빈 여백을 아스키 물결로 채운다. 미리 그린 그림을
     굴리는 방식이 아니라, 셀마다 문자·색 단계 자체가 시간에 따라 순환한다.
     밀도장(무늬)은 레이아웃에서 한 번 계산하고, 프레임에서는 밀도를 저주파
     사인으로 흔들어 윤곽이 흐르게 하고 문자는 셀 해시 + 스텝으로 순환시킨다. */

  var WAVE = {
    scale: 0.55,   /* 셀 피치 대비 파동 격자 피치 */
    thr: 0.2,      /* 이 밀도보다 낮은 칸은 그리지 않는다(등고선 느낌) */
    cells: 10000,  /* 여백 격자 전체 셀 수 상한 — 넘으면 격자 피치를 키운다 */
    stepMs: 1000 / 30, /* 파동장을 다시 그리는 간격 — 그 사이는 완성된 레이어를 복사만 한다 */
    warp: 0.8,     /* 웨이브 워프 진폭(격자 칸 단위) — 살짝 요동치는 정도 */
    warpSpeed: 0.2, /* 워프 위상이 흐르는 속도(라디안/초) — 느린 잔물결 */
    rSpeed: 190,   /* 클릭 리플 파면 속도(px/s) — 천천히, 짧게 퍼진다 */
    rLife: 2.2,    /* 클릭 리플 수명(초) — 도달 거리를 짧게 묶는다 */
    rLambda: 38,   /* 리플 파장(px) — 띠를 두껍게 읽히도록 길게 */
    rBand: 30,     /* 리플 파면 띠 두께(px) — 링을 두껍게 */
    rAmp: 0.55,    /* 리플 밀도 진폭 — 부호 합으로 간섭한다 */
    rMax: 6,       /* 동시에 살아 있는 리플 수 */
    wobble: 0.55,  /* 문자 흔들림 주기(Hz) — 칸마다 드물게 이웃 단계로 튄다 */
    ramp: '.-:=+*#%',
    colors: ['#0e1012', '#121517', '#171a1d', '#1c2023',
      '#212529', '#282c30', '#303439', '#393e43'],
    /* f: 화면 px당 격자 주기(작을수록 잔물결), w: 옥타브 가중치 */
    octaves: [
      { f: 1 / 30, w: 0.5 },
      { f: 1 / 14, w: 0.32 },
      { f: 1 / 6.8, w: 0.18 }
    ]
  };

  function lattice(seed, x, y) {
    var h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return h - Math.floor(h);
  }

  /* 화면 좌표 값노이즈 — 격자를 감지 않고 그대로 해시한다(주기 없음 → 같은 무늬 반복 없음) */
  function field(seed, x, y) {
    var x0 = Math.floor(x);
    var y0 = Math.floor(y);
    var tx = x - x0;
    var ty = y - y0;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    var a = lattice(seed, x0, y0);
    var b = lattice(seed, x0 + 1, y0);
    var c2 = lattice(seed, x0, y0 + 1);
    var d2 = lattice(seed, x0 + 1, y0 + 1);
    var top = a + (b - a) * tx;
    var bot = c2 + (d2 - c2) * tx;
    return top + (bot - top) * ty;
  }

  /* 격자 값을 쌍선형 보간한다 — 워프된 좌표에서 밀도를 다시 읽을 때 쓴다 */
  function sampleGrid(f, cols, rows, u, v) {
    var x0 = Math.floor(u);
    var y0 = Math.floor(v);
    var tx = u - x0;
    var ty = v - y0;
    if (x0 < 0) { x0 = 0; tx = 0; }
    else if (x0 > cols - 2) { x0 = cols - 2; tx = 1; }
    if (y0 < 0) { y0 = 0; ty = 0; }
    else if (y0 > rows - 2) { y0 = rows - 2; ty = 1; }
    var i0 = y0 * cols + x0;
    var i1 = i0 + 1;
    var i2 = i0 + cols;
    var i3 = i2 + 1;
    var a = f[i0] + (f[i1] - f[i0]) * tx;
    var b = f[i2] + (f[i3] - f[i2]) * tx;
    return a + (b - a) * ty;
  }

  /* 리플 한 줄의 바깥 띠 구간에 부호 있는 파면을 더한다(합이 곧 간섭) */
  function stampSpan(out, rowBase, cols, cw, cx, xa, xb, wy, R, k, edge, a) {
    var c0 = Math.ceil(xa / cw - 0.5);
    var c1 = Math.floor(xb / cw - 0.5);
    if (c0 < 0) c0 = 0;
    if (c1 > cols - 1) c1 = cols - 1;
    for (var c = c0; c <= c1; c++) {
      var wx = (c + 0.5) * cw - cx;
      var g = Math.sqrt(wx * wx + wy * wy) - R;
      if (g > edge || g < -edge) continue;
      var win = 1 - Math.abs(g) / edge;
      out[rowBase + c] += a * win * win * Math.sin(g * k);
    }
  }

  /* 여백 격자의 밀도장·해시·경기장 마스크를 레이아웃에서 한 번 만든다.
     격자 전체(경기장 안쪽 포함)를 저장해 두어야 워프 좌표로 밀도를 다시 샘플할 수 있다. */
  Renderer.prototype.buildWaveField = function () {
    var d = WAVE;
    var cssW = this.cssW;
    var cssH = this.cssH;
    var ox = this.ox;
    var oy = this.oy;
    var rx = ox + this.drawW;
    var by = oy + this.drawH;
    var mr = cssW - rx;
    var mb = cssH - by;
    this.wvN = 0;
    if (ox < 1 && mr < 1 && oy < 1 && mb < 1) return;

    /* 여백 면적과 무관하게 셀 수 상한을 지키도록 격자 피치를 키운다 */
    var pw = Math.max(2.6, this.cellCssW * d.scale);
    var ph = Math.max(3.6, this.cellCssH * d.scale);
    var cw = pw;
    var chh = ph;
    var cols = 1;
    var rows = 1;
    for (var tries = 0; tries < 16; tries++) {
      cols = Math.ceil(cssW / cw);
      rows = Math.ceil(cssH / chh);
      if (cols * rows <= d.cells) break;
      cw *= 1.15;
      chh *= 1.15;
    }
    if (cols < 2) cols = 2;
    if (rows < 2) rows = 2;

    var t = cols * rows;
    var dens = new Float32Array(t);
    var seeds = new Uint8Array(t);
    var inside = new Uint8Array(t);
    var oct = d.octaves;
    var octN = oct.length;
    var seedK = 3.7;
    var r, c, cx, cy, q;

    for (r = 0; r < rows; r++) {
      cy = (r + 0.5) * chh;
      var rowIn = cy > oy + 1 && cy < by - 1;
      for (c = 0; c < cols; c++) {
        q = r * cols + c;
        cx = (c + 0.5) * cw;
        if (rowIn && cx > ox + 1 && cx < rx - 1) {
          inside[q] = 1;   /* 경기장 안쪽은 비운다(배경 노이즈 점 영역) */
          continue;
        }
        var f = 0;
        for (var o = 0; o < octN; o++) {
          /* 1-|2n-1| 로 능선만 남기고 제곱해 마루를 날카롭게 한다 */
          var nv = field(seedK + o * 13.3, cx * oct[o].f, cy * oct[o].f);
          var rdg = 1 - Math.abs(nv * 2 - 1);
          f += oct[o].w * rdg * rdg;
        }
        var v = (f - 0.15) * 1.9;
        /* 셀 해시 디더 — 능선 경계를 조금씩 끊어 기계적으로 보이지 않게 한다 */
        v += (lattice(seedK * 5.1, c, r) - 0.5) * 0.16;
        if (v < 0) v = 0;
        else if (v > 1.2) v = 1.2;
        dens[q] = v;
        seeds[q] = (lattice(seedK * 7.3, c, r) * 255) | 0;
      }
    }

    this.wvN = t;
    this.wvCols = cols;
    this.wvRows = rows;
    this.wvW = cw;
    this.wvH = chh;
    this.wvHalfW = cw * 0.5;
    this.wvHalfH = chh * 0.5;
    this.wvDens = dens;
    this.wvSeed = seeds;
    this.wvInside = inside;
    this.ripField = new Float32Array(t);
    this.wvDu = new Float32Array(rows);
    this.wvDv = new Float32Array(cols);
    this.buildWaveAtlas(cw, chh);
    this.wvDirty = true;
  };

  /* 저사양 모드: 여백 파동장을 아예 그리지 않는다. 배경·경기 화면은 그대로다.
     다시 켜면 다음 프레임에 레이어를 새로 그린다. */
  Renderer.prototype.setLite = function (on) {
    this.lite = !!on;
    this.wvDirty = true;
  };

  /* 클릭 지점에서 퍼지는 리플을 예약한다(최대 rMax개, 오래된 것부터 버린다) */
  Renderer.prototype.addRipple = function (x, y) {
    if (!this.ripples) this.ripples = [];
    var now = window.performance ? window.performance.now() : Date.now();
    this.ripples.push({ x: x, y: y, t0: now });
    while (this.ripples.length > WAVE.rMax) this.ripples.shift();
  };

  /* 살아 있는 리플들의 파면을 부호 있는 값으로 누적한다.
     두 지점의 파면이 만나면 같은 부호는 더해지고(보강) 반대 부호는 깎인다(상쇄). */
  Renderer.prototype.addRipples = function (now, out) {
    var list = this.ripples;
    if (!list || !list.length) return;
    var d = WAVE;
    var cw = this.wvW;
    var chh = this.wvH;
    var cols = this.wvCols;
    var rows = this.wvRows;
    var k = (Math.PI * 2) / d.rLambda;
    var edge = d.rBand;
    var wide = edge * 2;
    var speed = d.rSpeed;
    var life = d.rLife;

    for (var i = list.length - 1; i >= 0; i--) {
      var ri = list[i];
      var age = (now - ri.t0) * 0.001;
      if (age > life) { list.splice(i, 1); continue; }
      var env = Math.exp(-age * 1.2) * (1 - age / life);
      if (env < 0.02) continue;
      var amp = d.rAmp * env;
      var R = age * speed;
      var rOut = R + wide;
      var rIn = R - wide;
      var inner = rIn > 0 ? rIn * rIn : 0;
      var y0 = Math.ceil((ri.y - rOut) / chh - 0.5);
      var y1 = Math.floor((ri.y + rOut) / chh - 0.5);
      if (y0 < 0) y0 = 0;
      if (y1 > rows - 1) y1 = rows - 1;

      for (var r = y0; r <= y1; r++) {
        var wy = (r + 0.5) * chh - ri.y;
        var oSpan2 = rOut * rOut - wy * wy;
        if (oSpan2 <= 0) continue;
        var oSpan = Math.sqrt(oSpan2);
        var iSpan2 = inner - wy * wy;
        var rowBase = r * cols;
        if (iSpan2 > 0) {
          /* 띠 안쪽 구멍은 건너뛰고 좌·우 두 구간만 훑는다 */
          var iSpan = Math.sqrt(iSpan2);
          stampSpan(out, rowBase, cols, cw, ri.x,
            ri.x - oSpan, ri.x - iSpan, wy, R, k, edge, amp);
          stampSpan(out, rowBase, cols, cw, ri.x,
            ri.x + iSpan, ri.x + oSpan, wy, R, k, edge, amp);
        } else {
          stampSpan(out, rowBase, cols, cw, ri.x,
            ri.x - oSpan, ri.x + oSpan, wy, R, k, edge, amp);
        }
      }
    }
  };

  /* 램프 단계 × 색 단계 스프라이트를 한 번만 그려 두고 프레임에서는 drawImage만 쓴다 */
  Renderer.prototype.buildWaveAtlas = function (cw, chh) {
    var d = WAVE;
    var ramp = d.ramp;
    var rampN = ramp.length;
    var dpr = this.dpr;
    var font = Math.max(5, Math.min(chh * 0.98, cw * 1.5));
    var sw = Math.max(4, Math.round(cw * dpr));
    var sh = Math.max(5, Math.round(chh * dpr));
    if (!this.wvAtlas) this.wvAtlas = document.createElement('canvas');
    var cv = this.wvAtlas;
    cv.width = rampN * sw;
    cv.height = rampN * sh;
    var b = cv.getContext('2d');
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, cv.width, cv.height);
    b.imageSmoothingEnabled = false;
    b.textAlign = 'center';
    b.textBaseline = 'middle';
    b.font = '700 ' + (font * dpr).toFixed(1) + 'px ' + FONT_FAMILY;
    for (var ci = 0; ci < rampN; ci++) {
      b.fillStyle = d.colors[ci];
      for (var gi = 0; gi < rampN; gi++) {
        b.fillText(ramp.charAt(gi), gi * sw + sw / 2, ci * sh + sh * 0.56);
      }
    }
    this.wvSpW = sw;
    this.wvSpH = sh;
    this.wvRampN = rampN;
  };

  /* 파동장은 오프스크린 레이어에 고정 간격(WAVE.stepMs)으로만 다시 그리고,
     매 프레임은 완성된 레이어를 한 번 복사한다(셀 수천 개 drawImage → 복사 1회).
     화면 흔들림은 복사할 때의 변환으로 그대로 받는다. */
  Renderer.prototype.drawWaves = function (ctx, now) {
    if (!this.wvN || !this.wvAtlas) return;
    if (this.lite || this.wvCols < 2 || this.wvRows < 2) return;
    var cssW = this.cssW;
    var cssH = this.cssH;
    if (this.ox < 1 && cssW - (this.ox + this.drawW) < 1 &&
      this.oy < 1 && cssH - (this.oy + this.drawH) < 1) return;

    var iv = WAVE.stepMs;
    if (!this.wvLayer || this.wvDirty) {
      this.wvAt = now;
      this.paintWaves(now);
    } else if (now - this.wvAt >= iv) {
      this.wvAt += iv;
      if (now - this.wvAt >= iv) this.wvAt = now; /* 밀렸으면 따라잡지 않고 현재로 맞춘다 */
      this.paintWaves(now);
    }
    this.blitWaves(ctx);
  };

  /* 레이어는 여백에만 내용이 있고 경기장 안쪽은 비어 있으므로 평소에는 여백 네 곳만 복사한다.
     화면과 같은 픽셀 격자에서 1:1로, 서로 겹치지 않게 나누고 경기장 경계에 걸친 픽셀은 여백 쪽에
     포함시킨다. 화면 흔들림처럼 소수 픽셀 이동이 있을 때는 조각 가장자리가 어긋나 보일 수 있어
     예전처럼 전체를 한 번에 복사한다(흔들림은 0.1~0.3초뿐). */
  Renderer.prototype.blitWaves = function (ctx) {
    var cv = this.wvLayer;
    var lw = cv.width;
    var lh = cv.height;
    if ((this.game.shakeX || 0) !== 0 || (this.game.shakeY || 0) !== 0 ||
      lw !== this.canvas.width || lh !== this.canvas.height) {
      ctx.drawImage(cv, 0, 0, this.cssW, this.cssH);
      return;
    }
    var d = this.dpr;
    var x0 = Math.min(lw, Math.max(0, Math.ceil(this.ox * d)));
    var x1 = Math.max(x0, Math.min(lw, Math.floor((this.ox + this.drawW) * d)));
    var y0 = Math.min(lh, Math.max(0, Math.ceil(this.oy * d)));
    var y1 = Math.max(y0, Math.min(lh, Math.floor((this.oy + this.drawH) * d)));

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (x0 > 0) ctx.drawImage(cv, 0, 0, x0, lh, 0, 0, x0, lh);
    if (x1 < lw) ctx.drawImage(cv, x1, 0, lw - x1, lh, x1, 0, lw - x1, lh);
    if (y0 > 0 && x1 > x0) ctx.drawImage(cv, x0, 0, x1 - x0, y0, x0, 0, x1 - x0, y0);
    if (y1 < lh && x1 > x0) ctx.drawImage(cv, x0, y1, x1 - x0, lh - y1, x0, y1, x1 - x0, lh - y1);
    ctx.restore();
  };

  /* 경기장 사각형 바깥 네 여백 띠에만 파동장을 찍는다.
     밀도장을 워프 좌표에서 다시 샘플하므로 등고선 자체가 물결처럼 휘고 흐르고,
     클릭 리플의 부호 있는 파면이 그 위에 더해져 보강·상쇄 간섭이 생긴다. */
  Renderer.prototype.paintWaves = function (now) {
    var atlas = this.wvAtlas;
    var cols = this.wvCols;
    var rows = this.wvRows;
    var cssW = this.cssW;
    var cssH = this.cssH;
    var ox = this.ox;
    var oy = this.oy;

    if (!this.wvLayer) this.wvLayer = document.createElement('canvas');
    var lw = Math.round(cssW * this.dpr);
    var lh = Math.round(cssH * this.dpr);
    if (this.wvLayer.width !== lw || this.wvLayer.height !== lh) {
      this.wvLayer.width = lw;
      this.wvLayer.height = lh;
    }
    this.wvDirty = false;
    var ctx = this.wvLayer.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, lw, lh);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;

    var d = WAVE;
    var rampN = this.wvRampN;
    var top = rampN - 1;
    var ts = now * 0.001;
    var spW = this.wvSpW;
    var spH = this.wvSpH;
    var halfW = this.wvHalfW;
    var halfH = this.wvHalfH;
    var w = halfW * 2;
    var h = halfH * 2;
    var cw = this.wvW;
    var chh = this.wvH;
    var dens = this.wvDens;
    var seeds = this.wvSeed;
    var inside = this.wvInside;
    var rip = this.ripField;
    var r, c, q;

    rip.fill(0);
    this.addRipples(now, rip);

    /* 도메인 워프: 행·열 위상을 미리 계산해 셀당 sin 호출을 없앤다.
       밀도를 굽힌 좌표에서 다시 읽으므로 마루가 물결처럼 흐르며 변형된다. */
    var du = this.wvDu;
    var dv = this.wvDv;
    var wa = d.warp;
    var ws = d.warpSpeed;
    for (r = 0; r < rows; r++) {
      var py = r * chh;
      du[r] = wa * (Math.sin(py * 0.0131 + ts * ws) * 0.68
        + Math.sin(py * 0.0277 - ts * ws * 1.6) * 0.32);
    }
    for (c = 0; c < cols; c++) {
      var px = c * cw;
      dv[c] = wa * (Math.sin(px * 0.0113 - ts * ws * 0.85) * 0.68
        + Math.sin(px * 0.0239 + ts * ws * 1.35) * 0.32);
    }

    var thr = d.thr;
    var span = 1 - thr;
    for (r = 0; r < rows; r++) {
      var base = r * cols;
      var yPos = (r + 0.5) * chh - halfH;
      var shiftX = du[r];
      for (c = 0; c < cols; c++) {
        q = base + c;
        if (inside[q]) continue;
        var lv = sampleGrid(dens, cols, rows, c + shiftX, r + dv[c]);
        if (rip[q] !== 0) lv += rip[q];
        if (lv < thr) continue;
        var f01 = (lv - thr) / span;
        if (f01 > 1) f01 = 1;
        var li = (f01 * top) | 0;
        /* 칸마다 느린 위상으로 가끔만 이웃 단계로 튀게 해 살짝 요동치게 한다 */
        var wob = (seeds[q] * 0.0037 + ts * d.wobble) % 1;
        var gi = li + (wob < 0.14 ? 1 : (wob > 0.93 ? -1 : 0));
        if (gi < 0) gi = 0;
        else if (gi > top) gi = top;
        ctx.drawImage(atlas, gi * spW, li * spH, spW, spH,
          (c + 0.5) * cw - halfW, yPos, w, h);
      }
    }
    /* 클립 대신 경기장 안쪽을 지운다 — 클립을 건 채 셀 수천 개를 찍는 것이 가장 느렸다 */
    ctx.clearRect(ox, oy, this.drawW, this.drawH);
  };

  /* ---------- 셀 버퍼 ---------- */

  Renderer.prototype.clearCells = function () {
    this.cbPrio.fill(EMPTY);
    this.cbGlow.fill(0);
  };

  /* 한 칸에는 우선순위가 가장 높은 문자 하나만 남는다 */
  Renderer.prototype.occupyC = function (cx, cy, gi, prio, r, g, b, glow) {
    if (!gi) return;
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return;
    var q = cy * this.cols + cx;
    if (prio <= this.cbPrio[q]) return;
    this.cbPrio[q] = prio;
    this.cbGi[q] = gi;
    this.cbR[q] = r;
    this.cbG[q] = g;
    this.cbB[q] = b;
    this.cbGlow[q] = 0; /* 글로우 전면 제거 — 단색 문자만 그린다 */
  };

  Renderer.prototype.occupy = function (wx, wy, gi, prio, r, g, b, glow) {
    if (!gi) return;
    var cx = Math.floor(wx * this.invFw);
    var cy = Math.floor(wy * this.invFh);
    this.occupyC(cx, cy, gi, prio, r, g, b, glow);
  };

  Renderer.prototype.pushDeco = function (ch, wx, wy, color, glow, prio) {
    var gi = GIDX[ch];
    if (!gi) return;
    var cc = rgb(color && color.charAt && color.charAt(0) === '#' ? color : '#ffffff');
    this.occupy(wx, wy, gi, prio === undefined ? P_ENERGY : prio, cc.r, cc.g, cc.b, glow);
  };

  /* ---------- 파이터 본체(아트 시트 1셀 1문자) ---------- */

  Renderer.prototype.body = function (f, now) {
    var parts = f.fluid;
    var sheet = f.sheet;
    if (!parts || !parts.length || !sheet) return;
    if (this.artShade && WBF.Shade && WBF.Shade.has(f.typeId) && !(f.typeId === 'juggernaut' && f.hot)) {
      this.bodyShaded(f, now);
      return;
    }

    var pos = f.body.position;
    var sig = rgb(f.color);
    var flash = now < f.flashUntil;
    /* JUGGERNAUT 오버드라이브: 실루엣 자체가 1.22배 팽창한다(유체 앵커 일치) */
    var hotScale = (f.typeId === 'juggernaut' && f.hot) ? 1.22 : 1;
    var cw = (f.cellW || this.fw) * hotScale;
    var chh = (f.cellH || this.fh) * hotScale;
    var ang = f.shapeAngle || 0;
    var ca = Math.cos(ang);
    var sa = Math.sin(ang);

    var colOuter = flash ? WHITE : mix(sig, 255, 0.45);
    var colStruct = flash ? WHITE : { r: 236, g: 241, b: 249 };
    var colFill = flash ? WHITE : mix(sig, 96, 0.5);
    var colFly = flash ? WHITE : mix(sig, 150, 0.35);
    if (f.hot && f.typeId === 'juggernaut') {
      /* 과열 가시는 백열 — 글로우 없이 색만 올린다 */
      colOuter = { r: 255, g: 240, b: 190 };
      colStruct = { r: 255, g: 214, b: 120 };
      colFill = { r: 205, g: 118, b: 38 };
      colFly = { r: 255, g: 190, b: 90 };
    }

    for (var i = 0; i < parts.length; i++) {
      var pt = parts[i];
      var gi = GIDX[pt.ch];
      if (!gi) continue;
      var ox, oy, prio, col, glow = 0;

      if (pt.st === 0) {
        /* 고정: 시트 셀 좌표를 회전시킨 뒤 가장 가까운 셀에 안착 */
        var lx = (pt.sc - sheet.cc) * cw;
        var ly = (pt.sr - sheet.cr) * chh;
        ox = lx * ca - ly * sa;
        oy = lx * sa + ly * ca;
        prio = pt.tier >= 3 ? P_OUTER : (pt.tier >= 2 ? P_STRUCT : P_FILL);
        col = pt.tier >= 3 ? colOuter : (pt.tier >= 2 ? colStruct : colFill);
      } else {
        /* 흩날림: 자유 좌표 그대로. 글로우 없이 본체보다 어두운 단색 */
        ox = pt.x;
        oy = pt.y;
        prio = P_STRUCT;
        col = colFly;
        glow = 0;
      }

      this.occupy(pos.x + ox, pos.y + oy, gi, prio, col.r, col.g, col.b, glow);
    }

    /* 회전 빈틈 보정(역매핑) — 시트가 기울어도 구멍이 뚫리지 않는다 */
    this.fillSheetGaps(f, sheet, pos, cw, chh, ca, sa, colFill, colStruct, colOuter);

  };

  /* ---------- 셰이딩 아트(구운 시트) ---------- */

  Renderer.prototype.setArtShade = function (on) {
    this.artShade = !!on;
  };

  /* 각도 단계별 구운 시트 — 처음 쓸 때 한 번만 굽는다 */
  Renderer.prototype.shadeFor = function (f, ang) {
    var ai = WBF.Shade.angleIndex(ang);
    var key = f.typeId + '|' + ai;
    var bk = this.shadeCache[key];
    if (bk) return bk;
    if (!this.shadeTab) this.shadeTab = WBF.Shade.glyphTable(this.atlasFont, this.spW, this.spH, GIDX);
    var sig = rgb(f.color);
    bk = WBF.Shade.bake(f.typeId, ai, {
      fw: this.fw, fh: this.fh, sig: [sig.r, sig.g, sig.b], tab: this.shadeTab, sheet: f.sheet
    });
    this.shadeCache[key] = bk;
    return bk;
  };

  /* 구운 시트를 파이터가 있는 셀 기준 정수 오프셋으로 복사한다. 회전 계산·역매핑이 없다.
     흩날린 유체 입자는 기존처럼 자유 좌표에 그리고, 그 입자의 원래 칸에 대응하는 구운 칸은 비운다. */
  Renderer.prototype.bodyShaded = function (f, now) {
    var parts = f.fluid;
    var pos = f.body.position;
    var flash = now < f.flashUntil;
    var sig = rgb(f.color);
    var colFly = flash ? WHITE : mix(sig, 150, 0.35);
    for (var i = 0; i < parts.length; i++) {
      var pt = parts[i];
      if (pt.st === 0) continue;
      var gi0 = GIDX[pt.ch];
      if (gi0) this.occupy(pos.x + pt.x, pos.y + pt.y, gi0, P_STRUCT, colFly.r, colFly.g, colFly.b, 0);
    }
    var bk = this.shadeFor(f, f.shapeAngle || 0);
    if (!bk) return;
    var cx0 = Math.floor(pos.x * this.invFw);
    var cy0 = Math.floor(pos.y * this.invFh);
    for (var k = 0; k < bk.n; k++) {
      var s = bk.src[k];
      if (s >= 0 && parts[s] && parts[s].st !== 0) continue;
      if (flash) this.occupyC(cx0 + bk.dc[k], cy0 + bk.dr[k], bk.gi[k], bk.prio[k], 255, 255, 255, 0);
      else this.occupyC(cx0 + bk.dc[k], cy0 + bk.dr[k], bk.gi[k], bk.prio[k], bk.r[k], bk.g[k], bk.b[k], 0);
    }
  };

  /* 셀 중심을 시트 로컬 좌표로 되돌려 가장 가까운 시트 셀을 찾는다 */
  Renderer.prototype.fillSheetGaps = function (f, sheet, pos, cw, chh, ca, sa, colFill, colStruct, colOuter) {
    var grid = sheetGrid(sheet);
    var spanW = sheet.cols * cw;
    var spanH = sheet.rows * chh;
    var halfW = (Math.abs(ca) * spanW + Math.abs(sa) * spanH) * 0.5 + this.fw;
    var halfH = (Math.abs(sa) * spanW + Math.abs(ca) * spanH) * 0.5 + this.fh;

    var c0 = Math.floor((pos.x - halfW) * this.invFw);
    var c1 = Math.floor((pos.x + halfW) * this.invFw);
    var r0 = Math.floor((pos.y - halfH) * this.invFh);
    var r1 = Math.floor((pos.y + halfH) * this.invFh);
    if (c0 < 0) c0 = 0;
    if (r0 < 0) r0 = 0;
    if (c1 >= this.cols) c1 = this.cols - 1;
    if (r1 >= this.rows) r1 = this.rows - 1;

    var invW = 1 / cw;
    var invH = 1 / chh;
    var gw = grid.w;
    var gh = grid.h;
    var ggi = grid.gi;
    var gtier = grid.tier;

    for (var r = r0; r <= r1; r++) {
      var wy = (r + 0.5) * this.fh - pos.y;
      for (var c = c0; c <= c1; c++) {
        var q = r * this.cols + c;
        if (this.cbPrio[q] > EMPTY) continue;
        var wx = (c + 0.5) * this.fw - pos.x;
        /* 역회전 */
        var lx = wx * ca + wy * sa;
        var ly = -wx * sa + wy * ca;
        var sc = Math.round(lx * invW) + sheet.cc;
        var sr = Math.round(ly * invH) + sheet.cr;
        if (sc < 0 || sr < 0 || sc >= gw || sr >= gh) continue;
        var k2 = sr * gw + sc;
        var gi = ggi[k2];
        if (!gi) continue;
        var tier = gtier[k2];
        var col = tier >= 3 ? colOuter : (tier >= 2 ? colStruct : colFill);
        this.occupyC(c, r, gi, P_FILL, col.r, col.g, col.b, 0);
      }
    }
  };

  /* 무기 보조 연출(조준선) — 본체와 같은 셀 버퍼를 쓴다 */
  Renderer.prototype.weaponFx = function (f, now) {
    var p = f.body.position;
    var R = f.radius;
    /* RAILGUN 고유 스킬: 3초 충전 — 총구로 문자 파편이 모여들며 코어가 커진다 */
    if (f.typeId === 'railgun' && f.skillAimT > 0) {
      var dur = f.skillChargeDur || 3.0;
      var prog = 1 - f.skillAimT / dur;
      if (prog < 0) prog = 0;
      else if (prog > 1) prog = 1;
      var sca = Math.cos(f.skillAimAngle || 0);
      var ssa = Math.sin(f.skillAimAngle || 0);
      var mx = p.x + sca * (R + 6);
      var my = p.y + ssa * (R + 6);
      var ts = (now || 0) * 0.001;

      /* 조준 점선: 충전될수록 촘촘하고 밝아진다 */
      var sstep = this.fw * (2.4 - prog * 1.4);
      var sn = 0;
      for (var sd = R + 20; sd < 1100; sd += sstep) {
        this.pushDeco(sn % 4 === 0 ? '+' : '·', p.x + sca * sd, p.y + ssa * sd,
          prog > 0.62 ? (sn % 8 === 0 ? '#ffffff' : '#ff5a7a') : '#7d1832', 0, P_FILL);
        sn++;
        if (sn > 90) break;
      }

      /* 모여드는 파편: 바깥 반경에서 총구로 수렴하는 링 문자 3겹 */
      for (var ri = 0; ri < 3; ri++) {
        var rr = (R + 96) * (1 - prog * 0.74) - ri * this.fw * 3.4;
        if (rr < R + 5) continue;
        var arcs = 10 + ri * 4;
        for (var k2 = 0; k2 < arcs; k2++) {
          var aa = (k2 / arcs) * Math.PI * 2 + ts * (1.6 + ri * 0.9) * (1 + prog * 1.8);
          this.pushDeco(k2 % 3 === 0 ? '*' : (k2 % 3 === 1 ? '·' : ':'),
            mx + Math.cos(aa) * rr, my + Math.sin(aa) * rr,
            ri === 0 ? '#ff9aae' : '#7d1832', 0, P_ENERGY);
        }
      }

      /* 총구 코어: 충전될수록 굵고 밝게 맥동하며, 주위로 십자 스포크가 돈다 */
      var pulse = 0.5 + 0.5 * Math.sin(ts * (8 + prog * 22));
      var core = prog > 0.86 ? '@' : (prog > 0.55 ? '#' : (prog > 0.25 ? '%' : '*'));
      this.pushDeco(core, mx, my, prog > 0.7 ? '#ffffff' : '#ff5a7a', 0, P_ENERGY);
      var spokes = 4 + Math.round(prog * 6);
      for (var s2 = 0; s2 < spokes; s2++) {
        var sa2 = (s2 / spokes) * Math.PI * 2 + ts * 2.4;
        var sr2 = R * (0.9 + prog * 0.5) + pulse * this.fw * 0.9;
        this.pushDeco(s2 % 2 ? '+' : '=',
          mx + Math.cos(sa2) * sr2, my + Math.sin(sa2) * sr2,
          s2 % 2 ? '#ffdf70' : '#ff5a7a', 0, P_ENERGY);
      }
      return;
    }
    if (f.typeId === 'railgun' && f.aim > 0) {
      var ca = Math.cos(f.aimAngle);
      var sa = Math.sin(f.aimAngle);
      var step = this.fw * 1.6;
      var n = 0;
      for (var d = R + 10; d < 900; d += step) {
        this.pushDeco(n % 3 === 0 ? '+' : '.', p.x + ca * d, p.y + sa * d, '#ff1e56', 0, P_FILL);
        n++;
        if (n > 60) break;
      }
    }
  };

  /* BLADE 돌진 검기 잔상: 과거 실루엣을 같은 셀 버퍼에 P_FILL로 깔아 본체를 덮지 않는다 */
  Renderer.prototype.bladeTrail = function (f) {
    var tr = f.trail;
    var sheet = f.sheet;
    if (!tr || !tr.length || !sheet) return;
    var sig = rgb(f.color);
    if (this.artShade && WBF.Shade && WBF.Shade.has(f.typeId)) {
      /* 셰이딩 아트: 과거 각도의 구운 시트 가장자리 칸만 어두운 단색으로 깐다 */
      for (var ti = 0; ti < tr.length; ti++) {
        var t2 = tr[ti];
        var tk = (ti + 1) / (tr.length + 1);
        var tc = mix(sig, 26, 0.35 + 0.45 * (1 - tk));
        var bk = this.shadeFor(f, t2.a);
        if (!bk) continue;
        var tx0 = Math.floor(t2.x * this.invFw);
        var ty0 = Math.floor(t2.y * this.invFh);
        for (var tq = 0; tq < bk.n; tq++) {
          if (bk.prio[tq] < P_OUTER) continue;
          this.occupyC(tx0 + bk.dc[tq], ty0 + bk.dr[tq], bk.gi[tq], P_FILL, tc.r, tc.g, tc.b, 0);
        }
      }
      return;
    }
    var cw = f.cellW || this.fw;
    var chh = f.cellH || this.fh;
    var cells = sheet.cells;
    var n = tr.length;
    for (var i = 0; i < n; i++) {
      var g2 = tr[i];
      var k = (i + 1) / (n + 1);
      /* 뒤로 갈수록 어두운 단색 — 불투명 덧그리기만 사용한다 */
      var col = mix(sig, 26, 0.35 + 0.45 * (1 - k));
      var ca = Math.cos(g2.a);
      var sa = Math.sin(g2.a);
      for (var c = 0; c < cells.length; c++) {
        var cell = cells[c];
        if (cell.tier < 2) continue;
        var gi = GIDX[cell.ch];
        if (!gi) continue;
        var lx = (cell.c - sheet.cc) * cw;
        var ly = (cell.r - sheet.cr) * chh;
        this.occupy(g2.x + lx * ca - ly * sa, g2.y + lx * sa + ly * ca, gi, P_FILL, col.r, col.g, col.b, 0);
      }
    }
  };

  /* ---------- 탄환 ---------- */

  Renderer.prototype.bullets = function (g) {
    var chars = ['@', '#', '#', '=', '=', '>', '>'];
    var offsets = [0, 6, 12, 18, 24, 30, 36];
    for (var i = 0; i < g.bullets.length; i++) {
      var b = g.bullets[i];
      var len = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;
      var nx = b.vx / len;
      var ny = b.vy / len;
      for (var s = chars.length - 1; s >= 0; s--) {
        this.pushDeco(chars[s], b.x - nx * offsets[s], b.y - ny * offsets[s],
          s === 0 ? '#fff4f6' : b.color, 0, P_ENERGY);
      }
    }
  };

  /* ---------- 스파크 · 충격파 · 잔열 ---------- */

  Renderer.prototype.fx = function (g, now) {
    var e = g.effects;
    var i, k;
    for (i = 0; i < e.waves.length; i++) {
      var w = e.waves[i];
      for (k = 0; k < 10; k++) {
        var a = (k / 10) * Math.PI * 2;
        this.pushDeco(k % 2 ? '+' : '-', w.x + Math.cos(a) * w.r, w.y + Math.sin(a) * w.r, w.color, 0, P_FILL);
      }
    }
    for (i = 0; i < e.parts.length; i++) {
      var p = e.parts[i];
      var pr = p.life / p.max;
      var ch = pr > 0.66 ? '+' : (pr > 0.33 ? '-' : '.');
      this.pushDeco(ch, p.x, p.y, p.color, 0, P_FILL);
    }
    /* 대장장이 스파크: 머리 '*'/'+' 뒤로 방향성 선 문자를 길게 찍어 궤적을 만든다.
       머리·꼬리 모두 P_ENERGY로 본체 위에 얹어 몸통에 묻히지 않게 한다
       (스폰 원점은 effects.forge가 법선 방향으로 밀어 둔다) */
    var sparkStep = this.fw * 0.9;
    for (i = 0; i < e.sparks.length; i++) {
      var fs = e.sparks[i];
      var fux = fs.ux || 0;
      var fuy = fs.uy === undefined ? 1 : fs.uy;
      var tail = fs.tail || 3;
      var stp = sparkStep * (fs.sp || 1);
      var fade = fs.life / fs.max;
      this.pushDeco(fs.head || '*', fs.x, fs.y, fs.color, 0, P_ENERGY);
      for (k = 1; k <= tail && fade > 0.25; k++) {
        var dd = stp * k;
        this.pushDeco(fs.ch, fs.x - fux * dd, fs.y - fuy * dd, fs.color, 0, P_ENERGY);
      }
    }
    /* 접점 섬광: 충돌 순간 3x3 문자를 짧게 얹어 '맞았다'를 즉시 읽히게 한다 */
    var fdx = this.fw * 1.05;
    var fdy = this.fh * 0.92;
    for (i = 0; i < e.flashes.length; i++) {
      var ff = e.flashes[i];
      var big = ff.life / ff.max > 0.55 ? '#' : 'X';
      this.pushDeco(big, ff.x, ff.y, ff.color, 0, P_ENERGY);
      this.pushDeco('*', ff.x - fdx, ff.y, ff.color, 0, P_ENERGY);
      this.pushDeco('*', ff.x + fdx, ff.y, ff.color, 0, P_ENERGY);
      this.pushDeco('*', ff.x, ff.y - fdy, ff.color, 0, P_ENERGY);
      this.pushDeco('*', ff.x, ff.y + fdy, ff.color, 0, P_ENERGY);
      this.pushDeco('+', ff.x - fdx, ff.y - fdy, ff.color, 0, P_ENERGY);
      this.pushDeco('+', ff.x + fdx, ff.y - fdy, ff.color, 0, P_ENERGY);
      this.pushDeco('+', ff.x - fdx, ff.y + fdy, ff.color, 0, P_ENERGY);
      this.pushDeco('+', ff.x + fdx, ff.y + fdy, ff.color, 0, P_ENERGY);
    }
    /* 총구 연기: 수명비로 굵은 문자 → 조각 문자, 밝은 회색 → 어두운 회색으로 풀린다 */
    var smokeRamp = '@#%*o+=~:-.';
    for (i = 0; i < e.smoke.length; i++) {
      var sm = e.smoke[i];
      var sl = sm.life / sm.max;
      var si = Math.floor((1 - sl) * (smokeRamp.length - 1) + sm.seed * 1.6);
      if (si < 0) si = 0;
      else if (si > smokeRamp.length - 1) si = smokeRamp.length - 1;
      var scol = sl > 0.72 ? '#94a0ae' : (sl > 0.48 ? '#727d8a' : (sl > 0.26 ? '#545d68' : '#3a424c'));
      this.pushDeco(smokeRamp.charAt(si), sm.x, sm.y, scol, 0, P_FILL);
    }
    /* 불씨: 식어 가며 밝은 노랑 → 주황 → 잿빛, 뒤로 한 칸 잔불을 남긴다 */
    /* 글리프 아틀라스에 실제로 있는 문자만 쓴다('x'·따옴표는 아틀라스에 없다) */
    var emberRamp = ['*', '+', 'o', '·', ':'];
    for (i = 0; i < e.embers.length; i++) {
      var eb = e.embers[i];
      var el2 = eb.life / eb.max;
      var ei = Math.floor((1 - el2) * 4 + eb.seed * 2);
      if (ei > 4) ei = 4;
      else if (ei < 0) ei = 0;
      this.pushDeco(emberRamp[ei], eb.x, eb.y,
        el2 > 0.66 ? '#fff6e0' : (el2 > 0.38 ? '#ffcf5a' : (el2 > 0.16 ? '#ff7a2a' : '#8a3a1c')), 0, P_ENERGY);
      if (el2 > 0.42) {
        var ev = Math.sqrt(eb.vx * eb.vx + eb.vy * eb.vy) || 1;
        var ek = this.fw * 0.9;
        this.pushDeco(emberRamp[ei > 3 ? 3 : ei + 1],
          eb.x - (eb.vx / ev) * ek, eb.y - (eb.vy / ev) * ek, '#ff9a4a', 0, P_FILL);
      }
    }
    /* 고유 스킬: 충전 관통 레이저 — 코어 + 외곽 2겹 문자 빔, 마디마다 'X' */
    var bstep = this.fw * 0.8;
    var bts = (now || 0) * 0.001;
    for (i = 0; i < g.beams.length; i++) {
      var bm = g.beams[i];
      var bl = Math.max(0, bm.life / bm.max);
      var bdx = bm.x2 - bm.x1;
      var bdy = bm.y2 - bm.y1;
      var blen = Math.sqrt(bdx * bdx + bdy * bdy) || 1;
      var bn = Math.min(200, Math.round(blen / bstep));
      var onx = -bdy / blen;
      var ony = bdx / blen;
      var thick = this.fw * (bl > 0.66 ? 1.15 : 0.9);
      var jitter = Math.sin(bts * 47) * 0.35;
      for (k = 0; k <= bn; k++) {
        var bt = k / bn;
        var bx0 = bm.x1 + bdx * bt;
        var by0 = bm.y1 + bdy * bt;
        var wob = Math.sin(bt * 34 + bts * 41) * jitter * this.fw;
        var bch = (k % 6 === 0) ? '@' : (bl > 0.62 ? '#' : (bl > 0.3 ? '=' : '-'));
        this.pushDeco(bch, bx0 + onx * wob, by0 + ony * wob,
          (k % 6 === 0) ? '#ffffff' : (bl > 0.5 ? '#ffd9e2' : '#ff9aae'), 0, P_ENERGY);
        this.pushDeco((k % 3 === 0) ? '+' : (k % 3 === 1 ? '=' : '-'),
          bx0 + onx * thick, by0 + ony * thick, bl > 0.4 ? '#ff1e56' : '#7d1832', 0, P_FILL);
        this.pushDeco((k % 3 === 0) ? '+' : (k % 3 === 1 ? '=' : '-'),
          bx0 - onx * thick, by0 - ony * thick, bl > 0.4 ? '#ff1e56' : '#7d1832', 0, P_FILL);
        if (k % 11 === 5 && bl > 0.25) this.pushDeco('X', bx0, by0, '#ffdf70', 0, P_ENERGY);
      }
    }
    /* 고유 스킬: BLADE 360도 회전 검기 링 · JUGGERNAUT 황금 충격파 링 */
    var slashChars = ['|', '/', '-', '\\', '*'];
    for (i = 0; i < g.fighters.length; i++) {
      var sf = g.fighters[i];
      if (!sf.alive) continue;
      if (sf.slashT > 0) {
        var skp = 1 - sf.slashT / 0.55;
        var srad = (sf.radius || 36) * (1.1 + skp * 1.2);
        for (k = 0; k < 16; k++) {
          var ska = (k / 16) * Math.PI * 2 + (sf.slashAng || 0) + skp * 4.2;
          this.pushDeco(slashChars[k % slashChars.length],
            sf.body.position.x + Math.cos(ska) * srad,
            sf.body.position.y + Math.sin(ska) * srad,
            k % 3 === 0 ? '#ffffff' : sf.color, 0, P_ENERGY);
        }
      }
      if (sf.slamT > 0) {
        var gkp = 1 - sf.slamT / 0.45;
        var grad = (sf.radius || 46) * (1.2 + gkp * 2.1);
        for (k = 0; k < 20; k++) {
          var gka = (k / 20) * Math.PI * 2;
          this.pushDeco(k % 2 ? '=' : '+',
            sf.body.position.x + Math.cos(gka) * grad,
            sf.body.position.y + Math.sin(gka) * grad,
            gkp > 0.5 ? '#ffdf70' : '#ffffff', 0, P_ENERGY);
        }
      }
    }
    for (i = 0; i < e.segs.length; i++) {
      var s = e.segs[i];
      for (k = 1; k <= 4; k++) {
        var t = k / 4;
        this.pushDeco(t > 0.5 ? '-' : '=', s.x1 + (s.x2 - s.x1) * t, s.y1 + (s.y2 - s.y1) * t, s.color, 0, P_FILL);
      }
    }
  };

  /* ---------- 클리어 충격파(저프레임 계단식 링 + 셀 왜곡) ---------- */

  var FIN_STEP_MS = 85;   /* 게임 쪽과 같은 값 — 약 12fps 스텝 페이즈 */
  var FIN_PHASES = 14;
  var FIN_CHARS = ['@', '#', '%', '=', '~', '·'];

  Renderer.prototype.finishWave = function (g, now) {
    var fx = g.finishFx;
    if (!fx) return;
    var phase = Math.floor((now - fx.t0) / FIN_STEP_MS);
    if (phase < 0 || phase >= FIN_PHASES) return;
    /* 이번 스텝 링 + 직전 스텝 링(잔상) — 12fps 스텝 사이가 비어 보이지 않게 한다 */
    for (var step = 0; step < 2; step++) {
      var ph = phase - step;
      if (ph < 0) break;
      var outer = fx.maxR * ((ph + 1) / FIN_PHASES);
      for (var ring = 0; ring < 3; ring++) {
        var rad = outer * (1 - ring * 0.08);
        if (rad < this.fw * 2) continue;
        var n = Math.round((Math.PI * 2 * rad) / (this.fw * 1.5));
        if (n < 12) n = 12;
        else if (n > 240) n = 240;
        for (var k = 0; k < n; k++) {
          var a = (k / n) * Math.PI * 2;
          var ch = FIN_CHARS[(k + ring * 3 + ph) % FIN_CHARS.length];
          this.pushDeco(ch, fx.x + Math.cos(a) * rad, fx.y + Math.sin(a) * rad,
            step === 0
              ? (ring === 0 ? '#ffffff' : (ring === 1 ? fx.color : '#8fa0b3'))
              : (ring === 0 ? '#8fa0b3' : '#4a5568'),
            0, step === 0 ? P_ENERGY : P_FILL);
        }
      }
    }
  };

  /* 링이 지나가는 띠의 셀을 한 셀 피치만큼 밀어내고 일부를 깨뜨린다 */
  Renderer.prototype.finishDistort = function (g, now) {
    var fx = g.finishFx;
    if (!fx) return;
    var phase = Math.floor((now - fx.t0) / FIN_STEP_MS);
    if (phase < 0 || phase >= FIN_PHASES) return;
    var rad = fx.maxR * ((phase + 1) / FIN_PHASES);
    var band = this.fh * 2.2;
    var cols = this.cols;
    var rows = this.rows;

    this.scGi.set(this.cbGi);
    this.scPrio.set(this.cbPrio);
    this.scR.set(this.cbR);
    this.scG.set(this.cbG);
    this.scB.set(this.cbB);

    var invFw = this.invFw;
    var invFh = this.invFh;
    var c0 = Math.max(0, Math.floor((fx.x - rad - band) * invFw));
    var c1 = Math.min(cols - 1, Math.ceil((fx.x + rad + band) * invFw));
    var r0 = Math.max(0, Math.floor((fx.y - rad - band) * invFh));
    var r1 = Math.min(rows - 1, Math.ceil((fx.y + rad + band) * invFh));

    for (var r = r0; r <= r1; r++) {
      var wy = (r + 0.5) * this.fh;
      for (var c = c0; c <= c1; c++) {
        var wx = (c + 0.5) * this.fw;
        var dx = wx - fx.x;
        var dy = wy - fx.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var gap = dist - rad;
        if (gap > band || gap < -band) continue;

        var ux = dx / dist;
        var uy = dy / dist;
        var sc = Math.floor((wx - ux * this.fw) * invFw);
        var sr = Math.floor((wy - uy * this.fh) * invFh);
        if (sc < 0 || sr < 0 || sc >= cols || sr >= rows) continue;
        var sq = sr * cols + sc;
        var q = r * cols + c;
        if (this.scPrio[sq] === EMPTY && this.cbPrio[q] === EMPTY) continue;

        var h = Math.sin(c * 12.9898 + r * 78.233 + phase * 6.137) * 43758.5453;
        h = h - Math.floor(h);
        if (h > 0.78) {
          /* 글리치: 밀려난 자리의 문자를 깨진 기호로 바꾼다 */
          this.cbGi[q] = h > 0.93 ? GIDX['#'] : (h > 0.86 ? GIDX['%'] : GIDX['*']);
          this.cbPrio[q] = P_ENERGY;
          this.cbR[q] = 255;
          this.cbG[q] = 255;
          this.cbB[q] = 255;
        } else {
          this.cbGi[q] = this.scGi[sq];
          this.cbPrio[q] = this.scPrio[sq];
          this.cbR[q] = this.scR[sq];
          this.cbG[q] = this.scG[sq];
          this.cbB[q] = this.scB[sq];
        }
      }
    }
  };

  /* ---------- 경기장 프레임 ---------- */

  Renderer.prototype.frame = function (g) {
    var c0 = Math.round(g.inset / this.fw);
    var c1 = this.cols - 1 - c0;
    var r0 = Math.round(g.inset / this.fh);
    var r1 = this.rows - 1 - r0;
    if (c1 <= c0 + 1 || r1 <= r0 + 1) return;
    var danger = g.time > g.shrinkStart;
    var col = danger ? '#ff1e56' : '#6c7789';
    var cc = rgb(col);
    var c, r, wx, wy;

    for (c = c0; c <= c1; c++) {
      wx = (c + 0.5) * this.fw;
      this.occupyC(c, r0, GIDX['─'], P_FRAME, cc.r, cc.g, cc.b, 0);
      this.occupyC(c, r1, GIDX['─'], P_FRAME, cc.r, cc.g, cc.b, 0);
    }
    for (r = r0; r <= r1; r++) {
      this.occupyC(c0, r, GIDX['│'], P_FRAME, cc.r, cc.g, cc.b, 0);
      this.occupyC(c1, r, GIDX['│'], P_FRAME, cc.r, cc.g, cc.b, 0);
    }
    this.occupyC(c0, r0, GIDX['┌'], P_FRAME, cc.r, cc.g, cc.b, 0);
    this.occupyC(c1, r0, GIDX['┐'], P_FRAME, cc.r, cc.g, cc.b, 0);
    this.occupyC(c0, r1, GIDX['└'], P_FRAME, cc.r, cc.g, cc.b, 0);
    this.occupyC(c1, r1, GIDX['┘'], P_FRAME, cc.r, cc.g, cc.b, 0);
  };

  /* ---------- 렌더 ---------- */

  Renderer.prototype.draw = function (now) {
    var g = this.game;
    if (this.cssW !== g.cssW || this.cssH !== g.cssH) {
      this.resize(g.cssW, g.cssH);
    } else if (this.fontPx !== (g.cellPx || 10)) {
      this.fontPx = g.cellPx || 10;
      this.layout();
    }

    /* 유체 앵커 피치를 실제 셀 피치와 동기화한다 */
    var i, f;
    for (i = 0; i < g.fighters.length; i++) {
      f = g.fighters[i];
      f.cellW = this.fw;
      f.cellH = this.fh;
    }

    this.clearCells();

    this.frame(g);
    for (i = 0; i < g.fighters.length; i++) {
      f = g.fighters[i];
      if (f.alive) this.weaponFx(f, now);
    }
    /* 발도 검기 잔상은 본체보다 먼저 깔린다(우선순위 P_FILL) */
    for (i = 0; i < g.fighters.length; i++) {
      f = g.fighters[i];
      if (f.alive && f.typeId === 'blade') this.bladeTrail(f);
    }
    this.bullets(g);
    for (i = 0; i < g.fighters.length; i++) {
      f = g.fighters[i];
      if (f.alive) this.body(f, now);
    }
    this.fx(g, now);
    /* 클리어 연출: 계단식 충격파 링 → 링이 지나간 셀 변위·글리치 */
    this.finishWave(g, now);
    this.finishDistort(g, now);

    this.flush(now);
  };

  Renderer.prototype.flush = function (now) {
    var ctx = this.ctx;
    var cols = this.cols;
    var rows = this.rows;
    var prio = this.cbPrio;
    var giArr = this.cbGi;
    var cr = this.cbR;
    var cg = this.cbG;
    var cb = this.cbB;
    var glowArr = this.cbGlow;
    var gx = this.gx;
    var gy = this.gy;
    var atlas = this.atlas;
    var glowAtlas = this.glowAtlas;
    var spW = this.spW;
    var spH = this.spH;
    var dw = this.cellCssW * 0.94;
    var dh = this.cellCssH * 0.94;
    var r, c, q, gi, row;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bgCanvas, 0, 0);
    /* 화면 흔들림: 배경(노이즈 점)은 제자리에 두고 그 위의 여백 파동장·셀 문자만
       같은 오프셋으로 옮긴다. 배경까지 옮기면 캔버스 가장자리에 빈 틈이 생긴다. */
    var shx = this.game.shakeX || 0;
    var shy = this.game.shakeY || 0;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, shx * this.dpr, shy * this.dpr);
    /* 경기장 밖 여백의 아스키 물결 — 배경 위, 문자 버퍼 아래(아스키 모드 전용) */
    if (this.game.asciiMode) this.drawWaves(ctx, now);

    /* RENDER_MODE = 블록(NORMAL): 문자 대신 셀을 단색 사각형으로 채워 실루엣만 남긴다.
       셀 버퍼(우선순위·색)는 아스키 모드와 동일하게 쓰므로 규칙·판정은 바뀌지 않는다.
       색 문자열은 4bit 양자화 키로 캐시해 프레임마다 새로 만들지 않는다. */
    if (!this.game.asciiMode) {
      var bCw = this.cellCssW;
      var bCh = this.cellCssH;
      var bStyles = this.blockStyles || (this.blockStyles = {});
      for (r = 0; r < rows; r++) {
        var bBase = r * cols;
        var bY = gy[r] - bCh / 2;
        for (c = 0; c < cols; c++) {
          q = bBase + c;
          if (prio[q] === EMPTY || !giArr[q]) continue;
          var bKey = ((cr[q] >> 4) << 8) | ((cg[q] >> 4) << 4) | (cb[q] >> 4);
          var bStyle = bStyles[bKey];
          if (bStyle === undefined) {
            bStyle = 'rgb(' + ((cr[q] & 240) + 8) + ',' + ((cg[q] & 240) + 8) + ',' + ((cb[q] & 240) + 8) + ')';
            bStyles[bKey] = bStyle;
          }
          ctx.fillStyle = bStyle;
          ctx.fillRect(gx[c] - bCw / 2, bY, bCw, bCh);
        }
      }
      return;
    }

    /* 1패스: 본체·프레임·무기 */
    for (r = 0; r < rows; r++) {
      var base = r * cols;
      var dy = gy[r] - dh / 2;
      for (c = 0; c < cols; c++) {
        q = base + c;
        if (prio[q] === EMPTY) continue;
        gi = giArr[q];
        if (!gi) continue;
        row = this.rowFor(cr[q], cg[q], cb[q]);
        if (row < 0) continue;
        ctx.drawImage(atlas, gi * spW, row * spH, spW, spH, gx[c] - dw / 2, dy, dw, dh);
      }
    }

  };

  return { Renderer: Renderer };
})();
