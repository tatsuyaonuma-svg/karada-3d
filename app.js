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
// 最初に読むもの（骨をまず出す）。続きは boot() が順に読み、着た姿（浅層まで）にする。
const FIRST = ['骨'];
// 骨のあとに自動で読む順（見た目に効く順）。「その他」は浅層の筋膜34個のために読む。
const DRESS_ORDER = ['筋', '関節・靭帯', '腱・筋膜', 'その他'];

// ---------------------------------------------------------------- 名前
// 書き出しのときに en（英名）／ja（和名）／side（左右）／system（系統）を別ファイルに出してある。
// 和名が無いものは英語のまま出す（作り話をしない）。
const NAME_MAPS = {};   // 系統ごとの対応表をためる

// ---------------------------------------------------------------- 分類（もとデータに忠実）
// data/regions.json＝Z-Anatomy自身の分類から取り出したもの（build_viewer_classify.py）。
//   r: 部位11区分（もとデータの Main divisions）
//   s: 1なら浅層（もとデータの Superficial muscles 由来。筋膜・腱・靱帯も含む）
//   g: 筋の区画（回旋筋腱板・前腕の前面 など34種）の番号
let CLASSIFY = {};
let GROUPS = [];

// 部位は2段。1段目はもとデータの階層と同じ束ね方（体幹の下に背中・胸・腹・骨盤）。
const REGION_LIST = [
  { key: 'all',   label: '全身' },
  { key: 'head',  label: '頭と首' },
  { key: 'trunk', label: '体幹' },
  { key: 'upper', label: '腕と手' },
  { key: 'lower', label: '脚と足' },
];
const SUB_LIST = {
  head:  [['head', '頭'], ['neck', '首']],
  trunk: [['back', '背中'], ['thorax', '胸'], ['abdomen', '腹'], ['pelvis', '骨盤']],
  upper: [['arm', '腕'], ['hand', '手']],
  lower: [['leg', '脚'], ['foot', '足']],
};
const TOP_OF = {
  head: 'head', neck: 'head',
  trunk: 'trunk', back: 'trunk', thorax: 'trunk', abdomen: 'trunk', pelvis: 'trunk',
  arm: 'upper', hand: 'upper', leg: 'lower', foot: 'lower',
};
const REGION_JA = {
  head: '頭', neck: '首', trunk: '体幹', back: '背中', thorax: '胸',
  abdomen: '腹', pelvis: '骨盤', arm: '腕', hand: '手', leg: '脚', foot: '足',
};
let currentRegion = 'all';
let currentSub = null;      // 2段目（back/thorax…）。null なら1段目の全体

// 層は4段。もとデータが持っている分け方だけを使う（浅層の印＋系統）。
// 「〜まで剥いだ状態」を番号で持つ。3=浅層まで（着た姿）…0=骨だけ。
const STRATA = [
  { rank: 3, label: '浅層まで' },
  { rank: 2, label: '深層の筋まで' },
  { rank: 1, label: '関節・靱帯まで' },
  { rank: 0, label: '骨だけ' },
];
let currentStratum = 3;

// 層の外にある系統（神経・血管・脳など）は、従来どおりボタンで足す。
const EXTRA_SYSTEMS = ['神経', '血管', '脳', 'その他', '未分類'];
const extraOn = {};
for (const s of EXTRA_SYSTEMS) extraOn[s] = false;

// メッシュ1個の層の深さ。浅層の印がいちばん強い（「その他」の筋膜もここで拾う）。
function meshRank(m) {
  const c = CLASSIFY[m.userData.partKey];
  if (c && c.s) return 3;
  const sys = m.userData.layer;
  if (sys === '筋' || sys === '腱・筋膜') return 2;
  if (sys === '関節・靭帯') return 1;
  if (sys === '骨') return 0;
  return null;   // 層の外（神経・血管・脳・その他・未分類）
}

// 名前で引いたとき、その名前のものだけを出す
let searchTarget = null;    // { en, sys }

fetch('./data/regions.json?v=2').then(r => r.json()).then(j => {
  GROUPS = j._groups || [];
  delete j._groups;
  CLASSIFY = j;
  applyVisibility();
});


// Z-Anatomyの目次用の文字物体（「Joints.g」「Skeletal system.g」など、体の左に浮かぶ
// 立体の文字。全11個＋説明文2個）。身体の部位ではないので、表示にも検索にも出さない。
// 末尾 .i（矢印344個）を書き出しから外したのと同じ扱い。
function isLabelObject(entry) {
  if (!entry) return false;
  const r = entry.raw || entry.en || '';
  return /\.g$/.test(r) || r === 'HOW TO ...' || r === 'Muscles.j';
}

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
  if (!isFinite(camera.aspect) || camera.aspect <= 0) return;
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

const DATA_VERSION = '2';
const loaded = {};       // 読み終わった系統
const loading = {};      // 読み込み中の系統

// 最初の1回（骨）だけ全画面。以後は画面を隠さない小さな表示で知らせる。
let statusIsPill = false;
function setStatus(text) {
  const el = document.getElementById('loading');
  if (!el) return;
  if (statusIsPill) el.classList.add('pill');
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
      if (isLabelObject(entry)) continue;   // 目次用の文字物体は入れない
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
    applyVisibility();
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

// 見える・見えないは、この1つの関数で決める（部位 × 層 × 検索）。
// 判定をボタンごとに分けると食い違うので、必ずここを通す。
function meshVisible(m) {
  const key = m.userData.partKey;
  const c = key ? CLASSIFY[key] : null;

  // 名前で引いているときは、その名前のものだけ
  if (searchTarget) {
    const e = m.userData.entry;
    return !!(e && e.en === searchTarget.en && m.userData.layer === searchTarget.sys);
  }

  // 部位の絞り
  const rg = c ? c.r : null;
  let regionOK;
  if (currentRegion === 'all') regionOK = true;
  else if (currentSub) regionOK = rg === currentSub;
  else regionOK = rg ? TOP_OF[rg] === currentRegion : false;
  if (!regionOK) return false;

  // 層の絞り
  const rank = meshRank(m);
  if (rank !== null) return rank <= currentStratum;
  // 層の外の系統は、ボタンで足したときだけ
  return !!extraOn[m.userData.layer];
}

function applyVisibility() {
  let shown = 0;
  for (const sys of Object.keys(layerGroups)) {
    const g = layerGroups[sys];
    for (let i = 0; i < g.children.length; i += 2) {
      const fill = g.children[i];
      const line = g.children[i + 1];
      const on = meshVisible(fill);
      fill.visible = on;
      if (line) line.visible = on;
      if (on) shown++;
    }
  }
  document.querySelectorAll('[data-region]').forEach(b => {
    b.classList.toggle('on', b.dataset.region === currentRegion);
  });
  document.querySelectorAll('[data-sub]').forEach(b => {
    b.classList.toggle('on', (b.dataset.sub || null) === (currentSub || null));
  });
  document.querySelectorAll('[data-stratum]').forEach(b => {
    b.classList.toggle('on', Number(b.dataset.stratum) === currentStratum);
  });
  rebuildSubRow();
  fitToVisible();
  return shown;
}

// 2段目の部位ボタン（1段目を選んだときだけ出す）
function rebuildSubRow() {
  const row = document.getElementById('subregions');
  if (!row) return;
  const subs = SUB_LIST[currentRegion];
  if (!subs) { row.replaceChildren(); row.style.display = 'none'; row.dataset.built = ''; return; }
  row.style.display = '';
  const want = 'w:' + currentRegion;
  if (row.dataset.built === want) return;   // 同じ1段目なら作り直さない
  row.dataset.built = want;
  row.replaceChildren();
  const all = document.createElement('button');
  all.textContent = '全体';
  all.dataset.sub = '';
  all.classList.toggle('on', !currentSub);
  all.addEventListener('click', () => { currentSub = null; afterFilterChange(); });
  row.appendChild(all);
  for (const [key, label] of subs) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.sub = key;
    b.classList.toggle('on', currentSub === key);
    b.addEventListener('click', () => { currentSub = key; afterFilterChange(); });
    row.appendChild(b);
  }
}

function afterFilterChange() {
  if (searchTarget) clearSearch(false);   // 部位や層を触ったら、名前の絞りは外す
  closeSheet();
  clearHighlight();
  setLabel('', '');
  applyVisibility();
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
  statusIsPill = true;              // 以後の読み込み表示は画面を隠さない
  resetView(false);
  buildControlsUI();
  onResize();
  // 骨を出したあと、着た姿（浅層まで）に向けて順に読む。終わるたびに着ていく。
  (async () => {
    for (const k of DRESS_ORDER) {
      if (!loaded[k]) await loadSystem(k);
    }
  })();
  buildSearchIndex();               // 名前で引くための索引（別ファイルの名前表を全部読む）
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
    clearSearch(false);
    currentRegion = 'all';
    currentSub = null;
    currentStratum = 3;
    for (const s of EXTRA_SYSTEMS) extraOn[s] = false;
    document.querySelectorAll('[data-layer]').forEach(b => b.classList.remove('on'));
    setLabel('', '');
    applyVisibility();
  }
}

// ---------------------------------------------------------------- 操作の並び
function buildControlsUI() {
  // 部位（プロメテウスと同じで、まずここを選ぶ。2段目は rebuildSubRow が作る）
  const regionRow = document.getElementById('regions');
  if (regionRow && !regionRow.children.length) {
    for (const r of REGION_LIST) {
      const b = document.createElement('button');
      b.textContent = r.label;
      b.dataset.region = r.key;
      b.classList.toggle('on', r.key === currentRegion);
      b.addEventListener('click', () => {
        currentRegion = r.key;
        currentSub = null;
        afterFilterChange();
      });
      regionRow.appendChild(b);
    }
  }

  // 層（浅層まで→骨だけ。押した層まで剥いだ状態にする）
  const strataRow = document.getElementById('strata');
  if (strataRow && !strataRow.children.length) {
    for (const s of STRATA) {
      const b = document.createElement('button');
      b.textContent = s.label;
      b.dataset.stratum = String(s.rank);
      b.classList.toggle('on', s.rank === currentStratum);
      b.addEventListener('click', async () => {
        currentStratum = s.rank;
        // その層に要る系統がまだなら読む（骨は最初に読み済み）
        if (s.rank >= 1 && !loaded['関節・靭帯']) await loadSystem('関節・靭帯');
        if (s.rank >= 2) {
          if (!loaded['筋']) await loadSystem('筋');
          if (!loaded['腱・筋膜']) await loadSystem('腱・筋膜');
        }
        if (s.rank >= 3 && !loaded['その他']) loadSystem('その他');  // 筋膜。待たずに後から出す
        afterFilterChange();
      });
      strataRow.appendChild(b);
    }
  }

  // 層の外の系統（神経・血管・脳・その他・未分類）は、押したときだけ足す
  const layersRow = document.getElementById('layers');
  for (const k of EXTRA_SYSTEMS) {
    const v = LOOK.layers[k];
    const b = document.createElement('button');
    b.textContent = v.label;
    b.dataset.layer = k;
    b.addEventListener('click', async () => {
      if (!extraOn[k] && !loaded[k]) {
        b.classList.add('busy');
        await loadSystem(k);
        b.classList.remove('busy');
        if (!loaded[k]) return;
      }
      extraOn[k] = !extraOn[k];
      b.classList.toggle('on', extraOn[k]);
      applyVisibility();
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

fetch('./data/part_lessons.json?v=2').then(r => r.json()).then(j => { PART_LESSONS = j; });

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
  const visible = pickable.filter(m => m.visible);
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
  // 系統・左右に加えて、もとデータの部位・層・筋の区画（あるものだけ）を出す
  const c = mesh.userData.partKey ? CLASSIFY[mesh.userData.partKey] : null;
  const grp = c && c.g !== undefined && GROUPS[c.g]
    ? (GROUPS[c.g].ja || GROUPS[c.g].en) : '';
  document.getElementById('s-meta').textContent =
    e ? [
      e.system || '未分類',
      e.side ? e.side + 'がわ' : '',
      c && c.r ? REGION_JA[c.r] : '',
      c && c.s ? '浅層' : '',
      grp,
    ].filter(Boolean).join('　・　') : '';

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

// ---------------------------------------------------------------- なまえで引く
// この道具は「からだの辞書」。部位名からすぐ引けるように、全系統の名前表を
// 先に読んで索引にしておく（3Dの実体は選ばれたときに読む）。
let SEARCH_INDEX = null;

async function buildSearchIndex() {
  if (SEARCH_INDEX) return;
  const idx = [];
  for (const [sys, conf] of Object.entries(LOOK.layers)) {
    try {
      const table = NAME_MAPS[sys]
        || await fetch(`./data/${conf.file}_names.json?v=${DATA_VERSION}`).then(r => r.json());
      if (!NAME_MAPS[sys]) NAME_MAPS[sys] = table;
      const seen = new Set();
      for (const v of Object.values(table)) {
        const en = (v.en || '').trim();
        if (!en) continue;
        if (isLabelObject(v)) continue;    // 目次用の文字物体は索引にも入れない
        const uniq = sys + '|' + en;          // 左右・複製は1行にまとめる
        if (seen.has(uniq)) continue;
        seen.add(uniq);
        idx.push({ sys, en, ja: (v.ja || '').trim(), enLower: en.toLowerCase() });
      }
    } catch (e) { console.error('検索の索引', sys, e); }
  }
  SEARCH_INDEX = idx;
}

function searchMatches(q) {
  if (!SEARCH_INDEX) return [];
  const qLower = q.toLowerCase();
  const hits = [];
  for (const item of SEARCH_INDEX) {
    let score = -1;
    if (item.ja) {
      if (item.ja.startsWith(q)) score = 0;
      else if (item.ja.includes(q)) score = 1;
    }
    if (score < 0) {
      if (item.enLower.startsWith(qLower)) score = 2;
      else if (item.enLower.includes(qLower)) score = 3;
    }
    if (score >= 0) hits.push([score, item]);
  }
  hits.sort((a, b) => a[0] - b[0] || (a[1].ja || a[1].en).length - (b[1].ja || b[1].en).length);
  return hits.slice(0, 20).map(h => h[1]);
}

const searchInput = document.getElementById('search');
const searchResults = document.getElementById('search-results');
const searchClearBtn = document.getElementById('search-clear');

function renderSearchResults(items) {
  searchResults.replaceChildren();
  if (!items.length) { searchResults.hidden = true; return; }
  for (const item of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'result';
    const name = document.createElement('span');
    name.textContent = item.ja || item.en;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = LOOK.layers[item.sys].label + (item.ja ? '　' + item.en : '');
    b.append(name, tag);
    // blur より先に動くように pointerdown で受ける
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); chooseSearchResult(item); });
    searchResults.appendChild(b);
  }
  searchResults.hidden = false;
}

async function chooseSearchResult(item) {
  searchResults.hidden = true;
  searchInput.value = item.ja || item.en;
  searchInput.blur();
  if (!loaded[item.sys]) await loadSystem(item.sys);
  if (!loaded[item.sys]) return;
  searchTarget = { en: item.en, sys: item.sys };
  searchClearBtn.hidden = false;
  clearHighlight();
  applyVisibility();   // その名前のものだけが残り、そこへ寄る
  const g = layerGroups[item.sys];
  const first = g.children.find(m => !m.userData.isOutline && m.visible);
  if (first) {
    const lab = labelOf(first.userData.entry);
    setLabel(lab.ja, lab.en);
    openSheetFor(first);
  }
}

function clearSearch(refresh = true) {
  searchTarget = null;
  if (searchInput) searchInput.value = '';
  if (searchResults) searchResults.hidden = true;
  if (searchClearBtn) searchClearBtn.hidden = true;
  if (refresh) { closeSheet(); applyVisibility(); }
}

if (searchInput) {
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    if (!q) { searchResults.hidden = true; return; }
    renderSearchResults(searchMatches(q));
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = searchInput.value.trim();
      const items = q ? searchMatches(q) : [];
      if (items.length) chooseSearchResult(items[0]);
    }
    if (e.key === 'Escape') clearSearch();
  });
  searchInput.addEventListener('blur', () => {
    setTimeout(() => { searchResults.hidden = true; }, 150);
  });
  searchClearBtn.addEventListener('click', () => clearSearch());
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
    分類の件数: Object.keys(CLASSIFY).length,
    region: currentRegion,
    sub: currentSub,
    stratum: currentStratum,
    検索: searchTarget,
    足している系統: Object.keys(extraOn).filter(k => extraOn[k]),
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
  // 裏側のタブや、まだ大きさの決まっていないiframeでは 0×0 になる。
  // 0で割るとカメラの位置が数字でなくなり、以後ずっと直らないので、ここで止める。
  if (!w || !h) return;
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
