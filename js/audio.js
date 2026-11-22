/* Web Audio API 코드 합성 사운드 (외부 음원 없음) */
window.WBF = window.WBF || {};

WBF.Audio = (function () {
  var ctx = null;
  var master = null;
  var space = null;
  var noiseBuf = null;
  var muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    master.connect(comp);
    comp.connect(ctx.destination);

    /* 처치 아르페지오용 딜레이 공간 */
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

    return ctx;
  }

  function tone(type, f0, f1, dur, gain, when, dest) {
    if (!ensure()) return;
    var t = ctx.currentTime + (when || 0);
    var osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest || master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur, gain, f0, f1) {
    if (!ensure()) return;
    var t = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
    bp.Q.value = 1.2;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  return {
    resume: function () { ensure(); },
    setMuted: function (v) {
      muted = !!v;
      if (master) master.gain.value = muted ? 0 : 0.5;
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

    /* 타이틀 로고 등장음 — 위에서 아래로 내려앉는 오르간/신스 코드와 저음 서브.
       외부 음원 없이 오실레이터·필터·딜레이만 쓴다(하강형이라야 델타룬 로고 감성이 난다). */
    logo: function () {
      if (!ensure() || muted) return;
      var t0 = ctx.currentTime + 0.03;
      var i;

      /* 1) 저음 서브: 한 옥타브 아래로 천천히 내려앉는 사인 — 묵직한 바닥 */
      var sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(110, t0);
      sub.frequency.exponentialRampToValueAtTime(41.2, t0 + 2.3);
      var subG = ctx.createGain();
      subG.gain.setValueAtTime(0.0001, t0);
      subG.gain.exponentialRampToValueAtTime(0.3, t0 + 0.3);
      subG.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.9);
      sub.connect(subG);
      subG.connect(master);
      sub.start(t0);
      sub.stop(t0 + 3.0);

      /* 2) 코드 버스: 로우패스가 위에서 아래로 닫혀 어둠 속으로 가라앉는다 */
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.8;
      lp.frequency.setValueAtTime(3200, t0);
      lp.frequency.exponentialRampToValueAtTime(420, t0 + 2.1);
      var chordG = ctx.createGain();
      chordG.gain.setValueAtTime(0.0001, t0);
      chordG.gain.exponentialRampToValueAtTime(0.16, t0 + 0.42);
      chordG.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.7);
      lp.connect(chordG);
      chordG.connect(master);
      /* 깊이감: 기존 딜레이 공간으로 살짝 흘려보낸다 */
      var send = ctx.createGain();
      send.gain.value = 0.5;
      chordG.connect(send);
      send.connect(space);

      /* 3) 오르간 스택 — 단7도가 섞인 A단조가 반음 위에서 목표음으로 글라이드 */
      var f0 = [220, 261.63, 329.63, 392];
      for (i = 0; i < f0.length; i++) {
        var base = f0[i];
        var when = t0 + i * 0.06;
        var saw = ctx.createOscillator();
        saw.type = 'sawtooth';
        saw.frequency.setValueAtTime(base * 1.5, when);
        saw.frequency.exponentialRampToValueAtTime(base * 0.5, when + 1.25);
        var g1 = ctx.createGain();
        g1.gain.value = 0.055 - i * 0.006;
        saw.connect(g1);
        g1.connect(lp);
        saw.start(when);
        saw.stop(t0 + 3.0);

        var tri = ctx.createOscillator();
        tri.type = 'triangle';
        tri.frequency.setValueAtTime(base * 2, when);
        tri.frequency.exponentialRampToValueAtTime(base, when + 1.4);
        var g2 = ctx.createGain();
        g2.gain.value = 0.04 - i * 0.004;
        tri.connect(g2);
        g2.connect(lp);
        tri.start(when);
        tri.stop(t0 + 3.0);
      }

      /* 4) 숨결 같은 노이즈 스웰 — 신비로운 공기감 */
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(1200, t0);
      bp.frequency.exponentialRampToValueAtTime(3200, t0 + 1.2);
      bp.frequency.exponentialRampToValueAtTime(600, t0 + 2.8);
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.exponentialRampToValueAtTime(0.05, t0 + 0.9);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.9);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(master);
      src.start(t0);
      src.stop(t0 + 3.0);
    },

    /* 시작 확인음 — 짧은 상승 사각파 두 음만. 저역 '우웅' 스윕은 울리지 않는다 */
    confirm: function (delay) {
      if (!ensure() || muted) return;
      var w = delay || 0;
      tone('square', 640, 980, 0.09, 0.085, w);
      tone('square', 980, 1280, 0.1, 0.07, w + 0.08);
    },

    /* 말풍선 타이핑 대화음 — 동물의 숲풍 짧은 사인 블립.
       커서마다 다른 기본 음높이를 받고, 글자 순서에 따라 살짝 올라간다.
       외부 음원 없이 오실레이터 두 개로만 만든다. */
    talk: function (pitch, step) {
      if (!ensure() || muted) return;
      var base = (pitch || 640) * (1 + ((step || 0) % 4) * 0.055);
      tone('sine', base, base * 1.3, 0.055, 0.052);
      tone('triangle', base * 0.5, base * 0.54, 0.045, 0.018);
    },

    /* 충돌 속도/데미지에 따라 피치·필터가 변하는 타격음 */
    hit: function (strength) {
      if (!ensure() || muted) return;
      var s = Math.max(0.2, Math.min(2, strength || 1));
      var base = 150 / s + 55;
      tone('sine', base * 2.4, base * 0.55, 0.18 + 0.05 * s, 0.22 * Math.min(1.6, s));
      tone('triangle', base * 0.9, base * 0.4, 0.22, 0.12 * Math.min(1.6, s));
      noise(0.09, 0.14 * Math.min(1.5, s), 1800 / s, 600 / s);
    },

    blade: function () {
      if (!ensure() || muted) return;
      noise(0.06, 0.07, 4200, 1800);
      tone('sawtooth', 780, 320, 0.09, 0.05);
    },

    shoot: function () {
      if (!ensure() || muted) return;
      tone('sawtooth', 1500, 180, 0.22, 0.16);
      tone('square', 900, 120, 0.16, 0.07);
      noise(0.14, 0.1, 3200, 400);
    },

    split: function () {
      if (!ensure() || muted) return;
      tone('square', 620, 160, 0.26, 0.1);
      tone('sine', 240, 640, 0.3, 0.1, 0.05);
    },

    pop: function () {
      if (!ensure() || muted) return;
      tone('sine', 220, 60, 0.3, 0.2);
      noise(0.24, 0.16, 900, 120);
    },

    victory: function () {
      if (!ensure() || muted) return;
      var notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      for (var i = 0; i < notes.length; i++) {
        tone('triangle', notes[i], notes[i], 0.34, 0.13, i * 0.11, space);
        tone('sine', notes[i] * 2, notes[i] * 2, 0.22, 0.05, i * 0.11 + 0.01, space);
      }
    }
  };
})();
