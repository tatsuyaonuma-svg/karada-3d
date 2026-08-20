// 感じて覚える運動解剖学｜全身3Dビューア
// 大沼指示（令和8年8月20日）：見る道具はこのまま。量は持っているデータの全て。
//   ウェブもアプリも無料で出す（CC BY-SA 4.0 の継承条件と、内耳・腎臓のNC条件のため）。
//
// 3Dデータ：Z-Anatomy / BodyParts3D（CC BY-SA 4.0）
// three.js はローカル同梱（vendor/）。CDNは使わない。

import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from './vendor/addons/loaders/DRACOLoader.js';

// 3Dデータは Draco で圧縮してある（118MB→約25MB。Squarespaceの1ファイル20MBに収めるため）。
// 展開する部品もローカルに同梱する（外へは一切取りに行かない）。
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('./vendor/libs/draco/gltf/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

// ---------------------------------------------------------------- 見た目の設定
const LOOK = {
  bg:       0xf9f7f3,
  outline:  0x6b5d4f,
  thickness: 0.0016,
  layers: {
    '骨':        { color: 0xf0e9dd, label: '骨',        file: 'bone' },
    '関節・靭帯': { color: 0xe2dac6, label: '関節・靱帯', file: 'joint' },
    '筋':        { color: 0xd99a8f, label: '筋',        file: 'muscle' },
    '腱・筋膜':   { color: 0xded3bd, label: '腱・筋膜',   file: 'tendon' },
    '神経':      { color: 0xd9cf9a, label: '神経',      file: 'nerve' },
    '血管':      { color: 0xc98f8f, label: '脈管',      file: 'vessel' },
    '脳':        { color: 0xdcc4cc, label: '脳',        file: 'brain' },
    'その他':     { color: 0xd6cfc0, label: 'その他',    file: 'other' },
    '未分類':     { color: 0xcfc8ba, label: '未分類',    file: 'misc' },
  },
};
// 最初に読むもの（軽い順に骨だけ）。ほかは押されたときに読む。
const FIRST = ['骨'];

// ---------------------------------------------------------------- 名前
// 書き出しのときに en（英名）／ja（和名）／side（左右）／system（系統）を別ファイルに出してある。
// 和名が無いものは英語のまま出す（作り話をしない）。
const NAME_MAPS = {};   // 系統ごとの対応表をためる
let REGIONS = {};       // パーツごとの部位（head / trunk / upper / lower）

// プロメテウスの章立てと同じ順に見る。まず部位を選び、その中で層を積む。
const REGION_LIST = [
  { key: 'all',   label: '全身' },
  { key: 'head',  label: '頭と首' },
  { key: 'trunk', label: '体幹' },
  { key: 'upper', label: '腕と手' },
  { key: 'lower', label: '脚と足' },
];
let currentRegion = 'all';

fetch('./data/regions.json').then(r => r.json()).then(j => { REGIONS = j; applyRegion(); });


// 【令和8年8月20日の直し】前は系統を見ずに、最初に見つかった表から名前を返していた。
// 系統ごとに p0001 から番号を振り直していたので、筋をさわると骨の名前が出ていた。
// 今は鍵に系統の頭文字が入り（bo/mu/jo…）、引くときも読んだ系統の表だけを見る。
function findEntry(obj, sys) {
  const table = NAME_MAPS[sys];
  if (!table) return null;
  let node = obj;
  while (node) {
    const key = String(node.name || '').replace(/_\d+$/, '');
    const m = table[key];
    if (m) return Object.assign({}, m, { _key: key });
    node = node.parent;
  }
  return null;
}

function labelOf(entry) {
  if (!entry) return { ja: '', en: '' };
  const side = entry.side ? entry.side : '';
  const ja = entry.ja ? (side + entry.ja) : '';
  const en = entry.en + (entry.side ? '（' + entry.side + '）' : '');
  return { ja: ja || en, en: ja ? en : '' };
}

// ---------------------------------------------------------------- 土台
const stage = document.getElementById('stage');
const scene = new THREE.Scene();
scene.background = new THREE.Color(LOOK.bg);

const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
// 【落とし穴・令和8年8月11日】カメラの位置と見る先が両方とも原点だと、
// 操作の部品が向きを計算できず、以後ずっと位置が数字にならない（画面が真っ白になる）。
// 3Dを読み込む前に、必ずどこかに置いておく。
camera.position.set(0, 0, 1);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true, // 画像として保存するために要る
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.9;
controls.zoomSpeed = 0.9;

// 光は2つだけ。影を落とさず、面の向きの差だけを出す。
scene.add(new THREE.AmbientLight(0xffffff, 0.62));
const key = new THREE.DirectionalLight(0xffffff, 0.85);
key.position.set(0.6, 1.0, 0.9);
scene.add(key);

// ---------------------------------------------------------------- イラスト風の材質
// 明暗を3段に切って、面をべたっと塗る（写真ではなく絵に見せる）。
function makeStepGradient() {
  const steps = new Uint8Array([116, 190, 255]);
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
const GRADIENT = makeStepGradient();

// 横隔膜や筋膜は薄い膜で、袋のように閉じていない。片面だけ塗ると裏側から
// 輪郭線（黒）が見えて穴が空いたように見えるので、両面を塗る。
const fillMaterials = {};
for (const [k, v] of Object.entries(LOOK.layers)) {
  fillMaterials[k] = new THREE.MeshToonMaterial({
    color: v.color, gradientMap: GRADIENT, side: THREE.DoubleSide,
  });
}

// 輪郭線：形を法線の向きに少しふくらませて裏面だけ描く。
// 太さを世界の長さで持つので、部品の大小によらず線の太さがそろう。
const outlineMaterial = new THREE.ShaderMaterial({
  uniforms: {
    thickness: { value: LOOK.thickness },
    lineColor: { value: new THREE.Color(LOOK.outline) },
  },
  vertexShader: `
    uniform float thickness;
    void main() {
      vec3 pushed = position + normalize(normal) * thickness;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pushed, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 lineColor;
    void main() { gl_FragColor = vec4(lineColor, 1.0); }`,
  side: THREE.BackSide,
});

// 三角形の頂点の並びを逆にして、面の表と裏を入れ替える
function flipWinding(geo) {
  const idx = geo.getIndex();
  if (idx) {
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i];
      a[i] = a[i + 2];
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
    return;
  }
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal ? geo.attributes.normal.array : null;
  for (let i = 0; i < pos.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      let t = pos[i + k]; pos[i + k] = pos[i + 6 + k]; pos[i + 6 + k] = t;
      if (nor) { t = nor[i + k]; nor[i + k] = nor[i + 6 + k]; nor[i + 6 + k] = t; }
    }
  }
  geo.attributes.position.needsUpdate = true;
  if (nor) geo.attributes.normal.needsUpdate = true;
}

// ---------------------------------------------------------------- 読み込み
const root = new THREE.Group();
scene.add(root);

const layerGroups = {};   // 層ごとのまとまり
const pickable = [];      // 触って名前を出せる部品
let homeTarget = new THREE.Vector3();
let homeDistance = 1;
let modelSize = null;

// 縦長の画面だと横がはみ出し、いちばん長い辺で合わせると小さくなりすぎる。
// 縦と横それぞれの実際の長さで合わせて、大きいほうを採る。
function updateFitDistance() {
  if (!modelSize) return;
  const half = (camera.fov * Math.PI) / 360;
  const fitVertical = (modelSize.y * 0.5) / Math.tan(half);
  const fitHorizontal = (modelSize.x * 0.5) / (Math.tan(half) * camera.aspect);
  homeDistance = Math.max(fitVertical, fitHorizontal) * 1.30 + modelSize.z * 0.5;
  controls.minDistance = homeDistance * 0.2;
  controls.maxDistance = homeDistance * 4;
}

for (const k of Object.keys(LOOK.layers)) {
  const g = new THREE.Group();
  g.name = k;
  root.add(g);
  layerGroups[k] = g;
}

const DATA_VERSION = '1';
const loaded = {};       // 読み終わった系統
const loading = {};      // 読み込み中の系統

function setStatus(text) {
  const el = document.getElementById('loading');
  if (!el) return;
  if (text) { el.textContent = text; el.classList.remove('hidden'); }
  else { el.classList.add('hidden'); }
}

async function loadSystem(sys) {
  if (loaded[sys] || loading[sys]) return;
  loading[sys] = true;
  const conf = LOOK.layers[sys];
  setStatus(conf.label + ' を読み込んでいます…');
  try {
    NAME_MAPS[sys] = await fetch(`./data/${conf.file}_names.json?v=${DATA_VERSION}`).then(r => r.json());
    const gltf = await gltfLoader.loadAsync(`./data/${conf.file}.glb?v=${DATA_VERSION}`);
    const meshes = [];
    gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });

    for (const mesh of meshes) {
      const entry = findEntry(mesh, sys);
      mesh.updateWorldMatrix(true, false);
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      // 右側は左を鏡に映して作られているので、面の表裏を戻す（そうしないと右半分が黒くなる）
      if (mesh.matrixWorld.determinant() < 0) flipWinding(geo);

      const fill = new THREE.Mesh(geo, fillMaterials[sys]);
      fill.userData.entry = entry;
      fill.userData.layer = sys;
      fill.userData.partKey = entry ? (LOOK.layers[sys].file + '/' + entry._key) : null;
      layerGroups[sys].add(fill);
      pickable.push(fill);

      const line = new THREE.Mesh(geo, outlineMaterial);
      line.userData.isOutline = true;
      layerGroups[sys].add(line);
    }
    loaded[sys] = true;
    applyRegion();
    console.log(conf.label, '読み込み完了', meshes.length, '個');
  } catch (e) {
    console.error(sys, e);
    setStatus(conf.label + ' を読み込めませんでした');
    setTimeout(() => setStatus(''), 2000);
    loading[sys] = false;
    return;
  }
  loading[sys] = false;
  setStatus('');
}

// 選んだ部位のものだけ出す
function applyRegion() {
  let shown = 0;
  for (const sys of Object.keys(layerGroups)) {
    layerGroups[sys].children.forEach(m => {
      const key = m.userData.partKey;
      const rg = key ? REGIONS[key] : null;
      const on = (currentRegion === 'all') || (rg === currentRegion) || (!rg && currentRegion === 'all');
      m.visible = on;
      if (on && !m.userData.isOutline) shown++;
    });
  }
  document.querySelectorAll('[data-region]').forEach(b => {
    b.classList.toggle('on', b.dataset.region === currentRegion);
  });
  fitToVisible();
  return shown;
}

// 見えているものだけに合わせて、位置と寄りを決め直す
function fitToVisible() {
  // 位置を動かしたあとの座標を使うので、先に反映させる（これが無いと計算がずれて画面から外れる）
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let any = false;
  for (const sys of Object.keys(layerGroups)) {
    layerGroups[sys].children.forEach(m => {
      if (!m.visible || m.userData.isOutline) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox.clone();
      b.applyMatrix4(m.matrixWorld);
      box.union(b);
      any = true;
    });
  }
  if (!any) return;
  // 見た目の中心を原点へ寄せる
  root.position.sub(box.getCenter(new THREE.Vector3()));
  root.updateMatrixWorld(true);
  // 動かしたあとの大きさで寄りを決める
  const after = new THREE.Box3();
  for (const sys of Object.keys(layerGroups)) {
    layerGroups[sys].children.forEach(m => {
      if (!m.visible || m.userData.isOutline) return;
      const b = m.geometry.boundingBox.clone();
      b.applyMatrix4(m.matrixWorld);
      after.union(b);
    });
  }
  modelSize = after.getSize(new THREE.Vector3());
  homeTarget = new THREE.Vector3(0, 0, 0);
  updateFitDistance();
  applyView(currentView);
}

// 中身に合わせて位置と距離を決め直す
function fitToContent() {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  // box は今の位置での見た目の箱なので、その中心の分だけ動かせば真ん中に来る
  root.position.sub(center);
  const box2 = new THREE.Box3().setFromObject(root);
  modelSize = box2.getSize(new THREE.Vector3());
  homeTarget = new THREE.Vector3(0, 0, 0);
  updateFitDistance();
}

async function boot() {
  for (const k of FIRST) await loadSystem(k);
  resetView(false);
  buildControlsUI();
  onResize();
}

boot().catch(err => {
  setStatus('3Dデータを読み込めませんでした');
  console.error(err);
});

// ---------------------------------------------------------------- 見る向き
const VIEWS = {
  '前': [0, 0, 1],
  '後': [0, 0, -1],
  '右': [1, 0, 0],
  '左': [-1, 0, 0],
  '上': [0, 1, 0.001],
};
let currentView = '前';

function applyView(name) {
  const v = VIEWS[name];
  if (!v) return;
  currentView = name;
  const dir = new THREE.Vector3(...v).normalize().multiplyScalar(homeDistance);
  camera.position.copy(homeTarget).add(dir);
  camera.up.set(0, 1, 0);
  controls.target.copy(homeTarget);
  controls.update();
  markActiveView();
}

function resetView(clearSelection = true) {
  applyView('前');
  if (clearSelection) {
    for (const k of Object.keys(layerGroups)) {
      const on = !!loaded[k];
      layerGroups[k].visible = on;
      const btn = document.querySelector(`[data-layer="${k}"]`);
      if (btn) btn.classList.toggle('on', on);
    }
    setLabel('', '');
  }
}

// ---------------------------------------------------------------- 操作の並び
function buildControlsUI() {
  // 部位（プロメテウスと同じで、まずここを選ぶ）
  const regionRow = document.getElementById('regions');
  if (regionRow && !regionRow.children.length) {
    for (const r of REGION_LIST) {
      const b = document.createElement('button');
      b.textContent = r.label;
      b.dataset.region = r.key;
      b.classList.toggle('on', r.key === currentRegion);
      b.addEventListener('click', () => {
        currentRegion = r.key;
        closeSheet();
        clearHighlight();
        setLabel('', '');
        applyRegion();
      });
      regionRow.appendChild(b);
    }
  }

  const layersRow = document.getElementById('layers');
  for (const [k, v] of Object.entries(LOOK.layers)) {
    const b = document.createElement('button');
    b.textContent = v.label;
    b.dataset.layer = k;
    b.classList.add('on');
    b.classList.toggle('on', FIRST.includes(k));
    b.addEventListener('click', async () => {
      if (!loaded[k]) {
        await loadSystem(k);
        if (!loaded[k]) return;
        layerGroups[k].visible = true;
        b.classList.add('on');
        return;
      }
      const g = layerGroups[k];
      g.visible = !g.visible;
      b.classList.toggle('on', g.visible);
    });
    layersRow.appendChild(b);
  }

  const viewsRow = document.getElementById('views');
  for (const name of Object.keys(VIEWS)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.dataset.view = name;
    b.classList.add('plain');
    b.addEventListener('click', () => applyView(name));
    viewsRow.appendChild(b);
  }

  const reset = document.createElement('button');
  reset.textContent = 'はじめに戻す';
  reset.classList.add('plain');
  reset.addEventListener('click', () => resetView(true));
  viewsRow.appendChild(reset);

  const save = document.createElement('button');
  save.textContent = '画像に保存';
  save.classList.add('plain');
  save.addEventListener('click', saveImage);
  viewsRow.appendChild(save);

  markActiveView();
}

function markActiveView() {
  document.querySelectorAll('[data-view]').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === currentView);
  });
}

// ---------------------------------------------------------------- さわると名前が出る
// Appleの考え方（WWDC 2018 Designing Fluid Interfaces）に沿う：
//   ・押した瞬間に応える（離すまで待たない）
//   ・掴んだものは指から離れない（1:1で追う）
//   ・動いている途中でも掴み直せる（決められた時間の動きではなく、バネで動かす）

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
let highlighted = null;
let PART_LESSONS = {};
const highlightMaterial = new THREE.MeshToonMaterial({
  color: 0xd8a7a0, gradientMap: GRADIENT, side: THREE.DoubleSide,
});

fetch('./data/part_lessons.json').then(r => r.json()).then(j => { PART_LESSONS = j; });

function setLabel(ja, en) {
  document.getElementById('ja').textContent = ja;
  document.getElementById('en').textContent = en;
}

function clearHighlight() {
  if (highlighted) {
    highlighted.material = fillMaterials[highlighted.userData.layer];
    highlighted = null;
  }
}

function pickAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const visible = pickable.filter(m => layerGroups[m.userData.layer].visible);
  const hits = raycaster.intersectObjects(visible, false);
  return hits.length ? hits[0].object : null;
}

// 押した瞬間に色を変える（応答は待たせない）
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  const hit = pickAt(e.clientX, e.clientY);
  clearHighlight();
  if (hit) {
    hit.material = highlightMaterial;
    highlighted = hit;
    const lab = labelOf(hit.userData.entry);
    setLabel(lab.ja, lab.en);
  }
});

// 回し始めたら、選んでいた色は戻す（回転と取り違えない）
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!downAt || !highlighted) return;
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) {
    clearHighlight();
    setLabel('', '');
  }
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 6) { clearHighlight(); return; }   // 回しただけ
  if (!highlighted) { closeSheet(); setLabel('', ''); return; }
  openSheetFor(highlighted);
  const hint = document.getElementById('hint');
  if (hint) hint.style.opacity = '0';
});

// ---------------------------------------------------------------- 下から出るシート
// バネは自前。Appleの「減衰比（跳ね具合）」と「反応の速さ（秒）」の2つで持つ。
function makeSpring(onUpdate, { damping = 1.0, response = 0.35 } = {}) {
  const w = (2 * Math.PI) / response;   // 角振動数
  const k = w * w;                      // かたさ
  const c = 2 * damping * w;            // 抵抗
  let value = 0, velocity = 0, target = 0, raf = null, last = 0;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    const a = -k * (value - target) - c * velocity;
    velocity += a * dt;
    value += velocity * dt;
    onUpdate(value);
    if (Math.abs(value - target) < 0.3 && Math.abs(velocity) < 3) {
      value = target; velocity = 0; onUpdate(value); raf = null; return;
    }
    raf = requestAnimationFrame(frame);
  }
  return {
    get value() { return value; },
    set value(v) { value = v; onUpdate(v); },
    get velocity() { return velocity; },
    set velocity(v) { velocity = v; },
    stop() { if (raf) cancelAnimationFrame(raf); raf = null; velocity = 0; },
    to(t, v0) {
      target = t;
      if (v0 !== undefined) velocity = v0;
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    },
  };
}

const sheet = document.getElementById('sheet');
let sheetH = 260;
let sheetOpen = false;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const sheetSpring = makeSpring((v) => {
  sheet.style.transform = `translate3d(0, ${v}px, 0)`;
}, { damping: 0.85, response: 0.32 });   // 掴んで投げられるものなので、少しだけ跳ねる

function measureSheet() { sheetH = sheet.offsetHeight || 260; }

function openSheet() {
  measureSheet();
  sheet.setAttribute('aria-hidden', 'false');
  document.getElementById('dock').classList.add('down');
  if (reduceMotion) { sheetSpring.stop(); sheetSpring.value = 0; sheetOpen = true; return; }
  sheetSpring.to(0);
  sheetOpen = true;
}
function closeSheet(v0) {
  measureSheet();
  document.getElementById('dock').classList.remove('down');
  if (reduceMotion) { sheetSpring.stop(); sheetSpring.value = sheetH; sheetOpen = false; return; }
  sheetSpring.to(sheetH, v0);
  sheetOpen = false;
}

function openSheetFor(mesh) {
  const e = mesh.userData.entry;
  const lab = labelOf(e);
  document.getElementById('s-name').textContent = lab.ja || '（名前が入っていません）';
  document.getElementById('s-sub').textContent = e ? e.en : '';
  document.getElementById('s-meta').textContent =
    e ? [e.system || '未分類', e.side ? e.side + 'がわ' : ''].filter(Boolean).join('　・　') : '';

  const box = document.getElementById('s-link');
  const key = mesh.userData.partKey;
  const L = key && PART_LESSONS[key] ? PART_LESSONS[key][0] : null;
  if (L) {
    box.innerHTML = `<a class="go" href="https://www.somaticstudiojapan.com/kanjite-undou-kaibou/${L.slug}" target="_blank" rel="noopener">
      <span>感じて覚える運動解剖学「${L.title}」を読む</span><span class="arrow">→</span></a>`;
  } else {
    box.innerHTML = `<div class="none">この部位に対応する回は、まだありません。<br>
      <a href="https://www.somaticstudiojapan.com/kanjite-undou-kaibou" target="_blank" rel="noopener" style="color:var(--accent)">感じて覚える運動解剖学の一覧を見る →</a></div>`;
  }
  openSheet();
}

// シートを掴んで下げる（指から離れない・投げたら勢いで閉じる）
{
  let dragging = false, startY = 0, startV = 0, hist = [];
  sheet.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a')) return;       // リンクを押したときは掴まない
    sheet.setPointerCapture(e.pointerId);
    measureSheet();
    dragging = true;
    sheetSpring.stop();
    startY = e.clientY;
    startV = sheetSpring.value;
    hist = [{ y: e.clientY, t: performance.now() }];
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    let d = startV + (e.clientY - startY);
    // 上へ引っぱりすぎたときは、だんだん付いていかなくする（硬く止めない）
    if (d < 0) d = -(-d * sheetH * 0.55) / (sheetH + 0.55 * -d);
    sheetSpring.value = d;
    hist.push({ y: e.clientY, t: performance.now() });
    if (hist.length > 5) hist.shift();
  });
  sheet.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    const a = hist[0], b = hist[hist.length - 1];
    const dt = Math.max((b.t - a.t) / 1000, 0.001);
    const v = (b.y - a.y) / dt;                       // 指の速さ（px/秒）
    // 勢いをそのまま先へ伸ばして、行き着く先で開くか閉じるかを決める
    const d = 0.998;
    const projected = sheetSpring.value + (v / 1000) * d / (1 - d);
    if (projected > sheetH * 0.4) closeSheet(v);
    else sheetSpring.to(0, v);
  });
}

// ---------------------------------------------------------------- 画像に保存
function saveImage() {
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = '感じて覚える運動解剖学_全身.png';
  a.click();
}

// ---------------------------------------------------------------- 動かす
// 確認用（中の数値を外から見るため）
window.__dbg = () => {
  const vis = {};
  for (const k of Object.keys(layerGroups)) {
    vis[k] = layerGroups[k].children.filter(m => m.visible && !m.userData.isOutline).length;
  }
  return {
    見えている数: vis,
    パーツの鍵の例: (layerGroups['骨'] ? layerGroups['骨'].children.filter(m=>!m.userData.isOutline).slice(0,5).map(m=>m.userData.partKey) : []),
    REGIONSの件数: Object.keys(REGIONS).length,
    region: currentRegion,
    カメラ位置: camera.position.toArray().map(n=>+n.toFixed(3)),
    見る先: controls.target.toArray().map(n=>+n.toFixed(3)),
    homeDistance: +homeDistance.toFixed(3),
    modelSize: modelSize ? modelSize.toArray().map(n=>+n.toFixed(3)) : null,
    rootPos: root.position.toArray().map(n=>+n.toFixed(3)),
    aspect: +camera.aspect.toFixed(3),
  };
};

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  updateFitDistance();
}
window.addEventListener('resize', onResize);
onResize();

function tick() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

// 中身を確かめるための覗き窓（作業用）
window.__viewer = { scene, root, layerGroups, pickable, camera, controls, LOOK };
