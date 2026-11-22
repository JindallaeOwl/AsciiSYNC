# 기술 메모 — 점선 테두리가 가루로 풀리는 닫힘 효과

속삭임 말풍선이 닫힐 때, 둥근 점선 테두리가 1~3px 미세 입자로 부스러져 바깥으로 흩어지며 사라지는 연출.
현재 구현 위치: `js/swarm.js`의 `edgePoint` · `fizzDust` · `fadeBubble`, `css/style.css`의 `.sw-dust` / `@keyframes sw-dust-fly`.
다른 UI 요소(“점선 테두리 + 흩어지는 닫힘”)에 그대로 옮겨 쓸 수 있도록 원리와 코드를 남긴다.

---

## 1. 한 줄 원리

**“테두리 둘레를 1차원 거리 s로 펴 놓고, 점선 주기마다 그 선 위의 점과 바깥 법선을 구해 입자를 뿌린다. 입자는 CSS 애니메이션 하나로 날아가 사라지고, JS는 생성과 컨테이너 정리만 한다.”**

---

## 2. 닫힘 순서

1. 말풍선이 닫힐 때(`fadeBubble`) 아직 화면에 있는 상태에서 `getBoundingClientRect()`로 사각형을 잰다.
2. `fizzDust()`가 둘레를 따라 입자 n개를 만들고, 각 입자에 이동 벡터·밝기·최종 크기·수명을 CSS 변수로 심는다.
3. 점선 SVG(`.sw-dash`)에서 `on` 클래스를 뺀다 → 점선 이동 애니메이션이 멈추고(잔상 방지) 180ms 동안 옅어진다.
4. 말풍선 본체는 `.whisper.out` 규칙으로 **180ms** 만에 옅어진다(일반 말풍선은 380ms).
5. 가루는 남아서 제 수명대로 떠오르다 사라지고, 가장 오래 사는 입자 + 140ms 뒤에 컨테이너를 제거한다.

---

## 3. 핵심 아이디어 6가지

### ① 점선을 “선 위의 좌표”로 펴 놓는다

둥근 사각형 둘레를 `s`(0 ~ 둘레 길이) 하나로 매개변수화한다. 구간 순서는 시계 방향:
위 변 → 오른쪽 위 곡선 → 오른쪽 변 → 오른쪽 아래 곡선 → 아래 변 → 왼쪽 아래 곡선 → 왼쪽 변 → 왼쪽 위 곡선.

각 구간은 “길이 + `s`를 받아 점과 **바깥 법선(nx, ny)** 을 돌려주는 함수” 쌍이다. 직선 구간은 법선이 축 방향 상수, 곡선 구간은 모서리 중심에서의 각도로 법선을 구한다.

```js
function edgePoint(w, h, r, s) {
  var ax = Math.max(0, w - r * 2), ay = Math.max(0, h - r * 2);
  var arc = Math.PI * r / 2;
  var segs = [
    [ax, function (d) { return { x: r + d, y: 0, nx: 0, ny: -1 }; }],
    [arc, function (d) {
      var a = -Math.PI / 2 + (r > 0 ? d / r : 0);
      return { x: w - r + Math.cos(a) * r, y: r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
    }],
    [ay, function (d) { return { x: w, y: r + d, nx: 1, ny: 0 }; }],
    [arc, function (d) {
      var a = (r > 0 ? d / r : 0);
      return { x: w - r + Math.cos(a) * r, y: h - r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
    }],
    [ax, function (d) { return { x: w - r - d, y: h, nx: 0, ny: 1 }; }],
    [arc, function (d) {
      var a = Math.PI / 2 + (r > 0 ? d / r : 0);
      return { x: r + Math.cos(a) * r, y: h - r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
    }],
    [ay, function (d) { return { x: 0, y: h - r - d, nx: -1, ny: 0 }; }],
    [arc, function (d) {
      var a = Math.PI + (r > 0 ? d / r : 0);
      return { x: r + Math.cos(a) * r, y: r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
    }]
  ];
  for (var i = 0; i < segs.length; i++) {
    var len = segs[i][0];
    if (len > 0 && s <= len) return segs[i][1](s);
    s -= len;
  }
  return { x: 0, y: 0, nx: 0, ny: -1 };
}
```

> 이 함수가 “점선이 도는 길”과 “입자가 태어나는 자리”를 **같은 좌표계**로 묶어 주는 핵심이다. 곡선 구간이 없으면 위·아래·양옆 직선만 남아 모서리에서 입자가 비어 보인다.

### ② 간격을 점선 주기와 똑같이 맞춘다

점선은 `stroke-dasharray: 4 6` = **10px 주기**다. 입자도 `DUST_STEP = 10`으로 놓아 “점선 한 올이 부스러지는” 인상을 만든다. 개수는 둘레 길이에서 뽑고 안전 범위로 자른다.

```js
var perim = 2 * Math.max(0, bw - rr * 2) + 2 * Math.max(0, bh - rr * 2) + 2 * Math.PI * rr;
var n = Math.round(clamp(perim / DUST_STEP, 8, DUST_MAX));   // DUST_MAX = 140
...
var s = perim * (k + Math.random() * 0.8) / n;   // 균등 분할 + 최대 0.8칸 흩뿌림
```

균등 분할만 하면 기계적으로 보이므로, 각 입자의 `s`에 0~0.8 주기만큼 난수를 더해 규칙성만 깬다(순서는 유지).

### ③ 기준선은 “테두리 상자 안쪽 1px”

CSS 테두리는 상자 안쪽에 1px로 그려진다. 그래서 폭·높이에서 1px을 빼고(`bw = w - 1`), 모서리 반지름도 CSS와 같은 `DASH_RX = 8`을 쓰되 짧은 변의 절반을 넘지 않게 묶는다.

```js
var rr = Math.max(0, Math.min(DASH_RX, bw * 0.5 - 0.5, bh * 0.5 - 0.5));
```

입자 좌표도 같은 선에 얹는다. 입자 크기만큼 절반을 빼서 **입자 중심이 선 위**에 오게 한다.

```js
i.style.left = (p.x + 0.5 - size / 2).toFixed(1) + 'px';
i.style.top  = (p.y + 0.5 - size / 2).toFixed(1) + 'px';
```

### ④ 방향 = 바깥 법선 + 위로 뜨는 힘 + 약간의 난수

법선 방향으로 밀면 말풍선 밖으로 퍼지고, y에 음수를 더하면 위로 떠오른다. 여기에 좌우 난수를 섞어“가루” 느낌을 만든다.

```js
var out = 5 + Math.random() * 18;
var dx = p.nx * out + (Math.random() - 0.5) * 8;
var dy = p.ny * out - (5 + Math.random() * 22);
```

- 위 변 입자: `ny = -1` → 더 위로
- 아래 변 입자: `ny = +1` → 바깥(아래)으로 나갔다가 위로 뜨는 힘에 눌려 살짝 내려간 뒤 흩어짐
- 옆 변·모서리: 바깥 + 위로 대각선

### ⑤ 수명·궤적은 CSS 한 장에 맡긴다

JS는 입자를 만들고 값을 심기만 한다. 프레임마다 위치를 계산하지 않으므로 개수가 늘어도 메인 루프 비용이 없다.

```css
#swarmLayer .sw-dust i {
  border-radius: 50%;
  position: absolute;
  display: block;
  line-height: 1;
  opacity: 0;
  will-change: transform, opacity;
  animation-name: sw-dust-fly;
  animation-timing-function: cubic-bezier(0.22, 0.85, 0.3, 1); /* 빠르게 출발 → 감속 */
  animation-fill-mode: forwards;
}

/* --dx/--dy 날아가는 방향 · --o 시작 밝기 · --sc 마지막 크기 배율 */
@keyframes sw-dust-fly {
  0%   { opacity: 0; transform: translate(0, 0) scale(1); }
  12%  { opacity: var(--o);
         transform: translate(calc(var(--dx) * 0.08), calc(var(--dy) * 0.06)) scale(1); }
  60%  { opacity: calc(var(--o) * 0.75);
         transform: translate(calc(var(--dx) * 0.62), calc(var(--dy) * 0.58)) scale(calc(var(--sc) * 0.85)); }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(var(--sc)); }
}
```

포인트: 0%에서 투명 → 12%에서 `--o`로 확 밝아지며 **짧게 “태어나는” 순간**을 준다. 60%에서 0.62 지점을 지나며 조금 남아 있고, 마지막에 `--sc`로 크기를 줄이며 사라진다. 감속 이징이라 “떠오르다 가라앉는” 느낌이 난다.

### ⑥ 정리는 컨테이너 하나만

입자마다 타이머를 걸지 않는다. 가장 긴 `수명 + 지연`을 누적해 두고 한 번만 제거한다.

```js
var dur = 640 + Math.random() * 520;   // 0.64 ~ 1.16s
var delay = Math.random() * 200;       // 0 ~ 0.2s
...
if (dur + delay > longest) longest = dur + delay;
...
window.setTimeout(function () {
  if (box.parentNode) box.parentNode.removeChild(box);
}, Math.round(longest) + 140);
```

---

## 4. 전체 JS (`js/swarm.js`)

```js
var DUST_STEP = 10;   /* 점선 한 주기(선 4px + 틈 6px)와 같은 간격 */
var DUST_MAX = 140;

function fizzDust(el, color) {
  if (!layer || !el) return;
  var rect = el.getBoundingClientRect();
  var w = rect.width, h = rect.height;
  if (!(w > 8) || !(h > 8)) return;
  /* 화면 밖으로 완전히 나간 자리면 가루를 띄우지 않는다 */
  if (rect.right < -20 || rect.left > vw() + 20 ||
      rect.bottom < -20 || rect.top > vh() + 20) return;

  var box = document.createElement('div');
  box.className = 'sw-dust';
  box.setAttribute('aria-hidden', 'true');
  box.style.left = rect.left.toFixed(1) + 'px';
  box.style.top = rect.top.toFixed(1) + 'px';
  box.style.width = w.toFixed(1) + 'px';
  box.style.height = h.toFixed(1) + 'px';
  box.style.zIndex = String(zSeq);       /* 말풍선과 같은 층, 나중에 붙어 위에 그려진다 */
  layer.appendChild(box);

  var bw = Math.max(1, w - 1), bh = Math.max(1, h - 1);
  var rr = Math.max(0, Math.min(DASH_RX, bw * 0.5 - 0.5, bh * 0.5 - 0.5));
  var perim = 2 * Math.max(0, bw - rr * 2) + 2 * Math.max(0, bh - rr * 2) + 2 * Math.PI * rr;
  var n = Math.round(clamp(perim / DUST_STEP, 8, DUST_MAX));
  var longest = 0;

  for (var k = 0; k < n; k++) {
    var s = perim * (k + Math.random() * 0.8) / n;
    var p = edgePoint(bw, bh, rr, s);
    var i = document.createElement('i');
    var size = 1 + Math.random() * 1.8;
    i.style.left = (p.x + 0.5 - size / 2).toFixed(1) + 'px';
    i.style.top = (p.y + 0.5 - size / 2).toFixed(1) + 'px';
    i.style.width = size.toFixed(2) + 'px';
    i.style.height = size.toFixed(2) + 'px';
    i.style.background = color || '#7fb8ff';

    var out = 5 + Math.random() * 18;
    var dx = p.nx * out + (Math.random() - 0.5) * 8;
    var dy = p.ny * out - (5 + Math.random() * 22);
    i.style.setProperty('--dx', dx.toFixed(1) + 'px');
    i.style.setProperty('--dy', dy.toFixed(1) + 'px');
    i.style.setProperty('--o', (0.32 + Math.random() * 0.5).toFixed(2));
    i.style.setProperty('--sc', (0.4 + Math.random() * 0.7).toFixed(2));

    var dur = 640 + Math.random() * 520;
    var delay = Math.random() * 200;
    i.style.animationDuration = Math.round(dur) + 'ms';
    i.style.animationDelay = Math.round(delay) + 'ms';
    if (dur + delay > longest) longest = dur + delay;
    box.appendChild(i);
  }

  window.setTimeout(function () {
    if (box.parentNode) box.parentNode.removeChild(box);
  }, Math.round(longest) + 140);
}
```

호출 지점(`fadeBubble`) — 점선 클래스를 떼는 것과 순서가 중요하다.

```js
if (el.classList.contains('whisper')) {
  fizzDust(el, c.color);
  if (c.dashEl) c.dashEl.classList.remove('on');   /* 점선 이동 정지 + 180ms 페이드 */
}
el.classList.add('out');                            /* 본체는 180ms 페이드 */
```

---

## 5. 관련 CSS (`css/style.css`)

```css
#swarmLayer .sw-dust {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;   /* 입자는 클릭을 가로채지 않는다 */
}

/* 점선이 흐르는 SVG. 점선이 곡선 모서리를 따라가므로 스타일도 같은 반지름을 쓴다 */
#swarmLayer .sw-dash {
  position: absolute;
  overflow: visible;
  pointer-events: none;
  opacity: 0;
  transition: opacity 180ms ease-out;
}
#swarmLayer .sw-dash.on { opacity: 1; }

#swarmLayer .sw-dash rect {
  fill: none;
  stroke: var(--sw-bc, currentColor);
  stroke-width: 1;
  stroke-dasharray: 4 6;                       /* 한 주기 10px */
  animation: sw-dash-move 800ms linear infinite;
}

@keyframes sw-dash-move {
  from { stroke-dashoffset: 0; }
  to   { stroke-dashoffset: -10; }
}

/* 닫힘 중에는 점선을 멈춘다(흐르면 잔상처럼 보인다) */
#swarmLayer .sw-dash:not(.on) rect { animation: none; }

/* 본체는 더 빠르게 사라져 글자와 가루가 겹치지 않게 한다 */
#swarmLayer .sw-bubble.whisper.out {
  animation: none;
  transition: opacity 180ms ease-out;
}
```

---

## 6. 조정 파라미터

| 값 | 현재 | 키우면 | 줄이면 |
|---|---|---|---|
| `DUST_STEP` | 10px | 입자가 듬성(굵은 가루) | 촘촘(연기처럼) |
| `DUST_MAX` | 140 | 긴 테두리에서도 밀도 유지 | 성능 여유·성김 |
| 입자 크기 | `1 + rand*1.8` | 알갱이가 보임 | 티끌처럼 |
| `out` | `5 + rand*18` | 멀리 흩어짐 | 테두리 근처에 머묾 |
| 상승 `-(5 + rand*22)` | 5~27px | 더 높이 뜸 | 제자리에서 부서짐 |
| `--o` | 0.32~0.82 | 밝고 선명 | 은은함 |
| `--sc` | 0.4~1.1 | 크게 부풀며 터짐 | 오므라들며 사라짐 |
| 수명 | 640~1160ms | 느긋 | 가볍고 빠름 |
| 지연 | 0~200ms | 물결처럼 순차 | 한꺼번에 |
| 본체 페이드 | 180ms | 가루가 더 오래 보임 | 즉시 사라짐 |

색은 커서(요소) 색을 그대로 받는다 — 파랑 속삭임이면 파란 가루.

---

## 7. 다른 곳에 옮길 때 체크리스트

1. **닫히는 직전의 실측 사각형**을 잰다(`getBoundingClientRect`). CSS `left/top` 값을 믿지 않는다.
2. **테두리 두께·반지름을 CSS와 똑같이** 맞춘다(여기선 1px, `8px`). 다르면 곡선과 입자가 어긋난다.
3. 점선이 없다면 둘레만 계산하면 된다(`rr = 0`으로 두면 직선 사각형).
4. 입자 컨테이너는 **`position: absolute` + `pointer-events: none`**, 위치는 `left/top` 고정, 움직임은 자식의 `transform`만.
5. CSS 변수 이름(`--dx/--dy/--o/--sc`)은 요소마다 상속되지 않으므로 **각 입자에 직접** 심는다.
6. 제거는 **가장 긴 수명 + 여유(140ms)** 한 번의 타이머로. `animationend`를 입자마다 듣지 않는다.
7. 화면 밖으로 나간 요소면 아예 띄우지 않는다(불필요한 DOM·낭비 방지).
8. 말풍선/카드 본체의 페이드는 가루보다 **빨라야** 텍스트와 입자가 겹쳐 보이지 않는다.

---

## 8. 알려진 제약

- `fizzDust`는 `WBF.Swarm` 클로저 안의 내부 함수다. 바깥에서 재사용하려면 그대로 복사하거나 `WBF.Swarm` 반환 객체에 노출해야 한다(현재 미노출).
- `edgePoint`는 **둥근 사각형 전용**이다. 원·말풍선 꼬리처럼 곡률이 다른 도형은 구간 함수를 추가해야 한다.
- 입자 개수는 둘레에 비례하므로 아주 큰 요소(수천 px 둘레)에서는 `DUST_MAX`로 잘린다. 필요하면 간격을 늘리는 편이 낫다.
- `prefers-reduced-motion` 규칙은 현재 **점선 이동만** 멈춘다. 가루 애니메이션은 그대로 재생되므로, 모션 최소화가 필요한 곳에 옮길 때는 `@media (prefers-reduced-motion: reduce)`에서 `animation: none`을 함께 추가한다.
- `will-change: transform, opacity`를 입자마다 준다. 수백 개를 동시에 띄우는 용도로는 `DUST_MAX`를 낮춰 쓰는 편이 안전하다.
