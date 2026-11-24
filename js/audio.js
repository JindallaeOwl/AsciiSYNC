/* Web Audio API 코드 합성 사운드 (외부 음원 없음)

   컨셉: 어두운 사이버 터미널
   - 음높이가 있는 소리는 모두 A 자연단음계(타이틀 로고와 같은 조)에 맞춘다. 어떤 소리가 겹쳐도 화음이 된다.
   - 디지털 질감: 일부 소리는 crush 버스(계단식 파형 왜곡)를 거쳐 아스키처럼 '양자화된' 결을 낸다.
   - 공간: 짧은 딜레이(space)와 어두운 방 잔향(room)으로 깊이를 준다.
   - 배경 드론: 경기 중에만 아주 작게 깔리는 저음 + CRT 험. 서든데스에는 필터가 열리고 맥박처럼 뛴다.
   - 클래스 음색: BLADE 금속 울림 · RAILGUN 디지털 전격 · JUGGERNAUT 쇳덩이 저음 · SPLITTER 유리 결정.
   - 성능: 동시 발음 수 상한(MAX_VOICES)과 소리별 최소 간격(gate)으로 난전에서도 노드가 쌓이지 않는다. */
window.WBF = window.WBF || {};

WBF.Audio = (function () {
  var ctx = null;
  var master = null;
  var space = null;
  var room = null;
  var crush = null;
  var noiseBuf = null;
  var muted = false;
  var MASTER_GAIN = 0.5;

  /* 동시 발음 제한 */
  var MAX_VOICES = 40;
  var voices = 0;
  var lastAt = {};
  var capOff = false;   /* 타이틀 로고처럼 노드를 한꺼번에 많이 예약하는 소리만 잠시 상한을 끈다 */

  /* 배경 드론 */
  var drone = null;
  var droneState = 0;

  /* ---------- 음계 ----------
     A 자연단음계(A B C D E F G). deg는 음계 도수(0 = A), oct는 A2(110Hz) 기준 옥타브. */
  var SCALE = [0, 2, 3, 5, 7, 8, 10];
  function note(deg, oct) {
    var o = (oct || 0) + Math.floor(deg / 7);
    var d = ((deg % 7) + 7) % 7;
    return 110 * Math.pow(2, o + SCALE[d] / 12);
  }

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    master.connect(comp);
    comp.connect(ctx.destination);

    /* 딜레이 공간(짧은 메아리) */
    space = ctx.createGain();
    var delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.22;
    var fb = ctx.createGain();
    fb.gain.value = 0.34;
    var wet = ctx.createGain();
    wet.gain.value = 0.5;
    space.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(master);

    var len = Math.floor(ctx.sampleRate * 0.6);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    /* 어두운 방 잔향: 지수 감쇠 노이즈 임펄스(1.6초)를 한 번 만들어 컨볼버에 건다 */
    room = ctx.createGain();
    var conv = ctx.createConvolver();
    var rl = Math.floor(ctx.sampleRate * 1.6);
    var ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var cd = ir.getChannelData(ch);
      for (i = 0; i < rl; i++) cd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2);
    }
    conv.buffer = ir;
    var roomLp = ctx.createBiquadFilter();
    roomLp.type = 'lowpass';
    roomLp.frequency.value = 2400;
    var roomWet = ctx.createGain();
    roomWet.gain.value = 0.32;
    room.connect(conv);
    conv.connect(roomLp);
    roomLp.connect(roomWet);
    roomWet.connect(master);

    /* crush 버스: 계단식 파형(12단계)으로 디지털 양자화 결을 낸다.
       신호가 작으면 계단에 묻혀 사라지므로 앞에서 키우고 뒤에서 줄인다. */
    crush = ctx.createGain();
    crush.gain.value = 5;
    var shaper = ctx.createWaveShaper();
    var n = 1024;
    var curve = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * 6) / 6;
    }
    shaper.curve = curve;
    var crushOut = ctx.createGain();
    crushOut.gain.value = 0.17;
    crush.connect(shaper);
    shaper.connect(crushOut);
    crushOut.connect(master);

    return ctx;
  }

  /* 소리별 최소 간격 — 같은 소리가 한 프레임에 수십 번 겹치지 않게 한다 */
  function gate(key, ms) {
    var t = performance.now();
    if (lastAt[key] && t - lastAt[key] < ms) return false;
    lastAt[key] = t;
    return true;
  }

  function ok() {
    return ensure() && !muted;
  }

  function track(node) {
    voices++;
    node.onended = function () { voices--; };
  }

  /* 오실레이터 한 음: 주파수 f0→f1 지수 이동, 짧은 어택 뒤 지수 감쇠.
     dest를 주지 않으면 master. send(선택)는 { bus, amt }로 공간 버스에 함께 보낸다. */
  function tone(type, f0, f1, dur, gain, when, dest, send) {
    if (!ensure()) return;
    if (voices >= MAX_VOICES && !capOff) return;
    var t = ctx.currentTime + (when || 0);
    var osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest || master);
    if (send) {
      var sg = ctx.createGain();
      sg.gain.value = send.amt;
      g.connect(sg);
      sg.connect(send.bus);
    }
    track(osc);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /* 필터 노이즈 한 번: kind = 'bandpass' | 'highpass' | 'lowpass', 필터 주파수 f0→f1 */
  function noise(dur, gain, f0, f1, kind, when, dest, q) {
    if (!ensure()) return;
    if (voices >= MAX_VOICES && !capOff) return;
    var t = ctx.currentTime + (when || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = dur > 0.55;
    var bp = ctx.createBiquadFilter();
    bp.type = kind || 'bandpass';
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    bp.Q.value = q || 1.2;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest || master);
    track(src);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /* 유리·결정 핑: 사인 + 비정수배 배음(×2.76)으로 맑고 차가운 종소리 */
  function glass(f, dur, gain, when, dest) {
    tone('sine', f, f * 0.998, dur, gain, when, dest || space);
    tone('sine', f * 2.76, f * 2.75, dur * 0.55, gain * 0.45, when, dest || space);
  }

  /* 블록 딸깍: 레고처럼 '누르고 → 걸리는' 두 번 딸깍.
     고역 대역 노이즈 클릭 + 음계 음높이로 빠르게 떨어지는 짧은 몸통 '톡'(삼각파),
     18ms 뒤 한 단계 높고 작은 두 번째 클릭. dig이면 두 번째 클릭을 crush 버스 사각파로 낸다. */
  function snap(f, band, amt, when, dig) {
    noise(0.012, 0.11 * amt, band, band * 0.8, 'bandpass', when, master, 3);
    tone('triangle', f * 2, f, 0.05, 0.12 * amt, when);
    noise(0.008, 0.07 * amt, band * 1.5, band * 1.3, 'bandpass', when + 0.018, master, 4);
    if (dig) tone('square', f * 4, f * 4, 0.02, 0.05 * amt, when + 0.018, crush);
    else tone('sine', f * 3, f * 2.6, 0.03, 0.05 * amt, when + 0.018);
  }

  /* 금속 울림: 사인 두 개(×1 / ×2.41)와 짧은 고역 노이즈 — 칼날 '칭' */
  function metal(f, dur, gain, when) {
    tone('sine', f, f * 0.99, dur, gain, when, master, room ? { bus: room, amt: 0.4 } : null);
    tone('sine', f * 2.41, f * 2.38, dur * 0.6, gain * 0.5, when);
    noise(0.04, gain * 0.9, 7000, 4000, 'highpass', when);
  }

  /* ---------- 배경 드론 ----------
     A1(55Hz)·E2 저음 두 겹 + 로우패스 노이즈 험. 상태: 0 꺼짐 · 1 경기 중 · 2 서든데스.
     노드는 처음 켤 때 한 번 만들고 이후에는 게인·필터·맥박 깊이만 옮긴다. */
  function buildDrone() {
    var out = ctx.createGain();
    out.gain.value = 0;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 2;
    /* 맥박: 저주파 LFO로 볼륨을 흔든다(서든데스에서만 깊어진다) */
    var pulse = ctx.createGain();
    pulse.gain.value = 1;
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 1.8;
    var lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0;
    lfo.connect(lfoDepth);
    lfoDepth.connect(pulse.gain);
    lfo.start();

    var a = ctx.createOscillator();
    a.type = 'sawtooth';
    a.frequency.value = 55;
    var b = ctx.createOscillator();
    b.type = 'sawtooth';
    b.frequency.value = 82.41 * 1.003;
    var ga = ctx.createGain();
    ga.gain.value = 0.5;
    var gb = ctx.createGain();
    gb.gain.value = 0.32;
    a.connect(ga);
    b.connect(gb);
    ga.connect(lp);
    gb.connect(lp);

    var hum = ctx.createBufferSource();
    hum.buffer = noiseBuf;
    hum.loop = true;
    var hlp = ctx.createBiquadFilter();
    hlp.type = 'bandpass';
    hlp.frequency.value = 120;
    hlp.Q.value = 6;
    var hg = ctx.createGain();
    hg.gain.value = 0.9;
    hum.connect(hlp);
    hlp.connect(hg);
    hg.connect(lp);

    lp.connect(pulse);
    pulse.connect(out);
    out.connect(master);
    a.start();
    b.start();
    hum.start();
    return { out: out, lp: lp, lfoDepth: lfoDepth, lfo: lfo };
  }

  return {
    resume: function () { ensure(); },
    setMuted: function (v) {
      muted = !!v;
      if (master) master.gain.value = muted ? 0 : MASTER_GAIN;
    },
    isMuted: function () { return muted; },
    state: function () { return ctx ? ctx.state : 'none'; },

    /* 자동재생 잠금 해제 — 첫 사용자 제스처에서 한 번만 콜백을 부른다 */
    unlock: function (cb) {
      if (!ensure()) return;
      if (ctx.state === 'running') {
        if (cb) cb();
        return;
      }
      var done = false;
      function fire() {
        if (done) return;
        done = true;
        window.removeEventListener('pointerdown', fire, true);
        window.removeEventListener('keydown', fire, true);
        window.removeEventListener('touchstart', fire, true);
        ensure();
        if (cb) cb();
      }
      window.addEventListener('pointerdown', fire, true);
      window.addEventListener('keydown', fire, true);
      window.addEventListener('touchstart', fire, true);
    },

    /* ---------- 타이틀 ----------
       '시스템 부팅' 흐름: 로고 등장(전원 → 데이터 재잘거림 → 화음 착지) → 대기 드론(ambience 3)
       → 시작: 확인음 + 디지털 붕괴(titleOut) → 커튼이 걷힐 때 시스템 온라인(reveal). */

    /* 타이틀 로고 등장음 — 블록 조립(약 3.3초).
       로고 모자이크가 6칸 → 3칸 → 2칸 → 1칸 블록으로 쪼개지는 흐름에 맞춰 조립음을 4단계로 낸다.
       큰 블록은 묵직한 '툭', 작은 블록으로 갈수록 높고 가볍고 촘촘한 '딸깍'이 되고,
       마지막 1칸 조각은 crush 버스로 디지털 결을 입힌다. 1.25초에 큰 '카칭' 잠김과 함께
       A단조 화음 + 서브 킥이 착지하고 유리 종소리가 이어진다. 타이틀은 로고 완성(2.1초)에
       잠김이 오도록 0.85초에 이 소리를 부른다. 미리 예약하는 노드가 많아 동시 발음 상한을 잠시 끈다. */
    logo: function () {
      if (!ok()) return;
      var t0 = ctx.currentTime + 0.03;
      var i;
      capOff = true;

      /* 1) 바닥: 조립 내내 깔리는 낮은 서브 스웰(41→55Hz) */
      var sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(41.2, t0);
      sub.frequency.exponentialRampToValueAtTime(55, t0 + 1.25);
      var subG = ctx.createGain();
      subG.gain.setValueAtTime(0.0001, t0);
      subG.gain.exponentialRampToValueAtTime(0.14, t0 + 1.1);
      subG.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.0);
      sub.connect(subG);
      subG.connect(master);
      sub.start(t0);
      sub.stop(t0 + 3.1);

      /* 2) 조립 4단계: [시작, 끝, 개수, 몸통 음계 도수 범위, 옥타브, 노이즈 대역, 세기, crush 여부] */
      var waves = [
        [0.00, 0.34, 5, [0, 2], 0, 1400, 1.0, false],   /* 6칸: 묵직한 툭 */
        [0.34, 0.68, 8, [4, 7], 0, 2400, 0.8, false],   /* 3칸 */
        [0.68, 0.98, 11, [2, 4], 1, 3400, 0.62, false], /* 2칸 */
        [0.98, 1.20, 14, [0, 4], 2, 5200, 0.45, true]   /* 1칸: 작고 디지털한 틱 */
      ];
      for (var w = 0; w < waves.length; w++) {
        var wv = waves[w];
        for (i = 0; i < wv[2]; i++) {
          /* 단계 안에서도 간격을 조금씩 흔들어 손으로 끼우는 리듬을 낸다 */
          var when = wv[0] + (wv[1] - wv[0]) * ((i + 0.15 + Math.random() * 0.5) / wv[2]);
          var deg = wv[3][0] + ((Math.random() * (wv[3][1] - wv[3][0] + 1)) | 0);
          snap(note(deg, wv[4]), wv[5], wv[6], when, wv[7]);
        }
      }

      /* 3) 잠김 '카칭': 크게 두 번 딸깍 + 서브 킥 + 노이즈 크랙 */
      var lockAt = 1.25;
      snap(note(0, 1), 1800, 1.6, lockAt, false);
      snap(note(4, 2), 4200, 1.0, lockAt + 0.035, true);
      tone('sine', 92, 38, 0.55, 0.3, lockAt + 0.01, master, { bus: room, amt: 0.4 });
      noise(0.2, 0.09, 4000, 500, 'lowpass', lockAt + 0.01);

      /* 4) 화음 착지: A2·C3·E3·G3 디튠 톱니파 2겹, 로우패스가 열렸다 천천히 닫힌다 */
      var hitT = t0 + lockAt;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(300, hitT);
      lp.frequency.exponentialRampToValueAtTime(2400, hitT + 0.3);
      lp.frequency.exponentialRampToValueAtTime(520, hitT + 2.0);
      var padG = ctx.createGain();
      padG.gain.setValueAtTime(0.0001, hitT);
      padG.gain.exponentialRampToValueAtTime(0.11, hitT + 0.1);
      padG.gain.exponentialRampToValueAtTime(0.0001, hitT + 2.0);
      lp.connect(padG);
      padG.connect(master);
      var rs = ctx.createGain();
      rs.gain.value = 0.5;
      padG.connect(rs);
      rs.connect(room);
      var chord = [note(0, 0), note(2, 0), note(4, 0), note(6, 0)];
      for (i = 0; i < chord.length; i++) {
        for (var k = 0; k < 2; k++) {
          var o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = chord[i] * (k ? 1.006 : 0.997);
          var og = ctx.createGain();
          og.gain.value = 0.045 - i * 0.005;
          o.connect(og);
          og.connect(lp);
          o.start(hitT);
          o.stop(hitT + 2.1);
        }
      }

      /* 5) 유리 종소리: A4 · C5 · E5 · A5 */
      var bells = [note(0, 2), note(2, 2), note(4, 2), note(0, 3)];
      for (i = 0; i < bells.length; i++) glass(bells[i], 1.0, 0.05, lockAt + 0.12 + i * 0.12);

      capOff = false;
    },

    /* 시작 직후 붕괴 전환(약 0.9초): 화면의 셀이 흩어지듯 높은 음에서 낮은 음으로 쏟아지는
       계단 왜곡 블립 + 아래로 닫히는 고역 노이즈 + 낮게 꺼지는 사인 */
    titleOut: function () {
      if (!ok()) return;
      for (var i = 0; i < 14; i++) {
        var f = note(13 - i, 2);
        tone('square', f, f * 0.97, 0.035, 0.05, 0.12 + i * 0.055, crush);
      }
      noise(0.85, 0.07, 6500, 700, 'highpass', 0.1);
      tone('sine', note(0, 1), note(0, -1), 0.9, 0.12, 0.12, master, { bus: room, amt: 0.4 });
    },

    /* 커튼이 걷히며 게임 화면이 드러날 때(약 0.8초): 차오르는 공기 노이즈 + 끝에서 울리는
       '시스템 온라인' 차임(A4 → E5, 딜레이 공간) */
    reveal: function () {
      if (!ok()) return;
      noise(0.8, 0.06, 300, 2400, 'bandpass', 0, master, 1.4);
      tone('triangle', note(0, 2), note(0, 2), 0.25, 0.05, 0.55, master, { bus: space, amt: 0.5 });
      tone('triangle', note(4, 2), note(4, 2), 0.4, 0.05, 0.68, master, { bus: space, amt: 0.6 });
      tone('square', note(0, 3), note(0, 3), 0.04, 0.03, 0.68, crush);
    },

    /* 시작 확인음 — 터미널 입력 확인처럼 짧은 디지털 두 음(음계 E5 → A5). 저역 스윕은 울리지 않는다 */
    confirm: function (delay) {
      if (!ok()) return;
      var w = delay || 0;
      tone('square', note(4, 3), note(4, 3), 0.07, 0.07, w, crush);
      tone('square', note(0, 4), note(0, 4), 0.11, 0.06, w + 0.075, crush);
      tone('sine', note(0, 4), note(0, 4), 0.14, 0.05, w + 0.075, master, { bus: space, amt: 0.3 });
    },

    /* 말풍선 타이핑 대화음 — 동물의 숲풍 짧은 사인 블립.
       커서마다 다른 기본 음높이를 받고, 글자 순서에 따라 살짝 올라간다. */
    talk: function (pitch, step) {
      if (!ok()) return;
      var base = (pitch || 640) * (1 + ((step || 0) % 4) * 0.055);
      tone('sine', base, base * 1.3, 0.055, 0.052);
      tone('triangle', base * 0.5, base * 0.54, 0.045, 0.018);
    },

    /* ---------- 경기 ---------- */

    /* 충돌 타격: 묵직한 저음 쿵 + 짧은 노이즈 딸깍 + 세면 음계 고음 디지털 틱.
       strength 0.2~2(충돌 속도·피해 비례). */
    hit: function (strength) {
      if (!ok() || !gate('hit', 35)) return;
      var s = Math.max(0.2, Math.min(2, strength || 1));
      var k = Math.min(1.6, s);
      tone('sine', 95 + 40 * s, 42, 0.16 + 0.06 * s, 0.26 * k);
      noise(0.05, 0.13 * k, 2600, 900, 'bandpass');
      if (s > 0.9) {
        var deg = [0, 4, 7][(Math.random() * 3) | 0];
        tone('square', note(deg, 3), note(deg, 3), 0.05, 0.05 * k, 0, crush);
      }
    },

    /* BLADE 휘두름·베기·튕겨내기: 고역 바람 + 금속 '칭'(음계 E6 근처) */
    blade: function () {
      if (!ok() || !gate('blade', 45)) return;
      noise(0.08, 0.08, 7500, 2600, 'highpass');
      metal(note([4, 7, 9][(Math.random() * 3) | 0], 3), 0.22, 0.06, 0.015);
    },

    /* BLADE 고유 스킬 FLASH_CUT(일섬): 공기를 가르는 아주 짧은 고역 '슉'(위에서 아래로 닫히는 필터)
       + 날카로운 금속 '칭' 두 겹(E5·A5) → 0.16초 정적 뒤 베기 자국이 갈라지는 건조한 크랙과
       낮게 꺼지는 사인. 회전 바람 없이 한 번에 끊어 친다. */
    flashCut: function () {
      if (!ok()) return;
      noise(0.09, 0.14, 11000, 2500, 'highpass', 0, master, 0.8);
      metal(note(4, 3), 0.55, 0.09, 0.012);
      metal(note(0, 4), 0.4, 0.05, 0.03);
      noise(0.05, 0.11, 3800, 1400, 'bandpass', 0.16, master, 3);
      tone('square', note(0, 2), note(0, 2) * 0.97, 0.03, 0.04, 0.16, crush);
      tone('sine', note(0, 1), note(0, 0), 0.35, 0.12, 0.16, master, { bus: room, amt: 0.4 });
    },

    /* RAILGUN 일반 사격: 디지털 전격(계단 왜곡된 하강 사각파) + 고역 크랙 + 짧은 저음 반동 */
    shoot: function () {
      if (!ok() || !gate('shoot', 50)) return;
      tone('square', 1760, 220, 0.12, 0.09, 0, crush);
      noise(0.06, 0.12, 6000, 1500, 'highpass');
      tone('sine', 140, 50, 0.12, 0.14);
    },

    /* RAILGUN 고유 스킬 충전(기본 3초): 점점 높아지고 빨라지는 충전 윙윙 — 필터가 열리며 떨림이 빨라진다 */
    charge: function (dur) {
      if (!ok()) return;
      var d = dur || 3;
      var t = ctx.currentTime;
      var osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(note(0, 0), t);
      osc.frequency.exponentialRampToValueAtTime(note(0, 3), t + d);
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 6;
      lp.frequency.setValueAtTime(260, t);
      lp.frequency.exponentialRampToValueAtTime(5200, t + d);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.3);
      g.gain.linearRampToValueAtTime(0.11, t + d * 0.95);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.05);
      /* 떨림: 4Hz → 26Hz로 빨라지는 트레몰로 */
      var trem = ctx.createGain();
      trem.gain.value = 0.6;
      var lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(4, t);
      lfo.frequency.exponentialRampToValueAtTime(26, t + d);
      var depth = ctx.createGain();
      depth.gain.value = 0.4;
      lfo.connect(depth);
      depth.connect(trem.gain);
      osc.connect(lp);
      lp.connect(trem);
      trem.connect(g);
      g.connect(master);
      track(osc);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + d + 0.08);
      lfo.stop(t + d + 0.08);
    },

    /* RAILGUN 관통 레이저 발사: 두꺼운 저음 방전(디튠 톱니파 2겹, 계단 왜곡) + 넓은 노이즈 폭발 + 서브 + 고음 잔향 */
    laser: function () {
      if (!ok()) return;
      tone('sawtooth', 55, 41, 0.75, 0.2, 0, crush);
      tone('sawtooth', 55 * 1.012, 41, 0.75, 0.12);
      noise(0.6, 0.24, 9000, 300, 'lowpass', 0, master, 0.7);
      tone('sine', 90, 28, 0.7, 0.32, 0, master, { bus: room, amt: 0.6 });
      tone('sine', note(4, 4), note(4, 4), 0.5, 0.05, 0.02, space);
    },

    /* JUGGERNAUT 과열 돌파(벽 반사): 톱니 래칫 딸깍 5번 + 차오르는 쇳소리 으르렁 */
    overheat: function () {
      if (!ok() || !gate('overheat', 120)) return;
      for (var i = 0; i < 5; i++) noise(0.02, 0.1, 1600, 1200, 'bandpass', i * 0.028, master, 4);
      tone('sawtooth', 55, 110, 0.4, 0.09);
      tone('square', note(0, 0), note(0, 1), 0.35, 0.04, 0, crush);
    },

    /* JUGGERNAUT 고유 스킬 GROUND_SLAM: 거대한 서브 붐 + 땅울림 노이즈 + 불협 쇳덩이 철컥(A·Bb) */
    slam: function () {
      if (!ok()) return;
      tone('sine', 72, 26, 0.95, 0.42, 0, master, { bus: room, amt: 0.7 });
      noise(0.55, 0.22, 900, 120, 'lowpass', 0, master, 0.8);
      tone('square', 220, 200, 0.16, 0.07, 0, crush);
      tone('square', 233.08, 210, 0.16, 0.06, 0.004, crush);
      tone('triangle', 110, 55, 0.5, 0.12);
    },

    /* SPLITTER 고유 스킬 FRAG_BURST: 자탄 9발 = 0.25초에 흩어지는 유리 핑 9개(음계 고음) */
    frag: function () {
      if (!ok()) return;
      for (var i = 0; i < 9; i++) {
        var deg = [0, 2, 4, 5, 7, 9, 11][(Math.random() * 7) | 0];
        glass(note(deg, 4), 0.28, 0.045, i * 0.028 + Math.random() * 0.01);
      }
      noise(0.16, 0.08, 5000, 2500, 'highpass');
    },

    /* SPLITTER 분열: 결정이 깨지는 고역 노이즈 + 하강하는 유리 핑 무더기 + 낮게 떨어지는 사인 */
    split: function () {
      if (!ok()) return;
      noise(0.35, 0.16, 6000, 2200, 'highpass', 0, master, 0.9);
      var degs = [11, 9, 7, 4, 2];
      for (var i = 0; i < degs.length; i++) glass(note(degs[i], 3), 0.4, 0.06, i * 0.045);
      tone('sine', note(0, 2), note(0, 0), 0.45, 0.12, 0.02, master, { bus: room, amt: 0.5 });
    },

    /* 처치: 데이터가 깨지는 글리치 — 계단 왜곡된 무작위 음계 블립 8개 + 노이즈 + 저음 추락 */
    pop: function () {
      if (!ok()) return;
      for (var i = 0; i < 8; i++) {
        var f = note((Math.random() * 14) | 0, 2);
        tone('square', f, f, 0.018, 0.07, i * 0.019, crush);
      }
      noise(0.26, 0.16, 1400, 160, 'bandpass', 0.02);
      tone('sine', 130, 32, 0.45, 0.24, 0.02, master, { bus: room, amt: 0.5 });
    },

    /* 벽 반사: 아주 작은 클래스별 틱(난전에서 거슬리지 않게 작게, 0.06초 간격 제한) */
    wall: function (typeId, speed) {
      if (!ok() || !gate('wall_' + typeId, 60)) return;
      var v = Math.max(0.4, Math.min(1.4, (speed || 8) / 10));
      if (typeId === 'blade') tone('sine', note(4, 4), note(4, 4) * 0.98, 0.05, 0.03 * v);
      else if (typeId === 'railgun') tone('square', note(0, 4), note(0, 4), 0.025, 0.025 * v, 0, crush);
      else if (typeId === 'juggernaut') {
        tone('sine', 85, 45, 0.12, 0.12 * v);
        noise(0.04, 0.05 * v, 700, 300, 'bandpass');
      } else glass(note(7, 4), 0.12, 0.025 * v, 0, master);
    },

    /* 스킬 게이지 완충: 클래스별 음높이의 상승 두 음 차임(딜레이 공간) */
    ready: function (typeId) {
      if (!ok()) return;
      var root = { blade: 4, railgun: 7, juggernaut: 0, splitter: 9 }[typeId];
      if (root === undefined) root = 4;
      var oct = typeId === 'juggernaut' ? 2 : 3;
      tone('triangle', note(root, oct), note(root, oct), 0.12, 0.06, 0, master, { bus: space, amt: 0.5 });
      tone('triangle', note(root + 4, oct), note(root + 4, oct), 0.2, 0.06, 0.09, master, { bus: space, amt: 0.6 });
      tone('square', note(root + 7, oct), note(root + 7, oct), 0.05, 0.03, 0.09, crush);
    },

    /* 서든데스 경보: 반음 아래로 떨어지는 경고음(A4→G#4) 3번 + 저음 스웰 */
    suddenDeath: function () {
      if (!ok()) return;
      for (var i = 0; i < 3; i++) {
        tone('square', 440, 415.3, 0.22, 0.07, i * 0.32, crush);
        tone('sine', 440, 415.3, 0.22, 0.06, i * 0.32);
      }
      tone('sawtooth', 55, 55, 1.1, 0.1, 0, master, { bus: room, amt: 0.4 });
    },

    /* 승리: 단조(Am) 화음이 장조(A)로 풀리고, 종소리가 딜레이·잔향 속에 퍼진다 */
    victory: function () {
      if (!ok()) return;
      var minor = [note(0, 1), note(2, 2), note(4, 2)];        /* A3 C4 E4 */
      var major = [note(0, 1), 277.18, note(4, 2), note(0, 2)]; /* A3 C#4 E4 A4 */
      var i;
      for (i = 0; i < minor.length; i++) {
        tone('sawtooth', minor[i], minor[i], 0.55, 0.045, 0, master, { bus: room, amt: 0.5 });
      }
      for (i = 0; i < major.length; i++) {
        tone('sawtooth', major[i], major[i], 1.6, 0.05, 0.42, master, { bus: room, amt: 0.6 });
        tone('triangle', major[i] * 2, major[i] * 2, 1.4, 0.04, 0.42 + i * 0.05, space);
      }
      var bells = [note(0, 3), note(4, 3), note(0, 4), note(4, 4)];
      for (i = 0; i < bells.length; i++) glass(bells[i], 0.9, 0.05, 0.5 + i * 0.12);
      tone('sine', 55, 55, 1.8, 0.16, 0.42);
    },

    /* 배경 드론 상태(0 꺼짐 · 1 경기 중 · 2 서든데스 · 3 타이틀 대기). 매 프레임 불러도 상태가 바뀔 때만 움직인다 */
    ambience: function (state) {
      if (state === droneState) return;
      if (!ctx || ctx.state !== 'running') {
        if (state === 0) droneState = 0;
        return;
      }
      if (!drone) drone = buildDrone();
      droneState = state;
      var t = ctx.currentTime;
      /* 3 = 타이틀 대기: 경기보다 작고 어둡게(로우패스 200Hz) */
      var gainTo = state === 0 ? 0 : (state === 2 ? 0.075 : (state === 3 ? 0.03 : 0.045));
      drone.out.gain.cancelScheduledValues(t);
      drone.out.gain.setTargetAtTime(gainTo, t, state === 0 ? 0.25 : (state === 3 ? 1.6 : 0.8));
      drone.lp.frequency.setTargetAtTime(state === 2 ? 900 : (state === 3 ? 200 : 320), t, 1.2);
      drone.lfoDepth.gain.setTargetAtTime(state === 2 ? 0.55 : 0, t, 0.6);
      drone.lfo.frequency.setTargetAtTime(state === 2 ? 2.4 : 1.8, t, 0.6);
    }
  };
})();
