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
