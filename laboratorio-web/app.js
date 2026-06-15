import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

const MODEL_URL = new URL("../modelo3D-brazo/source/rigged hand.fbx", import.meta.url).href;
const TEXTURE_URL = new URL("../modelo3D-brazo/textures/pCube1_albedo.jpg", import.meta.url).href;
const NORMAL_URL = new URL("../modelo3D-brazo/textures/pCube1_normal.png", import.meta.url).href;
const ROUGHNESS_URL = new URL("../modelo3D-brazo/textures/pCube1_roughness.jpg", import.meta.url).href;
const METALLIC_URL = new URL("../modelo3D-brazo/textures/pCube1_metallic.jpg", import.meta.url).href;
const AO_URL = new URL("../modelo3D-brazo/textures/pCube1_AO.jpg", import.meta.url).href;
const PLATFORM_TOP_Y = -44;
const PLATFORM_CENTER = new THREE.Vector3(0, PLATFORM_TOP_Y, 0);
const REST_POSE = {
  thumb: { base: 0, mid: 0, tip: 0, spread: 24 },
  index: { base: 2, mid: 1, tip: 0, spread: 10 },
  middle: { base: 1, mid: 1, tip: 0, spread: 1 },
  ring: { base: 2, mid: 1, tip: 0, spread: -8 },
  pinky: { base: 3, mid: 1, tip: 0, spread: -18 }
};
const ACTIVE_LIFT = {
  thumb: { base: 22, mid: 10, tip: 4 },
  index: { base: 48, mid: 22, tip: 10 },
  middle: { base: 50, mid: 22, tip: 10 },
  ring: { base: 46, mid: 20, tip: 9 },
  pinky: { base: 42, mid: 18, tip: 8 }
};
const REAL_ROTATION_AXIS = {
  pulgar: -1,
  indice: -1,
  medio: -1,
  anular: -1,
  menique: -1
};

const fingers = [
  { id: "thumb", label: "Pulgar", key: "pulgar" },
  { id: "index", label: "Indice", key: "indice" },
  { id: "middle", label: "Medio", key: "medio" },
  { id: "ring", label: "Anular", key: "anular" },
  { id: "pinky", label: "Menique", key: "menique" }
];

const realFingerBones = {
  pulgar: ["thumb", "thumbjoint", "joint6"],
  indice: ["inderxfinger", "indermiddle", "indertop"],
  medio: ["middlefinger", "middlemiddle", "middletop"],
  anular: ["ringvinger", "ringmiddle", "ringtop"],
  menique: ["pinkyfinger", "pinkymiddle", "pinkytop"]
};

const letterMap = {
  pulgar: ["a", "b", "c", "d", "e", "f"],
  indice: ["g", "h", "i", "j", "k", "l"],
  medio: ["m", "n", "ñ", "o", "p"],
  anular: ["q", "r", "s", "t", "u"],
  menique: ["v", "w", "x", "y", "z"]
};
letterMap.medio = ["m", "n", "\u00f1", "o", "p"];

const state = {
  hand: "r",
  view: "r",
  mode: "letters",
  labEnabled: false,
  model: null,
  realModelReady: false,
  fallbackActive: false,
  skeletonHelper: null,
  labHands: {},
  bones: new Map(),
  serialPort: null,
  serialReader: null,
  ws: null,
  demoTimer: null,
  fingerValues: {
    r: makeRestPose(),
    l: makeRestPose()
  }
};

const els = {
  sceneHost: document.querySelector("#sceneHost"),
  modelStatus: document.querySelector("#modelStatus"),
  loadBadge: document.querySelector("#loadBadge"),
  serialBadge: document.querySelector("#serialBadge"),
  modeBadge: document.querySelector("#modeBadge"),
  lastEvent: document.querySelector("#lastEvent"),
  boneSummary: document.querySelector("#boneSummary"),
  boneReport: document.querySelector("#boneReport"),
  fingerControls: document.querySelector("#fingerControls"),
  keyboard: document.querySelector("#keyboard"),
  textOutput: document.querySelector("#textOutput"),
  handSelect: document.querySelector("#handSelect"),
  viewSelect: document.querySelector("#viewSelect"),
  wsUrl: document.querySelector("#wsUrl"),
  calibrateBtn: document.querySelector("#calibrateBtn"),
  startLabBtn: document.querySelector("#startLabBtn"),
  pauseLabBtn: document.querySelector("#pauseLabBtn"),
  connectWsBtn: document.querySelector("#connectWsBtn"),
  calibrationFill: document.querySelector("#calibrationFill"),
  calibrationLabel: document.querySelector("#calibrationLabel")
};

function setBadge(el, text, status = "") {
  if (!el) return;
  el.textContent = text;
  el.classList.remove("status-ok", "status-warn", "status-bad", "status-info");
  if (status) el.classList.add(`status-${status}`);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x151920);

const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 2000);
camera.position.set(0, 70, 230);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
els.sceneHost.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 55, 0);

scene.add(new THREE.HemisphereLight(0xf4f7ff, 0x2f3439, 1.9));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.7);
keyLight.position.set(115, 150, 120);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x8fb8ff, 0.75);
fillLight.position.set(-120, 70, 70);
scene.add(fillLight);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const tableGroup = createTableAndPlatform();
scene.add(tableGroup);

const labHandsGroup = createLabHands();
scene.add(labHandsGroup);

const grid = new THREE.GridHelper(260, 26, 0xe0c34f, 0x2e7e5e);
grid.position.y = PLATFORM_TOP_Y + 0.2;
scene.add(grid);

const skeletonHelperGroup = new THREE.Group();
scene.add(skeletonHelperGroup);
updateLabHandVisibility();

function resize() {
  const rect = els.sceneHost.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height);
  camera.aspect = rect.width / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resize);
resize();

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

function cleanBoneName(name) {
  return name.replace(/\u0000.*$/, "").replace(/^Model::/, "");
}

function normalizeBoneName(name) {
  return cleanBoneName(name).toLowerCase();
}

function makeRestPose() {
  return Object.fromEntries(
    fingers.map((finger) => [finger.id, { ...REST_POSE[finger.id] }])
  );
}

function registerBones(root) {
  state.bones.clear();
  root.traverse((obj) => {
    if (obj.isBone) {
      state.bones.set(normalizeBoneName(obj.name), obj);
    }
  });
}

function boneName(fingerId, segment, side = state.hand) {
  return `${fingerId}_${String(segment).padStart(2, "0")}_${side}`;
}

function getBone(fingerId, segment, side = state.hand) {
  return state.bones.get(boneName(fingerId, segment, side));
}

function getRigNode(name) {
  return state.bones.get(name);
}

function createTableAndPlatform() {
  const group = new THREE.Group();

  const tableMaterial = new THREE.MeshStandardMaterial({
    color: 0x22272c,
    roughness: 0.72,
    metalness: 0.08
  });
  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: 0xf0cc45,
    roughness: 0.6,
    metalness: 0.18
  });
  const matMaterial = new THREE.MeshStandardMaterial({
    color: 0x0d6c54,
    roughness: 0.9,
    metalness: 0.02
  });

  const table = new THREE.Mesh(new THREE.BoxGeometry(290, 10, 196), tableMaterial);
  table.position.set(0, PLATFORM_TOP_Y - 22, 0);
  table.receiveShadow = true;
  table.castShadow = true;
  group.add(table);

  const platform = new THREE.Mesh(new THREE.BoxGeometry(184, 10, 122), edgeMaterial);
  platform.position.set(0, PLATFORM_TOP_Y - 8, 0);
  platform.receiveShadow = true;
  platform.castShadow = true;
  group.add(platform);

  const mat = new THREE.Mesh(new THREE.BoxGeometry(166, 3, 104), matMaterial);
  mat.position.set(0, PLATFORM_TOP_Y + 2, 0);
  mat.receiveShadow = true;
  mat.castShadow = true;
  group.add(mat);

  for (let x = -70; x <= 70; x += 14) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 104), edgeMaterial);
    line.position.set(x, PLATFORM_TOP_Y + 3.9, 0);
    group.add(line);
  }

  for (let z = -42; z <= 42; z += 14) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(166, 0.6, 0.42), edgeMaterial);
    line.position.set(0, PLATFORM_TOP_Y + 4, z);
    group.add(line);
  }

  return group;
}

function createLabHands() {
  const group = new THREE.Group();
  state.labHands = {};

  for (const side of ["l", "r"]) {
    const hand = createLabHand(side);
    state.labHands[side] = hand.userData.lab;
    group.add(hand);
  }

  updateLabHandVisibility();
  return group;
}

function createLabHand(side) {
  const sideSign = side === "r" ? 1 : -1;
  const group = new THREE.Group();
  group.name = `lab_hand_${side}`;

  const skin = new THREE.MeshStandardMaterial({
    color: 0xa7653f,
    roughness: 0.68,
    metalness: 0.02
  });
  const skinDark = new THREE.MeshStandardMaterial({
    color: 0x7f4328,
    roughness: 0.76,
    metalness: 0.01
  });
  const crease = new THREE.MeshStandardMaterial({
    color: 0x6d3522,
    roughness: 0.82,
    metalness: 0.01
  });
  const nail = new THREE.MeshStandardMaterial({
    color: 0xe9cfc1,
    roughness: 0.58,
    metalness: 0.01
  });

  const palm = new THREE.Mesh(new THREE.SphereGeometry(26, 32, 18), skin);
  palm.position.set(0, PLATFORM_TOP_Y + 12.4, -4);
  palm.scale.set(0.9, 0.24, 1.08);
  palm.castShadow = true;
  palm.receiveShadow = true;
  group.add(palm);

  const palmPad = new THREE.Mesh(new THREE.SphereGeometry(18, 28, 14), skinDark);
  palmPad.position.set(sideSign * 11, PLATFORM_TOP_Y + 11.7, -15);
  palmPad.scale.set(0.78, 0.16, 0.76);
  palmPad.castShadow = true;
  palmPad.receiveShadow = true;
  group.add(palmPad);

  const thumbPad = new THREE.Mesh(new THREE.SphereGeometry(13, 24, 12), skin);
  thumbPad.position.set(sideSign * 20, PLATFORM_TOP_Y + 12.7, -18);
  thumbPad.scale.set(0.72, 0.18, 0.95);
  thumbPad.rotation.y = THREE.MathUtils.degToRad(sideSign * 28);
  thumbPad.castShadow = true;
  thumbPad.receiveShadow = true;
  group.add(thumbPad);

  for (const x of [-15, -5, 6, 16]) {
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(4.8, 18, 10), skinDark);
    knuckle.position.set(x, PLATFORM_TOP_Y + 16.2, 22);
    knuckle.scale.set(1.08, 0.38, 0.86);
    knuckle.castShadow = true;
    group.add(knuckle);
  }

  for (const x of [-14, 0, 14]) {
    const creaseLine = new THREE.Mesh(new THREE.BoxGeometry(18, 0.35, 0.8), crease);
    creaseLine.position.set(x * 0.55, PLATFORM_TOP_Y + 16.9, 4 + Math.abs(x) * 0.1);
    creaseLine.rotation.y = THREE.MathUtils.degToRad(x * 0.55);
    group.add(creaseLine);
  }

  const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(13, 46, 12, 22), skin);
  wrist.rotation.x = Math.PI / 2;
  wrist.position.set(0, PLATFORM_TOP_Y + 13, -50);
  wrist.scale.set(1.08, 0.72, 1);
  wrist.castShadow = true;
  wrist.receiveShadow = true;
  group.add(wrist);

  const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(16, 70, 14, 24), skin);
  forearm.rotation.x = Math.PI / 2;
  forearm.position.set(0, PLATFORM_TOP_Y + 17, -95);
  forearm.scale.set(1.12, 0.82, 1);
  forearm.castShadow = true;
  forearm.receiveShadow = true;
  group.add(forearm);

  const lab = { group, fingers: {} };
  const specs = {
    index: { x: -14, z: 22, lengths: [25, 18, 13], radius: 4.9, restSpread: -7 },
    middle: { x: 0, z: 24, lengths: [29, 20, 14], radius: 5.2, restSpread: 0 },
    ring: { x: 14, z: 22, lengths: [26, 18, 13], radius: 4.9, restSpread: 7 },
    pinky: { x: 27, z: 17, lengths: [21, 15, 11], radius: 4.1, restSpread: 16 },
    thumb: { x: sideSign * 27, z: -8, lengths: [18, 15, 12], radius: 4.8, restSpread: sideSign * 50, thumb: true }
  };

  for (const finger of fingers) {
    lab.fingers[finger.id] = createLabFinger(group, specs[finger.id], skin, skinDark, crease, nail);
  }

  group.userData.lab = lab;
  return group;
}

function createLabFinger(parent, spec, skin, skinDark, crease, nail) {
  const root = new THREE.Group();
  root.position.set(spec.x, PLATFORM_TOP_Y + 13.8, spec.z);
  root.rotation.y = THREE.MathUtils.degToRad(spec.restSpread);
  parent.add(root);

  const pivots = [];
  let current = root;

  spec.lengths.forEach((length, index) => {
    const pivot = new THREE.Group();
    if (index > 0) pivot.position.z = spec.lengths[index - 1];
    current.add(pivot);
    pivots.push(pivot);

    const radius = Math.max(2.6, spec.radius - index * 0.52);
    const segment = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 12, 18), skin);
    segment.rotation.x = Math.PI / 2;
    segment.position.z = length / 2;
    segment.scale.set(0.92 - index * 0.03, 0.76 - index * 0.04, 1);
    segment.castShadow = true;
    segment.receiveShadow = true;
    pivot.add(segment);

    const dorsal = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.88, 16, 8), skinDark);
    dorsal.position.set(0, radius * 0.48, length * 0.42);
    dorsal.scale.set(0.95, 0.24, 1.25);
    dorsal.castShadow = true;
    dorsal.receiveShadow = true;
    pivot.add(dorsal);

    const joint = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.9, 16, 8), skinDark);
    joint.position.set(0, radius * 0.5, index === 0 ? 1.5 : 0);
    joint.scale.set(1, 0.25, 0.72);
    joint.castShadow = true;
    pivot.add(joint);

    if (index > 0) {
      const creaseLine = new THREE.Mesh(new THREE.BoxGeometry(radius * 2.1, 0.28, 0.65), crease);
      creaseLine.position.set(0, radius * 0.98, 1.4);
      pivot.add(creaseLine);
    }

    if (index === spec.lengths.length - 1) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.9, 18, 10), skin);
      tip.position.set(0, 0, length + 0.8);
      tip.scale.set(0.88, 0.68, 0.76);
      tip.castShadow = true;
      pivot.add(tip);

      const nailMesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.62, 18, 8), nail);
      nailMesh.position.set(0, radius * 0.72, length * 0.82);
      nailMesh.scale.set(0.72, 0.12, 1.05);
      nailMesh.rotation.x = THREE.MathUtils.degToRad(-9);
      nailMesh.castShadow = true;
      pivot.add(nailMesh);
    }

    current = pivot;
  });

  return { root, pivots, restSpread: spec.restSpread, thumb: Boolean(spec.thumb) };
}

function updateLabHandVisibility() {
  for (const side of ["l", "r"]) {
    const lab = state.labHands[side];
    if (!lab) continue;
    lab.group.visible = state.fallbackActive && !state.realModelReady && (state.view === "both" || state.view === side);
    if (state.view === "both") {
      lab.group.position.x = side === "l" ? -52 : 52;
    } else {
      lab.group.position.x = 0;
    }
  }
}

function updateLabHandPose() {
  for (const side of ["l", "r"]) {
    const lab = state.labHands[side];
    if (!lab) continue;
    const sideValues = state.fingerValues[side];

    for (const finger of fingers) {
      const rig = lab.fingers[finger.id];
      const values = sideValues[finger.id];
      if (!rig) continue;

      rig.root.rotation.y = THREE.MathUtils.degToRad(rig.restSpread + values.spread * 0.55);
      rig.pivots[0].rotation.x = THREE.MathUtils.degToRad(-values.base);
      rig.pivots[1].rotation.x = THREE.MathUtils.degToRad(-values.mid);
      rig.pivots[2].rotation.x = THREE.MathUtils.degToRad(-values.tip);
    }
  }
}

function isolateSelectedArm() {
  if (!state.model) return;

  for (const side of ["l", "r"]) {
    const visible = state.view === "both" || side === state.view;
    const root =
      getRigNode(`clavicle_${side}`) ||
      getRigNode(`upperarm_${side}`) ||
      getRigNode(`hand_${side}`);

    if (root) {
      root.scale.setScalar(visible ? 1 : 0.001);
      root.visible = visible;
    }
  }

  if (state.skeletonHelper) {
    state.skeletonHelper.visible = false;
  }
}

function placeHandsOnPlatform() {
  if (!state.model) return;
  const hand = getRigNode(`hand_${state.view === "l" ? "l" : "r"}`);
  if (!hand) return;

  state.model.updateMatrixWorld(true);
  const current = new THREE.Vector3();
  hand.getWorldPosition(current);

  const target = PLATFORM_CENTER.clone();
  target.y += 10;
  target.z += 10;
  if (state.view === "both") target.x -= 28;

  state.model.position.add(target.sub(current));
  state.model.updateMatrixWorld(true);
}

function visibleSides() {
  return state.view === "both" ? ["l", "r"] : [state.view];
}

function applyPoseForSide(side) {
  const flexAxis = side === "r" ? -1 : 1;
  const spreadAxis = side === "r" ? 1 : -1;
  const sideValues = state.fingerValues[side];

  for (const finger of fingers) {
    const values = sideValues[finger.id];
    const b1 = getBone(finger.id, 1, side);
    const b2 = getBone(finger.id, 2, side);
    const b3 = getBone(finger.id, 3, side);

    if (b1) {
      b1.rotation.z = THREE.MathUtils.degToRad(values.base * flexAxis);
      b1.rotation.y = THREE.MathUtils.degToRad(values.spread * spreadAxis);
    }
    if (b2) b2.rotation.z = THREE.MathUtils.degToRad(values.mid * flexAxis);
    if (b3) b3.rotation.z = THREE.MathUtils.degToRad(values.tip * flexAxis);
  }
}

function applyRealModelPose() {
  if (!state.realModelReady) return;

  for (const finger of fingers) {
    const values = state.fingerValues[state.hand][finger.id];
    const names = realFingerBones[finger.key];
    if (!names) continue;

    const axis = REAL_ROTATION_AXIS[finger.key] || -1;
    const rotations = [
      values.base * 0.9 * axis,
      values.mid * 0.9 * axis,
      values.tip * 0.9 * axis
    ];

    names.forEach((name, index) => {
      const bone = getRigNode(name);
      if (!bone) return;
      bone.rotation.x = THREE.MathUtils.degToRad(rotations[index]);
    });
  }
}

function applyPose() {
  for (const side of ["l", "r"]) {
    applyPoseForSide(side);
  }
  applyRealModelPose();
  isolateSelectedArm();
  updateLabHandVisibility();
  updateLabHandPose();
}

function resetPose() {
  state.fingerValues[state.hand] = makeRestPose();
  syncSliders();
  applyPose();
}

function setFingerFlex(fingerKey, active) {
  const finger = fingers.find((item) => item.key === fingerKey);
  if (!finger) return;
  const rest = REST_POSE[finger.id];
  const lift = active ? ACTIVE_LIFT[finger.id] : { base: 0, mid: 0, tip: 0 };
  state.fingerValues[state.hand][finger.id] = {
    base: rest.base + lift.base,
    mid: rest.mid + lift.mid,
    tip: rest.tip + lift.tip,
    spread: state.fingerValues[state.hand][finger.id].spread
  };
  syncSliders();
  applyPose();
}

function focusModel() {
  let target = new THREE.Vector3(0, PLATFORM_TOP_Y + 14, 8);

  if (state.model) {
    state.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(state.model);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      target = new THREE.Vector3(center.x - 3, PLATFORM_TOP_Y + 14, center.z - 6);
    }
  }

  controls.target.copy(target);
  camera.position.set(target.x, target.y + 132, target.z - 76);
  controls.update();
}

function alignRealModelOnTable(model) {
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const targetY = PLATFORM_TOP_Y + 3.4;

  model.position.x -= center.x;
  model.position.x -= 12;
  model.position.z -= center.z + 8;
  model.position.y += targetY - box.min.y;

  model.updateMatrixWorld(true);

  const laidBox = new THREE.Box3().setFromObject(model);
  const laidSize = laidBox.getSize(new THREE.Vector3());
  if (laidSize.z < laidSize.y) {
    model.rotation.x -= Math.PI / 2;
    model.updateMatrixWorld(true);
    const rotatedBox = new THREE.Box3().setFromObject(model);
    const rotatedCenter = rotatedBox.getCenter(new THREE.Vector3());
    model.position.x -= rotatedCenter.x;
    model.position.x -= 12;
    model.position.z -= rotatedCenter.z + 8;
    model.position.y += targetY - rotatedBox.min.y;
  }
}

function addFallbackRig() {
  state.fallbackActive = true;
  updateLabHandVisibility();
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} tardo mas de ${ms}ms`)), ms);
    })
  ]);
}

async function loadTexture(textureLoader, url, timeoutMs, label) {
  try {
    return await withTimeout(textureLoader.loadAsync(url), timeoutMs, label);
  } catch (error) {
    console.warn(error);
    return null;
  }
}

async function loadModel() {
  setBadge(els.loadBadge, "Modelo: cargando FBX", "warn");
  els.modelStatus.textContent = "Cargando el brazo 3D real...";
  state.fallbackActive = false;
  updateLabHandVisibility();

  try {
    const textureLoader = new THREE.TextureLoader();
    const [texture, normalMap, roughnessMap, metalnessMap, aoMap] = await Promise.all([
      loadTexture(textureLoader, TEXTURE_URL, 5000, "Textura albedo"),
      loadTexture(textureLoader, NORMAL_URL, 5000, "Textura normal"),
      loadTexture(textureLoader, ROUGHNESS_URL, 5000, "Textura roughness"),
      loadTexture(textureLoader, METALLIC_URL, 5000, "Textura metallic"),
      loadTexture(textureLoader, AO_URL, 5000, "Textura AO")
    ]);
    if (texture) texture.colorSpace = THREE.SRGBColorSpace;

    const fbx = await withTimeout(new FBXLoader().loadAsync(MODEL_URL), 12000, "Modelo FBX");
    fbx.scale.setScalar(4.1);
    fbx.rotation.set(0, 0, Math.PI * 1.96);
    fbx.position.set(0, 0, 0);

    fbx.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        obj.visible = true;
        if (!obj.geometry.attributes.uv2 && obj.geometry.attributes.uv) {
          obj.geometry.setAttribute("uv2", obj.geometry.attributes.uv);
        }
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            if (texture) mat.map = texture;
            if (normalMap) mat.normalMap = normalMap;
            if (roughnessMap) mat.roughnessMap = roughnessMap;
            if (metalnessMap) mat.metalnessMap = metalnessMap;
            if (aoMap) mat.aoMap = aoMap;
            mat.roughness = 0.72;
            mat.metalness = 0.02;
            mat.needsUpdate = true;
          }
        }
      }
    });

    scene.add(fbx);
    state.model = fbx;
    registerBones(fbx);

    skeletonHelperGroup.clear();
    const helper = new THREE.SkeletonHelper(fbx);
    helper.material.color.set(0xe6b84b);
    helper.visible = false;
    skeletonHelperGroup.add(helper);
    state.skeletonHelper = helper;
    state.realModelReady = true;
    state.fallbackActive = false;

    alignRealModelOnTable(fbx);
    applyPose();
    isolateSelectedArm();

    els.modelStatus.textContent = "Nuevo modelo FBX cargado para prueba real de huesos.";
    setBadge(els.loadBadge, "Modelo: brazo FBX", "ok");
    updateBoneReport();
    applyPose();
    focusModel();
  } catch (error) {
    console.error(error);
    state.realModelReady = false;
    state.fallbackActive = true;
    updateLabHandVisibility();
    els.modelStatus.textContent = `No se pudo cargar el FBX real: ${error.message}. Se muestra la mano de laboratorio.`;
    setBadge(els.loadBadge, "Modelo: respaldo", "bad");
    addFallbackRig();
  }
}

function updateBoneReport() {
  let ok = 0;
  let missing = 0;
  els.boneReport.innerHTML = "";

  for (const finger of fingers) {
    const expected = realFingerBones[finger.key] || [];
    const found = expected.filter((name) => state.bones.has(name));
    ok += found.length;
    missing += expected.length - found.length;

    const row = document.createElement("div");
    row.className = "bone-line";
    row.innerHTML = `
      <strong>${finger.label}</strong>
      <span class="${found.length === 3 ? "ok" : "warn"}">${found.length}/3 ${expected.join(" -> ")}</span>
    `;
    els.boneReport.appendChild(row);
  }

  const totalBones = [...state.bones.keys()].length;
  els.boneSummary.textContent = `${ok}/15 falanges, ${totalBones} huesos`;
  if (missing > 0) els.boneSummary.className = "warn";
}

function createFingerControls() {
  els.fingerControls.innerHTML = "";
  for (const finger of fingers) {
    const row = document.createElement("div");
    row.className = "finger-row";
    row.innerHTML = `
      <div class="finger-title">
        <strong>${finger.label}</strong>
        <span id="${finger.id}-value">0 deg</span>
      </div>
      ${rangeMarkup(finger.id, "base", "Elevar", 0, 58)}
      ${rangeMarkup(finger.id, "mid", "Falange", 0, 32)}
      ${rangeMarkup(finger.id, "tip", "Punta", 0, 18)}
      ${rangeMarkup(finger.id, "spread", "Apertura", -35, 35)}
    `;
    els.fingerControls.appendChild(row);
  }

  els.fingerControls.addEventListener("input", (event) => {
    const input = event.target;
    if (!input.matches("input[type='range']")) return;
    state.fingerValues[state.hand][input.dataset.finger][input.dataset.part] = Number(input.value);
    syncSliders();
    applyPose();
  });
}

function rangeMarkup(finger, part, label, min, max) {
  return `
    <div class="range-line">
      <label for="${finger}-${part}">${label}</label>
      <input id="${finger}-${part}" data-finger="${finger}" data-part="${part}" type="range" min="${min}" max="${max}" value="0">
      <output id="${finger}-${part}-out">0</output>
    </div>
  `;
}

function syncSliders() {
  for (const finger of fingers) {
    const values = state.fingerValues[state.hand][finger.id];
    for (const part of ["base", "mid", "tip", "spread"]) {
      const input = document.querySelector(`#${finger.id}-${part}`);
      const output = document.querySelector(`#${finger.id}-${part}-out`);
      if (input) input.value = values[part];
      if (output) output.value = values[part];
    }
    const value = document.querySelector(`#${finger.id}-value`);
    if (value) value.textContent = `${values.base} deg`;
  }
}

function parseIncoming(raw) {
  const line = raw.trim().toLowerCase();
  if (!line) return null;
  const normalized = line
    .replace(/\s*:\s*/g, ":")
    .replace(/^sys:/, "SYS:");

  if (normalized.startsWith("SYS:")) {
    return { type: "system", message: normalized.slice(4) };
  }

  const [finger, status] = normalized.split(":");
  if (!finger || !status) return null;
  if (!letterMap[finger]) return null;
  if (!["activo", "reposo"].includes(status)) return null;
  return { type: "finger", finger, status };
}

function handleIncoming(raw) {
  const trimmed = String(raw).trim();
  if (trimmed.startsWith("{")) {
    try {
      handleBridgeMessage(JSON.parse(trimmed));
    } catch (_error) {
      return;
    }
    return;
  }

  const msg = parseIncoming(raw);
  if (!msg) return;

  if (msg.type === "system") {
    els.lastEvent.textContent = `SYS: ${msg.message}`;
    return;
  }

  els.lastEvent.textContent = `${msg.finger}:${msg.status}`;
  setFingerFlex(msg.finger, msg.status === "activo");
  if (msg.status === "activo") {
    emitKeyboardFromFinger(msg.finger);
  }
}

function handleBridgeMessage(msg) {
  if (!msg || !msg.type) return;

  if (msg.type === "hello") {
    setMode(msg.mode || state.mode);
    if (msg.esp32_ip) {
      setBadge(els.serialBadge, `ESP32: ${msg.esp32_ip}`, msg.enabled ? "ok" : "warn");
    } else {
      setBadge(els.serialBadge, "Puente: conectado", "ok");
    }
    els.lastEvent.textContent = msg.enabled ? "Sistema iniciado" : "Esperando inicio";
    return;
  }

  if (msg.type === "connected") {
    if (msg.esp32_ip) {
      setBadge(els.serialBadge, `ESP32: ${msg.esp32_ip}`, "ok");
      els.lastEvent.textContent = "ESP32 conectado por UDP";
    } else {
      setBadge(els.serialBadge, "ESP32: desconectado", "bad");
      els.lastEvent.textContent = "Conexion cerrada";
    }
    return;
  }

  if (msg.type === "enabled") {
    state.labEnabled = Boolean(msg.enabled);
    els.textOutput.disabled = !state.labEnabled;
    renderKeyboard();
    els.startLabBtn.textContent = "Iniciar";
    els.startLabBtn.classList.toggle("active", state.labEnabled);
    els.lastEvent.textContent = msg.enabled ? "Teclado habilitado" : "Teclado detenido";
    return;
  }

  if (msg.type === "system") {
    els.lastEvent.textContent = `SYS: ${msg.message}`;
    return;
  }

  if (msg.type === "calibration") {
    const percent = Math.max(0, Math.min(100, Number(msg.percent || 0)));
    els.calibrationFill.style.width = `${percent}%`;
    els.calibrationLabel.textContent = `Calibracion: ${percent}%`;
    els.calibrateBtn.classList.toggle("active", percent > 0 && percent < 100);
    if (percent >= 100) {
      els.calibrateBtn.classList.remove("active");
      els.lastEvent.textContent = "Calibracion completada";
    }
    return;
  }

  if (msg.type === "mode") {
    setMode(msg.mode || "letters");
    markModeChange();
    return;
  }

  if (msg.type === "finger") {
    els.lastEvent.textContent = `${msg.finger}:${msg.status}`;
    setFingerFlex(msg.finger, msg.status === "activo");
    return;
  }

  if (msg.type === "preview") {
    els.lastEvent.textContent = `${msg.finger} x${msg.count} -> ${msg.key}`;
    if (msg.key) markKeyboardKey(msg.key, "key-preview", 900);
    return;
  }

  if (msg.type === "confirm") {
    if (msg.key && msg.key.length === 1) {
      writeText(msg.key);
    } else if (msg.key === "space") {
      writeText(" ");
    } else if (msg.key === "enter") {
      writeText("\n");
    } else if (msg.key === "tab") {
      writeText("  ");
    } else if (msg.key === "backspace") {
      deletePreviousChar();
    } else if (msg.key === "clear") {
      clearTextOutput();
    } else if (msg.key === "windows") {
      els.lastEvent.textContent = "Complementos: Windows";
    } else if (msg.key === "left_click") {
      els.lastEvent.textContent = "Complementos: click izquierdo";
    } else if (msg.key === "right_click") {
      els.lastEvent.textContent = "Complementos: click derecho";
    } else if (String(msg.key || "").startsWith("mouse_")) {
      els.lastEvent.textContent = `Complementos: ${msg.key}`;
    }
    if (msg.key) markKeyboardKey(msg.key, "key-confirmed", 900);
    return;
  }

  if (msg.type === "error") {
    els.lastEvent.textContent = msg.message || "Error";
    setBadge(els.serialBadge, "Puente: error", "bad");
  }
}

function emitKeyboardFromFinger(finger) {
  if (state.mode !== "letters") return;
  const chars = letterMap[finger] || [];
  const char = chars[0];
  if (char) {
    markKeyboardKey(char, "key-preview", 180);
    window.setTimeout(() => {
      writeText(char);
      markKeyboardKey(char, "key-confirmed", 650);
    }, 190);
  }
}

function writeText(value) {
  const target = els.textOutput;
  const start = target.selectionStart;
  const end = target.selectionEnd;
  target.value = target.value.slice(0, start) + value + target.value.slice(end);
  target.selectionStart = target.selectionEnd = start + value.length;
}

function deletePreviousChar() {
  const target = els.textOutput;
  const pos = target.selectionStart;
  if (pos > 0) {
    target.value = target.value.slice(0, pos - 1) + target.value.slice(target.selectionEnd);
    target.selectionStart = target.selectionEnd = pos - 1;
  }
}

function clearTextOutput() {
  els.textOutput.value = "";
  els.textOutput.selectionStart = els.textOutput.selectionEnd = 0;
}

function markModeChange() {
  document.querySelectorAll(".mode-btn.active").forEach((button) => {
    button.classList.add("key-confirmed");
    window.setTimeout(() => button.classList.remove("key-confirmed"), 700);
  });
}

function markKeyboardKey(value, className, duration = 500) {
  const aliases = {
    windows: "windows",
    mouse_left: "cursor izquierda",
    mouse_right: "cursor derecha",
    mouse_up: "cursor arriba",
    mouse_down: "cursor abajo",
    backspace: "borrar",
    clear: "borrar",
    left_click: "click izquierdo",
    right_click: "click derecho"
  };
  const key = aliases[String(value).toLowerCase()] || String(value).toLowerCase();
  const button = [...els.keyboard.querySelectorAll("button")]
    .find((item) => item.dataset.key === key);
  if (!button) return;

  button.classList.remove("key-preview", "key-confirmed");
  button.classList.add(className);
  window.setTimeout(() => {
    button.classList.remove(className);
  }, duration);
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    setBadge(els.serialBadge, "ESP32: Web Serial no disponible", "bad");
    return;
  }

  state.serialPort = await navigator.serial.requestPort();
  await state.serialPort.open({ baudRate: 115200 });
  setBadge(els.serialBadge, "ESP32: serial conectado", "ok");

  const decoder = new TextDecoderStream();
  state.serialPort.readable.pipeTo(decoder.writable);
  state.serialReader = decoder.readable.getReader();

  let buffer = "";
  while (state.serialPort && state.serialReader) {
    const { value, done } = await state.serialReader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) handleIncoming(line);
  }
}

async function disconnectSerial() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ action: "disconnect" }));
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  if (state.serialReader) {
    await state.serialReader.cancel();
    state.serialReader = null;
  }
  if (state.serialPort) {
    await state.serialPort.close();
    state.serialPort = null;
  }
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  setBadge(els.serialBadge, "ESP32: desconectado", "bad");
  state.labEnabled = false;
  els.textOutput.disabled = true;
  els.startLabBtn.textContent = "Iniciar";
  els.startLabBtn.classList.remove("active");
  els.connectWsBtn.classList.remove("active");
  renderKeyboard();
}

function connectWebSocket() {
  if (state.ws) state.ws.close();
  const wsUrl = els.wsUrl.value.trim().replace("ws://localhost:", "ws://127.0.0.1:");
  els.wsUrl.value = wsUrl;
  state.ws = new WebSocket(wsUrl);
  setBadge(els.serialBadge, "Puente: conectando", "warn");
  els.lastEvent.textContent = "Conectando con puente...";
  els.connectWsBtn.classList.add("active");
  state.ws.addEventListener("open", () => {
    setBadge(els.serialBadge, "Puente: conectado", "ok");
    els.lastEvent.textContent = "Esperando ESP32 por UDP";
  });
  state.ws.addEventListener("message", (event) => handleIncoming(String(event.data)));
  state.ws.addEventListener("close", () => {
    setBadge(els.serialBadge, "Puente: cerrado", "bad");
    els.connectWsBtn.classList.remove("active");
    state.labEnabled = false;
    els.textOutput.disabled = true;
    els.startLabBtn.classList.remove("active");
    renderKeyboard();
  });
  state.ws.addEventListener("error", () => {
    setBadge(els.serialBadge, "Puente: no disponible", "bad");
    els.lastEvent.textContent = "Ejecuta python-entorno/laboratorio_bridge.py";
  });
}

function sendBridge(action, extra = {}) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    els.lastEvent.textContent = "WebSocket no conectado";
    return;
  }
  state.ws.send(JSON.stringify({ action, ...extra }));
}

function simulateEsp32() {
  const sequence = ["pulgar", "indice", "medio", "anular", "menique"];
  let index = 0;
  window.clearInterval(state.demoTimer);
  state.demoTimer = window.setInterval(() => {
    const finger = sequence[index % sequence.length];
    handleIncoming(`${finger}:activo`);
    window.setTimeout(() => handleIncoming(`${finger}:reposo`), 420);
    index += 1;
  }, 850);
}

function renderKeyboard() {
  const layoutsOverride = {
    letters: "abcdefghijklmnÃ±opqrstuvwxyz".split(""),
    numbers: ["1", "2", "+", "3", "4", "-", "5", "6", "*", "7", "8", "/", "9", "0", ".", ";"],
    cursor: ["Windows", "Cursor izquierda", "Cursor derecha", "Cursor arriba", "Cursor abajo", "Borrar", "Click izquierdo", "Click derecho", "Modo ABC", "Modo 123"]
  };
  layoutsOverride.letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "\u00f1", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"];
  els.keyboard.innerHTML = "";
  for (const key of layoutsOverride[state.mode]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = key;
    button.dataset.key = String(key).toLowerCase();
    button.disabled = !state.labEnabled;
    button.addEventListener("click", () => pressVirtualKey(key));
    els.keyboard.appendChild(button);
  }
  return;

  const layouts = {
    letters: "abcdefghijklmnñopqrstuvwxyz".split(""),
    numbers: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", ".", ",", "-", "+", "/", "="],
    cursor: ["←", "→", "↑", "↓", "Inicio", "Fin", "Borrar", "Enter", "Espacio", "Tab", "Modo ABC", "Modo 123"]
  };

  els.keyboard.innerHTML = "";
  for (const key of layouts[state.mode]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = key;
    button.dataset.key = String(key).toLowerCase();
    button.disabled = !state.labEnabled;
    button.addEventListener("click", () => pressVirtualKey(key));
    els.keyboard.appendChild(button);
  }
}

function pressVirtualKey(key) {
  if (!state.labEnabled) return;
  if (key === "Borrar") {
    clearTextOutput();
    return;
  }
  if (key === "Enter") return writeText("\n");
  if (key === "Espacio") return writeText(" ");
  if (key === "Tab") return writeText("  ");
  if (key === "Modo ABC") return setMode("letters");
  if (key === "Modo 123") return setMode("numbers");
  if (["Windows", "Click izquierdo", "Click derecho"].includes(key) || key.startsWith("Cursor ")) {
    els.lastEvent.textContent = `Complementos: ${key}`;
    markKeyboardKey(key, "key-confirmed", 500);
    return;
  }
  if (["←", "→", "↑", "↓", "Inicio", "Fin"].includes(key)) {
    els.lastEvent.textContent = `Cursor: ${key}`;
    markKeyboardKey(key, "key-confirmed", 500);
    return;
  }
  writeText(key);
  markKeyboardKey(key, "key-confirmed", 500);
}

function setMode(mode) {
  state.mode = mode;
  const label = mode === "letters" ? "letras" : mode === "numbers" ? "numeros" : "complementos";
  setBadge(els.modeBadge, `Modo: ${label}`, "info");
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  renderKeyboard();
}

document.querySelector("#resetPoseBtn").addEventListener("click", resetPose);
document.querySelector("#focusBtn").addEventListener("click", focusModel);
document.querySelector("#demoBtn").addEventListener("click", simulateEsp32);
const connectSerialBtn = document.querySelector("#connectSerialBtn");
if (connectSerialBtn) {
  connectSerialBtn.addEventListener("click", () => connectSerial().catch((error) => {
    console.error(error);
    setBadge(els.serialBadge, "ESP32: serial cancelado/error", "bad");
  }));
}
document.querySelector("#disconnectSerialBtn").addEventListener("click", () => disconnectSerial().catch(console.error));
els.connectWsBtn.addEventListener("click", connectWebSocket);
els.calibrateBtn.addEventListener("click", () => sendBridge("calibrate"));
els.startLabBtn.addEventListener("click", () => sendBridge("start"));
els.pauseLabBtn.addEventListener("click", () => sendBridge("stop"));
document.querySelector("#simulateBtn").addEventListener("click", simulateEsp32);
document.querySelectorAll(".mode-btn").forEach((button) => {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
    sendBridge("mode", { mode: button.dataset.mode });
  });
});
els.handSelect.addEventListener("change", () => {
  state.hand = els.handSelect.value;
  if (state.view !== "both") {
    state.view = state.hand;
    els.viewSelect.value = state.view;
  }
  isolateSelectedArm();
  placeHandsOnPlatform();
  updateBoneReport();
  syncSliders();
  applyPose();
  focusModel();
});
els.viewSelect.addEventListener("change", () => {
  state.view = els.viewSelect.value;
  if (state.view !== "both") {
    state.hand = state.view;
    els.handSelect.value = state.hand;
  }
  isolateSelectedArm();
  placeHandsOnPlatform();
  updateBoneReport();
  syncSliders();
  applyPose();
  focusModel();
});

createFingerControls();
syncSliders();
renderKeyboard();
loadModel();
