/* 물리 엔진 + 전투 규칙 + 초고밀도 유체(메타볼) 아스키 렌더링 */
window.WBF = window.WBF || {};

(function () {
  var TAU = Math.PI * 2;
  var W = WBF.world.W;
  var H = WBF.world.H;
  var WALL_T = 140;
  /* 벽 접촉 처리 상수 — 벽 타기(끼임) 방지 */
  var WALL_SKIN = 1.5;       /* 벽면에서 띄우는 최소 간격(px) */
  var WALL_MIN_N = 0.46;     /* 반사 후 보장할 최소 법선 속도 비율 */
  var WALL_SHALLOW_N = 0.62; /* 법선이 죽은(벽면 평행) 상태에서 강제 주입할 비율 */

  /* 스킬 게이지 충전량(0~1). 완충되면 적과 부딪히는 순간 고유 스킬이 나가고 게이지는 0이 된다 */
  var SKILL_CHARGE = 0.085;   /* 초당 자연 충전 */
  var SKILL_WALL_GAIN = 0.07; /* 벽 반사 1회 */
  var SKILL_HIT_GAIN = 0.05;  /* 적중 1회 */

  /* 클리어 연출 타이밍 — 렌더러(js/ascii.js)의 FIN_STEP_MS와 같은 값이어야 한다 */
  var FIN_STEP_MS = 85;       /* 저프레임 스텝(약 12fps) */
  var FIN_RING_PHASES = 14;   /* 링이 화면을 다 쓸고 나가는 스텝 수 */
  var BAN_STEP_MS = 70;       /* 배너 세분화 스텝 — 링(85ms)보다 잘게 나눠 더 매끄럽게 푼다 */
  var BAN_PHASES = 13;        /* 모자이크 → 선명 텍스트 스텝 수(BAN_BLOCKS 길이와 같다) */
  var BAN_BLOCKS = [28, 23, 19, 16, 13, 11, 9, 7, 6, 5, 4, 3, 2];
  var BAN_ZOOM0 = 0.42;       /* 중앙 줌 시작 배율 — 스텝마다 1.0까지 커진다 */

  function speedOf(b) { return Math.sqrt(b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y); }

  /* 점 → 선분 최단거리(관통 레이저 판정) */
  function segDist(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    var ex = x1 + dx * t - px;
    var ey = y1 + dy * t - py;
    return Math.sqrt(ex * ex + ey * ey);
  }

  function Game(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = 960;
    this.cssH = 540;
    this.view = { k: 1, ox: 0, oy: 0 };

    /* 문자 크기(px) 9~11 — 이 값으로 아스키 밀도가 바뀐다 */
    this.cellPx = 10;
    this.asciiMode = true;
    this.renderer = new WBF.Ascii.Renderer(this);

    this.engine = Matter.Engine.create();
    this.engine.gravity.x = 0;
    this.engine.gravity.y = 0;
    this.engine.gravity.scale = 0;
    this.engine.positionIterations = 8;
    this.engine.velocityIterations = 6;
    this.world = this.engine.world;

    this.effects = new WBF.Effects.Layer();

    this.fighters = [];
    this.bullets = [];
    this.beams = [];
    this.walls = [];
    this.inset = 0;
    this.wallInset = -1;
    this.time = 0;
    this.running = false;
    this.paused = false;
    this.finished = false;
    this.winner = null;
    this.finishFx = null;
    this.bannerKey = '';
    this.bannerData = null;
    this.bannerBox = null;
    this.maskCanvas = null;
    this.shake = 0;
    this.shakeAmp = 0;
    this.shakeT = 0;
    this.shakeEnabled = true;
    /* 화면 문구 표시 언어 — 설정 패널과 같은 값. 기본 한국어, 승리 배너만 영어 고정 */
    this.lang = 'ko';
    this.teamMode = false;
    this.hitStop = 0;
    this.warmup = 0;
    this.deathMul = 1;
    this.shrinkStart = 30;
    this.matchLimit = 58;
    this.maxInset = 190;
    this.pendingSplits = [];
    this.pendingGrow = [];
    this.onLog = null;
    this.onFinish = null;
    this.stats = { hp: 150, atk: 100, spd: 100 };
    this.labelSeq = {};
    this.hitLogAt = {};
    this.nextId = 1;

    var self = this;
    Matter.Events.on(this.engine, 'collisionStart', function (evt) { self.onCollisionStart(evt); });

    this.buildWalls(0);
  }

  /* ---------- 화면 비율 ---------- */

  Game.prototype.resize = function (cw, ch) {
    cw = Math.max(240, Math.floor(cw));
    ch = Math.max(160, Math.floor(ch));
    this.cssW = cw;
    this.cssH = ch;
    this.canvas.width = Math.round(cw * this.dpr);
    this.canvas.height = Math.round(ch * this.dpr);
    var k = Math.min(cw / W, ch / H);
    this.view = { k: k, ox: (cw - W * k) / 2, oy: (ch - H * k) / 2 };
    if (this.renderer) this.renderer.resize(cw, ch);
  };

  /* ---------- 월드 ---------- */

  Game.prototype.buildWalls = function (inset) {
    this.inset = inset;
    this.wallInset = Math.floor(inset);

    /* 이미 만든 벽은 위치만 옮긴다 — 본체 재생성·월드 재등록이 없어 서든데스 축소에서도 끊기지 않는다 */
    if (this.walls.length === 4) {
      Matter.Body.setPosition(this.walls[0], { x: inset - WALL_T / 2, y: H / 2 });
      Matter.Body.setPosition(this.walls[1], { x: W - inset + WALL_T / 2, y: H / 2 });
      Matter.Body.setPosition(this.walls[2], { x: W / 2, y: inset - WALL_T / 2 });
      Matter.Body.setPosition(this.walls[3], { x: W / 2, y: H - inset + WALL_T / 2 });
      return;
    }

    var opts = { isStatic: true, restitution: 1.02, friction: 0, label: 'wall' };
    var segs = [
      Matter.Bodies.rectangle(inset - WALL_T / 2, H / 2, WALL_T, H + WALL_T * 2, opts),
      Matter.Bodies.rectangle(W - inset + WALL_T / 2, H / 2, WALL_T, H + WALL_T * 2, opts),
      Matter.Bodies.rectangle(W / 2, inset - WALL_T / 2, W + WALL_T * 2, WALL_T, opts),
      Matter.Bodies.rectangle(W / 2, H - inset + WALL_T / 2, W + WALL_T * 2, WALL_T, opts)
    ];
    this.walls = segs;
    Matter.World.add(this.world, segs);
  };

  Game.prototype.makeBody = function (x, y, r) {
    return Matter.Bodies.circle(x, y, r, {
      restitution: 1.05,
      friction: 0,
      frictionAir: 0,
      frictionStatic: 0,
      density: 0.0014,
      label: 'fighter'
    });
  };

  Game.prototype.setup = function (config) {
    var i;
    for (i = 0; i < this.fighters.length; i++) Matter.World.remove(this.world, this.fighters[i].body);
    this.fighters = [];
    this.bullets = [];
    this.beams.length = 0;
    this.effects.clear();
    this.buildWalls(0);
    this.time = 0;
    this.deathMul = 1;
    this.deathAnnounced = false;
    this.shake = 0;
    this.shakeT = 0;
    /* 새 경기를 시작하면 이전 경기의 흔들림이 남지 않게 지운다 */
    this.shakeAmp = 0;
    this.shakeAt = 0;
    this.shakeDur = 0;
    this.hitStop = 0;
    this.warmup = 1.2;
    this.finished = false;
    this.winner = null;
    this.finishFx = null;
    this.bannerKey = '';
    this.bannerData = null;
    this.bannerBox = null;
    this.paused = false;
    this.running = false;
    this.pendingSplits = [];
    this.pendingGrow = [];
    this.labelSeq = {};
    this.hitLogAt = {};
    this.stats = config.stats || { hp: 150, atk: 100, spd: 100 };

    this.mode = config.mode || 'duel';
    var list = [];
    var j, t, n;

    if (this.mode === 'boss') {
      /* BOSS_RAID: 광전사 1기가 팀 0(보스), 나머지 전원이 팀 1(사냥꾼) — 아군 피해 없음 */
      for (i = 0; i < WBF.TYPES.length; i++) {
        t = WBF.TYPES[i];
        n = (config.counts && config.counts[t.id]) || 0;
        for (j = 0; j < n; j++) {
          if (t.id === 'juggernaut') list.push({ type: t, team: 0, opts: { radiusMul: 1.1, hpMul: 2.4, isBoss: true } });
          else list.push({ type: t, team: 1, opts: { hpMul: 0.9 } });
        }
      }
    } else {
      for (i = 0; i < WBF.TYPES.length; i++) {
        t = WBF.TYPES[i];
        n = (config.counts && config.counts[t.id]) || 0;
        for (j = 0; j < n; j++) list.push({ type: t, team: i, opts: null });
      }
    }

    /* TEAM_MODE ON: 같은 클래스 = 같은 팀(아군 피해 면제) / OFF: 개인전 */
    this.teamMode = !!config.teamMode;

    var total = list.length;
    var entry, f, ang, sx, sy, sp0, launch;

    if (this.mode === 'boss') {
      /* 보스는 좌측 중앙, 사냥꾼은 우측 세로 배치 후 보스를 향해 발사 */
      var hi = 0;
      for (i = 0; i < total; i++) {
        entry = list[i];
        if (entry.team === 0) {
          sx = W * 0.2;
          sy = H * 0.5;
          ang = 0;
        } else {
          sx = W * 0.8;
          sy = H * (0.22 + hi * 0.28);
          ang = Math.PI;
          hi++;
        }
        f = this.createFighter(entry.type, entry.team, sx, sy, this.stats, false, entry.opts);
        f.heading = ang;
        sp0 = (f.cruise || 10) * 1.05;
        Matter.Body.setVelocity(f.body, { x: Math.cos(ang) * sp0, y: Math.sin(ang) * sp0 });
      }
    } else {
      /* 외곽 균등 배치 + 서로 다른 대각선 발사(초반 엉킴 방지) */
      var rx = W * 0.34;
      var ry = H * 0.34;
      for (i = 0; i < total; i++) {
        entry = list[i];
        ang = -Math.PI / 2 + (TAU / Math.max(1, total)) * i;
        var teamId = this.teamMode ? entry.team : i;
        sx = W / 2 + Math.cos(ang) * rx;
        sy = H / 2 + Math.sin(ang) * ry;
        f = this.createFighter(entry.type, teamId, sx, sy, this.stats, false, entry.opts);
        var side = i % 2 === 0 ? 1 : -1;
        launch = ang + Math.PI + side * (0.42 + (i % 3) * 0.16);
        f.heading = launch;
        sp0 = (f.cruise || 10) * 1.15;
        Matter.Body.setVelocity(f.body, { x: Math.cos(launch) * sp0, y: Math.sin(launch) * sp0 });
      }
    }
  };

  Game.prototype.createFighter = function (type, teamId, x, y, stats, isChild, opts) {
    opts = opts || {};
    var radius = (isChild ? type.radius * 0.72 : type.radius) * (opts.radiusMul || 1);
    var hpScale = (stats && stats.hp ? stats.hp : 150) / 150;
    var maxHp = Math.round(type.hp * hpScale * (isChild ? 0.55 : 1) * (opts.hpMul || 1));
    var body = this.makeBody(x, y, radius);

    this.labelSeq[type.id] = (this.labelSeq[type.id] || 0) + 1;
    var seq = this.labelSeq[type.id];

    var f = {
      id: this.nextId++,
      type: type,
      typeId: type.id,
      teamId: teamId,
      isChild: !!isChild,
      isBoss: !!opts.isBoss,
      baseRadius: radius,
      trail: [],
      body: body,
      radius: radius,
      maxHp: maxHp,
      hp: maxHp,
      atkMul: (stats && stats.atk ? stats.atk : 100) / 100,
      spdMul: (stats && stats.spd ? stats.spd : 100) / 100,
      color: type.color,
      label: type.tag + '_' + (seq < 10 ? '0' + seq : seq),
      shortTag: (type.abbr || type.tag.slice(0, 3)) + '-' + seq,
      orbPhase: Math.random() * TAU,
      alive: true,
      removed: false,
      flashUntil: 0,
      roll: Math.random() * 10,
      squash: 0,
      bladeAngle: Math.random() * TAU,
      bladeHitAt: {},
      aim: 0,
      aimAngle: 0,
      fireCd: 0.9 + Math.random() * 1.1,
      sizeBonus: 0,
      kills: 0,
      /* 실루엣 회전 + 핀볼(직선 반사) 이동 상태 */
      shapeAngle: Math.random() * TAU,
      heading: Math.random() * TAU,
      cruise: type.cruise || 10,
      speedTarget: type.cruise || 10,
      skillCd: 0.8 + Math.random() * 1.0,
      /* 스킬 게이지 + 고유 스킬 상태 */
      gauge: 0,
      gaugeReady: false,
      skillName: type.skillName || 'SKILL',
      skillColor: type.skillColor || '#ffdf70',
      skillUse: 0,
      skillAimT: 0,
      skillChargeDur: 0,
      /* RAILGUN은 게이지가 늦게 차는 대신 충전 3초 후 큰 한 방을 쏜다 */
      chargeMul: type.id === 'railgun' ? 0.62 : 1,
      skillAimAngle: 0,
      skillTargetId: 0,
      slashT: 0,
      slashAng: 0,
      slamT: 0,
      lastGaugeWall: 0,
      dashT: 0,
      boostT: 0,
      recoilT: 0,
      recoilBoost: 1.35,
      hot: false,
      lastWallAt: 0,
      zigSign: Math.random() < 0.5 ? -1 : 1,
      flankSign: 1,
      coreBlobs: WBF.Shapes.cores(type.id)
    };
    body.gameRef = f;
    WBF.Fluid.attach(f);
    this.fighters.push(f);
    Matter.World.add(this.world, body);
    return f;
  };

  Game.prototype.start = function () {
    if (this.fighters.length === 0) return false;
    this.running = true;
    this.paused = false;
    this.finished = false;
    return true;
  };

  Game.prototype.togglePause = function () {
    if (this.finished) return this.paused;
    this.paused = !this.paused;
    return this.paused;
  };

  /* ---------- 화면 흔들림 ----------
     설정이 켜져 있을 때만 동작한다. 아무 때나 흔들지 않고 기준을 두어 '큰 사건'에서만 흔든다:
       · 한 번에 SHAKE_MIN_DMG 이상의 피해(피해가 클수록 세고 길게)
       · 파이터 파괴(결정타)
       · 스킬 폭발·분열·경기 종료 같은 큰 연출
     잔타격·벽 충돌·일반 사격으로는 흔들지 않는다. */
  var SHAKE_MIN_DMG = 18;   /* 이 피해량부터 '큰 한 방'으로 본다 */
  var SHAKE_MAX_DMG = 60;   /* 이 이상은 진폭 상한에 붙는다 */
  var SHAKE_FLOOR = 2;      /* 이보다 약한 요청은 무시한다(px) */
  var SHAKE_MAX_AMP = 12;   /* 안전 상한(px) — 어떤 요청도 이 이상 흔들지 않는다 */

  /* 진폭(px)·시간(ms)으로 흔들림을 요청한다. 이미 더 센 흔들림이 남아 있으면
     약한 요청은 버려, 한 프레임에 여러 번 겹쳐 화면이 요동치는 것을 막는다. */
  Game.prototype.addShake = function (amp, ms) {
    if (!this.shakeEnabled) return false;
    if (!(amp > SHAKE_FLOOR)) return false;
    if (amp > SHAKE_MAX_AMP) amp = SHAKE_MAX_AMP;
    var now = performance.now();
    if (this.shakeDur && this.shakeAt) {
      var left = 1 - (now - this.shakeAt) / this.shakeDur;
      if (left > 0.5 && this.shakeAmp >= amp) return false;
    }
    this.shakeAmp = amp;
    this.shakeDur = Math.max(60, ms || 140);
    this.shakeT = this.shakeDur * 0.001; /* 남은 시간(초) — 상태 표시용 */
    this.shakeAt = now;
    return true;
  };

  /* 결정타: 파이터가 죽는 순간 */
  Game.prototype.killShake = function () {
    this.addShake(5.5, 150);
  };

  /* 큰 피해 1회에 대한 흔들림 — 18 미만(잔타격)은 흔들지 않는다 */
  Game.prototype.damageShake = function (amount) {
    if (!(amount >= SHAKE_MIN_DMG)) return;
    var t = (amount - SHAKE_MIN_DMG) / (SHAKE_MAX_DMG - SHAKE_MIN_DMG);
    if (t > 1) t = 1;
    this.addShake(2.6 + t * 3.4, 100 + t * 60);
  };

  /* 화면 흔들림 오프셋(px). 꺼져 있거나 흔들림이 끝났으면 0이다.
     경과 시간을 시계로 재므로 일시정지·저프레임에서도 정해진 시간 뒤 자연히 끝난다. */
  Game.prototype.shakeOffset = function () {
    if (!this.shakeEnabled || !this.shakeAt || !(this.shakeAmp > 0)) return { x: 0, y: 0 };
    var dur = this.shakeDur || 140;
    var el = performance.now() - this.shakeAt;
    if (el < 0 || el >= dur) return { x: 0, y: 0 };
    var p = el / dur;
    var k = 1 - p;
    k = k * k;                 /* 뒤로 갈수록 빠르게 잦아든다 */
    var amp = this.shakeAmp * k;
    /* x·y 주기를 다르게 해 원을 그리지 않고 흔들리며 멎게 한다 */
    return {
      x: Math.sin(el * 0.055) * amp,
      y: Math.cos(el * 0.078) * amp * 0.82
    };
  };

  Game.prototype.log = function (text, kind) {
    if (this.onLog) this.onLog(text, kind || null, this.time);
  };

  /* ---------- 시뮬레이션 ---------- */

  Game.prototype.step = function (dt) {
    if (this.paused) return;
    /* 히트스탑 없음: 충돌 순간에도 물리 스텝을 멈추지 않는다(멈칫·슬로우 제거) */
    this.effects.update(dt);
    this.updateBeams(dt);
    if (this.shakeT > 0) this.shakeT -= dt;
    this.updateSpin(dt);
    if (!this.running || this.finished) return;

    this.time += dt;
    this.updateArena(dt);
    this.updateMotion(dt);
    this.updateWeapons(dt);
    Matter.Engine.update(this.engine, dt * 1000);
    this.clampVelocities();
    this.enforceWalls();
    this.updateBullets(dt);
    this.finalize();
  };

  Game.prototype.updateSpin = function (dt) {
    for (var i = 0; i < this.fighters.length; i++) {
      var f = this.fighters[i];
      if (!f.alive) continue;
      var sp = speedOf(f.body);
      f.roll = (f.roll || 0) + dt * (sp * 0.06 + 0.4);
      f.squash = Math.max(0, (f.squash || 0) - dt * 2.2);
      this.updateShape(f, dt);
      WBF.Fluid.step(f, dt, this.time);
    }
  };

  /* 실루엣 회전: 레일건=조준/진행 방향, 광전사=저속 회전(돌파 시 진행 방향), 검사=휘두름 */
  Game.prototype.updateShape = function (f, dt) {
    var a = f.shapeAngle || 0;
    var d;
    if (f.typeId === 'railgun') {
      var want = f.skillAimT > 0 ? f.skillAimAngle : (f.aim > 0 ? f.aimAngle : (f.heading || 0));
      d = want - a;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      f.shapeAngle = a + d * Math.min(1, dt * 9);
    } else if (f.typeId === 'juggernaut') {
      if (f.boostT > 0) {
        d = (f.heading || 0) - a;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        f.shapeAngle = a + d * Math.min(1, dt * 8);
      } else {
        f.shapeAngle = a + dt * 0.5;
      }
    } else if (f.typeId === 'splitter') {
      f.shapeAngle = a + dt * (f.isChild ? 2.4 : 1.9);
    } else {
      f.shapeAngle = a + dt * (f.dashT > 0 ? 17 : 2.3);
      /* 돌진 중 실루엣 위치를 남겨 검기 잔상(bladeTrail)으로 그린다 */
      if (f.dashT > 0) {
        if (!f.trail) f.trail = [];
        f.trail.push({ x: f.body.position.x, y: f.body.position.y, a: f.shapeAngle });
        while (f.trail.length > 4) f.trail.shift();
      } else if (f.trail && f.trail.length) {
        f.trail.shift();
      }
    }
  };

  /* ---------- 핀볼 이동(직선 등속 + 벽 반사) + 경로 기반 스킬 ---------- */

  Game.prototype.dirOf = function (f) {
    var v = f.body.velocity;
    var sp = Math.sqrt(v.x * v.x + v.y * v.y);
    if (sp < 0.6) {
      var h = f.heading || 0;
      return { x: Math.cos(h), y: Math.sin(h), sp: sp };
    }
    return { x: v.x / sp, y: v.y / sp, sp: sp };
  };

  /* 조향(추적·회피) 없음: 방향은 충돌로만 바뀐다. 여기서는 스킬만 발동한다. */
  Game.prototype.updateMotion = function (dt) {
    if (this.warmup > 0) this.warmup = Math.max(0, this.warmup - dt);
    for (var i = 0; i < this.fighters.length; i++) {
      var f = this.fighters[i];
      if (!f.alive) continue;
      f.skillCd = Math.max(0, (f.skillCd || 0) - dt);
      f.slashT = Math.max(0, (f.slashT || 0) - dt);
      f.slamT = Math.max(0, (f.slamT || 0) - dt);
      f.dashT = Math.max(0, (f.dashT || 0) - dt);
      f.boostT = Math.max(0, (f.boostT || 0) - dt);
      f.recoilT = Math.max(0, (f.recoilT || 0) - dt);

      /* 게이지: 시간 경과로 서서히, 적중·벽 반사로 추가 충전 */
      this.addGauge(f, dt * SKILL_CHARGE);
      this.updateSkillAim(f, dt);

      var d = this.dirOf(f);
      f.heading = Math.atan2(d.y, d.x);

      var cruise = f.cruise || 10;
      /* 레일건이 3초 충전 중이면 몸을 고정하려 감속한다(충전 중 조준이 흔들리지 않게) */
      if (f.typeId === 'railgun' && f.skillAimT > 0) f.speedTarget = cruise * 0.5;
      else if (f.dashT > 0) f.speedTarget = cruise * 2.6;
      else if (f.boostT > 0) f.speedTarget = cruise * 1.5;
      else if (f.recoilT > 0) f.speedTarget = cruise * (f.recoilBoost || 1.35);
      else f.speedTarget = cruise;
      f.hot = f.boostT > 0;

      if (this.warmup > 0) continue;
      if (f.typeId === 'blade') this.skillBlade(f);
      else if (f.typeId === 'railgun') this.skillRailgun(f, dt);
    }
  };

  /* ① BLADE — 현재 진행 방향 그대로 초고속 부스트(추적 없음) */
  Game.prototype.skillBlade = function (f) {
    if (f.dashT > 0 || f.skillCd > 0) return;
    if (!this.nearestEnemy(f)) return;
    f.dashT = 0.34;
    f.skillCd = 1.7 + Math.random() * 0.9;
    f.speedTarget = (f.cruise || 10) * 2.6;
    this.effects.wave(f.body.position.x, f.body.position.y, f.color, 70, 0.25);
    WBF.Audio.blade();
  };

  /* ② RAILGUN — 이동은 그대로, 쿨마다 조준선 후 발사(반동으로 궤도가 꺾인다) */
  Game.prototype.skillRailgun = function (f, dt) {
    /* 고유 스킬(조준 → 관통 레이저) 중에는 일반 사격을 시작하지 않는다 */
    if (f.skillAimT > 0) return;
    if (f.aim > 0) {
      var t = this.nearestEnemy(f);
      if (t) f.aimAngle = Math.atan2(t.body.position.y - f.body.position.y, t.body.position.x - f.body.position.x);
      f.aim = Math.max(0, f.aim - dt);
      if (f.aim === 0) this.fireRailgun(f);
      return;
    }
    f.fireCd -= dt;
    if (f.fireCd > 0) return;
    var t2 = this.nearestEnemy(f);
    if (!t2) { f.fireCd = 0.4; return; }
    f.fireCd = 2.4 + Math.random() * 0.9;
    f.aim = 0.42;
    f.aimAngle = Math.atan2(t2.body.position.y - f.body.position.y, t2.body.position.x - f.body.position.x);
  };

  Game.prototype.updateArena = function (dt) {
    if (this.time > this.shrinkStart) {
      if (!this.deathAnnounced) {
        this.deathAnnounced = true;
        this.log('WARNING: SUDDEN_DEATH_INITIATED', 'warn');
      }
      var t = this.time - this.shrinkStart;
      var target = Math.min(this.maxInset, t * 9.5);
      if (Math.floor(target) > this.wallInset) this.buildWalls(target);
      this.deathMul = 1 + Math.min(1.4, t * 0.055);
    }
  };

  /* 등속 직선 유지: 방향은 충돌로만 바뀌고 속력은 클래스별 목표값으로 일정하다 */
  Game.prototype.clampVelocities = function () {
    for (var i = 0; i < this.fighters.length; i++) {
      var f = this.fighters[i];
      if (!f.alive) continue;
      var b = f.body;
      var sp = speedOf(b);
      var target = f.speedTarget || f.cruise || 10;
      var a = sp > 0.6 ? Math.atan2(b.velocity.y, b.velocity.x) : (f.heading || 0);
      f.heading = a;
      Matter.Body.setVelocity(b, { x: Math.cos(a) * target, y: Math.sin(a) * target });
      var p = b.position;
      if (p.x < -120 || p.x > W + 120 || p.y < -120 || p.y > H + 120) {
        Matter.Body.setPosition(b, { x: W / 2, y: H / 2 });
        f.heading = Math.random() * TAU;
        Matter.Body.setVelocity(b, { x: Math.cos(f.heading) * target, y: Math.sin(f.heading) * target });
      }
    }
  };

  /* ---------- 벽 접촉 처리(끼임 방지) ----------
     clampVelocities는 '방향만' 보존하고 속력만 목표값으로 맞춘다. 그래서 충돌 해석기가
     법선 속도를 지워 버리면 접선 성분만 각도로 남아 파이터가 벽을 타고 미끄러진다(끼임).
     엔진 업데이트 뒤에 위치를 안쪽으로 밀고 법선 속도를 보장해 고착을 끊는다. */

  Game.prototype.arenaBox = function (r) {
    var inset = this.inset;
    return {
      l: inset + r + WALL_SKIN,
      r: W - inset - r - WALL_SKIN,
      t: inset + r + WALL_SKIN,
      b: H - inset - r - WALL_SKIN
    };
  };

  Game.prototype.enforceWallOne = function (f) {
    if (!f || !f.alive || !f.body) return false;
    var b = f.body;
    var p = b.position;
    var v = b.velocity;
    var r = f.radius || 10;
    var box = this.arenaBox(r);
    var target = f.speedTarget || f.cruise || 10;

    /* 서든데스로 경기장이 몸통보다 좁아진 경우: 중앙 복귀 */
    if (box.l > box.r || box.t > box.b) {
      f.heading = Math.random() * TAU;
      Matter.Body.setPosition(b, { x: W / 2, y: H / 2 });
      Matter.Body.setVelocity(b, { x: Math.cos(f.heading) * target, y: Math.sin(f.heading) * target });
      f.wallStuck = false;
      return true;
    }

    /* 벽을 넘은 축만큼 안쪽으로 밀어낼 양(코너는 두 축 동시) */
    var px = 0;
    var py = 0;
    if (p.x < box.l) px = box.l - p.x;
    else if (p.x > box.r) px = box.r - p.x;
    if (p.y < box.t) py = box.t - p.y;
    else if (p.y > box.b) py = box.b - p.y;
    if (!px && !py) {
      f.wallStuck = false;
      return false;
    }

    /* 1) 위치 강제 이탈: 벽 안쪽으로 충분히 밀어낸다 */
    Matter.Body.setPosition(b, { x: p.x + px, y: p.y + py });

    var len = Math.sqrt(px * px + py * py) || 1;
    var ux = px / len;
    var uy = py / len;
    var vn = v.x * ux + v.y * uy;
    var shallow = vn < target * 0.35;
    var need = target * (shallow ? WALL_SHALLOW_N : WALL_MIN_N);

    /* 2) 법선 성분이 충분하면 속도는 건드리지 않는다(정상 반사 보존) */
    if (vn >= need) {
      f.wallStuck = false;
      return true;
    }

    /* 3) 접선 성분 유지 + 법선 속도 강제 주입 */
    var tx = -uy;
    var ty = ux;
    var vt = v.x * tx + v.y * ty;
    var vtMax = target * (shallow ? 0.55 : 0.85);
    if (vt > vtMax) vt = vtMax;
    else if (vt < -vtMax) vt = -vtMax;
    /* 방향 교정 킥: 평행 성분만 남았으면 접선에 미세 편차를 줘 고착을 깬다 */
    if (shallow) vt += (Math.random() < 0.5 ? -1 : 1) * target * 0.12;

    var nvx = ux * need + tx * vt;
    var nvy = uy * need + ty * vt;
    Matter.Body.setVelocity(b, { x: nvx, y: nvy });
    f.heading = Math.atan2(nvy, nvx);

    /* 벽에 붙은 채 굳지 않도록 표면 유체만 한 번 흔든다 */
    if (shallow && !f.wallStuck) WBF.Fluid.splat(f, ux, uy, 1.1);
    f.wallStuck = shallow;
    return true;
  };

  Game.prototype.enforceWalls = function () {
    for (var i = 0; i < this.fighters.length; i++) this.enforceWallOne(this.fighters[i]);
  };

  Game.prototype.nearestEnemy = function (f) {
    var best = null;
    var bd = Infinity;
    for (var i = 0; i < this.fighters.length; i++) {
      var o = this.fighters[i];
      if (!o.alive || o.teamId === f.teamId) continue;
      var d = Math.hypot(o.body.position.x - f.body.position.x, o.body.position.y - f.body.position.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };

  Game.prototype.updateWeapons = function (dt) {
    for (var i = 0; i < this.fighters.length; i++) {
      var f = this.fighters[i];
      if (!f.alive) continue;
      if (f.typeId === 'blade') this.updateBlade(f, dt);
    }
  };

  Game.prototype.updateBlade = function (f, dt) {
    f.bladeAngle += dt * (13 + 7 * f.spdMul);
    var orbit = f.radius + 16 + (f.dashT > 0 ? 22 : 0);
    var now = performance.now();
    var px = f.body.position.x;
    var py = f.body.position.y;

    for (var k = 0; k < 2; k++) {
      var a = f.bladeAngle + k * Math.PI;
      var bx = px + Math.cos(a) * orbit;
      var by = py + Math.sin(a) * orbit;
      this.effects.afterglow(px, py, bx, by, f.color, 0.16);

      for (var i = 0; i < this.fighters.length; i++) {
        var o = this.fighters[i];
        if (!o.alive || o === f || o.teamId === f.teamId) continue;
        var dx = o.body.position.x - bx;
        var dy = o.body.position.y - by;
        if (Math.hypot(dx, dy) > o.radius + 10) continue;
        var last = f.bladeHitAt[o.id] || 0;
        if (now - last < 200) continue;
        f.bladeHitAt[o.id] = now;
        var ang = Math.atan2(dy, dx);
        Matter.Body.setVelocity(o.body, {
          x: o.body.velocity.x + Math.cos(ang) * 1.7,
          y: o.body.velocity.y + Math.sin(ang) * 1.7
        });
        this.damage(o, o.typeId === 'blade' ? 4 : 8, f, bx, by, f.color);
        this.effects.spark(bx, by, 7, f.color, 6);
        WBF.Audio.blade();
      }

      for (var j = 0; j < this.bullets.length; j++) {
        var b = this.bullets[j];
        if (!b.alive || b.teamId === f.teamId) continue;
        if (Math.hypot(b.x - bx, b.y - by) < 14) {
          b.alive = false;
          this.effects.spark(b.x, b.y, 11, f.color, 7);
          this.effects.wave(b.x, b.y, f.color, 60, 0.3);
          WBF.Audio.blade();
        }
      }
    }
  };

  Game.prototype.fireRailgun = function (f) {
    var p = f.body.position;
    var a = f.aimAngle;
    var sx = p.x + Math.cos(a) * (f.radius + 6);
    var sy = p.y + Math.sin(a) * (f.radius + 6);
    this.bullets.push({
      x: sx, y: sy,
      vx: Math.cos(a) * 1450,
      vy: Math.sin(a) * 1450,
      r: 5,
      teamId: f.teamId,
      owner: f,
      dmg: 16,
      bounces: 3,
      life: 3.2,
      alive: true,
      color: f.color
    });
    /* 반동: 사격 반대 방향으로 튕져 나가며 궤도가 꺾인다 */
    var side = Math.random() < 0.5 ? -1 : 1;
    var kick = a + Math.PI + side * (0.35 + Math.random() * 0.4);
    var sp0 = (f.cruise || 11) * 1.7;
    f.heading = kick;
    f.recoilT = 0.22;
    f.recoilBoost = 1.35; /* 일반 사격은 스킬 레이저의 강반동을 물려받지 않는다 */
    Matter.Body.setVelocity(f.body, { x: Math.cos(kick) * sp0, y: Math.sin(kick) * sp0 });
    this.effects.spark(sx, sy, 9, f.color, 8);
    this.effects.muzzleSmoke(sx, sy, Math.cos(a), Math.sin(a), 4, 0.45);
    this.effects.emberBurst(sx, sy, Math.cos(a), Math.sin(a), 3, 0.5);
    this.effects.wave(sx, sy, f.color, 110, 0.4);
    WBF.Audio.shoot();
    this.log(f.label + ' fired RAILGUN // recoil', 'hit');
  };

  Game.prototype.updateBullets = function (dt) {
    var left = this.inset;
    var right = W - this.inset;
    var top = this.inset;
    var bottom = H - this.inset;

    for (var i = 0; i < this.bullets.length; i++) {
      var b = this.bullets[i];
      if (!b.alive) continue;
      var px0 = b.x, py0 = b.y;
      var steps = 4;
      var sdt = dt / steps;
      for (var s = 0; s < steps && b.alive; s++) {
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
        /* SPLITTER 자탄: 매 스텝 살짝 꺾여 변칙 궤도를 그린다 */
        if (b.erratic) {
          var wob = (Math.random() < 0.5 ? -1 : 1) * 0.16;
          var cw2 = Math.cos(wob);
          var sw2 = Math.sin(wob);
          var nvx = b.vx * cw2 - b.vy * sw2;
          b.vy = b.vx * sw2 + b.vy * cw2;
          b.vx = nvx;
        }
        if (b.x < left + b.r) { b.x = left + b.r; b.vx = Math.abs(b.vx); b.bounces--; }
        else if (b.x > right - b.r) { b.x = right - b.r; b.vx = -Math.abs(b.vx); b.bounces--; }
        if (b.y < top + b.r) { b.y = top + b.r; b.vy = Math.abs(b.vy); b.bounces--; }
        else if (b.y > bottom - b.r) { b.y = bottom - b.r; b.vy = -Math.abs(b.vy); b.bounces--; }
        if (b.bounces < 0) {
          b.alive = false;
          this.effects.spark(b.x, b.y, 6, b.color, 5);
          break;
        }
        for (var j = 0; j < this.fighters.length; j++) {
          var o = this.fighters[j];
          if (!o.alive || o.teamId === b.teamId) continue;
          if (Math.hypot(o.body.position.x - b.x, o.body.position.y - b.y) < o.radius + b.r) {
            var dealt = this.damage(o, b.dmg, b.owner, b.x, b.y, b.color);
            this.effects.spark(b.x, b.y, 14, b.color, 8);
            this.effects.wave(b.x, b.y, b.color, 130, 0.45);
            WBF.Audio.hit(1.3);
            if (b.owner) this.log(b.owner.label + ' crit -> ' + o.label + ' (-' + Math.round(dealt) + ' HP)', 'hit');
            b.alive = false;
            break;
          }
        }
      }
      this.effects.afterglow(px0, py0, b.x, b.y, b.color, 0.22);
      b.life -= dt;
      if (b.life <= 0) b.alive = false;
    }

    var keep = [];
    for (var q = 0; q < this.bullets.length; q++) if (this.bullets[q].alive) keep.push(this.bullets[q]);
    this.bullets = keep;
  };

  /* ---------- 데미지 ---------- */

  /* '강타' 표시 임계값 — 일반 사격(기본 16)은 서든데스 후반이 아니면 걸리지 않도록 18에서 올렸다 */
  var BIG_HIT_MIN = 22;

  Game.prototype.damage = function (target, base, source, x, y, color) {
    if (!target.alive || this.finished) return 0;
    if (this.warmup > 0) return 0;
    var mul = this.deathMul * (source ? source.atkMul : 1);
    if (source && source.typeId === 'juggernaut') mul *= 1 + source.sizeBonus * 0.018;
    var amount = Math.max(1, base * mul);
    target.hp -= amount;
    target.flashUntil = performance.now() + 90;
    target.squash = Math.min(0.65, (target.squash || 0) + 0.34);
    WBF.Fluid.splash(target, x, y, amount >= BIG_HIT_MIN ? 2.2 : 1);
    this.effects.text(x, y, '-' + Math.round(amount), color || '#ffffff', amount >= BIG_HIT_MIN ? 24 : 17);
    if (amount >= BIG_HIT_MIN) {
      /* 강타 표시 — 한국어는 '강타', 영어는 'HIT'. 한글은 획이 많아 두어 px 키운다 */
      var bigKo = this.lang === 'ko';
      this.effects.text(x, y - 22, bigKo ? '강타' : 'HIT', color || '#ffffff', bigKo ? 15 : 12);
    }
    /* 큰 한 방은 화면을 살짝 흔든다(잔타격은 흔들지 않는다) — 결정타 흔들림이 뒤이어 더 세게 온다 */
    this.damageShake(amount);
    if (target.hp <= 0) this.kill(target, source);
    else if (target.typeId === 'splitter' && !target.isChild && target.hp <= target.maxHp * 0.5) this.pendingSplits.push(target);
    /* 적중도 게이지를 채운다 */
    if (source) this.addGauge(source, SKILL_HIT_GAIN);
    return amount;
  };

  Game.prototype.kill = function (f, source) {
    if (!f.alive) return;
    var p = f.body.position;
    f.alive = false;
    f.hp = 0;
    if (source) source.kills = (source.kills || 0) + 1;
    WBF.Fluid.burst(f, 1.6);
    this.effects.wave(p.x, p.y, f.color, 220, 0.7);
    this.killShake();
    WBF.Audio.pop();
    this.log((source ? source.label + ' eliminated ' : '') + f.label, 'warn');
  };

  Game.prototype.split = function (f) {
    if (f.isChild || !f.alive) return;
    var p = { x: f.body.position.x, y: f.body.position.y };
    var v = f.body.velocity;
    var baseAngle = Math.atan2(v.y, v.x);
    var stats = { hp: this.stats.hp, atk: f.atkMul * 100, spd: f.spdMul * 100 };
    f.alive = false;
    f.removed = true;
    Matter.World.remove(this.world, f.body);

    for (var k = 0; k < 2; k++) {
      var a = baseAngle + (k === 0 ? -0.9 : 0.9);
      var child = this.createFighter(
        f.type, f.teamId,
        p.x + Math.cos(a) * f.radius * 0.8,
        p.y + Math.sin(a) * f.radius * 0.8,
        stats, true
      );
      child.hp = Math.max(10, f.hp / 2);
      child.maxHp = Math.round(child.maxHp * 0.55);
      child.flankSign = k === 0 ? 1 : -1;
      child.heading = a;
      child.speedTarget = child.cruise || 12;
      Matter.Body.setVelocity(child.body, {
        x: Math.cos(a) * (child.cruise || 12),
        y: Math.sin(a) * (child.cruise || 12)
      });
    }

    this.effects.wave(p.x, p.y, f.color, 190, 0.6);
    this.effects.text(p.x, p.y - 30, 'SPLIT', f.color, 15);
    this.addShake(9);
    WBF.Audio.split();
    this.log(f.label + ' divided // units=2', 'sys');
  };

  Game.prototype.growBody = function (f) {
    var r = (f.baseRadius || f.type.radius) + f.sizeBonus;
    if (Math.abs(r - f.radius) < 0.05) return;
    var pos = { x: f.body.position.x, y: f.body.position.y };
    var vel = { x: f.body.velocity.x, y: f.body.velocity.y };
    Matter.World.remove(this.world, f.body);
    var body = this.makeBody(pos.x, pos.y, r);
    body.gameRef = f;
    Matter.Body.setVelocity(body, vel);
    f.body = body;
    f.radius = r;
    Matter.World.add(this.world, body);
    WBF.Fluid.grow(f, 1);
  };

  Game.prototype.finalize = function () {
    var i;
    var changed = false;
    for (i = 0; i < this.fighters.length; i++) {
      var f = this.fighters[i];
      if (!f.alive && !f.removed) {
        f.removed = true;
        Matter.World.remove(this.world, f.body);
        changed = true;
      }
    }
    if (changed) {
      var alive = [];
      for (i = 0; i < this.fighters.length; i++) if (!this.fighters[i].removed) alive.push(this.fighters[i]);
      this.fighters = alive;
    }
    while (this.pendingGrow.length) {
      var g = this.pendingGrow.shift();
      if (g.alive && !g.removed) this.growBody(g);
    }
    while (this.pendingSplits.length) {
      var s = this.pendingSplits.shift();
      if (s.alive && !s.removed) this.split(s);
    }
    if (!this.running || this.finished) return;

    var teams = {};
    var count = 0;
    var lastTeam = null;
    for (i = 0; i < this.fighters.length; i++) {
      var x = this.fighters[i];
      if (!x.alive) continue;
      if (!teams[x.teamId]) { teams[x.teamId] = true; count++; lastTeam = x.teamId; }
    }
    if (count <= 1) { this.finish(count === 1 ? lastTeam : null); return; }
    if (this.time > this.matchLimit) {
      var best = null;
      for (i = 0; i < this.fighters.length; i++) {
        var c = this.fighters[i];
        if (c.alive && (!best || c.hp > best.hp)) best = c;
      }
      this.finish(best ? best.teamId : null);
    }
  };

  Game.prototype.finish = function (teamId) {
    this.finished = true;
    this.running = false;
    var f = null;
    var i;
    for (i = 0; i < this.fighters.length; i++) {
      if (this.fighters[i].teamId === teamId && this.fighters[i].alive) { f = this.fighters[i]; break; }
    }
    if (!f) {
      for (i = 0; i < this.fighters.length; i++) {
        if (this.fighters[i].teamId === teamId) { f = this.fighters[i]; break; }
      }
    }
    this.winner = f ? { tag: f.type.tag, name: f.type.name, color: f.color } : null;
    /* 클리어 연출: 승자 위치(없으면 중앙)에서 아스키 충격파가 퍼진다 */
    this.startFinishFx(f ? f.body.position.x : W / 2, f ? f.body.position.y : H / 2);
    this.addShake(9, 320);
    WBF.Audio.victory();
    this.log(this.winner ? 'MATCH_END // WINNER=' + this.winner.tag : 'MATCH_END // DRAW', 'sys');
    if (this.onFinish) this.onFinish(this.winner);
  };

  /* ---------- 충돌 ---------- */

  Game.prototype.onCollisionStart = function (evt) {
    if (this.finished) return;
    for (var i = 0; i < evt.pairs.length; i++) {
      var pair = evt.pairs[i];
      var a = pair.bodyA;
      var b = pair.bodyB;
      var fa = a.gameRef;
      var fb = b.gameRef;
      if (fa && fb) {
        if (fa.teamId !== fb.teamId) this.ballClash(fa, fb);
      } else if (fa && b.label === 'wall') {
        this.wallHit(fa);
      } else if (fb && a.label === 'wall') {
        this.wallHit(fb);
      }
    }
  };

  Game.prototype.ballClash = function (fa, fb) {
    var va = fa.body.velocity;
    var vb = fb.body.velocity;
    var rel = Math.hypot(va.x - vb.x, va.y - vb.y);
    if (rel < 1.4) return;
    var mx = (fa.body.position.x + fb.body.position.x) / 2;
    var my = (fa.body.position.y + fb.body.position.y) / 2;
    /* 게이지가 완충된 채 적과 부딪히면 클래스 고유 스킬이 먼저 터진다(발동 즉시 0으로 초기화) */
    if (fa.gaugeReady) this.castSkill(fa, fb, mx, my);
    if (fb.gaugeReady) this.castSkill(fb, fa, mx, my);
    var base = Math.min(44, rel) * 0.55;
    /* 벽 반사 과열 중인 광전사는 중량 돌파: 큰 피해 + 상대를 강하게 튕겨낸다 */
    var ja = fa.typeId === 'juggernaut' && fa.boostT > 0;
    var jb = fb.typeId === 'juggernaut' && fb.boostT > 0;
    var d1 = this.damage(fb, base * (ja ? 1.6 : 1), fa, mx, my, fa.color);
    var d2 = this.damage(fa, base * (jb ? 1.6 : 1), fb, mx, my, fb.color);
    /* 1v1 접촉: 양쪽 실루엣이 가운데에서 묵직하게 찰랑인다 */
    WBF.Fluid.splash(fa, mx, my, ja ? 2.4 : 1.7);
    WBF.Fluid.splash(fb, mx, my, jb ? 2.4 : 1.7);
    if (ja) this.knock(fa, fb);
    if (jb) this.knock(fb, fa);
    /* 파이터끼리 부딪히는 순간에만 대장장이 금속 스파크가 튄다 */
    var cx = fb.body.position.x - fa.body.position.x;
    var cy = fb.body.position.y - fa.body.position.y;
    var cl = Math.sqrt(cx * cx + cy * cy) || 1;
    this.effects.forge(mx, my, cx / cl, cy / cl,
      Math.min(26, 10 + Math.round(rel * 1.4)), [fa.color, fb.color, '#ffdf70'],
      Math.min(fa.radius || 34, fb.radius || 34));
    this.effects.flash(mx, my, rel > 7 ? '#ffffff' : '#ffdf70');
    if (rel > 7) {
      WBF.Audio.hit(1.2);
      if (this.time - (this.hitLogAt[fa.id] || -9) > 0.4) {
        this.hitLogAt[fa.id] = this.time;
        this.log(fa.label + ' dealt ' + Math.round(Math.max(d1, d2)) + ' DMG to ' + fb.label, 'hit');
      }
    } else {
      WBF.Audio.hit(0.45 + rel * 0.05);
    }
  };

  /* ---------- 스킬 게이지 · 클래스 고유 스킬 ---------- */

  /* 게이지는 0~1. 완충(gaugeReady)되면 다음 적 충돌 때 스킬이 나가고 0으로 돌아간다 */
  Game.prototype.addGauge = function (f, amount) {
    if (!f || !f.alive || f.gaugeReady) return;
    f.gauge += amount * (f.chargeMul || 1);
    if (f.gauge < 1) return;
    f.gauge = 1;
    f.gaugeReady = true;
    /* 한국어 설정에서는 '스킬 준비!'(한글은 획이 많아 두어 px 키운다) */
    var ko = this.lang === 'ko';
    this.effects.text(f.body.position.x, f.body.position.y - (f.radius || 30) - 24,
      ko ? '스킬 준비!' : 'SKILL_READY', f.skillColor || '#ffdf70', ko ? 16 : 10);
  };

  Game.prototype.findFighterById = function (id) {
    if (!id) return null;
    for (var i = 0; i < this.fighters.length; i++) {
      if (this.fighters[i].id === id) return this.fighters[i];
    }
    return null;
  };

  /* RAILGUN 고유 스킬: 3초 모은 뒤 관통 레이저를 쏜다(충전 중에는 대상을 계속 겨눔) */
  Game.prototype.updateSkillAim = function (f, dt) {
    if (f.skillAimT <= 0) return;
    var t = this.findFighterById(f.skillTargetId);
    if (t && t.alive) {
      f.skillAimAngle = Math.atan2(t.body.position.y - f.body.position.y, t.body.position.x - f.body.position.x);
    }
    f.skillAimT = Math.max(0, f.skillAimT - dt);
    if (f.skillAimT === 0) this.fireSkillLaser(f);
  };

  Game.prototype.castSkill = function (f, target, mx, my) {
    if (!f.alive || !f.gaugeReady) return;
    f.gauge = 0;
    f.gaugeReady = false;
    f.skillUse = (f.skillUse || 0) + 1;
    if (f.typeId === 'blade') this.skillCastBlade(f, target, mx, my);
    else if (f.typeId === 'railgun') this.skillCastRailgun(f, target);
    else if (f.typeId === 'juggernaut') this.skillCastJuggernaut(f, target, mx, my);
    else this.skillCastSplitter(f, target, mx, my);
    this.log(f.label + ' >> SKILL ' + f.skillName + ' // gauge=0%', 'sys');
  };

  /* ① BLADE — 360도 회전 검기 난무: 주변 광역 피해 + 충돌 상대에게 큰 단일 피해 */
  Game.prototype.skillCastBlade = function (f, target, mx, my) {
    var px = f.body.position.x;
    var py = f.body.position.y;
    var R = (f.radius || 36) * 2.3;
    f.slashT = 0.55;
    f.slashAng = f.bladeAngle || 0;
    for (var i = 0; i < this.fighters.length; i++) {
      var o = this.fighters[i];
      if (!o.alive || o === f || o.teamId === f.teamId) continue;
      var d = Math.hypot(o.body.position.x - px, o.body.position.y - py);
      if (d > R + o.radius) continue;
      var big = (o === target) || d < (f.radius || 36) * 1.3;
      this.damage(o, big ? 30 : 16, f, o.body.position.x, o.body.position.y, f.color);
      var ang = Math.atan2(o.body.position.y - py, o.body.position.x - px);
      Matter.Body.setVelocity(o.body, {
        x: o.body.velocity.x + Math.cos(ang) * (big ? 4.2 : 2.2),
        y: o.body.velocity.y + Math.sin(ang) * (big ? 4.2 : 2.2)
      });
    }
    this.effects.wave(px, py, f.color, R + 40, 0.45);
    this.effects.wave(px, py, '#ffdf70', R * 0.7, 0.3);
    this.effects.flash(mx, my, '#ffffff');
    this.effects.text(px, py - (f.radius || 36) - 30, 'SPIN_SLASH', f.skillColor, 12);
    WBF.Audio.blade();
    this.addShake(2.5);
  };

  /* ② RAILGUN — 최근접 적을 2초 겨눈 뒤 관통 레이저 + 큰 반동 */
  Game.prototype.skillCastRailgun = function (f, target) {
    var t = (target && target.alive) ? target : this.nearestEnemy(f);
    f.skillTargetId = t ? t.id : 0;
    f.skillAimAngle = t
      ? Math.atan2(t.body.position.y - f.body.position.y, t.body.position.x - f.body.position.x)
      : (f.heading || 0);
    f.skillAimT = 3.0;
    f.skillChargeDur = 3.0;
    this.effects.text(f.body.position.x, f.body.position.y - (f.radius || 33) - 24, 'CHARGE 3.0s', '#ff1e56', 11);
    WBF.Audio.hit(0.5);
  };

  Game.prototype.fireSkillLaser = function (f) {
    if (!f.alive) return;
    var p = f.body.position;
    var a = f.skillAimAngle;
    var ca = Math.cos(a);
    var sa = Math.sin(a);
    var x1 = p.x + ca * ((f.radius || 33) + 6);
    var y1 = p.y + sa * ((f.radius || 33) + 6);
    var x2 = p.x + ca * 1600;
    var y2 = p.y + sa * 1600;

    this.beams.push({ x1: x1, y1: y1, x2: x2, y2: y2, life: 0.44, max: 0.44, color: '#ff1e56' });

    for (var i = 0; i < this.fighters.length; i++) {
      var o = this.fighters[i];
      if (!o.alive || o === f || o.teamId === f.teamId) continue;
      if (segDist(o.body.position.x, o.body.position.y, x1, y1, x2, y2) > o.radius + 8) continue;
      this.damage(o, 72, f, o.body.position.x, o.body.position.y, '#ff2a55');
      var push = Math.atan2(o.body.position.y - p.y, o.body.position.x - p.x);
      Matter.Body.setVelocity(o.body, {
        x: o.body.velocity.x + Math.cos(push) * 4.6,
        y: o.body.velocity.y + Math.sin(push) * 4.6
      });
    }

    /* 반동: 거의 정후방으로 크게 날아간다(속도 목표도 recoilBoost로 크게 올린다) */
    var side = Math.random() < 0.5 ? -1 : 1;
    var kick = a + Math.PI + side * (0.12 + Math.random() * 0.2);
    var sp0 = (f.cruise || 11) * 3.6;
    f.heading = kick;
    f.recoilT = 0.5;
    f.recoilBoost = 3.4;
    Matter.Body.setVelocity(f.body, { x: Math.cos(kick) * sp0, y: Math.sin(kick) * sp0 });
    WBF.Fluid.splat(f, -ca, -sa, 2.6);

    /* 총구: 화구 → 아스키 연기와 불씨가 앞으로 뿜어져 나간다 */
    this.effects.muzzleSmoke(x1, y1, ca, sa, 30, 1.5);
    this.effects.emberBurst(x1, y1, ca, sa, 26, 1.2);
    this.effects.spark(x1, y1, 14, '#ff1e56', 9);
    this.effects.flash(x1, y1, '#ffffff');
    this.effects.wave(x1, y1, '#ff1e56', 190, 0.5);
    this.effects.wave(x1, y1, '#ffdf70', 104, 0.32);
    /* 뒤로 밀려나는 궤적에도 연기 띠를 남긴다 */
    this.effects.muzzleSmoke(p.x - ca * ((f.radius || 33) + 4), p.y - sa * ((f.radius || 33) + 4), -ca, -sa, 10, 0.85);
    this.addShake(6.5);
    WBF.Audio.shoot();
    this.log(f.label + ' charged_laser // 72 DMG // heavy recoil', 'hit');
  };

  /* ③ JUGGERNAUT — 거대화 + 황금 충격파 광폭 돌진(짓누르기) */
  Game.prototype.skillCastJuggernaut = function (f, target, mx, my) {
    var px = f.body.position.x;
    var py = f.body.position.y;
    f.boostT = Math.max(f.boostT || 0, 1.6);
    f.hot = true;
    f.slamT = 0.45;
    f.speedTarget = (f.cruise || 7.8) * 1.9;
    if (f.sizeBonus < 14) {
      /* 일시 거대화: 입자(셀)가 늘어난다 */
      f.sizeBonus = Math.min(14, f.sizeBonus + 2.2);
      this.pendingGrow.push(f);
    }
    WBF.Fluid.splat(f, f.body.velocity.x, f.body.velocity.y, 2.6);
    this.effects.wave(px, py, '#ffdf70', (f.radius || 46) * 3.4, 0.55);
    this.effects.flash(mx, my, '#ffdf70');
    this.effects.text(px, py - (f.radius || 46) - 30, 'GROUND_SLAM', f.skillColor, 12);
    if (target && target.alive) {
      this.damage(target, 38, f, target.body.position.x, target.body.position.y, '#ffdf70');
      if (target.alive) this.knock(f, target);
    }
    WBF.Audio.hit(1.5);
    this.addShake(9);
  };

  /* ④ SPLITTER — 변칙 궤도 자탄을 사방 부채꼴로 뿌린다 */
  Game.prototype.skillCastSplitter = function (f, target, mx, my) {
    var p = f.body.position;
    var n = 9;
    var base = Math.random() * TAU;
    for (var k = 0; k < n; k++) {
      var a = base + (TAU / n) * k + (Math.random() - 0.5) * 0.5;
      var spd = 560 + Math.random() * 220;
      this.bullets.push({
        x: p.x + Math.cos(a) * ((f.radius || 38) + 5),
        y: p.y + Math.sin(a) * ((f.radius || 38) + 5),
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        r: 4,
        teamId: f.teamId,
        owner: f,
        dmg: 9,
        bounces: 2,
        life: 1.5,
        alive: true,
        erratic: true,
        color: f.color
      });
    }
    this.effects.wave(p.x, p.y, f.color, 170, 0.5);
    this.effects.text(p.x, p.y - (f.radius || 38) - 30, 'FRAG_BURST', f.skillColor, 12);
    WBF.Audio.split();
  };

  Game.prototype.updateBeams = function (dt) {
    for (var i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].life -= dt;
      if (this.beams[i].life > 0) continue;
      var last = this.beams.pop();
      if (i < this.beams.length) this.beams[i] = last;
    }
  };

  /* 벽 반사: 클래스별로 반사 후 처리가 다르다(분열=변칙 각도, 광전사=과열 가속) */
  Game.prototype.wallHit = function (f) {
    var sp = speedOf(f.body);
    if (sp < 2) return;
    var now = performance.now();

    /* 벽 반사도 게이지를 채운다(연속 접촉 시 과충전 방지용 0.25초 쿨다운) */
    if (this.time - (f.lastGaugeWall || 0) >= 0.25) {
      f.lastGaugeWall = this.time;
      this.addGauge(f, SKILL_WALL_GAIN);
    }

    if (f.typeId === 'splitter') {
      /* 변칙 바운스: 반사각에 ±25도 무작위 */
      if (now - (f.lastWallAt || 0) < 90) return;
      f.lastWallAt = now;
      var ang = Math.atan2(f.body.velocity.y, f.body.velocity.x) +
        (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 13) * Math.PI / 180;
      f.heading = ang;
      Matter.Body.setVelocity(f.body, { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp });
      /* 벽 충돌은 물리 반사만 — 스파크·파편 없음 */
      return;
    }

    if (f.typeId === 'juggernaut') {
      /* 벽 반사 = 오버드라이브 과열: 실루엣 1.22배 팽창 + 과열 속도(updateMotion이 1.5배로 유지) */
      if (now - (f.lastWallAt || 0) >= 90) {
        f.lastWallAt = now;
        f.boostT = 1.3;
        f.speedTarget = (f.cruise || 7.8) * 1.7;
        WBF.Fluid.splat(f, f.body.velocity.x, f.body.velocity.y, 2.2);
        WBF.Audio.hit(0.7);
      }
      if (f.sizeBonus >= 14) return;
      if (sp < 3) return;
      f.sizeBonus = Math.min(14, f.sizeBonus + 1.1);
      this.pendingGrow.push(f);
    }
  };

  /* 과열 돌파 중 부딪힌 상대를 진행 반대 방향으로 강하게 밀어낸다 */
  Game.prototype.knock = function (from, to) {
    var dx = to.body.position.x - from.body.position.x;
    var dy = to.body.position.y - from.body.position.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var a = Math.atan2(dy / len, dx / len);
    var s = (to.cruise || 10) * (from.hot ? 2.4 : 1.7);
    to.heading = a;
    to.recoilT = 0.26;
    Matter.Body.setVelocity(to.body, { x: Math.cos(a) * s, y: Math.sin(a) * s });
    WBF.Fluid.splash(to, from.body.position.x, from.body.position.y, 1.8);
  };

  /* 아레나 렌더는 전부 문자 렌더러가 담당한다(fillText 전용) */
  Game.prototype.render = function (now) {
    /* 흔들림 오프셋은 한 프레임에 한 번만 계산해 렌더러와 오버레이가 같은 값을 쓴다 */
    var sh = this.shakeOffset();
    this.shakeX = sh.x;
    this.shakeY = sh.y;
    this.renderer.draw(now);
    this.drawOverlay(now);
  };

  /* 최상단 레이어 — 파이터 체력 숫자는 표시하지 않고 전투 텍스트만 픽셀 폰트로 */
  Game.prototype.drawOverlay = function (now) {
    var ctx = this.ctx;
    var view = this.view;
    /* 오버레이도 같은 흔들림 오프셋을 받아 셀 문자와 함께 움직인다 */
    ctx.setTransform(this.dpr, 0, 0, this.dpr,
      (this.shakeX || 0) * this.dpr, (this.shakeY || 0) * this.dpr);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    if ('filter' in ctx) ctx.filter = 'none';

    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.k, view.k);
    this.effects.drawTexts(ctx);

    /* 머리 위 클래스 태그: 픽셀 폰트 · 몸체 위에는 아무 숫자도 그리지 않는다 */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '8px "Press Start 2P", "VT323", monospace';
    for (var ti = 0; ti < this.fighters.length; ti++) {
      var tf = this.fighters[ti];
      if (!tf.alive) continue;
      var tp = tf.body.position;
      var tx = tp.x;
      var ty = tp.y - tf.radius - 15;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(5,5,7,0.95)';
      ctx.strokeText(tf.shortTag, tx, ty);
      ctx.fillStyle = tf.color;
      ctx.fillText(tf.shortTag, tx, ty);
    }
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'miter';

    /* 경고 문구도 설정 언어를 따른다 — 한글은 자간이 넓어 12px */
    var sdKo = this.lang === 'ko';
    if (this.time > this.shrinkStart && !this.finished && Math.floor(now / 380) % 2 === 0) {
      ctx.font = (sdKo ? '12px' : '10px') +
        ' "Press Start 2P", "VT323", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", monospace';
      ctx.fillStyle = '#ff1e56';
      ctx.fillText(sdKo ? '!! 서든 데스 !!' : '!! SUDDEN_DEATH !!', this.cssW / 2, 24);
    }

    if (this.finished) this.drawFinishBanner(ctx, now);
  };

  /* ---------- 클리어 연출: 충격파 → 모자이크 배너 ---------- */

  Game.prototype.startFinishFx = function (x, y) {
    var corners = [[0, 0], [W, 0], [0, H], [W, H]];
    var maxR = 0;
    for (var i = 0; i < 4; i++) {
      var d = Math.hypot(corners[i][0] - x, corners[i][1] - y);
      if (d > maxR) maxR = d;
    }
    this.finishFx = {
      x: x,
      y: y,
      maxR: maxR + 24,
      color: this.winner ? this.winner.color : '#6c7789',
      t0: performance.now()
    };
    /* 배너 마스크는 승자가 바뀌면 다시 만들어야 한다 */
    this.bannerKey = '';
  };

  /* 배너 글자 크기 — 마스크와 최종 텍스트가 같은 값을 쓴다. 화면 폭·높이에 맞춰 크게 잡는다 */
  Game.prototype.bannerMetrics = function () {
    var w = this.cssW;
    var h = this.cssH;
    var tagFont = Math.round(Math.min(w * 0.084, h * 0.182));
    if (tagFont < 32) tagFont = 32;
    else if (tagFont > 108) tagFont = 108;
    var small = Math.round(Math.min(w * 0.015, h * 0.029));
    if (small < 9) small = 9;
    else if (small > 17) small = 17;
    return { tagFont: tagFont, small: small, dy1: -tagFont * 0.92, dy3: tagFont * 0.8 };
  };

  /* 배너 글자를 흰색 마스크로 한 번만 렌더하고 알파를 샘플링한다 */
  Game.prototype.buildBannerMask = function () {
    var tag = this.winner ? this.winner.tag : 'DRAW';
    var key = this.cssW + 'x' + this.cssH + '|' + tag;
    if (this.bannerKey === key && this.bannerData && this.bannerBox) return this.bannerData;

    var w = Math.max(64, Math.round(this.cssW));
    var h = Math.max(48, Math.round(this.cssH));
    if (!this.maskCanvas) {
      this.maskCanvas = document.createElement('canvas');
      this.maskCtx = this.maskCanvas.getContext('2d');
    }
    this.maskCanvas.width = w;
    this.maskCanvas.height = h;

    var m = this.maskCtx;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalAlpha = 1;
    m.globalCompositeOperation = 'source-over';
    m.clearRect(0, 0, w, h);
    m.fillStyle = '#ffffff';
    m.textAlign = 'center';
    m.textBaseline = 'middle';
    var cx = w / 2;
    var cy = h / 2;
    var mt = this.bannerMetrics();
    m.font = mt.small + 'px "Press Start 2P", "VT323", monospace';
    m.fillText('SIMULATION_COMPLETE', cx, cy + mt.dy1);
    m.font = mt.tagFont + 'px "Press Start 2P", "VT323", monospace';
    m.fillText(tag, cx, cy);
    m.font = mt.small + 'px "Press Start 2P", "VT323", monospace';
    m.fillText(this.winner ? '>> WINNER <<' : '>> NO_CONTEST <<', cx, cy + mt.dy3);

    var data = m.getImageData(0, 0, w, h).data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      var off = y * w * 4 + 3;
      for (var x = 0; x < w; x++) {
        if (data[off + x * 4] > 110) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    this.bannerData = data;
    this.bannerBox = maxX < 0 ? null : {
      x0: Math.max(0, minX - 12),
      y0: Math.max(0, minY - 12),
      x1: Math.min(w - 1, maxX + 12),
      y1: Math.min(h - 1, maxY + 12)
    };
    this.bannerKey = key;
    return data;
  };

  Game.prototype.drawFinishBanner = function (ctx, now) {
    var fx = this.finishFx;
    if (!fx) return;
    var el = now - fx.t0;
    if (el < 0) return;

    var w = Math.round(this.cssW);
    var h = Math.round(this.cssH);
    var cx = w / 2;
    var cy = h / 2;
    /* 충격파 링과 같은 프레임에 등장한다 — 링이 다 지나가기를 기다리지 않는다 */
    var phase = Math.floor(el / BAN_STEP_MS);

    /* 중앙 줌: 작게 시작해 스텝마다 커지며 선명해진다(저프레임 유지) */
    var zoom = 1;
    if (phase < BAN_PHASES) {
      zoom = BAN_ZOOM0 + (1 - BAN_ZOOM0) * (phase / (BAN_PHASES - 1));
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);

    if (phase >= BAN_PHASES) {
      this.drawFinishText(ctx, cx, cy);
      ctx.restore();
      return;
    }

    var data = this.buildBannerMask();
    var box = this.bannerBox;
    if (!box || !data) {
      this.drawFinishText(ctx, cx, cy);
      ctx.restore();
      return;
    }

    var block = BAN_BLOCKS[phase] || 2;
    var amp = (BAN_PHASES - 1 - phase) * 0.85; /* 모자이크일수록 크게 울렁이고 선명해지며 0이 된다 */
    var chars = ['█', '▓', '▒', '░'];
    /* 단계가 촘촘할수록 덩어리 경계가 부드럽게 이어진다 */
    var thresh = [0.66, 0.46, 0.26, 0.09];
    /* 블록 안을 촘촘히 샘플링해야 밀도(=문자 등급)가 정교해진다 */
    var stride = Math.max(1, Math.round(block / 7));

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.round(block * 1.16) + 'px "JetBrains Mono", "Fira Code", monospace';

    var bx0 = Math.floor(box.x0 / block) * block;
    var by0 = Math.floor(box.y0 / block) * block;
    for (var by = by0; by <= box.y1; by += block) {
      for (var bx = bx0; bx <= box.x1; bx += block) {
        var hits = 0;
        var total = 0;
        for (var sy = by; sy < by + block && sy <= box.y1; sy += stride) {
          var rowOff = sy * w;
          for (var sx = bx; sx < bx + block && sx <= box.x1; sx += stride) {
            if (sx < 0 || sy < 0) continue;
            total++;
            if (data[(rowOff + sx) * 4 + 3] > 110) hits++;
          }
        }
        if (!total) continue;
        var cov = hits / total;
        var ci = -1;
        for (var t = 0; t < thresh.length; t++) {
          if (cov >= thresh[t]) { ci = t; break; }
        }
        if (ci < 0) continue;

        /* 터뷸런트 디스플레이스: 백색 잡음 대신 좌표 기반 사인 노이즈를 써서
           이웃 블록이 함께 울렁인다(따로 튀면 지글거려 보인다). 스텝마다 값만 갱신 */
        var nx = Math.sin(bx * 0.017 + phase * 1.9) + Math.sin(by * 0.011 - phase * 1.3) * 0.6;
        var ny = Math.cos(by * 0.015 - phase * 1.7) + Math.cos(bx * 0.009 + phase * 1.1) * 0.6;
        var tint = Math.sin(bx * 0.02 + by * 0.03 + phase * 0.9);
        ctx.fillStyle = tint > 0.9 ? fx.color : (tint < -0.94 ? '#8fa0b3' : '#e6ecf5');
        ctx.fillText(chars[ci],
          bx + block / 2 + nx * amp * 0.5,
          by + block / 2 + ny * amp * 0.5);
      }
    }
    ctx.restore();
  };

  /* 모자이크가 다 풀린 뒤의 선명한 최종 배너 */
  Game.prototype.drawFinishText = function (ctx, cx, cy) {
    var mt = this.bannerMetrics();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = mt.small + 'px "Press Start 2P", "VT323", monospace';
    ctx.fillStyle = '#4a5568';
    ctx.fillText('SIMULATION_COMPLETE', cx, cy + mt.dy1);
    ctx.font = mt.tagFont + 'px "Press Start 2P", "VT323", monospace';
    ctx.fillStyle = this.winner ? this.winner.color : '#4a5568';
    ctx.fillText(this.winner ? this.winner.tag : 'DRAW', cx, cy);
    ctx.font = mt.small + 'px "Press Start 2P", "VT323", monospace';
    ctx.fillStyle = '#e6ecf5';
    ctx.fillText(this.winner ? '>> WINNER <<' : '>> NO_CONTEST <<', cx, cy + mt.dy3);
  };

  WBF.Game = Game;
})();
