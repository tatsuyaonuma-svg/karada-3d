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
// 【令和8年8月21日・大沼指示「みにくい」「いっそのこと元データそのままでもいいかも。
// 君がつくるとどこかでずれていくのかもしれない」】
// イラスト風（3段の塗り＋輪郭線）をやめた。色はこちらで決めず、
// **Z-Anatomy自身の材質（骨=象牙色・筋=赤・靱帯=白・筋膜=半透明の青）をそのまま表示する**。
// glbに材質が入っている（export_system.py が元の色を取り出して同梱する）。
// 下の color は、万一材質が入っていないメッシュのための代えでしかない。
const LOOK = {
  // 【令和8年8月21日・大沼指示「色とかは前のままでいいんだよ。まずはシステムだ」】
  // 見た目は元データの材質＋明るい背景のまま。作り込むのは仕組みの方
  // （目次から辿る・これだけ見る/隠す の4つ組・層を剥ぐ・部位の絞り・なまえで引く）。
  bg: 0xf4f1ec,
  layers: {
    '骨':        { color: 0xcc8b50, label: '骨',        file: 'bone' },
    '関節・靭帯': { color: 0xe5fef9, label: '関節・靱帯', file: 'joint' },
    '筋':        { color: 0xcc2718, label: '筋',        file: 'muscle' },
    '腱・筋膜':   { color: 0xecd8d6, label: '腱・筋膜',   file: 'tendon' },
    '神経':      { color: 0xd8c26a, label: '神経',      file: 'nerve' },
    '血管':      { color: 0xa23430, label: '脈管',      file: 'vessel' },
    '脳':        { color: 0xe5985f, label: '脳',        file: 'brain' },
    'その他':     { color: 0xbfb2a2, label: 'その他',    file: 'other' },
    '未分類':     { color: 0xb9ab99, label: '未分類',    file: 'misc' },
  },
};
// 最初に読むもの（骨をまず出す）。続きは boot() が順に読み、着た姿（浅層まで）にする。
const FIRST = ['骨'];
// 骨のあとに自動で読む順（見た目に効く順）。「その他」は浅層の筋膜と大腰筋・横隔膜、
// 「未分類」は外眼筋・会陰筋・耳小骨筋のために読む（出すのは印の付いたものだけ）。
const DRESS_ORDER = ['筋', '関節・靭帯', '腱・筋膜', 'その他', '未分類'];

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

// 筋膜（ファシア）は初期表示に出さない（令和8年8月22日・大沼指示「ファシアいらないかも。邪魔だわ」）。
// 検索・目次から引いたときだけ出る。腱（アキレス腱など）は筋膜ではないので残す。
function isFasciaEntry(e) {
  return !!(e && /fascia|aponeurosis|iliotibial tract/i.test(e.en || ''));
}

// メッシュ1個の層の深さ。浅層の印がいちばん強い（「その他」の筋膜もここで拾う）。
function meshRank(m) {
  if (isFasciaEntry(m.userData.entry)) return null;   // 筋膜は層に出さない
  const c = CLASSIFY[m.userData.partKey];
  if (c && c.s) return 3;
  // 筋の実体が別の系統に入っているもの（大腰筋・横隔膜・膝関節筋・外眼筋・会陰筋・耳小骨筋）は
  // 筋として扱う（令和8年8月22日・大沼指摘「大腰筋がなかったりしたよ」）
  if (c && c.m) return 2;
  const sys = m.userData.layer;
  if (sys === '筋' || sys === '腱・筋膜') return 2;
  if (sys === '関節・靭帯') return 1;
  if (sys === '骨') return 0;
  return null;   // 層の外（神経・血管・脳・その他・未分類）
}

// 名前で引いたとき、その名前のものだけを出す
let searchTarget = null;    // { en, sys }

const classifyReady = fetch('./data/regions.json?v=4').then(r => r.json()).then(j => {
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
// 【令和8年8月22日・操作の直し①】拡大は、画面の真ん中ではなく
// カーソル・つまんだ指の位置に向かって寄る（地図アプリと同じ寄り方）
controls.zoomToCursor = true;

// 【令和8年8月22日・操作の直し④】読み込みの続き（筋・関節…と着ていく間）で、
// 層が読み終わるたびにカメラが初期位置へ戻り、その間の拡大・回転が巻き戻っていた。
// 一度でも動かしたら、読み込みではカメラを戻さない。部位や層を選び直したときだけ戻す。
let userMoved = false;
controls.addEventListener('start', () => { userMoved = true; });

// 光：上からの柔らかい光＋正面からの主光＋うしろからの弱い返し（前の見た目のまま）。
// 色は材質が持っているので、光は白のまま強さだけで整える。
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a4, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(0.5, 1.0, 0.8);
scene.add(key);
const backLight = new THREE.DirectionalLight(0xffffff, 0.45);
backLight.position.set(-0.6, 0.3, -0.7);
scene.add(backLight);

// ---------------------------------------------------------------- 輪郭線（スケッチ調）
// 【令和8年8月22日・大沼指示「視認性を保ちつつ、スケッチのような美しいものに」】
// 色は元データのまま、部品の縁にだけ細い線を引く（解剖図版の描き方）。
// 形を法線の向きにわずかにふくらませて裏面だけ描く。太さは世界の長さで持つ。
const outlineMaterial = new THREE.ShaderMaterial({
  uniforms: {
    thickness: { value: 0.0009 },
    lineColor: { value: new THREE.Color(0x5c5044) },
    lineAlpha: { value: 0.6 },
  },
  vertexShader: `
    uniform float thickness;
    void main() {
      vec3 pushed = position + normalize(normal) * thickness;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pushed, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 lineColor;
    uniform float lineAlpha;
    void main() { gl_FragColor = vec4(lineColor, lineAlpha); }`,
  side: THREE.BackSide,
  transparent: true,
});

// ---------------------------------------------------------------- 材質（元データのものを使う）
// glbに入っているZ-Anatomy自身の材質をそのまま使う。触るのは2点だけ：
// ・薄い膜（横隔膜・筋膜）は袋のように閉じていないので、両面を塗る
// ・半透明（筋膜など）は、透けたぶん奥が見えるように描く順を整える
const preparedMaterials = new Map();
function prepareMaterial(srcMat, sys) {
  if (!srcMat) {
    // 材質が入っていないときだけ、系統の代えの色を使う
    if (!preparedMaterials.has(sys)) {
      preparedMaterials.set(sys, new THREE.MeshStandardMaterial({
        color: LOOK.layers[sys].color, roughness: 0.55, side: THREE.DoubleSide,
      }));
    }
    return preparedMaterials.get(sys);
  }
  if (preparedMaterials.has(srcMat.uuid)) return preparedMaterials.get(srcMat.uuid);
  srcMat.side = THREE.DoubleSide;
  if (srcMat.transparent) srcMat.depthWrite = false;
  preparedMaterials.set(srcMat.uuid, srcMat);
  return srcMat;
}

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

const DATA_VERSION = '4';   // 4=大腰筋など6種の筋の印と和名（令和8年8月22日）
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

      const fill = new THREE.Mesh(geo, prepareMaterial(mesh.material, sys));
      fill.userData.baseMaterial = fill.material;   // 選択の色から戻すときに使う
      fill.userData.entry = entry;
      fill.userData.layer = sys;
      fill.userData.partKey = entry ? (LOOK.layers[sys].file + '/' + entry._key) : null;
      layerGroups[sys].add(fill);
      pickable.push(fill);

      // 輪郭線は部品の子に付ける（見える・見えないが親と一緒に切り替わる）
      if (!(fill.material.transparent)) {           // 半透明のものに線を引くと汚れる
        const line = new THREE.Mesh(geo, outlineMaterial);
        line.raycast = () => {};                    // 触っても当たらない
        fill.add(line);
      }
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

  // 「隠す」で消したもの
  if (m.userData.hidden) return false;

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

function applyVisibility(refit = true) {
  let shown = 0;
  for (const sys of Object.keys(layerGroups)) {
    for (const m of layerGroups[sys].children) {
      const on = meshVisible(m);
      m.visible = on;
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
  if (refit) fitToVisible();   // はがす・戻すのときは寄り直さない
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
  userMoved = false;                      // 選び直したときは、選んだ範囲に合わせて寄り直す
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
  if (!userMoved) applyView(currentView);   // 動かしたあとの読み込みでは、カメラを戻さない
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
  userMoved = false;
  applyView('前');
  if (clearSelection) {
    clearSearch(false);
    restoreOps(false);
    currentRegion = 'all';
    currentSub = null;
    currentStratum = 3;
    for (const s of EXTRA_SYSTEMS) extraOn[s] = false;
    document.querySelectorAll('[data-layer]').forEach(b => b.classList.remove('on'));
    setLabel('', '');
    applyFades();
    applyVisibility();
    updateRestoreChip();
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

  // はがすモード（さわった部位を1枚ずつはがす）と「一枚戻す」
  const peelRow = document.getElementById('peel');
  if (peelRow && !peelRow.children.length) {
    const b = document.createElement('button');
    b.textContent = 'はがすモード';
    b.addEventListener('click', () => {
      peelMode = !peelMode;
      b.classList.toggle('on', peelMode);
      if (peelMode) {
        closeSheet();
        clearHighlight();
        setLabel('', 'さわった部位を1枚ずつはがします');
      } else {
        setLabel('', '');
      }
    });
    peelRow.appendChild(b);
    const u = document.createElement('button');
    u.textContent = '一枚戻す';
    u.addEventListener('click', unpeel);
    peelRow.appendChild(u);
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
let peelMode = false;   // オンのとき、さわった部位を1枚ずつはがす
let PART_LESSONS = {};
// 選んだものは青くする（前の見た目のまま。元データの色と混ざらない色）
const highlightMaterial = new THREE.MeshStandardMaterial({
  color: 0x4d7fae, roughness: 0.5, side: THREE.DoubleSide,
});

// ---------------------------------------------------------------- 部位ごとの操作
// 売れているアプリの4つ組：隠す・薄くする・まわりを薄く・これだけ見る。
// 同じ名前（左右・複製）をひとまとめに扱う。
const fadedCache = new Map();
function fadedOf(base) {
  if (!fadedCache.has(base.uuid)) {
    const m = base.clone();
    m.transparent = true;
    m.opacity = 0.16;
    m.depthWrite = false;
    fadedCache.set(base.uuid, m);
  }
  return fadedCache.get(base.uuid);
}

// 選択の光り（令和8年8月22日・大沼指示2件）
// ・どちらか一方を選んだら左右の両方が光る（同名のまとまりで光らせる）
// ・視点を変えても光ったまま（選択は、別の部位を選ぶ・空を触る・選び直すまで残る）
let selectedGroup = [];   // 確定した選択
let pressedGroup = [];    // 押している間だけの光り
let pressedMesh = null;   // 実際に指が触れた側（左右の表示に使う）

function sameNameMeshes(mesh) {
  const e = mesh.userData.entry;
  if (!e) return [mesh];
  const out = [];
  for (const m of layerGroups[mesh.userData.layer].children) {
    if (m.userData.entry && m.userData.entry.en === e.en) out.push(m);
  }
  return out;
}

function anyOps() {
  return pickable.some(m => m.userData.hidden || m.userData.faded);
}

function applyFades() {
  const lit = new Set([...selectedGroup, ...pressedGroup]);
  for (const m of pickable) {
    if (lit.has(m)) { m.material = highlightMaterial; continue; }
    const base = m.userData.baseMaterial;
    m.material = m.userData.faded ? fadedOf(base) : base;
  }
}

function updateRestoreChip() {
  const chip = document.getElementById('restore');
  if (chip) chip.hidden = !(anyOps() || searchTarget);
}

function restoreOps(refresh = true) {
  for (const m of pickable) { m.userData.hidden = false; m.userData.faded = false; }
  hideStack.length = 0;
  if (refresh) { applyFades(); applyVisibility(); }
  updateRestoreChip();
}

// はがす（隠す）は一枚ずつ積む。「一枚戻す」で逆順に戻せる（令和8年8月22日・大沼指示）
const hideStack = [];
function peelGroup(mesh) {
  const g = sameNameMeshes(mesh).filter(m => !m.userData.hidden);
  if (!g.length) return;
  g.forEach(m => { m.userData.hidden = true; });
  hideStack.push(g);
  applyVisibility(false);   // はがすたびに寄り直さない
  updateRestoreChip();
}
function unpeel() {
  const g = hideStack.pop();
  if (!g) return;
  g.forEach(m => { m.userData.hidden = false; });
  applyVisibility(false);
  updateRestoreChip();
  const e = g[0].userData.entry;
  const lab = labelOf(e);
  setLabel(lab.ja, '一枚戻した');
}

function opHide(mesh)  { peelGroup(mesh); closeSheet(); clearHighlight(); setLabel('', ''); }
function opFade(mesh)  { sameNameMeshes(mesh).forEach(m => { m.userData.faded = true; }); clearHighlight(); applyFades(); updateRestoreChip(); }
function opFadeOthers(mesh) {
  const keep = new Set(sameNameMeshes(mesh));
  for (const m of pickable) { if (m.visible && !keep.has(m)) m.userData.faded = true; }
  applyFades(); updateRestoreChip();
  glideTo(centerOfSameName(mesh));   // 残した部位が回転の軸になる
}
function opIsolate(mesh) {
  const e = mesh.userData.entry;
  if (!e) return;
  searchTarget = { en: e.en, sys: mesh.userData.layer };
  clearHighlight();
  userMoved = false;   // 残した部位に寄り直す
  applyVisibility();
  updateRestoreChip();
}

fetch('./data/part_lessons.json?v=2').then(r => r.json()).then(j => { PART_LESSONS = j; });

// 筋の起始・停止・支配神経（出典：プロメテウス。原本の頁を目視で確かめて転記したものだけ載せる）
let MUSCLE_FACTS = null;
fetch('./data/muscle_facts.json?v=1')
  .then(r => (r.ok ? r.json() : null))
  .then(j => { MUSCLE_FACTS = j; })
  .catch(() => {});

function factsFor(entry, mesh) {
  if (!MUSCLE_FACTS || !entry) return null;
  const c = CLASSIFY[mesh.userData.partKey];
  const isMuscle = mesh.userData.layer === '筋' || (c && c.m);
  if (!isMuscle) return null;
  const en = entry.en.toLowerCase().replace(/^\(/, '').replace(/\)$/, '');
  let bestKey = null;
  for (const k of Object.keys(MUSCLE_FACTS)) {
    if (k.startsWith('_')) continue;
    const kl = k.toLowerCase();
    if (en === kl || en.endsWith(' of ' + kl) || en.includes(kl)) {
      if (!bestKey || kl.length > bestKey.length) bestKey = k;
    }
  }
  return bestKey ? MUSCLE_FACTS[bestKey] : null;
}

function setLabel(ja, en) {
  document.getElementById('ja').textContent = ja;
  document.getElementById('en').textContent = en;
}

function clearHighlight() {
  selectedGroup = [];
  pressedGroup = [];
  applyFades();
}

function pickHit(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const visible = pickable.filter(m => m.visible);
  const hits = raycaster.intersectObjects(visible, false);
  return hits.length ? hits[0] : null;   // .object と 当たった点 .point
}
function pickAt(clientX, clientY) {
  const hit = pickHit(clientX, clientY);
  return hit ? hit.object : null;
}

// 【令和8年8月22日・操作の直し②】見る先とカメラを、すっと滑らせて動かす。
// 動かしたあとは、その点が回転の軸になる（見ているものを軸に回れる）。
let glideRaf = null;
function glideTo(targetPos, dist) {
  if (glideRaf) { cancelAnimationFrame(glideRaf); glideRaf = null; }
  const startT = controls.target.clone();
  const startP = camera.position.clone();
  const dir = startP.clone().sub(startT).normalize();
  const endT = targetPos.clone();
  const endDist = (dist !== undefined) ? dist : startP.distanceTo(startT);
  const endP = endT.clone().add(dir.multiplyScalar(endDist));
  if (reduceMotion) {
    controls.target.copy(endT); camera.position.copy(endP); controls.update(); return;
  }
  const t0 = performance.now(), dur = 450;
  function frame(now) {
    const u = Math.min((now - t0) / dur, 1);
    const e = 1 - Math.pow(1 - u, 3);   // はじめ速く、終わりゆっくり
    controls.target.lerpVectors(startT, endT, e);
    camera.position.lerpVectors(startP, endP, e);
    controls.update();
    glideRaf = (u < 1) ? requestAnimationFrame(frame) : null;
  }
  glideRaf = requestAnimationFrame(frame);
}

// 同じ名前のまとまり（左右・複製）の、いまの位置での中心
function centerOfSameName(mesh) {
  const box = new THREE.Box3();
  for (const m of sameNameMeshes(mesh)) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox.clone();
    b.applyMatrix4(m.matrixWorld);
    box.union(b);
  }
  return box.getCenter(new THREE.Vector3());
}

// 押した瞬間に色を変える（応答は待たせない）。確定した選択は消さない
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  const hit = pickAt(e.clientX, e.clientY);
  pressedMesh = hit;
  pressedGroup = hit ? sameNameMeshes(hit) : [];
  applyFades();
  if (hit) {
    const lab = labelOf(hit.userData.entry);
    setLabel(lab.ja, lab.en);
  }
});

// 回し始めたら、押している間の光りだけ戻す（確定した選択は光ったまま）
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!downAt || !pressedGroup.length) return;
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) {
    pressedGroup = [];
    applyFades();
    if (selectedGroup.length) {
      const lab = labelOf(selectedGroup[0].userData.entry);
      setLabel(lab.ja, lab.en);
    } else {
      setLabel('', '');
    }
  }
});

// 【令和8年8月22日・操作の直し③】2回たたくと、そこへ寄る。
// 寄ったあとは、たたいた点が回転の軸になる。何もない所を2回たたくと全身に戻る。
let lastTap = null;
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 6) { pressedGroup = []; applyFades(); return; }   // 回しただけ

  // はがすモード：さわった部位をその場で1枚はがす（2回たたく寄りは使わない）
  if (peelMode) {
    const hit = pickAt(e.clientX, e.clientY);
    pressedGroup = [];
    applyFades();
    if (hit) {
      const lab = labelOf(hit.userData.entry);
      peelGroup(hit);
      setLabel(lab.ja, 'はがした（' + hideStack.length + '枚）');
    }
    return;
  }

  const now = performance.now();
  if (lastTap && now - lastTap.t < 320
      && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    lastTap = null;
    const hit = pickHit(e.clientX, e.clientY);
    if (hit) {
      const cur = camera.position.distanceTo(controls.target);
      const dist = Math.max(cur * 0.45, controls.minDistance * 1.05);
      glideTo(hit.point.clone(), dist);
    } else {
      glideTo(new THREE.Vector3(0, 0, 0), homeDistance);   // 全身に戻る
    }
    return;
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY };

  const hit = pressedMesh;
  pressedMesh = null;
  if (!hit || !pressedGroup.length) {
    selectedGroup = [];
    pressedGroup = [];
    applyFades();
    closeSheet();
    setLabel('', '');
    return;
  }
  // 選択を確定する。左右・複製のまとまりごと光らせ、視点を変えても光ったまま
  selectedGroup = pressedGroup;
  pressedGroup = [];
  applyFades();
  openSheetFor(hit);
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

let bannerMesh = null;   // いま名前を出している部品（操作の対象）

function openSheetFor(mesh) {
  bannerMesh = mesh;
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

  // 筋なら起始・停止・支配神経を出す（原本を目視で確かめたデータのある筋だけ）
  const factsEl = document.getElementById('s-facts');
  if (factsEl) {
    factsEl.replaceChildren();
    const f = factsFor(e, mesh);
    if (f) {
      const row = (label, text) => {
        if (!text) return;
        const r = document.createElement('div');
        r.className = 'frow';
        const k = document.createElement('span'); k.className = 'k'; k.textContent = label;
        const v = document.createElement('span'); v.className = 'v'; v.textContent = text;
        r.append(k, v);
        factsEl.appendChild(r);
      };
      row('起始', f.起始);
      row('停止', f.停止);
      row('支配神経', f.神経);
      if (f.頁) {
        const s = document.createElement('div');
        s.className = 'src';
        s.textContent = '出典：プロメテウス解剖学アトラス 解剖学総論／運動器系 p.' + f.頁;
        factsEl.appendChild(s);
      }
    }
  }

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
    if (e.target.closest('a,button')) return;   // リンクや操作ボタンを押したときは掴まない
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
      for (const [pid, v] of Object.entries(table)) {
        const en = (v.en || '').trim();
        if (!en) continue;
        if (isLabelObject(v)) continue;    // 説明用の文字物体は索引にも入れない
        const uniq = sys + '|' + en;          // 左右・複製は1行にまとめる
        if (seen.has(uniq)) continue;
        seen.add(uniq);
        idx.push({
          sys, en,
          ja: (v.ja || '').trim(),
          enLower: en.toLowerCase(),
          key: conf.file + '/' + pid,     // 分類（部位・区画）を引くための鍵
          tag: (v.system || conf.label),  // 札の表示（大腰筋などは「筋」と出す）
        });
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
    tag.textContent = (item.tag || LOOK.layers[item.sys].label) + (item.ja ? '　' + item.en : '');
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
  userMoved = false;   // 選んだ部位に寄り直す
  applyVisibility();   // その名前のものだけが残り、そこへ寄る
  updateRestoreChip();
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
  if (refresh) { closeSheet(); userMoved = false; applyVisibility(); }
  updateRestoreChip();
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

// ---------------------------------------------------------------- 目次から辿る
// 売れている解剖アプリの背骨は「系統 → 区画・部位 → 構造」を一覧から辿れること。
// 筋は区画（回旋筋腱板・前腕の前面など）で、それ以外の系統は部位で束ねる。
// 構造を選ぶと、なまえで引いたときと同じ動きをする（その部位だけ残して寄る）。
const catalogEl = document.getElementById('catalog');
const catalogBtn = document.getElementById('catalog-btn');
let catalogBuilt = false;
const REGION_ORDER = ['head', 'neck', 'trunk', 'back', 'thorax', 'abdomen', 'pelvis', 'arm', 'hand', 'leg', 'foot'];

function catalogGroupOf(e) {
  const c = CLASSIFY[e.key];
  // 筋は区画（回旋筋腱板など）が先。区画が無いものは部位で束ねて後ろに置く
  if (e.sys === '筋' && c && c.g !== undefined && GROUPS[c.g]) {
    return { kind: 'g', label: GROUPS[c.g].ja || GROUPS[c.g].en, order: c.g };
  }
  if (c && c.r) {
    const base = (e.sys === '筋') ? 100 : 0;
    return { kind: 'r', label: REGION_JA[c.r], order: base + REGION_ORDER.indexOf(c.r) };
  }
  return { kind: 'x', label: 'そのほか', order: 999 };
}

function buildCatalogDOM() {
  catalogEl.replaceChildren();
  for (const [sys, conf] of Object.entries(LOOK.layers)) {
    const entries = SEARCH_INDEX.filter(e => e.sys === sys);
    if (!entries.length) continue;

    const lv1 = document.createElement('button');
    lv1.className = 'lv1';
    lv1.append(
      Object.assign(document.createElement('span'), { textContent: conf.label }),
      Object.assign(document.createElement('span'), { className: 'count', textContent: entries.length + '種 ▾' }),
    );
    const box1 = document.createElement('div');
    box1.hidden = true;
    lv1.addEventListener('click', () => {
      if (box1.hidden && !box1.children.length) {
        // 開いたときにはじめて中身を作る（全部先に作ると重い）
        const groups = new Map();
        for (const e of entries) {
          const g = catalogGroupOf(e);
          if (!groups.has(g.label)) groups.set(g.label, { order: g.order, items: [] });
          groups.get(g.label).items.push(e);
        }
        const sorted = [...groups.entries()].sort((a, b) => a[1].order - b[1].order);
        for (const [label, g] of sorted) {
          const lv2 = document.createElement('button');
          lv2.className = 'lv2';
          lv2.append(
            Object.assign(document.createElement('span'), { textContent: label }),
            Object.assign(document.createElement('span'), { className: 'count', textContent: g.items.length + '種 ▾' }),
          );
          const box2 = document.createElement('div');
          box2.hidden = true;
          lv2.addEventListener('click', () => {
            if (box2.hidden && !box2.children.length) {
              g.items.sort((a, b) => (a.ja || a.en).localeCompare(b.ja || b.en, 'ja'));
              for (const e of g.items) {
                const it = document.createElement('button');
                it.className = 'item';
                it.textContent = e.ja || e.en;
                if (e.ja) {
                  const enEl = document.createElement('span');
                  enEl.className = 'en';
                  enEl.textContent = e.en;
                  it.appendChild(enEl);
                }
                it.addEventListener('click', () => {
                  catalogEl.hidden = true;
                  chooseSearchResult(e);
                });
                box2.appendChild(it);
              }
            }
            box2.hidden = !box2.hidden;
          });
          box1.append(lv2, box2);
        }
      }
      box1.hidden = !box1.hidden;
    });
    catalogEl.append(lv1, box1);
  }
}

if (catalogBtn) {
  catalogBtn.addEventListener('click', async () => {
    if (!catalogEl.hidden) { catalogEl.hidden = true; return; }
    catalogBtn.classList.add('busy');
    await buildSearchIndex();
    await classifyReady;
    catalogBtn.classList.remove('busy');
    if (!catalogBuilt) { buildCatalogDOM(); catalogBuilt = true; }
    if (searchResults) searchResults.hidden = true;
    catalogEl.hidden = false;
  });
  // 検索を打ち始めたら目次は引っ込める
  if (searchInput) searchInput.addEventListener('focus', () => { catalogEl.hidden = true; });
}

// 名前の下の操作ボタン（隠す・薄くする・まわりを薄く・これだけ見る）と「表示を元に戻す」
{
  const bind = (id, fn) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => { if (bannerMesh) fn(bannerMesh); });
  };
  bind('op-hide', opHide);
  bind('op-fade', opFade);
  bind('op-fade-others', opFadeOthers);
  bind('op-isolate', opIsolate);
  const chip = document.getElementById('restore');
  if (chip) chip.addEventListener('click', () => {
    clearSearch(false);
    userMoved = false;   // 全身が見える位置に戻す
    restoreOps();
    closeSheet();
    clearHighlight();
    setLabel('', '');
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
