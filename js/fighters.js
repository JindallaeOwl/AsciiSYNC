/* 파이터 4종 정의 + 아스키 아트 시트(문자 행렬)
   아트 시트 규칙: 1글자 = 1셀. 공백은 빈 셀. 열 = 뒤→앞(+x, 정면), 행 = 위→아래.
   입자는 시트의 비공백 셀 하나당 정확히 하나만 존재한다(중복 0). */
window.WBF = window.WBF || {};

WBF.world = { W: 960, H: 540 };

/* 시그니처 네온: BLADE 시안 / RAILGUN 크림슨 / JUGGERNAUT 앰버 / SPLITTER 바이올렛 */
/* 반지름은 이전 대비 약 1.4배 — 셀 피치(fw 6px/fh 11px) 기준으로 시트 높이가
   지름과 비슷해지도록 맞춘 값이다(실루엣과 판정 원의 어긋남 최소화). */
/* skillName = 게이지 완충 후 적 충돌 시 발동하는 고유 스킬. skillColor = 게이지 바 색(체력과 구분). */
WBF.TYPES = [
  { id: 'blade',      abbr: 'BLD', tag: 'BLADE',      name: '검사',     color: '#00f0ff', hp: 200, radius: 36, cruise: 10.0, skillName: 'SPIN_SLASH',   skillColor: '#8ff6ff' },
  { id: 'railgun',    abbr: 'RLG', tag: 'RAILGUN',    name: '스나이퍼', color: '#ff1e56', hp: 170, radius: 33, cruise: 11.2, skillName: 'PIERCE_LASER', skillColor: '#ff9aae' },
  { id: 'juggernaut', abbr: 'JUG', tag: 'JUGGERNAUT', name: '광전사',   color: '#ffaa00', hp: 310, radius: 46, cruise: 7.8,  skillName: 'GROUND_SLAM',  skillColor: '#ffd166' },
  { id: 'splitter',   abbr: 'SPL', tag: 'SPLITTER',   name: '분열술사', color: '#b829ff', hp: 230, radius: 38, cruise: 11.8, skillName: 'FRAG_BURST',   skillColor: '#dda6ff' }
];

/* ---------- 셰이딩 아트 원본(시제품: BLADE) ----------
   손으로 쓴 문자 시트 대신 도형 + 재질 + 두께로 파이터를 정의하고, js/shade.js가 각도별로
   셀마다 가장 닮은 문자와 크롬 반사 색을 구워 둔다(1셀 1문자 규칙은 그대로).
   좌표: 참조 셀 6×11px 기준 px, 회전 중심 원점, +x = 정면(칼끝), +y = 아래.
   parts는 뒤 → 앞 순서(뒤에 있는 부위가 앞 부위를 덮는다).
   - shape: { circle: [cx, cy, r] } | { poly: [[x,y]...], mirror: true } — mirror면 poly는 y=0 축 위 점에서 시작해 축 위 점으로 끝나는 위쪽 절반 경로이고, 아래 절반은 y를 뒤집어 거꾸로 이어 붙인다
   - mat: materials 키
   materials:
   - env: [하늘, 어두운 띠, 바닥] — '#hex' | 'sig'(시그니처 색) | 'sig+0.6'(흰색 쪽으로) | 'sig-0.7'(검정 쪽으로)
   - profile: 'bevel'(가장자리에서 W까지 직선 경사 → 날 능선) | 'dome'(둥글게 부푼 면)
   - W, H: 경사 폭·높이(px). H/W가 클수록 기울기가 커져 반사가 하늘·바닥으로 멀리 간다
   - stripe: [진폭, 주기px] — x 방향 감김 무늬(손잡이)
   - rim: [높이, 가장자리에서 거리, 폭] — 테두리 바로 안쪽이 살짝 솟는다
   - 내부 칸 채움: grain(결 각도, 라디안 — 회전에 맞춰 = \ | / 중 하나) 또는 ramp(어두움→밝음 문자열)
   어두운 띠도 검은 배경 위에서 구멍처럼 보이지 않게 너무 어둡게 두지 않는다 */
WBF.ART = {
  blade: {
    materials: {
      steel: { env: ['sig+0.8', 'sig-0.55', 'sig'], profile: 'bevel', W: 11, H: 11, grain: 0 },
      brass: { env: ['#fff0b8', '#7a5414', '#d6952a'], profile: 'bevel', W: 5, H: 5, grain: Math.PI / 2 },
      grip:  { env: ['sig-0.2', 'sig-0.65', 'sig-0.45'], profile: 'dome', W: 6, H: 4, stripe: [1.6, 5], ramp: '+*#' },
      gem:   { env: ['#ffffff', 'sig-0.3', 'sig+0.2'], profile: 'dome', W: 5, H: 6, ramp: 'o@' }
    },
    parts: [
      { shape: { circle: [-64, 0, 11] }, mat: 'brass' },
      { shape: { circle: [-64, 0, 5.5] }, mat: 'gem' },
      { shape: { poly: [[-56, -6], [-26, -6], [-26, 6], [-56, 6]] }, mat: 'grip' },
      { shape: { poly: [[-15, 0], [-15, -11], [48, -11], [78, 0]], mirror: true }, mat: 'steel' },
      { shape: { poly: [[-29, 0], [-29, -27], [-22, -36], [-14, -27], [-14, 0]], mirror: true }, mat: 'brass' },
      { shape: { circle: [-21, 0, 4.5] }, mat: 'gem' }
    ]
  }
};

WBF.getType = function (id) {
  for (var i = 0; i < WBF.TYPES.length; i++) {
    if (WBF.TYPES[i].id === id) return WBF.TYPES[i];
  }
  return null;
};

WBF.Shapes = (function () {
  /* ---------- 아트 시트(문자 행렬) ---------- */
  var SHEETS = {
    /* ① BLADE — 대검: 월광 손잡이(<@>) · 코등이(|) · 가는 칼날(=) · 검끝(>>)
       7행 = 셀 높이 11px 기준 약 77px. 지름 72px와 거의 같아 회전해도 판정과 맞는다. */
    blade: [
      '          ^               ',
      '          |               ',
      '    _     |               ',
      '  <@>====+|#============>>',
      '  <@>====+|#============>>',
      '    -     |               ',
      '          v               '
    ],
    /* ② RAILGUN — 화살: 깃(<) · 몸통(#) · 레일(=) · 촉(>>>) */
    railgun: [
      '                      ',
      '   <                  ',
      '    <=   ==========>>>',
      ' @#=====############>>>',
      '    <=   ==========>>>',
      '   <                  ',
      '                      '
    ],
    /* ③ JUGGERNAUT — 중장갑 코어 + 3단 가시(철퇴). 9행 = 99px ≈ 지름 92px */
    juggernaut: [
      '       *        ',
      '      *#*       ',
      '    *#%%%#*     ',
      '  *#%%%%%%%#*   ',
      ' #%%@@XXX@@%%#  ',
      '  *#%%%%%%%#*   ',
      '    *#%%%#*     ',
      '      *#*       ',
      '       *        '
    ],
    /* ④ SPLITTER — 쌍둥이 핵 + 얇은 허리 */
    splitter: [
      '   ~&~     ~&~   ',
      '  %@@@%   %@@@%  ',
      ' @@@@@X@ @X@@@@@ ',
      ' %@@@@%  +  %@@@@%',
      ' @@@@@X@ @X@@@@@ ',
      '  %@@@%   %@@@%  ',
      '   ~&~     ~&~   '
    ]
  };

  /* 문자 등급: 3 = 실루엣 외곽, 2 = 구조, 1 = 내부 채움 */
  var TIER = {
    '|': 3, '/': 3, '\\': 3, '>': 3, '<': 3, '^': 3, 'v': 3, '#': 3, '@': 3, '*': 3,
    '=': 2, '+': 2, '&': 2, '%': 2, 'X': 2,
    '-': 1, '~': 1, '·': 1, ':': 1, '.': 1, '_': 1
  };

  var cache = {};

  /* 시트 → { cols, rows, cc, cr, cells[{c, r, ch, tier}] } */
  function sheetFor(typeId) {
    var s = cache[typeId];
    if (s) return s;
    var rows = SHEETS[typeId] || SHEETS.blade;
    var cols = 0, i, j;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].length > cols) cols = rows[i].length;
    }
    var cc = Math.floor(cols / 2);
    var cr = Math.floor(rows.length / 2);
    var cells = [];
    for (i = 0; i < rows.length; i++) {
      var line = rows[i];
      for (j = 0; j < cols; j++) {
        var ch = line.charAt(j);
        if (!ch || ch === ' ') continue;
        cells.push({ c: j, r: i, ch: ch, tier: TIER[ch] || 2 });
      }
    }
    s = { id: typeId, cols: cols, rows: rows.length, cc: cc, cr: cr, cells: cells };
    cache[typeId] = s;
    return s;
  }

  /* 셀 단위 목록(구 API 호환) */
  function assign(typeId) {
    var s = sheetFor(typeId);
    var out = [];
    for (var i = 0; i < s.cells.length; i++) {
      out.push({ x: s.cells[i].c - s.cc, y: s.cells[i].r - s.cr, ch: s.cells[i].ch, tier: s.cells[i].tier });
    }
    return out;
  }

  return { sheetFor: sheetFor, assign: assign, cores: function () { return []; } };
})();
