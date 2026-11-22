/* ASCII SYNC — 타이틀 화면 (100% 아스키 셀 그리드)

   벡터 텍스트(fillText·웹 폰트)·이미지를 쓰지 않는다. 화면을 일정한 문자 셀 그리드로 나누고,
   각 셀의 문자를 5x7 비트맵 글리프로 직접 칠해 아스키 문자를 그린다.

   1) 배경: 차콜(#181818) 바탕 위에 밀도 램프(' ', '.', '-', ':', '+', '*', '#')를 다중 사인파로
      계산해 등고선처럼 일렁이는 톤온톤(#222~#444) 아스키 필드를 그린다. 비네팅·중앙 마스크 포함.
   2) 상·하단: 터미널 시스템 정보가 아스키 글리프로 흐른다(스크롤).
   3) 마우스 파문: 포인터 주변 셀이 밝아지고 바깥으로 살짝 밀린다.
   4) 타이틀: 'ASCII SYNC'를 5x7 비트맵으로 점유 격자에 찍고, 점유된 칸마다 아스키 문자를
      배치해 글자 형태를 만든다. 내부 문자는 시간에 따라 순환한다(디더링 라이브 모션).
   5) 0.32s 어둠 → 0.9~2.1s 모자이크(울렁임) → 세분화 → 선명. 1.5s에 로고 코드 재생.
   6) 2.05s부터 '>> PRESS ENTER TO START <<'가 깜빡이지 않고 계속 표시된다.
   7) 클릭·Enter·Space → 확인음 + 1v1 전환. CSS 페이드 대신 캔버스 안에서 셀 하나하나가
      무작위 방향으로 흩날리며 사라지는 아스키 붕괴(디스퍼전) 연출을 거친다. */
window.WBF = window.WBF || {};

WBF.Title = (function () {
  'use strict';

  var TITLE_TEXT = 'ASCII SYNC';
  var PROMPT_TEXT = '>> PRESS ENTER / SPACE TO START <<';
  /* 타이틀 글자 내부를 순환하는 문자 */
  var TITLE_CHARS = ['@', '#', 'W', 'M', '8', 'O', '+', '*', '%', '0'];
  /* 배경 밀도 램프 — 왼쪽이 어두운 계곡, 오른쪽이 밝은 능선 */
  var BG_RAMP = [' ', '.', '-', ':', '+', '*', '#'];
  /* 톤온톤 회색 6단계(배경 #181818 위 #222222 ~ #444444) */
  var BG_TONES = [null, '#222222', '#272727', '#2e2e2e', '#353535', '#3c3c3c', '#444444'];

  var C_BG = '#181818';
  var C_TITLE = '#e9f1ff';
  var C_TITLE_DIM = '#90a7c0';
  var C_TITLE_HOT = '#ffffff';
  var C_HUD = '#2b3540';
  var C_HUD_HI = '#5a7089';
  var C_PROMPT = '#9fb6cf';

  var TITLE_AT = 320;        /* 어둠 → 등장 시작 */
  var REFINE_FROM = 900;     /* 모자이크 세분화 시작 */
  var REFINE_TO = 2100;      /* 선명 완성 */
  var MUSIC_AT = 1500;       /* 로고 코드 */
  var PROMPT_AT = 2050;      /* 시작 문구 */
  var DISPERSE_MS = 900;     /* 전환 1: 아스키 셀이 흩어져 사라지는 붕괴 시간 */
  var REVEAL_MS = 820;       /* 전환 2: 검은 블록이 커튼처럼 걷히며 게임 화면이 드러나는 시간 */

  /* 5x7 비트맵 폰트 — 문자 하나가 35개 픽셀(7행 x 5열) */
  var FONT = {
    ' ': '00000000000000000000000000000000000',
    'A': '01110' + '10001' + '10001' + '11111' + '10001' + '10001' + '10001',
    'B': '11110' + '10001' + '10001' + '11110' + '10001' + '10001' + '11110',
    'C': '01111' + '10000' + '10000' + '10000' + '10000' + '10000' + '01111',
    'D': '11110' + '10001' + '10001' + '10001' + '10001' + '10001' + '11110',
    'E': '11111' + '10000' + '10000' + '11110' + '10000' + '10000' + '11111',
    'F': '11111' + '10000' + '10000' + '11110' + '10000' + '10000' + '10000',
    'G': '01110' + '10001' + '10000' + '10111' + '10001' + '10001' + '01110',
    'H': '10001' + '10001' + '10001' + '11111' + '10001' + '10001' + '10001',
    'I': '11111' + '00100' + '00100' + '00100' + '00100' + '00100' + '11111',
    'J': '00111' + '00010' + '00010' + '00010' + '00010' + '10010' + '01100',
    'K': '10001' + '10010' + '10100' + '11000' + '10100' + '10010' + '10001',
    'L': '10000' + '10000' + '10000' + '10000' + '10000' + '10000' + '11111',
    'M': '10001' + '11011' + '10101' + '10101' + '10001' + '10001' + '10001',
    'N': '10001' + '11001' + '10101' + '10011' + '10001' + '10001' + '10001',
    'O': '01110' + '10001' + '10001' + '10001' + '10001' + '10001' + '01110',
    'P': '11110' + '10001' + '10001' + '11110' + '10000' + '10000' + '10000',
    'Q': '01110' + '10001' + '10001' + '10001' + '10101' + '10010' + '01101',
    'R': '11110' + '10001' + '10001' + '11110' + '10100' + '10010' + '10001',
    'S': '01111' + '10000' + '10000' + '01110' + '00001' + '00001' + '11110',
    'T': '11111' + '00100' + '00100' + '00100' + '00100' + '00100' + '00100',
    'U': '10001' + '10001' + '10001' + '10001' + '10001' + '10001' + '01110',
    'V': '10001' + '10001' + '10001' + '10001' + '10001' + '01010' + '00100',
    'W': '10001' + '10001' + '10001' + '10101' + '10101' + '11011' + '10001',
    'X': '10001' + '10001' + '01010' + '00100' + '01010' + '10001' + '10001',
    'Y': '10001' + '10001' + '01010' + '00100' + '00100' + '00100' + '00100',
    'Z': '11111' + '00001' + '00010' + '00100' + '01000' + '10000' + '11111',
    '0': '01110' + '10001' + '10011' + '10101' + '11001' + '10001' + '01110',
    '1': '00100' + '01100' + '00100' + '00100' + '00100' + '00100' + '01110',
    '2': '01110' + '10001' + '00001' + '00010' + '00100' + '01000' + '11111',
    '3': '11110' + '00001' + '00001' + '01110' + '00001' + '00001' + '11110',
    '4': '00010' + '00110' + '01010' + '10010' + '11111' + '00010' + '00010',
    '5': '11111' + '10000' + '11110' + '00001' + '00001' + '10001' + '01110',
    '6': '01110' + '10000' + '10000' + '11110' + '10001' + '10001' + '01110',
    '7': '11111' + '00001' + '00010' + '00100' + '01000' + '01000' + '01000',
    '8': '01110' + '10001' + '10001' + '01110' + '10001' + '10001' + '01110',
    '9': '01110' + '10001' + '10001' + '01111' + '00001' + '00001' + '01110',
    '.': '00000' + '00000' + '00000' + '00000' + '00000' + '00110' + '00110',
    ',': '00000' + '00000' + '00000' + '00000' + '00110' + '00100' + '01000',
    ':': '00000' + '00110' + '00110' + '00000' + '00110' + '00110' + '00000',
    ';': '00000' + '00110' + '00110' + '00000' + '00110' + '00100' + '01000',
    '-': '00000' + '00000' + '00000' + '01110' + '00000' + '00000' + '00000',
    '_': '00000' + '00000' + '00000' + '00000' + '00000' + '00000' + '11111',
    '/': '00001' + '00001' + '00010' + '00100' + '01000' + '10000' + '10000',
    '\\': '10000' + '10000' + '01000' + '00100' + '00010' + '00001' + '00001',
    '<': '00010' + '00100' + '01000' + '10000' + '01000' + '00100' + '00010',
    '>': '01000' + '00100' + '00010' + '00001' + '00010' + '00100' + '01000',
    '=': '00000' + '00000' + '11111' + '00000' + '11111' + '00000' + '00000',
    '|': '00100' + '00100' + '00100' + '00100' + '00100' + '00100' + '00100',
    '[': '01110' + '01000' + '01000' + '01000' + '01000' + '01000' + '01110',
    ']': '01110' + '00010' + '00010' + '00010' + '00010' + '00010' + '01110',
    '(': '00010' + '00100' + '01000' + '01000' + '01000' + '00100' + '00010',
    ')': '01000' + '00100' + '00010' + '00010' + '00010' + '00100' + '01000',
    '+': '00000' + '00100' + '00100' + '11111' + '00100' + '00100' + '00000',
    '*': '00000' + '10101' + '01110' + '11111' + '01110' + '10101' + '00000',
    '#': '01010' + '01010' + '11111' + '01010' + '11111' + '01010' + '01010',
    '@': '01110' + '10001' + '10111' + '10101' + '10111' + '10000' + '01110',
    '%': '11001' + '11010' + '00010' + '00100' + '01000' + '01011' + '10011',
    '!': '00100' + '00100' + '00100' + '00100' + '00100' + '00000' + '00100',
    '?': '01110' + '10001' + '00001' + '00010' + '00100' + '00000' + '00100',
    '^': '00100' + '01010' + '10001' + '00000' + '00000' + '00000' + '00000',
    '~': '00000' + '00000' + '01101' + '10110' + '00000' + '00000' + '00000',
    '"': '01010' + '01010' + '00000' + '00000' + '00000' + '00000' + '00000',
    "'": '00100' + '00100' + '00000' + '00000' + '00000' + '00000' + '00000'
  };

  /* 타이틀 전용 고해상도 비트맵 글리프 — 글자 하나가 9x12칸.
     점유 격자를 5x7에서 9x12로 올려 실루엣과 내부 문자 밀도를 함께 높이고,
     획을 2칸 두께로 그려 실루엣이 가늘게 보이지 않게 한다. */
  var TITLE_W = 9;
  var TITLE_H = 12;
  var TITLE_HD = {
    'A': '...###...' + '..#####..' + '..#####..' + '.##...##.' + '.##...##.' + '##.....##' +
         '##.....##' + '#########' + '#########' + '##.....##' + '##.....##' + '##.....##',
    'C': '..#####..' + '.##...##.' + '##.....##' + '##.......' + '##.......' + '##.......' +
         '##.......' + '##.......' + '##.......' + '##.....##' + '.##...##.' + '..#####..',
    'I': '#########' + '#########' + '...###...' + '...###...' + '...###...' + '...###...' +
         '...###...' + '...###...' + '...###...' + '...###...' + '#########' + '#########',
    'N': '##.....##' + '###....##' + '####...##' + '##.##..##' + '##.##..##' + '##..##.##' +
         '##..##.##' + '##...####' + '##....###' + '##.....##' + '##.....##' + '##.....##',
    'S': '..#####..' + '.##...##.' + '##.....##' + '##.......' + '##.......' + '.##......' +
         '..#####..' + '.....##..' + '.......##' + '##.....##' + '.##...##.' + '..#####..',
    'Y': '##.....##' + '##.....##' + '.##...##.' + '.##...##.' + '..##.##..' + '..##.##..' +
         '...###...' + '...###...' + '...###...' + '...###...' + '...###...' + '...###...',
    ' ': '.........' + '.........' + '.........' + '.........' + '.........' + '.........' +
         '.........' + '.........' + '.........' + '.........' + '.........' + '.........'
  };

  var layer = null;
  var canvas = null;
  var ctx = null;

  var cssW = 0;
  var cssH = 0;
  var dpr = 1;

  /* 배경 문자 셀 그리드 — 타이틀과 분리된 촘촘한 격자 */
  var cellW = 12;
  var cellH = 16;
  var cols = 1;
  var rows = 1;
  var glyphPx = 2;     /* 배경 셀 글리프의 픽셀 블록 크기 */
  var hudPx = 2;
  var promptPx = 3;

  /* 상·하단 HUD 스트립 캐시 — 문자열을 오프스크린에 한 번 구워 두고 매 프레임
     drawImage 2~4회로만 민다. 문자 수백 개를 매 프레임 개별로 찍던 비용을 없앤다. */
  var hudStripT = null;
  var hudStripB = null;
  var hudStripWT = 1;
  var hudStripWB = 1;
  var hudStripKey = '';

  /* 타이틀 점유 격자 — 배경보다 굵은 자체 격자 */
  var titleCellW = 24;
  var titleCellH = 32;
  var titlePx = 4;
  var titleZoom = 1;
  var occW = 0;
  var occH = 12;
  var occ = null;
  var titleX0 = 0;
  var titleY0 = 0;
  var promptY = 0;

  var hash = null;
  var hash2 = null;
  /* 배경 필드의 셀별 밀도·문자 단계(파문 제외). 파문 레이어가 이 값을 매 프레임 다시 조합한다 */
  var baseV = null;
  var baseIdx = null;
  var colA = null;
  var colB = null;
  var colC = null;
  var rowA = null;
  var rowB = null;
  var rowC = null;
  var bitCache = {};
  var atlas = {};
  var atlasN = 0;

  /* 스프라이트 캐시 — 매 프레임 문자열 키를 만들지 않고 단계 인덱스로 바로 꺼내 쓴다.
     bgSp[밀도단계] · titleSp[색][글리프px][문자] · curSp[색][조각문자] */
  var bgSp = [];
  var titleSp = [];
  var curSp = [];
  var TITLE_COLORS = [C_TITLE, C_TITLE_DIM, C_TITLE_HOT];
  var CUR_DUST_CHARS = [':', '-', '.'];

  /* 배경 비트맵은 30Hz로만 다시 그리고, 매 프레임은 완성된 비트맵을 한 번 복사한다 */
  var bgCanvas = null;
  var bgCtx = null;
  var bgT = 0;
  var BG_INTERVAL = 1000 / 30;

  var active = false;
  var started = false;
  var raf = 0;
  var t0 = 0;
  var logoPlayed = false;
  var onStart = null;

  var ptrX = 0;
  var ptrY = 0;
  var smX = 0;
  var smY = 0;
  var hasPtr = false;

  var fps = 60;
  var fpsT = 0;
  var fpsN = 0;

  /* 붕괴(디스퍼전) 상태 — 시작 클릭 순간부터 아스키 셀이 하나하나 흩어진다 */
  var disp = { on: false, p: 0, freezeT: 0, freezeE: 0 };

  /* 커튼(리졸브) 상태 — 붕괴가 끝나면 검은 블록이 걷히며 뒤의 게임 화면이 드러난다 */
  var rev = { on: false, p: 0, t0: 0 };
  var curW = 24;
  var curH = 32;
  var curCols = 1;
  var curRows = 1;
  var curHash = null;
  var curHash2 = null;

  function rand1(i) {
    var s = Math.sin(i * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  }

  /* 셀 하나가 흩어질 위치와 수명을 계산한다(재사용 배열 dust).
     hd = 지연·이동거리 해시, ha = 방향 해시, p = 전체 진행도, spread = 최대 이동 거리(px)
     dust[0..1] = 오프셋, dust[2] = 1이면 살아 있음, dust[3] = 개별 진행도(0~1) */
  var dust = [0, 0, 1, 0];

  function dustOut(hd, ha, p, spread) {
    var lp = (p - hd * 0.34) / 0.66;
    if (lp <= 0) {
      dust[0] = 0; dust[1] = 0; dust[2] = 1; dust[3] = 0;
      return dust;
    }
    if (lp >= 1) {
      dust[0] = 0; dust[1] = 0; dust[2] = 0; dust[3] = 1;
      return dust;
    }
    var ang = ha * 6.283185307179586;
    var reach = spread * (0.4 + ((hd * 91.7) % 1) * 1.1);
    var d = lp * lp * reach;   /* 초반엔 천천히, 사라지기 직전에 빠르게 날아간다 */
    dust[0] = Math.cos(ang) * d;
    dust[1] = Math.sin(ang) * d;
    dust[2] = 1;
    dust[3] = lp;
    return dust;
  }

  function hasAudio() {
    return !!(WBF.Audio && WBF.Audio.logo && WBF.Audio.confirm);
  }

  function playLogo() {
    if (logoPlayed) return;
    logoPlayed = true;
    if (hasAudio()) WBF.Audio.logo();
  }

  /* ---------- 글리프(문자) 그리기 ---------- */

  function bitsOf(ch) {
    var b = bitCache[ch];
    if (b) return b;
    var s = FONT[ch] || FONT['?'];
    b = new Uint8Array(35);
    for (var i = 0; i < 35; i++) b[i] = s.charCodeAt(i) === 49 ? 1 : 0;
    bitCache[ch] = b;
    return b;
  }

  /* 문자 하나를 작은 오프스크린 캔버스로 만들어 캐시한다(문자·색·블록 크기별) */
  function glyph(ch, color, px) {
    var key = ch + color + px;
    var c = atlas[key];
    if (c) return c;
    var bits = bitsOf(ch);
    c = document.createElement('canvas');
    c.width = 5 * px;
    c.height = 7 * px;
    var g = c.getContext('2d');
    g.fillStyle = color;
    for (var r = 0; r < 7; r++) {
      for (var i = 0; i < 5; i++) {
        if (bits[r * 5 + i]) g.fillRect(i * px, r * px, px, px);
      }
    }
    atlas[key] = c;
    atlasN++;
    return c;
  }

  /* 타이틀·커튼 글리프도 문자열 키 없이 인덱스로 꺼내 쓴다 */
  function titleSprite(ch, colorIdx, px) {
    var byPx = titleSp[colorIdx] || (titleSp[colorIdx] = []);
    var byCh = byPx[px] || (byPx[px] = {});
    return byCh[ch] || (byCh[ch] = glyph(ch, TITLE_COLORS[colorIdx], px));
  }

  function drawText(str, x, y, px, color) {
    var step = 6 * px;
    var dp = disp.p;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (ch === ' ') continue;
      var ox = 0;
      var oy = 0;
      if (dp > 0) {
        var du = dustOut(rand1(i * 5 + 11), rand1(i * 13 + 3), dp, cellH * 3.6);
        if (!du[2]) continue;
        ox = du[0];
        oy = du[1];
      }
      ctx.drawImage(glyph(ch, color, px), Math.round(x + i * step + ox), Math.round(y + oy));
    }
  }

  /* ---------- 화면 크기 · 격자 ---------- */

  function titleUnitsW() {
    var x = 0;
    for (var i = 0; i < TITLE_TEXT.length; i++) {
      var ch = TITLE_TEXT.charAt(i);
      if (ch === ' ') { x += 5; continue; }
      x += TITLE_W;
      if (i < TITLE_TEXT.length - 1) x += 2;
    }
    return x;
  }

  /* 타이틀 글리프 비트(9x12) — 5x7 FONT와 별도 캐시 */
  function titleBitsOf(ch) {
    var key = 'h' + ch;
    var b = bitCache[key];
    if (b) return b;
    var s = TITLE_HD[ch] || TITLE_HD[' '];
    b = new Uint8Array(TITLE_W * TITLE_H);
    for (var i = 0; i < b.length; i++) b[i] = s.charCodeAt(i) === 35 ? 1 : 0;
    bitCache[key] = b;
    return b;
  }

  function buildTitleGrid() {
    occW = Math.max(1, titleUnitsW());
    occH = TITLE_H;
    occ = new Uint8Array(occW * occH);
    var x = 0;
    for (var i = 0; i < TITLE_TEXT.length; i++) {
      var ch = TITLE_TEXT.charAt(i);
      if (ch === ' ') { x += 5; continue; }
      var bits = titleBitsOf(ch);
      for (var r = 0; r < TITLE_H; r++) {
        var ro = r * occW;
        for (var c = 0; c < TITLE_W; c++) {
          if (bits[r * TITLE_W + c]) occ[ro + x + c] = 1;
        }
      }
      x += TITLE_W;
      if (i < TITLE_TEXT.length - 1) x += 2;
    }

    var w = occW * titleCellW * titleZoom;
    var h = occH * titleCellH * titleZoom;
    titleX0 = Math.round((cssW - w) * 0.5);
    titleY0 = Math.round(cssH * 0.46 - h * 0.5);
    /* 시작 문구는 타이틀 아래로 충분히 내려 띄운다(화면 하단 여백 안에서) */
    var gap = Math.max(36, Math.min(cssH * 0.085, titleCellH * titleZoom * 4.2));
    promptY = Math.round(Math.min(
      titleY0 + h + gap,
      cssH - 7 * promptPx - Math.max(6, cellH * 0.6)
    ));
  }

  function resize() {
    if (!layer) return;
    var rect = layer.getBoundingClientRect();
    cssW = Math.max(240, Math.round(rect.width || window.innerWidth));
    cssH = Math.max(180, Math.round(rect.height || window.innerHeight));
    dpr = Math.min(2, window.devicePixelRatio || 1);

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    atlas = {};
    atlasN = 0;
    titleSp = [];
    curSp = [];
    bgSp = [];

    /* 오프스크린 배경 비트맵 — 표시 캔버스와 같은 크기·변환을 쓴다 */
    if (!bgCanvas) {
      bgCanvas = document.createElement('canvas');
      bgCtx = bgCanvas.getContext('2d');
    }
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgCtx.imageSmoothingEnabled = false;
    bgT = 0;

    /* 배경 격자: 화면 면적으로 글리프 픽셀 크기(1~3)를 골라 총 셀 수를 약 7,000개로 묶는다.
       셀이 작아야 세밀한 아스키 질감이 나오고, 고해상도에서도 프레임 비용이 일정하다. */
    var area = cssW * cssH;
    glyphPx = Math.max(1, Math.min(3, Math.round(Math.sqrt(area / (48 * 7000)))));
    cellW = 6 * glyphPx;
    cellH = 8 * glyphPx;

    cols = Math.ceil(cssW / cellW);
    rows = Math.ceil(cssH / cellH);

    /* 타이틀 격자: 점유 격자(102x12)를 화면 폭 74%에 맞춘다. 글리프 서브 블록 px는 정수로
       두고 남는 폭은 소수 배율 zoom으로 채워, 화면 크기가 달라져도 문자 하나가
       과도하게 굵어지지 않게 한다. */
    var units = Math.max(1, titleUnitsW()) * 6;
    var target = cssW * 0.74;
    titlePx = Math.max(1, Math.min(4, Math.round(target / units)));
    titleZoom = target / (units * titlePx);
    titleCellW = 6 * titlePx;
    titleCellH = 8 * titlePx;

    hudPx = cssW > 1100 ? 2 : 1;
    hudStripT = null;
    hudStripB = null;
    hudStripKey = '';
    /* 시작 문구는 타이틀보다 작게 — 글리프 픽셀 2~4px(1600px 폭에서 3px) */
    promptPx = Math.max(2, Math.min(4, Math.round(cssW / 520)));

    /* 밀도 단계별 배경 스프라이트와 커튼 조각 문자를 크기가 바뀔 때만 만들어 둔다 */
    bgSp = new Array(BG_RAMP.length);
    for (var bi = 1; bi < BG_RAMP.length; bi++) {
      bgSp[bi] = glyph(BG_RAMP[bi], BG_TONES[bi], glyphPx);
    }
    curSp = new Array(C_CUR_DUST.length);
    for (var cs = 0; cs < C_CUR_DUST.length; cs++) {
      curSp[cs] = new Array(CUR_DUST_CHARS.length);
      for (var cd = 0; cd < CUR_DUST_CHARS.length; cd++) {
        curSp[cs][cd] = glyph(CUR_DUST_CHARS[cd], C_CUR_DUST[cs], glyphPx);
      }
    }

    hash = new Float32Array(cols * rows);
    hash2 = new Float32Array(cols * rows);
    baseV = new Float32Array(cols * rows);
    baseIdx = new Uint8Array(cols * rows);
    for (var i = 0; i < hash.length; i++) {
      hash[i] = Math.random();
      hash2[i] = Math.random();
    }
    colA = new Float32Array(cols);
    colB = new Float32Array(cols);
    colC = new Float32Array(cols);
    rowA = new Float32Array(rows);
    rowB = new Float32Array(rows);
    rowC = new Float32Array(rows);

    /* 커튼(리졸브) 블록 격자 — 배경 셀 2x2를 한 블록으로 묶어 걷히는 결이 크게 읽히게 한다.
       지연·방향 해시는 크기가 바뀔 때만 한 번 만든다. */
    curW = Math.max(6, cellW * 2);
    curH = Math.max(8, cellH * 2);
    curCols = Math.ceil(cssW / curW);
    curRows = Math.ceil(cssH / curH);
    curHash = new Float32Array(curCols * curRows);
    curHash2 = new Float32Array(curCols * curRows);
    for (var cq = 0; cq < curHash.length; cq++) {
      curHash[cq] = Math.random();
      curHash2[cq] = Math.random();
    }

    buildTitleGrid();
  }

  /* ---------- 배경: 살아있는 아스키 노이즈 + 마우스 파문 ---------- */

  /* 포인터 보간은 배경 갱신 주기와 무관하게 매 프레임 한 번씩 한다(반응이 늦어지지 않게) */
  function smoothPointer() {
    if (!hasPtr) return;
    smX += (ptrX - smX) * 0.16;
    smY += (ptrY - smY) * 0.16;
  }

  /* 배경 필드는 오프스크린(bgCtx)에 그리되 파문은 넣지 않는다.
     필드 자체는 매우 느리게 움직여 30Hz로 충분하고, 빠르게 반응해야 하는
     파문만 drawRippleOverlay가 매 프레임 덧그린다. */
  function drawBackground(now) {
    var g = bgCtx;
    /* 붕괴 중에는 파동을 멈춰 흩어지는 셀만 읽히게 한다 */
    var t = (disp.on ? disp.freezeT : now) * 0.001;
    var c;
    var r;

    g.fillStyle = C_BG;
    g.fillRect(0, 0, cssW, cssH);

    /* 다중 사인파: 열·행별로 sin을 한 번만 구하고, 좌우파 x 세로파의 곱으로 대각 간섭을 만든다 */
    for (c = 0; c < cols; c++) {
      colA[c] = Math.sin(t * 0.42 + c * 0.085);
      colB[c] = Math.sin(t * 0.27 - c * 0.147 + 1.7);
      colC[c] = Math.sin(t * 0.19 + c * 0.041 + 0.6);
    }
    for (r = 0; r < rows; r++) {
      rowA[r] = Math.sin(t * 0.34 - r * 0.128);
      rowB[r] = Math.sin(t * 0.24 + r * 0.063 + 2.1);
      rowC[r] = Math.sin(t * 0.16 - r * 0.024 + 1.2);
    }

    var invW = 1 / Math.max(1, cssW);
    var invH = 1 / Math.max(1, cssH);
    var ax = cssW * 0.5;
    var ay = cssH * 0.46;
    var rampN = BG_RAMP.length;
    var q = 0;

    for (r = 0; r < rows; r++) {
      var ra = rowA[r];
      var rb = rowB[r];
      var rc = rowC[r];
      var py = (r * cellH + cellH * 0.5 - ay) * invH;
      var py2 = py * py;
      var q0 = r * cols;

      for (c = 0; c < cols; c++) {
        var hq = hash[q];
        var hb = hash2[q];
        var v = 0.52 + colA[c] * 0.2 + ra * 0.18 + colB[c] * rb * 0.33 + colC[c] * rc * 0.2;
        v += (hq - 0.5) * 0.17;   /* 셀 해시 = 정지 디더 그레인 */
        q++;

        var dx = (c * cellW + cellW * 0.5 - ax) * invW;
        var d2 = dx * dx + py2;

        /* 중앙 마스크: 로고 자리는 옅게. 비네팅: 가장자리로 갈수록 어둡게 */
        var cm = 0.5 + d2 * 2.3;
        if (cm > 1) cm = 1;
        var vg = 1 - d2 * 1.25;
        if (vg < 0.12) vg = 0.12;
        v *= cm * vg;

        /* 파문을 걷어낸 기본 밀도·문자 단계를 남겨 둔다 — 파문 레이어가 매 프레임 이 값을 쓴다 */
        var qi = q0 + c;
        baseV[qi] = v;
        if (v < 0.19) {
          baseIdx[qi] = 0;
          continue;
        }
        var idx = (v * rampN) | 0;
        if (idx > rampN - 1) idx = rampN - 1;
        baseIdx[qi] = idx;

        var ox = 0;
        var oy = 0;

        /* 붕괴: 셀마다 지연·방향·거리가 달라 덩어리가 아니라 먼지처럼 흩어지고,
           흩어지기 시작한 셀은 더 가벼운 조각 문자로 분해된다. */
        if (disp.p > 0) {
          var du = dustOut(hb, hq, disp.p, cellH * 5.4);
          if (!du[2]) continue;
          ox += du[0];
          oy += du[1];
          if (du[3] > 0.62) {
            if (du[3] > 0.88) continue;
            idx = hb > 0.5 ? 1 : 2;
          }
        }

        g.drawImage(
          bgSp[idx],
          Math.round(c * cellW + ox),
          Math.round(r * cellH + oy)
        );
      }
    }
  }

  /* ---------- 마우스 파문 레이어 ----------
     배경 필드는 30Hz로 캐시해 두고 파문만 화면 주기 그대로 다시 그린다.
     캐시된 비트맵을 복사한 다음, 파문이 닿는 사각형만 배경색으로 되돌리고 그 안의 셀을
     다시 찍는다. 셀이 파문 바깥으로 밀려 나가는 거리까지 덮도록 사각형을 넉넉히 잡는다. */
  function drawRippleOverlay(now) {
    if (disp.on || !baseV) return;
    var t = (disp.on ? disp.freezeT : now) * 0.001;
    var pcx;
    var pcy;
    if (hasPtr) {
      pcx = smX;
      pcy = smY;
    } else {
      pcx = cssW * 0.5 + Math.cos(t * 0.31) * cssW * 0.3;
      pcy = cssH * 0.5 + Math.sin(t * 0.23) * cssH * 0.28;
    }

    /* 파문 반경은 셀 개수가 아니라 화면 픽셀 기준이다. 셀은 12x16px처럼 세로가 길어서
       셀 단위로 거리를 재면 파문이 세로로 긴 타원이 된다. */
    var radPx = (4.0 + 1.2 * (0.5 + 0.5 * Math.sin(t * 0.85))) * cellH;
    var rad2 = radPx * radPx;
    var reach = radPx * 1.4 + cellW * 2;

    var c0 = Math.max(0, Math.floor((pcx - reach) / cellW));
    var c1 = Math.min(cols - 1, Math.ceil((pcx + reach) / cellW));
    var r0 = Math.max(0, Math.floor((pcy - reach) / cellH));
    var r1 = Math.min(rows - 1, Math.ceil((pcy + reach) / cellH));
    if (c1 < c0 || r1 < r0) return;

    ctx.globalAlpha = 1;
    ctx.fillStyle = C_BG;
    ctx.fillRect(c0 * cellW, r0 * cellH, (c1 - c0 + 1) * cellW, (r1 - r0 + 1) * cellH);

    var rampN = BG_RAMP.length;
    var c;
    var r;
    for (r = r0; r <= r1; r++) {
      var rdy = r * cellH + cellH * 0.5 - pcy;
      for (c = c0; c <= c1; c++) {
        var qi = r * cols + c;
        var hq = hash[qi];
        var rdx = c * cellW + cellW * 0.5 - pcx;
        var pd2 = rdx * rdx + rdy * rdy;
        var ox = 0;
        var oy = 0;
        var idx = baseIdx[qi];

        if (pd2 < rad2) {
          /* 파문: 원형(픽셀 거리)으로 밝아지고 바깥으로 밀리되, 경계를 하드 컷하지 않는다.
             1) 거리비 nd를 smoothstep으로 감쇠시켜 가장자리로 갈수록 부드럽게 사라진다.
             2) 셀 해시 + 사인 파형을 곱해 경계를 노이즈로 풀어 윤곽이 보이지 않게 한다. */
          var nd = Math.sqrt(pd2) / radPx;
          var soft = 1 - nd;
          soft = soft * soft * (3 - 2 * soft);
          var grain = hq * 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(nd * 11 - t * 2.6 + hq * 6.28));
          var w = soft * (0.3 + 0.85 * grain);
          var v = baseV[qi] + w * 0.55;
          ox = rdx * w * 0.34;
          oy = rdy * w * 0.34;
          idx = (v * rampN) | 0;
          if (idx > rampN - 1) idx = rampN - 1;
        }

        if (idx < 1) continue;
        ctx.drawImage(bgSp[idx], Math.round(c * cellW + ox), Math.round(r * cellH + oy));
      }
    }
  }

  /* ---------- 상·하단 터미널 시스템 정보(아스키 스크롤) ---------- */

  /* HUD 문자열을 재사용 객체에 담는다(매 프레임 새 객체를 만들지 않는다) */
  function hudLines() {
    hudLines.top = 'SYS_CORE_ACTIVE // GRID_LINK: OK // CELL_BUFFER: LIVE // FPS: ' + fps +
      ' // SYNC_STATUS: OK // ASCII_ENCODER: ONLINE   ';
    /* 하단 줄은 ' // '로 끝맺어 처음('BUFFER: LIVE')과 자연스럽게 맞물린다.
       끝에 'BUFFER: LIVE'를 또 두면 이어 붙을 때 같은 문구가 두 번 겹쳐 끊겨 보인다. */
    hudLines.bot = 'BUFFER: LIVE   ASCII_SYNC.TERM // GRID: ' + cols + 'x' + rows +
      ' // REPEAT: 0x1A // GLYPH: 5X7+9X12 // ';
    return hudLines;
  }

  /* 문자열 한 줄을 오프스크린 스트립에 굽는다(문자·색·하이라이트 위치까지). */
  function buildHudStrip(text, px, mod) {
    var step = 6 * px;
    var len = text.length;
    var c = document.createElement('canvas');
    c.width = Math.max(1, len * step);
    c.height = 7 * px;
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    for (var i = 0; i < len; i++) {
      var ch = text.charAt(i);
      if (ch === ' ') continue;
      var col = (i % mod === 0) ? C_HUD_HI : C_HUD;
      g.drawImage(glyph(ch, col, px), i * step, 0);
    }
    return c;
  }

  function ensureHudStrips() {
    var s = hudLines();
    var key = hudPx + '|' + s.top + '|' + s.bot;
    if (key === hudStripKey && hudStripT && hudStripB) return;
    hudStripKey = key;
    hudStripT = buildHudStrip(s.top, hudPx, 37);
    hudStripB = buildHudStrip(s.bot, hudPx, 41);
    hudStripWT = hudStripT.width;
    hudStripWB = hudStripB.width;
  }

  /* 평상시: 스트립을 통째로 민다(문자 수백 → drawImage 몇 번).
     좌표를 화면 픽셀(dpr) 격자에 맞춰 흐림 없이 레티나에서 0.5px 단위로 흐른다. */
  function drawHudStrip(now) {
    ensureHudStrips();
    var px = hudPx;
    var step = 6 * px;
    var yTop = Math.round(Math.max(2, cellH * 0.35));
    var yBot = Math.round(cssH - 7 * px - Math.max(2, cellH * 0.35));
    var t = (disp.on ? disp.freezeT : now) * 0.001;
    var q = 1 / dpr;
    var sx;

    var wT = hudStripWT;
    var offT = (t * 9 * step) % wT;
    for (sx = -offT; sx < cssW; sx += wT) {
      ctx.drawImage(hudStripT, Math.round(sx / q) * q, yTop);
    }

    /* 하단은 상단과 반대 방향(오른쪽)으로 흐르며, 스트립을 왼쪽 화면 밖에서부터
       화면 오른쪽 끝을 넘어설 때까지 타일로 이어 붙여 어느 순간에도 화면이 비지 않는다.
       (cssW - offB에서 왼쪽으로만 찍으면 오프셋만큼 오른쪽 끝이 비어 끊겨 보인다.) */
    var wB = hudStripWB;
    var offB = (t * 6 * step) % wB;
    for (sx = -wB + offB; sx < cssW; sx += wB) {
      ctx.drawImage(hudStripB, Math.round(sx / q) * q, yBot);
    }
  }

  /* 붕괴(디스퍼전) 중: 셀 하나하나가 흩어져야 하므로 문자별로 찍는다(0.9초뿐). */
  function drawHudDisintegrate(now) {
    var t = (disp.on ? disp.freezeT : now) * 0.001;
    var px = hudPx;
    var step = 6 * px;
    var n = Math.floor(cssW / step) + 2;
    var s = hudLines();
    var top = s.top;
    var bot = s.bot;
    var yTop = Math.round(Math.max(2, cellH * 0.35));
    var yBot = Math.round(cssH - 7 * px - Math.max(2, cellH * 0.35));
    var i;
    var k;
    var ch;
    var col;

    /* 붕괴 중에는 셀마다 지연·방향이 달라 흩어진다 */
    var sTop = t * 9;
    var fTop = (sTop - Math.floor(sTop)) * step;
    var i0 = Math.floor(sTop) % top.length;
    for (i = 0; i < n; i++) {
      k = (i0 + i) % top.length;
      ch = top.charAt(k);
      if (ch === ' ') continue;
      col = (k % 37 === 0) ? C_HUD_HI : C_HUD;
      var duT = dustOut(rand1(i * 3 + 1), rand1(i * 7 + 2), disp.p, cellH * 4.6);
      if (!duT[2]) continue;
      ctx.drawImage(glyph(ch, col, px), Math.round(i * step - fTop + duT[0]), Math.round(yTop + duT[1]));
    }

    var sBot = t * 6;
    var fBot = (sBot - Math.floor(sBot)) * step;
    var i1 = bot.length - 1 - (Math.floor(sBot) % bot.length);
    for (i = 0; i < n; i++) {
      k = ((i1 - i) % bot.length + bot.length) % bot.length;
      ch = bot.charAt(k);
      if (ch === ' ') continue;
      col = (k % 41 === 0) ? C_HUD_HI : C_HUD;
      var duB = dustOut(rand1(i * 5 + 31), rand1(i * 11 + 17), disp.p, cellH * 4.6);
      if (!duB[2]) continue;
      ctx.drawImage(glyph(ch, col, px), Math.round(cssW - (i + 1) * step - fBot + duB[0]), Math.round(yBot + duB[1]));
    }
  }

  function drawHud(now) {
    if (disp.p > 0) drawHudDisintegrate(now);
    else drawHudStrip(now);
  }

  /* ---------- 타이틀: 모자이크 → 세분화 → 선명 + 라이브 모션 ---------- */

  function h2(a, b, s) {
    var n = (a * 73856093) ^ (b * 19349663) ^ (s * 83492791);
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  /* drawTitle 한 프레임의 상태를 담아 두는 재사용 객체(매 프레임 새 객체를 만들지 않는다) */
  var anim = {
    pe: 0, order: 0, phase: 0, jt: 0, amp: 0, alpha: 1, zoom: 1,
    cx: 0, cy: 0, lx0: 0, ly0: 0, hotR2: 0
  };

  /* 타이틀 점유 격자를 그린다.
     세분화를 화면 전체가 한꺼번에 바꾸지 않고, 6칸 블록마다 자기 시점에 6→3→2→1칸으로
     쪼개지게 한다. 블록이 하나씩 흩어지며 촘촘해져 툭 튀는 느낌이 사라진다.
     6은 3·2·1로 나누어떨어지므로 하위 블록이 격자를 벗어나지 않는다. */
  function paintTitleBlocks() {
    var pe = anim.pe;
    var order = anim.order;
    var phase = anim.phase;
    var amp = anim.amp;
    var alpha = anim.alpha;
    var lx0 = anim.lx0;
    var ly0 = anim.ly0;
    var hotR2 = anim.hotR2;
    var zoom = anim.zoom;
    var cx = anim.cx;
    var cy = anim.cy;
    var dp = disp.p;
    var occInv = 1 / Math.max(1, occW);
    var rampN = TITLE_CHARS.length;
    var gx;
    var gy;

    for (gy = 0; gy < occH; gy += 6) {
      for (gx = 0; gx < occW; gx += 6) {
        /* 블록마다 세분화 시점을 어긋나게 한다(해시 + 좌→우 편향) */
        var ord = h2(gx, gy, 7) * 0.7 + gx * occInv * 0.3;
        var lp = pe * 1.35 - ord * 0.42;
        if (lp < 0) lp = 0;
        else if (lp > 1) lp = 1;

        var L;
        if (lp < 0.3) L = 6;
        else if (lp < 0.58) L = 3;
        else if (lp < 0.82) L = 2;
        else L = 1;

        /* 묶음 하나를 큰 글자 하나로 채운다 */
        var blockPx = Math.max(titlePx, Math.floor(Math.min(
          (L * titleCellW) / 5,
          (L * titleCellH) / 7
        )));
        var halfW = 5 * blockPx * 0.5;
        var halfH = 7 * blockPx * 0.5;
        var threshold = L > 1 ? 0.4 : 0.5;
        var sy;
        var sx;

        for (sy = gy; sy < gy + 6 && sy < occH; sy += L) {
          for (sx = gx; sx < gx + 6 && sx < occW; sx += L) {
            var hits = 0;
            var tot = 0;
            var yy;
            var xx;
            for (yy = sy; yy < sy + L && yy < occH; yy++) {
              var rro = yy * occW;
              for (xx = sx; xx < sx + L && xx < occW; xx++) {
                tot++;
                if (occ[rro + xx]) hits++;
              }
            }
            if (!tot) continue;
            var ratio = hits / tot;
            if (ratio < threshold) continue;

            /* 무작위 덩어리 문자 → 대각선 순환 문자로 블록마다 서서히 넘어간다 */
            var ch;
            var rnd = h2(sx, sy, phase);
            if (rnd < order) {
              var ci = ((sx + sy + phase) % rampN + rampN) % rampN;
              ch = TITLE_CHARS[ci];
            } else {
              ch = TITLE_CHARS[(rnd * rampN) | 0];
            }

            var x = lx0 + sx * titleCellW + (L * titleCellW - 5 * blockPx) * 0.5;
            var y = ly0 + sy * titleCellH + (L * titleCellH - 7 * blockPx) * 0.5;

            /* 흔들림은 정수 페이즈가 아니라 연속 시간으로 흔들어 끊김을 없앤다 */
            var jx = Math.sin(sy * 1.7 + anim.jt) * amp;
            var jy = Math.cos(sx * 1.3 - anim.jt * 0.82) * amp;

            /* 붕괴: 칸 하나하나가 자기 지연·방향으로 흩날리고, 날아간 칸은 작은
               파편 문자로 분해되다 사라진다. */
            var chOut = ch;
            var pxOut = blockPx;
            if (dp > 0) {
              var duK = dustOut(h2(sx, sy, 913), h2(sx, sy, 977), dp, titleCellW * 7.2);
              if (!duK[2]) continue;
              jx += duK[0];
              jy += duK[1];
              if (duK[3] > 0.7) {
                if (duK[3] > 0.9) continue;
                chOut = '.';
                pxOut = Math.max(1, blockPx >> 1);
              }
            }

            var spark = ((sx * 31 + sy * 17 + phase) % 27) === 0;
            if (hasPtr) {
              var ddx = cx + (x + halfW + jx) * zoom - smX;
              var ddy = cy + (y + halfH + jy) * zoom - smY;
              if (ddx * ddx + ddy * ddy < hotR2) spark = true;
            }
            var csi = spark ? 2 : (((sx + sy + phase) % 5) === 0 ? 1 : 0);

            ctx.globalAlpha = alpha * (L > 1 ? Math.min(1, 0.45 + ratio * 0.75) : 1);
            ctx.drawImage(titleSprite(chOut, csi, pxOut), Math.round(x + jx), Math.round(y + jy));
          }
        }
      }
    }
  }

  function drawTitle(now) {
    /* 붕괴 중에는 등장 시간을 멈춰 흩어지는 모습만 남긴다 */
    var e = disp.on ? disp.freezeE : now - t0;
    if (!occ || e < TITLE_AT) return;

    /* 등장은 선형이 아니라 smoothstep — 천천히 시작해 천천히 끝난다 */
    var ta = (e - TITLE_AT) / 820;
    if (ta > 1) ta = 1;
    if (ta <= 0) return;
    var alpha = ta * ta * (3 - 2 * ta);

    var p = (e - REFINE_FROM) / (REFINE_TO - REFINE_FROM);
    if (p < 0) p = 0;
    else if (p > 1) p = 1;
    var pe = p * p * (3 - 2 * p);

    /* 배율과 흔들림은 등장 시작부터 완성까지 계속 움직인다(중간에 멈췄다 다시 커지지 않게) */
    var zp = (e - TITLE_AT) / (REFINE_TO - TITLE_AT);
    if (zp > 1) zp = 1;
    var zs = zp * zp * (3 - 2 * zp);

    /* 문자 종류 전환도 한 지점에서 확 바뀌지 않고 구간 안에서 서서히 섞인다 */
    var ord = (p - 0.26) / 0.42;
    if (ord < 0) ord = 0;
    else if (ord > 1) ord = 1;
    ord = ord * ord * (3 - 2 * ord);

    anim.pe = pe;
    anim.order = ord;
    anim.phase = Math.floor(e / 55);   /* 문자 순환 10Hz → 약18Hz(디더링 모션이 덜 끊긴다) */
    anim.jt = e * 0.0085;
    anim.amp = (1 - zs) * titleCellW * 1.9;
    anim.alpha = alpha;
    anim.zoom = titleZoom * (0.87 + 0.13 * zs);
    anim.cx = cssW * 0.5;
    anim.cy = titleY0 + occH * titleCellH * titleZoom * 0.5;
    anim.lx0 = -(occW * titleCellW) * 0.5;
    anim.ly0 = -(occH * titleCellH) * 0.5;
    var hotR = Math.max(64, occH * titleCellH * titleZoom * 0.9);
    anim.hotR2 = hotR * hotR;

    ctx.save();
    ctx.translate(anim.cx, anim.cy);
    ctx.scale(anim.zoom, anim.zoom);
    paintTitleBlocks();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ---------- 시작 문구 ---------- */

  /* 깜빡이지 않는다. 등장할 때 400ms 동안만 부드럽게 밝아진 뒤 계속 표시된다. */
  function drawPrompt(now) {
    var e = disp.on ? disp.freezeE : now - t0;
    if (e < PROMPT_AT) return;

    var fade = (e - PROMPT_AT) / 400;
    if (fade > 1) fade = 1;
    fade = fade * fade * (3 - 2 * fade);

    var step = 6 * promptPx;
    var w = PROMPT_TEXT.length * step;
    var x = (cssW - w) / 2;
    ctx.globalAlpha = fade;
    drawText(PROMPT_TEXT, x, promptY, promptPx, C_PROMPT);
    ctx.globalAlpha = 1;
  }

  /* ---------- 커튼(리졸브) — 붕괴 뒤 게임 화면이 걷히며 드러난다 ---------- */

  var C_CURTAIN = ['#171717', '#1b1b1b', '#131313'];
  var C_CUR_DUST = ['#2a2a2a', '#3a3a3a', '#323232'];

  /* 붕괴가 끝나면 타이틀 레이어의 불투명 배경을 걷어내고,
     화면을 덮고 있던 검은 블록을 왼쪽부터 흩어지게 하며 게임 화면을 드러낸다.
     블록은 줄어들면서 바깥으로 흩어지고, 개별 진행도가 1에 닿으면 그 블록만 사라진다. */
  function drawCurtain() {
    var p = rev.p;
    var q = 0;
    var r;
    var c;
    for (r = 0; r < curRows; r++) {
      var y = r * curH;
      for (c = 0; c < curCols; c++, q++) {
        var h = curHash[q];
        var hb = curHash2[q];
        /* 왼쪽부터 걷히는 커튼 + 블록마다 다른 잡음. 임계값이 어긋나 있어
           화면 전체가 한 번에 사라지지 않고 가장자리가 흩어지며 걷힌다. */
        var th = 0.06 + 0.62 * (c / curCols) + 0.34 * (h - 0.5) + 0.05 * (r / curRows);
        if (th < 0) th = 0;
        else if (th > 0.82) th = 0.82;
        var lp = (p - th) / 0.34;
        if (lp >= 1) continue;

        var x = c * curW;
        var gx = x;
        var gy = y;
        var gw = curW;
        var gh = curH;
        var a = 1;

        if (lp > 0) {
          var sp = 1 - lp;
          var ang = hb * 6.283185307179586;
          var d = lp * lp * curW * 2.4;
          gw = curW * (0.24 + 0.76 * sp);
          gh = curH * (0.24 + 0.76 * sp);
          gx = x + (curW - gw) * 0.5 + Math.cos(ang) * d;
          gy = y + (curH - gh) * 0.5 + Math.sin(ang) * d;
          a = 1 - lp * lp;
        }

        /* 블록 사이로 게임 화면이 새지 않게 +0.6px 겹쳐 칠한다 */
        ctx.globalAlpha = a;
        ctx.fillStyle = C_CURTAIN[(h * 3) | 0];
        ctx.fillRect(gx | 0, gy | 0, Math.ceil(gw) + 1, Math.ceil(gh) + 1);

        /* 걷히는 블록에는 가벼운 조각 문자가 섞여 먼지처럼 풀린다 */
        if (lp > 0.1 && lp < 0.88) {
          var di = hb > 0.62 ? 0 : (hb > 0.3 ? 1 : 2);
          ctx.globalAlpha = a * 0.8;
          ctx.drawImage(
            curSp[(h * 3) | 0][di],
            Math.round(gx + (gw - 5 * glyphPx) * 0.5),
            Math.round(gy + (gh - 7 * glyphPx) * 0.5)
          );
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function startReveal(now) {
    if (rev.on) return;
    rev.on = true;
    rev.p = 0;
    rev.t0 = now;
    /* 남은 블록이 게임 화면을 덮도록 레이어의 불투명 배경을 뺀다 */
    if (layer) layer.style.background = 'transparent';
  }

  /* ---------- 루프 ---------- */

  function frame(now) {
    if (!active) return;
    raf = requestAnimationFrame(frame);

    if (disp.on && !rev.on) {
      disp.p = (now - disp.freezeT) / DISPERSE_MS;
      if (disp.p >= 1) {
        disp.p = 1;
        startReveal(now);
      }
    }
    if (rev.on) {
      rev.p = (now - rev.t0) / REVEAL_MS;
      if (rev.p >= 1) {
        rev.p = 1;
        finish();
        return;
      }
    }

    fpsN++;
    if (now - fpsT > 500) {
      fps = Math.max(1, Math.round((fpsN * 1000) / (now - fpsT)));
      fpsN = 0;
      fpsT = now;
    }

    if (!started && !logoPlayed && hasAudio() && WBF.Audio.state() === 'running' && now - t0 > MUSIC_AT) {
      playLogo();
    }

    /* 커튼: 캔버스를 비우고 남은 블록만 그려 뒤의 게임 화면이 드러나게 한다 */
    if (rev.on) {
      ctx.clearRect(0, 0, cssW, cssH);
      drawCurtain();
      ctx.globalAlpha = 1;
      return;
    }

    ctx.globalAlpha = 1;

    smoothPointer();
    /* 배경은 움직임이 아주 느리므로 30Hz로만 다시 그려 오프스크린에 담고,
       매 프레임은 그 비트맵을 한 번 복사한다(셀 수천 개 drawImage → 큰 복사 1회).
       붕괴 중에는 셀이 날아가는 모습이 필요하므로 매 프레임 다시 그린다. */
    if (disp.on) {
      drawBackground(now);
      bgT = now + BG_INTERVAL;
    } else if (now >= bgT) {
      drawBackground(now);
      /* 다음 갱신 시각을 고정 간격으로 누적한다. 프레임 시간과의 차분에만 기대면
         30Hz가 20Hz와 30Hz 사이를 오가며 파동이 한 칸씩 튀어 보인다. */
      bgT += BG_INTERVAL;
      if (bgT < now) bgT = now + BG_INTERVAL;
    }
    ctx.drawImage(bgCanvas, 0, 0, cssW, cssH);
    /* 필드 위에 파문만 매 프레임 다시 얹어 커서와 어긋나지 않게 한다 */
    drawRippleOverlay(now);

    drawHud(now);
    drawTitle(now);
    if (!started || disp.on) drawPrompt(now);

    ctx.globalAlpha = 1;
  }

  /* ---------- 시작 / 종료 ---------- */

  function begin() {
    if (!active || started) return;
    started = true;
    layer.style.pointerEvents = 'none';
    /* 시작 클릭으로 로고 코드를 다시 울리지 않는다(저역 '우웅' 소리 제거) */
    if (hasAudio()) WBF.Audio.confirm(0.18);
    if (onStart) onStart();
    /* CSS 페이드아웃 대신, 화면의 아스키 셀이 하나하나 무작위 방향으로 흩날리며
       사라지는 붕괴(디스퍼전) 연출로 넘어간다. */
    disp.on = true;
    disp.p = 0;
    disp.freezeT = performance.now();
    disp.freezeE = disp.freezeT - t0;
    /* 붕괴 → 커튼(리졸브) 순서로 이어지고, 커튼이 끝나면 frame()에서 레이어를 숨긴다 */
  }

  function finish() {
    active = false;
    started = false;
    disp.on = false;
    disp.p = 0;
    rev.on = false;
    rev.p = 0;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (layer) layer.hidden = true;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', resize);
  }

  function onMove(ev) {
    if (!active) return;
    ptrX = ev.clientX;
    ptrY = ev.clientY;
    if (!hasPtr) {
      hasPtr = true;
      smX = ptrX;
      smY = ptrY;
    }
  }

  function onDown() {
    begin();
  }

  function onKey(ev) {
    if (!active || started) return;
    if (ev.key === 'Enter' || ev.key === 'NumpadEnter' || ev.code === 'Space' || ev.key === ' ') {
      ev.preventDefault();
      begin();
    }
  }

  function boot(opts) {
    onStart = opts && opts.onStart ? opts.onStart : null;
    layer = document.getElementById('titleLayer');
    canvas = document.getElementById('titleCanvas');
    if (!layer || !canvas) return;
    if (active) return;

    ctx = canvas.getContext('2d');
    active = true;
    started = false;
    logoPlayed = false;
    disp.on = false;
    disp.p = 0;
    rev.on = false;
    rev.p = 0;
    layer.hidden = false;
    layer.classList.remove('out');
    layer.style.pointerEvents = '';
    layer.style.background = '';

    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(layer);
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);

    /* 자동재생 잠금: 첫 제스처에서 풀리면 그 자리에서 로고 코드를 울린다 */
    if (WBF.Audio && WBF.Audio.unlock) {
      WBF.Audio.unlock(function () {
        if (!started) playLogo();
      });
    }

    t0 = performance.now() + 40;
    fpsT = t0;
    fpsN = 0;
    raf = requestAnimationFrame(frame);
  }

  return {
    boot: boot,
    isActive: function () { return active; },
    isStarted: function () { return started; },
    /* 커튼이 걷히는 중 — 뒤의 게임 화면을 렌더해야 하는 구간 */
    isRevealing: function () { return active && rev.on; }
  };
})();
