/* 처음 경기를 시작할 때 한 번 도는 Swarm 커서 튜토리얼 시나리오
   경기를 대기 상태로 세워 두고 커서 3기(GUIDE · SCOUT · SYSTEM)가
   경기장 → 상태 바 → 설정 터미널 머리 → 설정 줄 → 스크롤 바 드래그 → 매치업 빌더 →
   적용 줄 → 키·제한 줄 → COMBAT_LOG → FPS 토글 → 텔레메트리 순으로 드래그 선택하며 설명하고,
   마지막에 고정 대진(BLADE x1 vs RAILGUN x1) 시뮬레이션을 시작해 중계·해설한 뒤 흩어진다.
   선택·클릭 연출은 보여 주기만 하며 실제 설정을 바꾸지 않는다(예외: 해설 중 배속 시연).
   Esc를 누르면 즉시 건너뛰고 그 자리에서 경기가 시작된다. */
window.WBF = window.WBF || {};

WBF.Tutorial = (function () {
  'use strict';

  var started = false;   /* 페이지 수명 동안 한 번만 자동 시작 */
  var sw = null;         /* 현재 실행 중인 Swarm 컨트롤러 */
  var token = 0;

  var COLORS = { guide: '#33ff66', scout: '#ffb000', sys: '#7fb8ff' };

  /* 경기장(②) 선택 연출 방식.
     'flash' = 눌림(띠용) 없이, 선택이 끝난 자리가 흰색으로 짧게 점멸하는 강조
     'bounce' = 예전처럼 대상이 0.986배로 쫀득하게 눌리는 손맛
     예전 모션이 그리우면 이 값만 'bounce'로 바꾸면 그대로 되돌아간다. */
  var STAGE_MOTION = 'flash';

  var TEXT = {
    ko: {
      guide: 'GUIDE', scout: 'SCOUT', sys: 'SYSTEM',
      intro: '조작 없이 자동으로 싸우는 관전 시뮬레이션입니다. 세 커서가 화면을 짚어 드릴게요.',
      whisper: '(ESC를 누르면 튜토리얼을 스킵할 수 있어요!)',
      arena: '경기장은 16:9. 파이터는 핀볼처럼 벽에 튕기며 스스로 싸웁니다.',
      status: '상태 바에는 살아 있는 팀 수와 경기 종료까지 남은 시간이 흐릅니다.',
      head: '설정은 이 터미널에서 클릭으로 바로 바꿉니다. 지금은 경기가 대기 상태입니다.',
      action: '동작 줄은 실행·일시정지·리셋, 배속은 0.5~5배입니다. 배속은 원하는 값을 바로 클릭하면 됩니다.',
      cell: '글자_크기는 아스키 밀도, 소리는 효과음 켜기/끄기입니다.',
      spawn: '출전_파이터 수 · 경기_모드 · 렌더_모드 · 프레임_모드를 한 묶음으로 봐 주세요.',
      scroll: '아래 설정은 스크롤 바 썸을 잡아 내려야 보입니다. 이렇게 끌면 됩니다.',
      builder: '매치업 빌더에서 파이터 수를 직접 짜고, 팀 모드·화면 흔들림을 켜고 끕니다.',
      apply: '초기화/적용을 누르면 지금 대진 그대로 새 경기가 시작됩니다.',
      keys: '키 안내와 경기 제한. 30초가 지나면 벽이 좁혀지는 서든 데스가 시작됩니다.',
      log: '오른쪽은 실시간 전투 로그. 타격·스킬·체력 변화가 계속 쌓입니다.',
      fps: '화면 갱신은 30 / 60 중에 고릅니다. 물리 판정은 1/60초 고정이라 결과는 같아요.',
      units: '이 줄이 파이터별 체력과 스킬 게이지입니다. 게이지가 차면 충돌 순간 스킬이 터집니다.',
      start: '그럼 이제 진짜 경기를 시작합니다. BLADE 대 RAILGUN!',
      c1: '경기 시작! 벽에 튕길 때마다 스킬 게이지가 더 빨리 찹니다.',
      c2: '게이지가 가득 차면 다음 충돌에서 고유 스킬이 나갑니다.',
      c3: '레일건은 충전을 시작하면 3초 동안 거의 멈춰 서서 조준합니다.',
      speedUse: '앞에서 본 배속을 여기서 써 보겠습니다. 0.5배로 낮추면 스킬 충전 장면을 천천히 볼 수 있어요.',
      slowWatch: '어때요? 이렇게 보면 스킬이 차오르는 장면이 훨씬 세밀하게 보이죠?',
      speedBack: '좋습니다. 배속은 다시 1배로 돌려 두겠습니다.',
      c4: '즐겁게 관전하세요. 설정은 언제든 클릭 한 번으로 바꿀 수 있습니다!',
      L_arena: 'ARENA',
      L_status: 'STATUS_BAR',
      L_head: 'TERMINAL',
      L_action: 'L2 · 동작 / 배속',
      L_speed: 'L3 · 배속',
      L_cell: 'L4 · 밀도 / 소리',
      L_spawn: 'L6-9 · 파이터 / 모드',
      L_builder: 'L10-14 · 매치업 빌더',
      L_apply: 'L15 · 적용',
      L_keys: 'L16-19 · 키 / 제한',
      L_log: 'COMBAT_LOG',
      L_fps: 'FPS 30 / 60',
      L_units: 'TELEMETRY'
    },
    en: {
      guide: 'GUIDE', scout: 'SCOUT', sys: 'SYSTEM',
      intro: 'A spectator sim — the fighters move on their own. These cursors will point things out.',
      whisper: '(Press ESC to skip the tutorial!)',
      arena: 'The arena is 16:9. Fighters ricochet off walls like pinballs and fight by themselves.',
      status: 'The status bar shows surviving teams and the time left in the match.',
      head: 'Every setting is clicked right here in this terminal. The match is on standby now.',
      action: 'ACTION cycles run / pause / reset, SIM_SPEED goes 0.5-5x. Each click steps to the next value.',
      cell: 'ASCII_CELL_PX sets glyph density, SOUND_FX toggles the synth effects.',
      spawn: 'SPAWN_FIGHTERS · GAME_MODE · RENDER_MODE · FPS_MODE — read them as one block.',
      scroll: 'The rest of the settings sit below. Drag the scroll thumb like this to reach them.',
      builder: 'MATCHUP_BUILDER sets fighter counts by hand and toggles TEAM_MODE and SHAKE.',
      apply: '[RESET / APPLY] starts a fresh match with the matchup you built.',
      keys: 'Key hints and MATCH_LIMIT. At 30s the walls close in — sudden death.',
      log: 'This is the live combat log. Hits, skills and HP changes pile up here.',
      fps: 'Pick 30 or 60 redraws per second. Physics stays on a fixed 1/60 step either way.',
      units: 'HP and skill gauge per fighter. Once the gauge fills, the class skill fires on collision.',
      start: 'Time for the real match. BLADE versus RAILGUN!',
      c1: 'Match on! Every wall bounce charges the skill gauge faster.',
      c2: 'When the gauge is full, the next collision fires the class skill.',
      c3: 'Once RAILGUN starts charging it nearly stops for 3 seconds to line up the shot.',
      speedUse: 'Here is the speed setting from earlier. Dropping it to 0.5x lets us watch the charge-up slowly.',
      slowWatch: 'See? At 0.5x the charge-up is far easier to follow in detail.',
      speedBack: 'Good — putting the speed back to 1x.',
      c4: 'Enjoy the show — every setting is one click away!',
      L_arena: 'ARENA',
      L_status: 'STATUS_BAR',
      L_head: 'TERMINAL',
      L_action: 'L2 · ACTION / SPEED',
      L_speed: 'L3 · SIM_SPEED',
      L_cell: 'L4 · CELL / SOUND',
      L_spawn: 'L6-9 · SPAWN / MODE',
      L_builder: 'L10-14 · MATCHUP BUILDER',
      L_apply: 'L15 · APPLY',
      L_keys: 'L16-19 · KEYS / LIMIT',
      L_log: 'COMBAT_LOG',
      L_fps: 'FPS 30 / 60',
      L_units: 'TELEMETRY'
    }
  };

  /* 설정 패널의 현재 언어를 따른다(안내 중 토글해도 문구가 바뀐다) */
  function currentLang() {
    var on = document.querySelector('#langToggle .lang-opt.on');
    var v = on ? on.getAttribute('data-lang') : 'ko';
    return v === 'en' ? 'en' : 'ko';
  }

  /* 타이틀 커튼이 다 걷힌 뒤에 시작한다 */
  function waitTitle(cb) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var busy = !!(WBF.Title && WBF.Title.isActive());
      if (!busy || tries > 60) {
        clearInterval(timer);
        cb();
      }
    }, 100);
  }

  function run(lang) {
    if (!WBF.Swarm) return;
    var my = ++token;
    var swc = WBF.Swarm.create();
    sw = swc;
    var dead = false;
    var lastSpeaker = 'guide';   /* 바로 앞에서 설명을 마친 커서 — 스크롤이 필요할 때 썸을 잡는다 */

    function T() { return TEXT[currentLang()] || TEXT.ko; }
    function alive() { return !dead && my === token && sw === swc; }

    function wait(ms) {
      return new Promise(function (res) { setTimeout(res, Math.max(0, Math.round(ms))); });
    }

    /* 한 단계가 응답하지 않아도 나머지 안내가 얼어붙지 않게 상한을 둔다 */
    function cap(p, ms) {
      return Promise.race([
        Promise.resolve(p).catch(function () { return null; }),
        wait(ms)
      ]);
    }

    var codeEl = document.getElementById('code');
    var arenaEl = document.getElementById('arenaPane');
    var sbLeft = document.getElementById('sbLeft');
    var fpsEl = document.getElementById('sbFps');
    var unitsEl = document.getElementById('units');
    var termHead = document.querySelector('#editorPane .pane-head');
    var logHead = document.querySelector('#telemetryPane .pane-head');

    function finish() {
      window.removeEventListener('keydown', onKey);
      if (my === token && sw === swc) sw = null;
    }

    function restoreScroll() {
      try { swc.hideScrollThumb(); } catch (e1) { }
      try { swc.hideBox(); } catch (e2) { }
      if (codeEl) codeEl.scrollTop = 0;
    }

    function startShowcase() {
      if (WBF.App && WBF.App.playShowcase) WBF.App.playShowcase();
    }

    function skip() {
      if (dead) return;
      dead = true;
      restoreScroll();
      /* 배속 시연 중에 건너뛰어도 원래 배속으로 돌려 둔다 */
      if (WBF.App && WBF.App.setSpeed) WBF.App.setSpeed(1);
      swc.dismissAll();
      /* 안내를 건너뛰어도 그 자리에서 경기는 시작된다 */
      startShowcase();
      finish();
    }

    function onKey(ev) {
      if (ev.key === 'Escape' || ev.key === 'Esc' || ev.code === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        skip();
      }
    }
    window.addEventListener('keydown', onKey);

    /* 요소 하나를 선택 영역 대상으로 바꾼다(여백을 조금 준다) */
    function elRect(el, pad) {
      if (!el || !el.getBoundingClientRect) return null;
      var rr = el.getBoundingClientRect();
      if (rr.width < 6 || rr.height < 6) return null;
      var p = typeof pad === 'number' ? pad : 3;
      return {
        left: rr.left - p, top: rr.top - p,
        width: rr.width + p * 2, height: rr.height + p * 2,
        bounceEl: el
      };
    }

    /* 지정 줄(from~to)이 화면 가운데에 오는 스크롤 비율(0~1).
       썸을 끌어 옮길 목표를 미리 계산해 두면 다음 단계가 화면을 순간이동시키지 않는다. */
    function scrollRatioFor(from, to) {
      if (!codeEl) return null;
      var a = codeEl.children[from - 1];
      var b = (to ? codeEl.children[to - 1] : a) || a;
      if (!a || !b) return null;
      var maxScroll = codeEl.scrollHeight - codeEl.clientHeight;
      if (!(maxScroll > 1)) return null;
      var cr = codeEl.getBoundingClientRect();
      var ra = a.getBoundingClientRect();
      var rb = b.getBoundingClientRect();
      var top = Math.min(ra.top, rb.top);
      var bottom = Math.max(ra.bottom, rb.bottom);
      var docTop = (top - cr.top) + codeEl.scrollTop;
      var target = docTop - (codeEl.clientHeight - (bottom - top)) * 0.5;
      return target < 0 ? 0 : (target > maxScroll ? 1 : target / maxScroll);
    }

    /* 설정 패널의 from~to 줄을 한 덩어리 사각형으로 잡는다(스크롤은 건드리지 않는다) */
    function rowRect(from, to) {
      if (!codeEl) return null;
      var a = codeEl.children[from - 1];
      if (!a) return null;
      var b = (to ? codeEl.children[to - 1] : a) || a;
      var ra = a.getBoundingClientRect();
      var rb = b.getBoundingClientRect();
      var left = Math.min(ra.left, rb.left);
      var top = Math.min(ra.top, rb.top);
      var right = Math.max(ra.right, rb.right);
      var bottom = Math.max(ra.bottom, rb.bottom);
      if (right - left < 8 || bottom - top < 4) return null;
      return {
        left: left, top: top, width: right - left, height: bottom - top,
        bounceEl: a
      };
    }

    /* 그 줄 묶음이 지금 패널 안에 다 보이는지 */
    function rowsVisible(from, to) {
      if (!codeEl) return true;
      var a = codeEl.children[from - 1];
      if (!a) return true;
      var b = (to ? codeEl.children[to - 1] : a) || a;
      var cr = codeEl.getBoundingClientRect();
      var ra = a.getBoundingClientRect();
      var rb = b.getBoundingClientRect();
      var top = Math.min(ra.top, rb.top);
      var bottom = Math.max(ra.bottom, rb.bottom);
      return top >= cr.top + 6 && bottom <= cr.bottom - 6;
    }

    /* 스크롤이 필요하면 '바로 앞에서 설명을 마친 커서'가 썸을 잡아 부드럽게 끌어 옮긴다.
       scrollIntoView처럼 화면을 순간이동시키지 않는다. */
    async function syncScroll(from, to) {
      if (!codeEl || !alive()) return;
      if (rowsVisible(from, to)) return;
      var target = scrollRatioFor(from, to);
      if (target === null) return;
      var maxScroll = codeEl.scrollHeight - codeEl.clientHeight;
      var cur = maxScroll > 1 ? codeEl.scrollTop / maxScroll : 0;
      if (!(Math.abs(target - cur) > 0.004)) return;
      var span = Math.abs(target - cur);
      var dur = Math.round(640 + span * 900);
      swc.hideBox();
      await cap(swc.scrollDrag(lastSpeaker, codeEl, { to: target, duration: dur, grabDuration: 420 }), dur + 1500);
      swc.hideScrollThumb();
      if (!alive()) return;
      await wait(170);
    }

    /* 줄 묶음 선택 + 설명 한 단계(필요하면 직전 커서가 먼저 스크롤을 맞춘다) */
    async function explainRows(ctx) {
      if (!alive() || !ctx) return false;
      /* noScroll: 다른 커서가 썸을 끄는 중이라 스크롤을 다시 잡지 않는다 */
      if (!ctx.noScroll) await syncScroll(ctx.from, ctx.to);
      if (!alive()) return false;
      /* follow: 스크롤이 움직이는 동안에도 선택 영역이 그 줄들을 따라가게 한다.
         첫 줄·끝 줄만 넘기면 중간 줄이 더 넓거나 좁을 때 합친 사각형이 실제 줄 묶음과
         어긋나므로, 범위 안의 모든 줄을 넘겨 매 프레임 전체 사각형을 다시 재게 한다.
         스크롤은 어느 단계에서든 일어날 수 있으므로(다음 단계가 썸을 끌거나 안내 중
         휠을 굴릴 때) 줄 묶음 선택은 항상 실제 줄을 따라가게 한다. */
      if (codeEl) {
        var lastRow = ctx.to || ctx.from;
        var fEls = [];
        for (var rn = ctx.from; rn <= lastRow; rn++) {
          var fe = codeEl.children[rn - 1];
          if (fe) fEls.push(fe);
        }
        if (fEls.length) ctx.followEls = fEls;
      }
      ctx.rect = rowRect(ctx.from, ctx.to);
      return explain(ctx);
    }

    /* 영역 드래그 선택 시연 — 왼쪽 위 모서리에서 반대 모서리로 끌어 선택 영역을 만든다 */
    function pick(id, rect, label, follow, opts) {
      var o = opts || {};
      if (!rect && !follow) return Promise.resolve(null);
      /* 요소 하나를 잡는 단계도 그 요소의 실제 사각형을 계속 따라간다. 처음 잰
         사각형만 쓰면 그 뒤 스크롤이 움직였을 때 상자만 제자리에 남는다. */
      var els = (follow && follow.length) ? follow
        : (rect && rect.bounceEl ? [rect.bounceEl] : null);
      return swc.selectBox(id, rect || {}, {
        grabDuration: 460,
        label: label,
        bounceEl: rect ? rect.bounceEl : (els ? els[0] : null),
        bounce: o.noBounce ? false : true,
        flash: !!o.flash,
        follow: els
      });
    }

    /* 선택 + 설명 한 단계 */
    async function explain(ctx) {
      if (!alive() || !ctx) return false;
      lastSpeaker = ctx.id;
      if (ctx.rect || ctx.followEls) {
        await cap(pick(ctx.id, ctx.rect, ctx.label, ctx.followEls, ctx), 2600);
        if (!alive()) return false;
      }
      var ms = ctx.ms || 3800;
      await cap(swc.say(ctx.id, ctx.text, ms), ms + 500);
      return alive();
    }

    (async function () {
      var r = arenaEl ? arenaEl.getBoundingClientRect() : null;
      var cx = r ? r.left + r.width * 0.5 : window.innerWidth * 0.5;
      var cy = r ? r.top + r.height * 0.5 : window.innerHeight * 0.4;

      /* 세 커서가 서로 다른 방향에서 날아 들어온다 */
      swc.spawn('guide', { name: T().guide, color: COLORS.guide, x: -80, y: window.innerHeight * 0.76 });
      swc.spawn('scout', { name: T().scout, color: COLORS.scout, x: window.innerWidth + 80, y: window.innerHeight * 0.2 });
      swc.spawn('sys', { name: T().sys, color: COLORS.sys, x: window.innerWidth + 80, y: window.innerHeight * 0.58 });

      await cap(Promise.all([
        swc.moveTo('guide', { x: cx - 170, y: cy + 74 }, { duration: 820, curve: -0.26 }),
        swc.moveTo('scout', { x: cx + 160, y: cy - 92 }, { duration: 900, curve: 0.22 }),
        swc.moveTo('sys', { x: cx + 58, y: cy + 132 }, { duration: 940, curve: -0.18 })
      ]), 1500);
      if (!alive()) return;

      /* ① 인트로 — GUIDE가 말하는 동안, 가만히 서 있던 SYSTEM이 반투명 속삭임 말풍선으로
         Esc 건너뛰기를 짧게 귀띔한다. 말풍선만 잠깐 떴다 사라지고 커서·경기 상태는 그대로다. */
      var introP = explain({ id: 'guide', text: T().intro, ms: 3400 });
      await cap(swc.say('sys', T().whisper, { persist: true, whisper: true }), 800);
      if (!alive()) return;
      await cap(wait(3300), 3500);
      if (!alive()) return;
      swc.hideBubble('sys');
      if (!await introP) return;

      /* ② 경기장 드래그 선택.
         STAGE_MOTION이 'flash'면 경기장이 커졌다 작아지는 눌림 없이 넘어가고,
         영역 선택이 끝난 그 자리가 흰색으로 짧게 점멸해 강조된다. */
      var arenaRect = r ? {
        left: r.left, top: r.top, width: r.width, height: r.height,
        bounceEl: arenaEl
      } : null;
      var arenaLabel = T().L_arena + (r ? ' · ' + Math.round(r.width) + ' × ' + Math.round(r.height) : ' · 16:9');
      if (!await explain({
        id: 'guide', rect: arenaRect, label: arenaLabel, text: T().arena, ms: 3800,
        noBounce: STAGE_MOTION === 'flash',
        flash: STAGE_MOTION === 'flash'
      })) return;

      /* ③ 상태 바 — 생존 수 · 서든 데스 */
      if (!await explain({ id: 'scout', rect: elRect(sbLeft), label: T().L_status, text: T().status, ms: 3600 })) return;

      /* ④ 설정 터미널 머리 */
      if (!await explain({ id: 'sys', rect: elRect(termHead), label: T().L_head, text: T().head, ms: 3800 })) return;

      /* ⑤ 동작 · 배속 줄 */
      if (!await explainRows({ id: 'guide', from: 2, to: 3, label: T().L_action, text: T().action, ms: 4000 })) return;

      /* ⑥ 글자_크기 · 소리 줄 */
      if (!await explainRows({ id: 'scout', from: 4, to: 5, label: T().L_cell, text: T().cell, ms: 3400 })) return;

      /* ⑦ 출전_파이터 ~ 프레임_모드 */
      if (!await explainRows({ id: 'sys', from: 6, to: 9, label: T().L_spawn, text: T().spawn, ms: 4000 })) return;

      /* ⑧ 스크롤 바 드래그 — 썸을 잡아 아래로 내려 설명하고, 말풍선이 어느 정도 찍힌
         뒤에 위로 다시 끌어 다음에 설명할 자리를 만든다. 되끌기가 거의 끝나갈 때
         (약 0.2초 남기고) ⑨를 맡을 커서가 그 자리에서 영역을 미리 잡기 시작해,
         스크롤과 선택이 동시에 뭉치지 않고 순서대로 이어지며 끝부분만 짧게 겹친다. */
      var builderP = null;
      if (codeEl && alive()) {
        swc.hideBox();
        var upTo = scrollRatioFor(10, 14);
        var upGrab = 360, upDur = 980, upLead = 200;

        /* 아래 끝까지 내리며 스크롤 시연 */
        await cap(swc.scrollDrag('guide', codeEl, { to: 1, duration: 1150, grabDuration: 380 }), 2500);
        if (!alive()) return;

        /* 설명 말풍선이 먼저 뜨고, 어느 정도 찍힌 뒤에 썸을 위로 다시 끈다.
           예전에는 말풍선과 되끌기가 같은 순간에 시작해 장면이 한꺼번에 뭉쳤다. */
        var sayP = cap(swc.say('guide', T().scroll, 3200), 3600);
        await cap(wait(820), 1100);
        if (!alive()) return;
        var upP = upTo === null ? Promise.resolve(null)
          : cap(swc.scrollDrag('guide', codeEl, { to: upTo, duration: upDur, grabDuration: upGrab }),
            upGrab + upDur + 700);

        /* 되끌기가 거의 끝나갈 때, 완전히 끝나기를 기다리지 않고
           다음 커서가 매치업 빌더 영역을 미리 잡기 시작한다(짧은 겹침). */
        await cap(wait(upGrab + upDur - upLead), 1800);
        if (!alive()) return;
        builderP = explainRows({
          id: 'sys', from: 10, to: 14, label: T().L_builder, text: T().builder, ms: 3900,
          follow: true, noScroll: true
        });

        await cap(Promise.all([upP, sayP]), 4800);
        if (!alive()) return;
        swc.hideScrollThumb();
      }

      /* ⑨ 매치업 빌더 — 스크롤과 겹쳐 시작한 선택 영역을 이어서 설명한다 */
      if (builderP) {
        await cap(builderP, 6400);
        if (!alive()) return;
      } else if (!await explainRows({ id: 'sys', from: 10, to: 14, label: T().L_builder, text: T().builder, ms: 3900 })) {
        return;
      }
      if (!alive()) return;

      /* ⑩ 초기화 / 적용 */
      if (!await explainRows({ id: 'guide', from: 15, to: 15, label: T().L_apply, text: T().apply, ms: 3400 })) return;

      /* ⑪ 키 안내 · 경기 제한 */
      if (!await explainRows({ id: 'scout', from: 16, to: 19, label: T().L_keys, text: T().keys, ms: 3800 })) return;

      /* ⑫ COMBAT_LOG */
      if (!await explain({ id: 'sys', rect: elRect(logHead), label: T().L_log, text: T().log, ms: 3600 })) return;

      /* ⑬ FPS 토글 */
      if (!await explain({ id: 'scout', rect: elRect(fpsEl), label: T().L_fps, text: T().fps, ms: 3800 })) return;

      /* ⑭ 텔레메트리 체력 · 스킬 게이지 */
      if (unitsEl && unitsEl.children.length) {
        if (!await explain({ id: 'guide', rect: elRect(unitsEl, 2), label: T().L_units, text: T().units, ms: 4000 })) return;
      }

      /* ⑮ 고정 대진 시뮬레이션 시작 */
      if (!await explain({ id: 'guide', text: T().start, ms: 2400 })) return;
      swc.hideBox();
      startShowcase();

      /* ⑯ 중계 · 해설 — 관전하러 경기장 가장자리로 흩어진다 */
      await cap(Promise.all([
        swc.moveTo('guide', { x: cx - (r ? r.width * 0.24 : 170), y: cy + (r ? r.height * 0.28 : 110) }, { duration: 720, curve: 0.2 }),
        swc.moveTo('scout', { x: cx + (r ? r.width * 0.26 : 170), y: cy - (r ? r.height * 0.24 : 100) }, { duration: 760, curve: -0.2 }),
        swc.moveTo('sys', { x: cx + (r ? r.width * 0.18 : 120), y: cy + (r ? r.height * 0.24 : 100) }, { duration: 800, curve: 0.16 })
      ]), 1300);
      if (!alive()) return;

      if (!await explain({ id: 'guide', text: T().c1, ms: 2800 })) return;
      if (!await explain({ id: 'scout', text: T().c2, ms: 2600 })) return;
      if (!await explain({ id: 'sys', text: T().c3, ms: 2600 })) return;

      /* ⑰ 스크롤을 다시 위로 — GUIDE가 말없이 썸을 끌어 배속 줄을 보이는 자리에 둔다 */
      if (codeEl && alive()) {
        swc.hideBox();
        await cap(swc.scrollDrag('guide', codeEl, { to: 0, duration: 1300, grabDuration: 420 }), 2300);
        swc.hideScrollThumb();
        if (!alive()) return;
      }

      /* ⑱ 아까 배운 배속을 실제로 낮춰 천천히 관전한다 */
      if (!await explainRows({ id: 'scout', from: 3, to: 3, label: T().L_speed, text: T().speedUse, ms: 3600 })) return;
      if (WBF.App && WBF.App.setSpeed) WBF.App.setSpeed(0.5);
      if (!alive()) return;
      swc.hideBox();
      if (!await explain({ id: 'sys', text: T().slowWatch, ms: 3200 })) return;
      if (WBF.App && WBF.App.setSpeed) WBF.App.setSpeed(1);
      if (!await explain({ id: 'guide', text: T().speedBack, ms: 2200 })) return;

      if (!await explain({ id: 'guide', text: T().c4, ms: 2800 })) return;

      /* ⑰ 인사하고 흩어짐 */
      await swc.dismissAll();
      restoreScroll();
      finish();
    })().catch(function () {
      if (!dead) {
        dead = true;
        try { swc.dismissAll(); } catch (e) { }
        finish();
      }
    });
  }

  /* 안내가 시작되면 true를 돌려줘 진입 파일이 경기를 대기 상태로 세울 수 있게 한다 */
  function start(lang) {
    if (started) return false;
    if (!WBF.Swarm) return false;
    started = true;
    var L = (lang === 'en') ? 'en' : 'ko';
    waitTitle(function () { run(L); });
    return true;
  }

  return {
    start: start,
    isActive: function () { return !!sw; },
    skip: function () { if (sw) sw.dismissAll(); }
  };
})();
