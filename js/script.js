/* 진입 파일: 코드 에디터형 설정 UI · 텔레메트리 로그 · 게임 루프 */
(function () {
  var pane = document.getElementById('arenaPane');
  var canvas = document.getElementById('arena');
  var codeEl = document.getElementById('code');
  var unitsEl = document.getElementById('units');
  var logEl = document.getElementById('log');
  /* 실제 스크롤 컨테이너는 ol이 아니라 감싸는 .logwrap 이다 */
  var logWrap = logEl ? logEl.parentElement : null;
  var sbLeft = document.getElementById('sbLeft');
  var sbRight = document.getElementById('sbRight');
  var sbFps = document.getElementById('sbFps');
  var fpsOpts = sbFps ? sbFps.querySelectorAll('.fps-opt') : [];

  if (!pane || !canvas || !codeEl) return;

  var game = new WBF.Game(canvas);
  var TYPES = WBF.TYPES;

  /* 더블클릭해도 코드 텍스트가 선택·하이라이트되지 않게 한다(설정 버튼만 반응) */
  codeEl.addEventListener('dblclick', function (ev) {
    ev.preventDefault();
    var sel = window.getSelection ? window.getSelection() : null;
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
  });
  codeEl.addEventListener('selectstart', function (ev) {
    ev.preventDefault();
  });

  /* 에디터 토큰 팔레트 */
  var C = {
    com: '#7a7a7a',
    kw: '#b9a7ff',
    id: '#8fd7ff',
    num: '#e09f5a',
    str: '#7ee0d0',
    pun: '#808080',
    dim: '#5c5c5c',
    ok: '#33ff66',
    warn: '#ff2a55',
    amber: '#ffb000'
  };

  /* ---------- 상태 ---------- */

  var counts = {};
  var ti;
  for (ti = 0; ti < TYPES.length; ti++) counts[TYPES[ti].id] = 0;

  /* 경기 모드 — 하단 터미널 GAME_MODE 라인에서 클릭으로 즉시 전환된다 */
  var MODES = ['1V1_DUEL', '2V2_TEAM', 'BOSS_RAID', 'ALL_OUT_BRAWL'];
  var gameMode = '1V1_DUEL';

  var SPEEDS = [0.5, 1, 2, 5];
  var speedIdx = 1;
  var speed = 1;
  var soundOn = true;
  var cellPx = 10;
  var asciiMode = true;
  var teamMode = false;
  /* 화면 흔들림은 기본 켜짐 — 설정 패널에서 끌 수 있다 */
  var shakeOn = true;
  var fpsMode = 60;
  var renderAt = 0;

  var ACTIONS = ['▶ RUN', '❚❚ PAUSE', '↻ RESET'];
  var actionIdx = 0;

  var STEP = 1 / 60;
  var acc = 0;
  var last = 0;
  var frames = 0;
  var fpsAt = 0;
  var fps = 0;
  var logSeq = 0;
  var liveLine = null;
  var lastUnitsAt = 0;

  /* ---------- 공통 DOM 도우미 ---------- */

  function sp(text, color, opts) {
    var node = document.createElement('span');
    node.textContent = text;
    node.style.color = color || C.pun;
    if (opts && opts.bold) node.style.fontWeight = '700';
    if (opts && opts.click) {
      node.style.cursor = 'pointer';
      node.style.padding = '1px 2px';
      node.style.borderRadius = '0';
      node.style.userSelect = 'none';
      node.style.webkitUserSelect = 'none';
      /* 더블클릭·드래그로 단어가 선택되지 않게 선택 시작을 막는다 */
      node.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
      });
      node.addEventListener('click', function (ev) {
        ev.stopPropagation();
        opts.click();
      });
      node.addEventListener('mouseenter', function () {
        node.style.background = 'rgba(255,80,80,0.18)';
        node.style.color = '#ffffff';
      });
      node.addEventListener('mouseleave', function () {
        node.style.background = '';
        node.style.color = opts.color || color || C.pun;
      });
    }
    return node;
  }

  function addLine(no, nodes) {
    var li = document.createElement('li');
    li.style.cssText = 'display:flex;align-items:baseline;gap:10px;padding:0 8px;line-height:1.5;font-size:11.5px;';
    var ln = document.createElement('span');
    ln.textContent = no < 10 ? '0' + no : String(no);
    ln.style.cssText = 'flex:0 0 22px;text-align:right;color:#5c5c5c;user-select:none;';
    li.appendChild(ln);
    var body = document.createElement('span');
    body.style.cssText = 'flex:1;min-width:0;white-space:pre-wrap;word-break:break-word;';
    for (var i = 0; i < nodes.length; i++) body.appendChild(nodes[i]);
    li.appendChild(body);
    li.addEventListener('mouseenter', function () { li.style.background = 'rgba(255,80,80,0.08)'; });
    li.addEventListener('mouseleave', function () { li.style.background = ''; });
    codeEl.appendChild(li);
    return li;
  }

  /* ---------- 액션 ---------- */

  function totalUnits() {
    var sum = 0;
    for (var i = 0; i < TYPES.length; i++) sum += counts[TYPES[i].id] || 0;
    return sum;
  }

  function buildConfig() {
    var c = {};
    for (var i = 0; i < TYPES.length; i++) {
      var id = TYPES[i].id;
      c[id] = counts[id] || 0;
    }
    return {
      counts: c,
      teamMode: teamMode,
      mode: gameMode === 'BOSS_RAID' ? 'boss' : 'duel',
      stats: { hp: 150, atk: 100, spd: 100 }
    };
  }

  /* fixedSpawn: 튜토리얼 쇼케이스처럼 늘 같은 자리에서 시작해야 할 때만 true */
  function startMatch(fixedSpawn) {
    if (totalUnits() === 0) {
      pushLog('ERR: NO_UNIT_SELECTED // SPAWN_FIGHTERS 조정 필요', 'warn');
      return;
    }
    WBF.Audio.setMuted(!soundOn);
    WBF.Audio.resume();
    acc = 0;
    var cfg = buildConfig();
    cfg.fixedSpawn = fixedSpawn === true;
    game.setup(cfg);
    game.start();
    actionIdx = 0;
    pushLog('SIM_START // UNITS=' + totalUnits() + ' // SPEED=' + speed + 'x', 'sys');
    refresh();
  }

  function togglePause() {
    if (game.finished) {
      pushLog('ERR: MATCH_ENDED // RESET 필요', 'warn');
      actionIdx = 2;
      refresh();
      return;
    }
    if (!game.running) {
      pushLog('ERR: SIM_NOT_RUNNING', 'warn');
      actionIdx = 0;
      refresh();
      return;
    }
    game.paused = !game.paused;
    actionIdx = game.paused ? 1 : 0;
    pushLog(game.paused ? 'SIM_PAUSED' : 'SIM_RESUMED', 'sys');
    refresh();
  }

  function resetMatch() {
    acc = 0;
    game.setup(buildConfig());
    actionIdx = 0;
    pushLog('SIM_RESET // STANDBY', 'sys');
    refresh();
  }

  function cycleAction() {
    actionIdx = (actionIdx + 1) % ACTIONS.length;
    if (actionIdx === 0) startMatch();
    else if (actionIdx === 1) togglePause();
    else resetMatch();
    refresh();
  }

  function cycleSpeed() {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    speed = SPEEDS[speedIdx];
    pushLog('SIM_SPEED = ' + speed + 'x', 'sys');
    refresh();
  }

  /* 원하는 배속을 바로 고른다(사이클을 한 바퀴 돌지 않아도 된다) */
  function setSpeedIdx(idx) {
    var n = Math.max(0, Math.min(SPEEDS.length - 1, Math.round(idx)));
    if (n === speedIdx) { refresh(); return; }
    speedIdx = n;
    speed = SPEEDS[speedIdx];
    pushLog('SIM_SPEED = ' + speed + 'x', 'sys');
    refresh();
  }

  function bumpDensity(delta) {
    /* 7~11px: 작을수록 칸이 촘촘해져 같은 크기의 파이터에 글자가 더 들어간다(셀 수가 늘어 무거워진다) */
    cellPx = Math.max(7, Math.min(11, cellPx + delta));
    game.cellPx = cellPx;
    refresh();
  }

  function toggleSound() {
    soundOn = !soundOn;
    WBF.Audio.setMuted(!soundOn);
    if (soundOn) WBF.Audio.resume();
    refresh();
  }

  function toggleMode() {
    asciiMode = !asciiMode;
    game.asciiMode = asciiMode;
    pushLog('RENDER_MODE = ' + (asciiMode ? 'ASCII' : 'BLOCK'), 'sys');
    refresh();
  }

  /* FPS 토글: 렌더 주기만 바꾸고 물리 계산은 항상 1/60 고정 스텝 */
  function setFpsMode(next) {
    if (next !== 30 && next !== 60) return;
    if (fpsMode === next) { syncFpsUI(); return; }
    fpsMode = next;
    pushLog('FPS_MODE = ' + fpsMode + ' // physics=fixed 1/60', 'sys');
    syncFpsUI();
    refresh();
  }

  function syncFpsUI() {
    for (var i = 0; i < fpsOpts.length; i++) {
      var el = fpsOpts[i];
      var on = Number(el.getAttribute('data-fps')) === fpsMode;
      el.className = 'fps-opt' + (on ? ' on' : '');
    }
  }

  for (var fo = 0; fo < fpsOpts.length; fo++) {
    (function (el) {
      el.addEventListener('click', function () { setFpsMode(Number(el.getAttribute('data-fps'))); });
    })(fpsOpts[fo]);
  }

  function bumpCount(id, delta) {
    var next = Math.max(0, Math.min(4, (counts[id] || 0) + delta));
    if (next === counts[id]) return;
    if (delta < 0 && totalUnits() <= 1) {
      pushLog('ERR: AT_LEAST_ONE_UNIT_REQUIRED', 'warn');
      return;
    }
    counts[id] = next;
    refresh();
  }

  /* ---------- 매치업 빌더 ---------- */

  function setCounts(next) {
    for (var i = 0; i < TYPES.length; i++) {
      var id = TYPES[i].id;
      counts[id] = Math.max(0, Math.min(4, next[id] || 0));
    }
  }

  function matchupSummary() {
    if (gameMode === 'BOSS_RAID') return 'JUGGERNAUT x1(BOSS hp x2.4) vs 사냥꾼 x3';
    var out = [];
    for (var i = 0; i < TYPES.length; i++) {
      out.push(TYPES[i].tag + 'x' + (counts[TYPES[i].id] || 0));
    }
    return out.join(' ') + ' // TEAM=' + (teamMode ? 'ON' : 'OFF');
  }

  function applyMatchup(tag) {
    if (totalUnits() === 0) {
      pushLog('ERR: MATCHUP_EMPTY // 최소 1기 필요', 'warn');
      refresh();
      return;
    }
    pushLog('MATCHUP_APPLY // ' + matchupSummary() + (tag ? ' // ' + tag : ''), 'sys');
    startMatch();
  }

  function shuffleIds() {
    var ids = [];
    for (var i = 0; i < TYPES.length; i++) ids.push(TYPES[i].id);
    for (var j = ids.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var tmp = ids[j];
      ids[j] = ids[k];
      ids[k] = tmp;
    }
    return ids;
  }

  /* 모드 설정만 적용(경기 시작 없음) — 부트 시 기본 1v1 진형을 만든다 */
  function configureMode(mode) {
    gameMode = mode;
    var ids, next;
    if (mode === 'BOSS_RAID') {
      next = { blade: 3, railgun: 0, juggernaut: 1, splitter: 0 };
      teamMode = false;
    } else if (mode === '2V2_TEAM') {
      ids = shuffleIds();
      next = {};
      next[ids[0]] = 2;
      next[ids[1]] = 2;
      teamMode = true;
    } else if (mode === 'ALL_OUT_BRAWL') {
      next = { blade: 2, railgun: 1, juggernaut: 1, splitter: 2 };
      teamMode = false;
    } else {
      /* 1V1_DUEL(기본): 무작위 2종 각 1기 */
      ids = shuffleIds();
      next = {};
      next[ids[0]] = 1;
      next[ids[1]] = 1;
      teamMode = false;
    }
    setCounts(next);
    game.teamMode = teamMode;
  }

  /* 모드 설정 + 즉시 새 경기 시작 */
  function applyMode(mode) {
    configureMode(mode);
    pushLog('GAME_MODE = ' + mode + ' // ' + matchupSummary(), 'sys');
    startMatch();
  }

  function toggleTeamMode() {
    if (gameMode === 'BOSS_RAID') {
      pushLog('ERR: BOSS_RAID_FIXED_TEAMS // TEAM_MODE 잠금', 'warn');
      return;
    }
    teamMode = !teamMode;
    game.teamMode = teamMode;
    var pending = game.running && !game.finished && !game.paused;
    pushLog('TEAM_MODE = ' + (teamMode ? 'ON' : 'OFF') + (pending ? ' // NEXT_MATCH' : ''), 'sys');
    refresh();
  }

  function toggleShake() {
    shakeOn = !shakeOn;
    game.shakeEnabled = shakeOn;
    pushLog('SHAKE = ' + (shakeOn ? 'ON (BIG_HIT 18+ / KILL 5.5px)' : 'OFF'), 'sys');
    refresh();
  }

  /* ---------- 설정 패널 언어 (한국어 기본 · 한/영 토글) ---------- */

  var LANG = 'ko';

  var MODE_KO = {
    '1V1_DUEL': '1대1 듀얼',
    '2V2_TEAM': '2대2 팀전',
    'BOSS_RAID': '보스 레이드',
    'ALL_OUT_BRAWL': '난전'
  };
  var NAME_KO = { blade: '블레이드', railgun: '레일건', juggernaut: '저거넛', splitter: '스플리터' };
  var STATE_KO = { running: '진행 중', paused: '일시정지', idle: '대기', done: '종료' };

  function isKo() { return LANG === 'ko'; }
  function modeName(m) { return isKo() ? (MODE_KO[m] || m) : m; }
  function unitName(t) { return isKo() ? (NAME_KO[t.id] || t.tag) : t.tag; }
  function unitLabel(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return unitName(TYPES[i]);
    return id;
  }

  /* 표시 전용 대진 요약 — 로그는 영어 태그를 그대로 쓴다 */
  function matchupSummaryUI() {
    if (!isKo()) return matchupSummary();
    if (gameMode === 'BOSS_RAID') return '저거넛 x1(보스 체력 x2.4) vs 사냥꾼 x3';
    var out = [];
    for (var i = 0; i < TYPES.length; i++) {
      out.push(unitName(TYPES[i]) + 'x' + (counts[TYPES[i].id] || 0));
    }
    return out.join(' ') + ' // 팀=' + (teamMode ? '켜짐' : '꺼짐');
  }

  /* 설정 패널 토큰 이름·주석. 코드 문법 기호(const·=·[ ]·;)는 두 언어 공통 */
  var LABELS = {
    ko: {
      fileTag: '설정',
      hint: '값을 클릭해 변경',
      comment1: '// 설정 — 값을 클릭해 변경 · 즉시 적용',
      action: '동작',
      actionNames: ['▶ 실행', '❚❚ 일시정지', '↻ 리셋'],
      actionComment: '  // 클릭 → 실행',
      speed: '배속',
      speedNames: ['0.5배', '1배', '2배', '5배'],
      speedComment: '  // 시뮬레이션 배속',
      cell: '글자_크기',
      cellComment: '아스키 밀도',
      sound: '소리',
      soundBtn: '[켜기/끄기]',
      soundComment: '신스 효과음',
      spawn: '출전_파이터',
      mode: '경기_모드',
      modeComment: '  // 클릭 → 즉시 전환/시작',
      render: '렌더_모드',
      renderVals: ['아스키', '블록'],
      fps: '프레임_모드',
      fpsComment: '고정 스텝 유지',
      builder: '┌─[ 매치업 빌더 ]──────────────────────┐',
      builderEnd: '└────────────────────────────────────┘',
      teamMode: '팀 모드',
      shake: '화면 흔들림',
      on: '켜짐',
      off: '꺼짐',
      apply: '[ 초기화 / 적용 ]',
      runtime: '// ─── 실행 중 ─────────────────────────────',
      keys: '// [Space] 일시정지/재시작   [R] 리셋   [Enter] 실행',
      limit: '경기_제한',
      shrink: '축소_시작',
      world: '화면',
      worldW: '너비',
      worldH: '높이'
    },
    en: {
      fileTag: 'SETTINGS',
      hint: 'click values to edit',
      comment1: '// SETTINGS — click a value to change it',
      action: 'ACTION',
      actionNames: ['▶ RUN', '❚❚ PAUSE', '↻ RESET'],
      actionComment: '   // click → 실행',
      speed: 'SIM_SPEED',
      speedNames: ['0.5x', '1x', '2x', '5x'],
      speedComment: '  // 배속 조절',
      cell: 'ASCII_CELL_PX',
      cellComment: '아스키 밀도',
      sound: 'SOUND_FX',
      soundBtn: '[TOGGLE]',
      soundComment: '신스 사운드',
      spawn: 'SPAWN_FIGHTERS',
      mode: 'GAME_MODE',
      modeComment: '  // click → 즉시 전환/시작',
      render: 'RENDER_MODE',
      renderVals: ['ASCII', 'BLOCK'],
      fps: 'FPS_MODE',
      fpsComment: '고정 스텝 유지',
      builder: '┌─[ MATCHUP_BUILDER ]────────────────────────┐',
      builderEnd: '└─────────────────────────────────────────────┘',
      teamMode: 'TEAM_MODE',
      shake: 'SHAKE',
      on: 'ON',
      off: 'OFF',
      apply: '[ RESET / APPLY ]',
      runtime: '// ─── runtime ─────────────────────────────',
      keys: '// [SPACE] PAUSE/RESTART   [R] RESET   [ENTER] RUN',
      limit: 'MATCH_LIMIT',
      shrink: 'SHRINK_START',
      world: 'WORLD',
      worldW: 'W',
      worldH: 'H'
    }
  };

  /* ---------- 코드 에디터 렌더 ---------- */

  function renderCode() {
    var L = LABELS[LANG];
    codeEl.textContent = '';
    liveLine = null;

    addLine(1, [sp(L.comment1, C.com)]);

    var n2 = [sp(L.action, C.id), sp(' = [ ', C.pun)];
    for (var i = 0; i < ACTIONS.length; i++) {
      if (i) n2.push(sp(', ', C.pun));
      n2.push(sp('"' + L.actionNames[i] + '"', i === actionIdx ? C.ok : C.str, { bold: i === actionIdx }));
    }
    n2.push(sp(' ];', C.pun), sp(L.actionComment, C.com));
    bindLine(addLine(2, n2), cycleAction);

    var n3 = [sp(L.speed, C.id), sp(' = [ ', C.pun)];
    for (var s = 0; s < SPEEDS.length; s++) {
      if (s) n3.push(sp(', ', C.pun));
      var on = s === speedIdx;
      /* 배속 값 하나하나를 직접 눌러 그 값으로 바로 바꾼다 */
      (function (idx, isOn) {
        n3.push(sp('"' + L.speedNames[idx] + '"', isOn ? C.ok : C.num, {
          bold: isOn,
          click: function () { setSpeedIdx(idx); }
        }));
      })(s, on);
    }
    n3.push(sp(' ];', C.pun), sp(L.speedComment, C.com));
    bindLine(addLine(3, n3), cycleSpeed);

    var n4 = [
      sp(L.cell, C.id),
      sp(' = ', C.pun),
      sp(String(cellPx), C.num, { bold: true }),
      sp(';  // ', C.com),
      sp('[-]', C.amber, { click: function () { bumpDensity(-1); } }),
      sp(' ', C.pun),
      sp('[+]', C.amber, { click: function () { bumpDensity(1); } }),
      sp(' ' + L.cellComment, C.com)
    ];
    addLine(4, n4);

    var n5 = [
      sp(L.sound, C.id),
      sp(' = ', C.pun),
      sp(soundOn ? 'true' : 'false', soundOn ? C.ok : C.warn, { bold: true }),
      sp(';    // ', C.com),
      sp(L.soundBtn, C.amber, { click: toggleSound }),
      sp(' ' + L.soundComment, C.com)
    ];
    addLine(5, n5);

    var n6 = [sp(L.spawn, C.id), sp(' = { ', C.pun)];
    for (var k = 0; k < TYPES.length; k++) {
      var t = TYPES[k];
      if (k) n6.push(sp(', ', C.pun));
      n6.push(sp(unitName(t), C.str), sp(': ', C.pun));
      n6.push(sp(String(counts[t.id]), C.num, { bold: true }));
      n6.push(sp(' ', C.pun));
      (function (id) {
        n6.push(sp('[-]', C.amber, { click: function () { bumpCount(id, -1); } }));
        n6.push(sp('[+]', C.amber, { click: function () { bumpCount(id, 1); } }));
      })(t.id);
    }
    n6.push(sp(' };', C.pun));
    addLine(6, n6);

    var n7 = [sp(L.mode, C.id), sp(' = [ ', C.pun)];
    for (var m7 = 0; m7 < MODES.length; m7++) {
      if (m7) n7.push(sp(', ', C.pun));
      (function (mode, on) {
        n7.push(sp('"' + modeName(mode) + '"', on ? C.ok : C.str, {
          bold: on,
          click: function () { applyMode(mode); }
        }));
      })(MODES[m7], MODES[m7] === gameMode);
    }
    n7.push(sp(' ];', C.pun), sp(L.modeComment, C.com));
    addLine(7, n7);

    var n8 = [
      sp(L.render, C.id),
      sp(' = ', C.pun),
      sp('"' + L.renderVals[asciiMode ? 0 : 1] + '"', C.str, { bold: true }),
      sp('; // ', C.com),
      sp('[' + L.renderVals[0] + ']', asciiMode ? C.ok : C.dim, { click: function () { if (!asciiMode) toggleMode(); } }),
      sp(' ', C.pun),
      sp('[' + L.renderVals[1] + ']', asciiMode ? C.dim : C.ok, { click: function () { if (asciiMode) toggleMode(); } })
    ];
    addLine(8, n8);

    var n9 = [
      sp(L.fps, C.id),
      sp(' = ', C.pun),
      sp(String(fpsMode), C.num, { bold: true }),
      sp(';   // ', C.com),
      sp('[30]', fpsMode === 30 ? C.ok : C.dim, { click: function () { setFpsMode(30); } }),
      sp(' ', C.pun),
      sp('[60]', fpsMode === 60 ? C.ok : C.dim, { click: function () { setFpsMode(60); } }),
      sp(' ' + L.fpsComment, C.com)
    ];
    addLine(9, n9);

    addLine(10, [sp(L.builder, C.com)]);
    addLine(11, [].concat(
      counterNodes('blade', unitLabel('blade')), [sp('  |  ', C.pun)],
      counterNodes('railgun', unitLabel('railgun'))
    ));
    addLine(12, [].concat(
      counterNodes('juggernaut', unitLabel('juggernaut')), [sp('  |  ', C.pun)],
      counterNodes('splitter', unitLabel('splitter'))
    ));
    addLine(13, [
      sp('[ ' + L.teamMode + ': ', C.amber, { click: toggleTeamMode }),
      sp(teamMode ? L.on : L.off, teamMode ? C.ok : C.dim, { bold: true, click: toggleTeamMode }),
      sp(' ]', C.amber, { click: toggleTeamMode }),
      sp('   ', C.pun),
      sp('[ ' + L.shake + ': ', C.amber, { click: toggleShake }),
      sp(shakeOn ? L.on : L.off, shakeOn ? C.ok : C.dim, { bold: true, click: toggleShake }),
      sp(' ]', C.amber, { click: toggleShake })
    ]);
    addLine(14, [sp(L.builderEnd, C.com)]);
    addLine(15, [
      sp(L.apply, C.ok, { click: function () { applyMatchup('MANUAL'); } }),
      sp('   // ', C.com),
      sp(matchupSummaryUI(), C.com)
    ]);

    addLine(16, [sp(L.runtime, C.com)]);
    addLine(17, [sp(L.keys, C.com)]);
    addLine(18, [
      sp(L.limit, C.id), sp(' = ', C.pun), sp(String(game.matchLimit), C.num),
      sp('; // ', C.com), sp(L.shrink, C.id), sp(' = ', C.pun), sp(String(game.shrinkStart), C.num), sp('s', C.pun)
    ]);
    addLine(19, [
      sp(L.world, C.id), sp(' = { ', C.pun),
      sp(L.worldW, C.str), sp(': ', C.pun), sp('960', C.num), sp(', ', C.pun),
      sp(L.worldH, C.str), sp(': ', C.pun), sp('540', C.num), sp(' };', C.pun),
      sp(' // 16:9', C.com)
    ]);

    var live = sp(liveText(), C.com);
    liveLine = live;
    addLine(20, [live]);
  }

  function counterNodes(id, name) {
    return [
      sp(name, C.str),
      sp(': ', C.pun),
      sp('[ - ]', C.amber, { click: function () { bumpCount(id, -1); } }),
      sp(' ' + (counts[id] || 0) + ' ', C.num, { bold: true }),
      sp('[ + ]', C.amber, { click: function () { bumpCount(id, 1); } })
    ];
  }

  function bindLine(li, fn) {
    li.style.cursor = 'pointer';
    li.addEventListener('click', fn);
  }

  function liveText() {
    var alive = 0;
    for (var i = 0; i < game.fighters.length; i++) if (game.fighters[i].alive) alive++;
    var state = game.finished ? 'done' : (game.paused ? 'paused' : (game.running ? 'running' : 'idle'));
    if (isKo()) {
      return '// 상태=' + (STATE_KO[state] || state) + ' · 경기=' + modeName(gameMode) +
        ' · 개체=' + alive + '/' + game.fighters.length +
        ' · 경과=' + game.time.toFixed(1) + '초' +
        ' · 배속=' + speed + '배' +
        ' · 글자=' + cellPx + 'px' +
        ' · 프레임=' + fpsMode;
    }
    return '// state=' + state + ' mode=' + gameMode + ' units=' + game.fighters.length + ' alive=' + alive +
      ' t=' + game.time.toFixed(1) + 's speed=' + speed + 'x' +
      ' cell=' + cellPx + 'px fps=' + fpsMode;
  }

  function refresh() {
    renderCode();
  }

  /* ---------- 전투 로그 ---------- */

  var LOG_MAX = 70;

  function fmtTime(t) {
    var m = Math.floor(t / 60);
    var s = t - m * 60;
    return '[' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(1) + ']';
  }

  /* 사용자가 위로 올려 지난 로그를 보는 중이면 바닥 고정을 잠시 풀어준다 */
  function atBottom() {
    if (!logWrap) return true;
    return logWrap.scrollHeight - logWrap.scrollTop - logWrap.clientHeight < 24;
  }

  function stickToBottom() {
    var box = logWrap || logEl;
    if (!box) return;
    /* 레이아웃이 갱신된 뒤 높이를 계산해 맨 아래 행까지 보이게 한다 */
    box.scrollTop = box.scrollHeight;
    if (logWrap && logEl) logWrap.scrollTop = logEl.offsetTop + logEl.offsetHeight;
  }

  var LOG_TONE = { time: '#5c5c5c', sys: '#8a8a8a', hit: '#b8b8b8', warn: '#f0f0f0' };

  function pushLog(text, kind) {
    var pinned = atBottom();
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;white-space:pre-wrap;word-break:break-word;padding:1px 0;';

    var no = document.createElement('span');
    logSeq = (logSeq % 999) + 1;
    no.textContent = logSeq < 10 ? '0' + logSeq : String(logSeq);
    no.style.cssText = 'flex:0 0 24px;text-align:right;color:' + LOG_TONE.time + ';user-select:none;';

    /* 로그는 색상 없이 회색 밝기 단계로만 구분한다(시각·번호 < 시스템 < 전투 < 경고).
       경고(탈락·서든데스·오류)만 가장 밝게 두어 훑어볼 때 눈에 걸리게 한다. */
    var ts = document.createElement('span');
    ts.textContent = fmtTime(game.time);
    ts.style.cssText = 'flex:0 0 auto;color:' + LOG_TONE.time + ';';

    var txt = document.createElement('span');
    txt.textContent = text;
    txt.style.color = LOG_TONE[kind] || LOG_TONE.sys;
    txt.style.flex = '1';
    txt.style.minWidth = '0';

    row.appendChild(no);
    row.appendChild(ts);
    row.appendChild(txt);
    logEl.appendChild(row);

    while (logEl.childNodes.length > LOG_MAX) logEl.removeChild(logEl.firstChild);
    if (pinned) stickToBottom();
  }

  game.onLog = function (text, kind) {
    pushLog(text, kind);
  };

  game.onFinish = function () {
    actionIdx = 0;
    refresh();
  };

  /* ---------- 텔레메트리 (파이터 HP 요약) ---------- */

  function bar(ratio) {
    var segs = 10;
    var on = Math.round(Math.max(0, Math.min(1, ratio)) * segs);
    var out = '';
    for (var i = 0; i < segs; i++) out += i < on ? '█' : '░';
    return out;
  }

  /* 스킬 게이지 바 — 체력 바와 다른 색·다른 칸수로 구분한다 */
  function barN(ratio, segs) {
    var on = Math.round(Math.max(0, Math.min(1, ratio)) * segs);
    var out = '';
    for (var i = 0; i < segs; i++) out += i < on ? '▰' : '▱';
    return out;
  }

  function renderUnits() {
    unitsEl.textContent = '';
    var list = game.fighters;

    if (!list.length) {
      var empty = document.createElement('div');
      empty.textContent = '// NO_UNITS // click [▶ RUN]';
      empty.style.cssText = 'color:#5c5c5c;font-size:10px;padding:2px 0;';
      unitsEl.appendChild(empty);
      return;
    }

    for (var i = 0; i < list.length; i++) {
      if (i >= 10) break;
      var f = list[i];
      var ratio = f.maxHp > 0 ? f.hp / f.maxHp : 0;
      if (!f.alive) ratio = 0;

      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:baseline;gap:6px;font-size:10px;line-height:1.45;white-space:nowrap;';

      var name = document.createElement('span');
      name.textContent = f.label;
      name.style.cssText = 'flex:0 0 92px;overflow:hidden;text-overflow:ellipsis;';
      name.style.color = f.alive ? f.color : '#444444';

      var track = document.createElement('span');
      track.textContent = bar(ratio);
      track.style.color = ratio > 0.5 ? C.ok : (ratio > 0.22 ? C.amber : C.warn);

      /* 스킬 게이지: 체력 옆에 다른 색 막대로 표시. 완충되면 흰색 굵게 */
      var gaugeRatio = f.alive ? Math.max(0, Math.min(1, f.gauge || 0)) : 0;
      var gtrack = document.createElement('span');
      gtrack.textContent = barN(gaugeRatio, 6);
      gtrack.style.cssText = 'flex:0 0 auto;color:' +
        (f.alive ? (f.gaugeReady ? '#ffffff' : (f.skillColor || C.amber)) : '#444444') + ';' +
        (f.gaugeReady ? 'font-weight:700;' : '');
      gtrack.title = (f.skillName || 'SKILL') + ' ' + Math.round(gaugeRatio * 100) + '%';

      var val = document.createElement('span');
      val.textContent = Math.max(0, Math.ceil(f.hp)) + '/' + f.maxHp;
      val.style.cssText = 'flex:0 0 62px;text-align:right;color:' + (f.alive ? '#9a9a9a' : '#444444') + ';';

      row.appendChild(name);
      row.appendChild(track);
      row.appendChild(gtrack);
      row.appendChild(val);
      unitsEl.appendChild(row);
    }
  }

  /* ---------- 상태 바 ---------- */

  var lastLeft = '';
  var lastRight = '';

  function two(n) { return n < 10 ? '0' + n : String(n); }

  function updateStatusBar() {
    var survivors = {};
    var count = 0;
    for (var i = 0; i < game.fighters.length; i++) {
      var f = game.fighters[i];
      if (!f.alive) continue;
      if (!survivors[f.teamId]) { survivors[f.teamId] = true; count++; }
    }

    /* 경기 종료 시각까지 하나의 카운트다운으로 센다 — 서든데스 시작에서 값이 튀지 않는다.
       이 시계는 경기 종료까지 남은 시간이므로 'TIME'으로 적고, 서든데스는 시작된 뒤에만 표시한다. */
    var remain = Math.max(0, game.matchLimit - game.time);
    var clock = two(Math.floor(remain / 60)) + ':' + two(Math.floor(remain % 60));
    var tail = ' | TIME: ' + clock + (game.time > game.shrinkStart ? ' | SUDDEN_DEATH' : '') + ']';

    var left;
    if (game.teamMode) {
      var vs = [];
      for (var tq = 0; tq < TYPES.length; tq++) {
        var aliveN = 0;
        for (var fq = 0; fq < game.fighters.length; fq++) {
          var ff = game.fighters[fq];
          if (ff.alive && ff.typeId === TYPES[tq].id) aliveN++;
        }
        if (aliveN > 0) vs.push(TYPES[tq].tag + '(' + aliveN + ')');
      }
      left = '[TEAM: ' + (vs.length ? vs.join(' vs ') : 'NONE') + tail;
    } else {
      left = '[SURVIVORS: ' + count + tail;
    }
    if (left !== lastLeft) {
      lastLeft = left;
      sbLeft.textContent = left;
    }

    var state = game.finished ? 'done' : (game.paused ? 'paused' : (game.running ? 'running' : 'idle'));
    var right = state + ' • ' + (fps > 0 ? fps + ' fps' : '-- fps') + ' [FPS:' + fpsMode + ']';
    if (right !== lastRight) {
      lastRight = right;
      sbRight.textContent = right;
      sbRight.className = 'sb-right' + (game.finished ? ' warn' : (game.running && !game.paused ? ' run' : ''));
    }
  }

  /* ---------- 화면 크기 ---------- */

  function fit() {
    var rect = pane.getBoundingClientRect();
    var w = Math.max(200, Math.floor(rect.width));
    var h = Math.max(120, Math.floor(rect.height));
    game.resize(w, h);
  }

  if (window.ResizeObserver) {
    new ResizeObserver(fit).observe(pane);
  }
  window.addEventListener('resize', fit);
  fit();

  /* ---------- 키보드 ---------- */

  window.addEventListener('keydown', function (ev) {
    /* 타이틀 화면이 떠 있는 동안 키 입력은 타이틀 모듈이 처리한다 */
    if (WBF.Title && WBF.Title.isActive()) return;
    /* 튜토리얼 안내 중에는 경기를 시작·정지·리셋하지 않는다(Esc는 튜토리얼이 처리) */
    if (WBF.Tutorial && WBF.Tutorial.isActive() &&
      (ev.code === 'Space' || ev.key === 'Enter' || ev.key === 'r' || ev.key === 'R')) {
      ev.preventDefault();
      return;
    }
    var tag = ev.target ? ev.target.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (ev.key === 'l' || ev.key === 'L') {
      setLite(!lite, false);
      return;
    }
    if ((ev.key === 'k' || ev.key === 'K') && game.renderer && game.renderer.setArtShade) {
      /* 셰이딩 아트 시제품 비교: 구운 시트 <-> 기존 문자 시트 */
      game.renderer.setArtShade(!game.renderer.artShade);
      pushLog('ART_MODE = ' + (game.renderer.artShade ? 'SHADED' : 'SHEET') + ' // [K] toggle', 'sys');
      return;
    }
    if (ev.code === 'Space') {
      ev.preventDefault();
      /* 경기가 끝났거나 멈춰 있으면 Enter처럼 다시 시작, 진행 중이면 일시정지 */
      if (game.finished || !game.running) startMatch();
      else togglePause();
    } else if (ev.key === 'r' || ev.key === 'R') {
      resetMatch();
    } else if (ev.key === 'Enter') {
      startMatch();
    }
  });

  /* ---------- 저사양 모드 ----------
     여백 파동장(셀 수천 개)이 가장 무거워서 저사양 모드에서는 여백 파동장을 아예 그리지 않는다.
     경기장·파이터·타이틀은 그대로다. L 키로 켜고 끄며, ?lite=1 로 시작할 수도 있고,
     경기 중 프레임이 목표보다 계속 낮으면 한 번 자동으로 켠다(자동으로 끄지는 않는다). */
  var lite = /[?&]lite=1(&|$)/.test(window.location.search);
  var slowSamples = 0;
  var liteAutoDone = false;

  function setLite(on, auto) {
    lite = !!on;
    if (auto) liteAutoDone = true;
    if (game.renderer && game.renderer.setLite) game.renderer.setLite(lite);
    pushLog('LITE_MODE = ' + (lite ? 'ON' : 'OFF') + (auto ? ' (AUTO: low FPS)' : '') + ' // [L] toggle', 'sys');
  }
  if (lite && game.renderer && game.renderer.setLite) game.renderer.setLite(true);

  /* ---------- 루프 ---------- */

  function loop(now) {
    requestAnimationFrame(loop);
    /* 배경 드론: 경기 진행 중 1, 서든데스 2, 그 밖(대기·일시정지·종료) 0. 상태가 바뀔 때만 움직인다.
       타이틀이 떠 있는 동안에는 타이틀 모듈이 드론(3 = 타이틀 대기)을 맡는다. */
    if (!(WBF.Title && WBF.Title.isActive && WBF.Title.isActive())) {
      WBF.Audio.ambience(game.running && !game.paused && !game.finished ?
        (game.time > game.shrinkStart ? 2 : 1) : 0);
    }
    if (!last) last = now;
    var delta = (now - last) / 1000;
    last = now;
    if (delta > 0.1) delta = 0.1;

    if (game.running && !game.paused) {
      acc += delta * speed;
      var guard = 0;
      while (acc >= STEP && guard < 24) {
        game.step(STEP);
        acc -= STEP;
        guard++;
        if (game.finished) break;
      }
      if (guard >= 24) acc = 0;
    } else if (game.finished && !game.paused) {
      /* 경기 종료 뒤에도 살아 있던 스파크·연기가 허공에 얼지 않도록 효과 레이어를 계속 갱신한다.
         step()은 finished 상태에서 물리·판정·시간을 멈추고 이펙트·빔·실루엣만 진행한다. */
      acc += delta;
      var guardFx = 0;
      while (acc >= STEP && guardFx < 24) {
        game.step(STEP);
        acc -= STEP;
        guardFx++;
      }
      if (guardFx >= 24) acc = 0;
    } else {
      acc = 0;
    }

    /* 렌더 주기만 FPS 모드에 맞춰 제한 — 물리 고정 스텝은 그대로 진행 */
    var gap = 1000 / fpsMode;
    if (now - renderAt < gap - 1) return;
    renderAt = now;

    /* 타이틀 화면이 떠 있는 동안에는 경기장 렌더·텔레메트리 갱신을 건너뛴다.
       단, 커튼이 걷히는 동안에는 뒤의 게임 화면이 보여야 하므로 그린다. */
    var titleCover = !!(WBF.Title && WBF.Title.isActive() && !WBF.Title.isRevealing());
    if (!titleCover) {
      game.render(now);
      updateStatusBar();

      if (now - lastUnitsAt > 220) {
        lastUnitsAt = now;
        renderUnits();
        if (liveLine) liveLine.textContent = liveText();
      }
    }

    frames++;
    if (now - fpsAt >= 500) {
      fps = Math.round((frames * 1000) / (now - fpsAt));
      frames = 0;
      fpsAt = now;
      /* 경기 중 프레임이 목표의 65% 아래로 6번(약 3초) 연속이면 저사양 모드를 자동으로 켠다 */
      if (!lite && !liteAutoDone && !titleCover && game.running && !game.paused && !document.hidden &&
        fps < fpsMode * 0.65) {
        if (++slowSamples >= 6) setLite(true, true);
      } else {
        slowSamples = 0;
      }
    }
  }

  /* ---------- 언어 토글 ---------- */

  var editorTag = document.getElementById('editorTag');
  var editorHint = document.getElementById('editorHint');
  var editorPane = document.getElementById('editorPane');
  var langOpts = document.querySelectorAll('#langToggle .lang-opt');

  function applyLangUI() {
    var L = LABELS[LANG];
    if (editorTag) editorTag.textContent = L.fileTag;
    if (editorHint) editorHint.textContent = L.hint;
    /* 스크린리더가 설정 패널의 언어를 알 수 있게 패널에만 lang을 건다 */
    if (editorPane) editorPane.lang = LANG;
    for (var i = 0; i < langOpts.length; i++) {
      var b = langOpts[i];
      var on = b.getAttribute('data-lang') === LANG;
      b.className = 'lang-opt' + (on ? ' on' : '');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function setLang(next) {
    if (next !== 'ko' && next !== 'en') return;
    if (LANG === next) return;
    LANG = next;
    /* 인게임 문구도 같은 언어를 따른다 */
    game.lang = next;
    applyLangUI();
    refresh();
  }

  for (var lo = 0; lo < langOpts.length; lo++) {
    (function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        setLang(btn.getAttribute('data-lang'));
      });
    })(langOpts[lo]);
  }

  applyLangUI();

  /* ---------- 부트 ---------- */

  game.cellPx = cellPx;
  game.asciiMode = asciiMode;
  game.shakeEnabled = shakeOn;
  WBF.Audio.setMuted(!soundOn);
  /* 기본 대진 = 1v1 듀얼(무작위 2종 각 1기) */
  configureMode('1V1_DUEL');
  game.setup(buildConfig());
  actionIdx = 0;
  refresh();
  renderUnits();
  updateStatusBar();
  syncFpsUI();
  pushLog('BOOT_OK // MODE=' + gameMode + ' // RENDERER=' + (asciiMode ? 'ASCII' : 'BLOCK') + ' // CELL=' + cellPx + 'px // FPS=' + fpsMode + ' // TEAM=' + (teamMode ? 'ON' : 'OFF') + ' SHAKE=' + (shakeOn ? 'ON' : 'OFF'), 'sys');
  pushLog('STANDBY // press [ENTER]/[SPACE] or click [▶ RUN]', null);

  /* 튜토리얼이 경기를 세워 두고 안내한 뒤 직접 시작할 수 있게 하는 훅 */
  window.WBF.App = {
    game: game,
    /* 설정만 적용하고 경기는 시작하지 않는다(대기 상태) */
    standby: function () { resetMatch(); },
    isRunning: function () { return !!(game.running && !game.paused && !game.finished); },
    pause: function () {
      if (game.running && !game.finished && !game.paused) {
        game.paused = true;
        actionIdx = 1;
        refresh();
      }
    },
    resume: function () {
      if (game.paused && !game.finished) {
        game.paused = false;
        actionIdx = 0;
        refresh();
      }
    },
    /* 튜토리얼이 배속 설정을 실제로 낮춰 천천히 보여 줄 때 쓴다 */
    setSpeed: function (value) {
      var idx = SPEEDS.indexOf(Number(value));
      if (idx < 0) return false;
      setSpeedIdx(idx);
      return true;
    },
    speed: function () { return speed; },
    /* 튜토리얼용 고정 대진 — ids는 1기씩 내보낼 클래스 두 개(예: ['blade', 'railgun']).
       쇼케이스는 늘 같은 자리·같은 발사 각도로 시작한다(fixedSpawn). */
    playShowcase: function (ids) {
      if (game.running && !game.finished) return;
      if (!ids || ids.length < 2) ids = ['blade', 'railgun'];
      gameMode = '1V1_DUEL';
      teamMode = false;
      game.teamMode = false;
      var c = { blade: 0, railgun: 0, juggernaut: 0, splitter: 0 };
      var tags = [];
      for (var i = 0; i < ids.length; i++) {
        c[ids[i]] = 1;
        var ty = WBF.getType(ids[i]);
        tags.push((ty ? ty.tag : ids[i].toUpperCase()) + ' x1');
      }
      setCounts(c);
      pushLog('TUTORIAL_MATCH // ' + tags.join(' vs '), 'sys');
      startMatch(true);
    }
  };

  /* 타이틀 화면의 엔터/클릭 → 게임 화면으로 진입한다.
     튜토리얼이 도는 동안에는 경기를 대기 상태로 두고, 안내가 끝난 뒤 튜토리얼이 직접 시작한다. */
  function enterGame() {
    gameMode = '1V1_DUEL';
    configureMode('1V1_DUEL');
    var guiding = !!(WBF.Tutorial && WBF.Tutorial.start(LANG));
    if (guiding) resetMatch();
    else startMatch();
  }

  if (WBF.Title) WBF.Title.boot({ onStart: enterGame });

  requestAnimationFrame(loop);
})();
