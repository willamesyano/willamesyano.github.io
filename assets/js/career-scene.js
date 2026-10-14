import * as THREE from 'three';

const FOV = 30;
const SAMPLES_PER_PHASE = 48;
const SPACING_X = 2.0;
const SPACING_Z = 1.3;
const FLOOR_Y = -1.1;
const CLICK_TOLERANCE = 6;
const LANDSCAPE = {
  direction: new THREE.Vector3(0.1, 0.62, 1).normalize(),
  limitX: 0.68,
  limitTop: 0.62,
  limitBottom: -0.62,
};
const PORTRAIT = {
  direction: new THREE.Vector3(0.62, 0.9, 1).normalize(),
  limitX: 0.42,
  limitTop: 0.84,
  limitBottom: -0.84,
};

export function supportsWebGL() {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch {
    return false;
  }
}

function readPalette() {
  const style = getComputedStyle(document.documentElement);
  const color = (name) => new THREE.Color(style.getPropertyValue(name).trim());
  return {
    surface: color('--surface'),
    fg: color('--fg'),
    line: color('--line'),
    grid: color('--grid'),
    accent: color('--accent'),
  };
}

function layoutPoints(count) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const offset = i - (count - 1) / 2;
    points.push(new THREE.Vector3(offset * SPACING_X + Math.sin(i * 1.4) * 0.45, Math.sin(i * 1.1) * 0.22, offset * SPACING_Z));
  }
  return points;
}

function gridPositions() {
  const positions = [];
  const step = 0.5;
  for (let x = -30; x <= 30; x += step) {
    for (let z = -40; z <= 12; z += step) {
      positions.push(x, FLOOR_Y, z);
    }
  }
  return new THREE.Float32BufferAttribute(positions, 3);
}

function stemPositions(points) {
  const positions = [];
  for (const point of points) {
    positions.push(point.x, point.y, point.z, point.x, FLOOR_Y, point.z);
  }
  return new THREE.Float32BufferAttribute(positions, 3);
}

function satellitePositions(count) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    positions.push(Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, 0);
  }
  return new THREE.Float32BufferAttribute(positions, 3);
}

export function createCareerScene({ canvas, stage, labels, techCounts, onSelect, reducedMotion }) {
  const count = techCounts.length;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  const palette = readPalette();
  scene.fog = new THREE.Fog(palette.surface, 12, 34);

  const pathMaterial = new THREE.LineBasicMaterial({ color: palette.line });
  const progressMaterial = new THREE.LineBasicMaterial({ color: palette.accent });
  const stemMaterial = new THREE.LineDashedMaterial({ color: palette.line, dashSize: 0.05, gapSize: 0.07 });
  const gridMaterial = new THREE.PointsMaterial({ color: palette.grid, size: 2, sizeAttenuation: false });
  const nodeMaterial = new THREE.MeshBasicMaterial({ color: palette.fg });
  const activeMaterial = new THREE.MeshBasicMaterial({ color: palette.accent });
  const haloMaterial = new THREE.MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
  const satelliteMaterial = new THREE.PointsMaterial({ color: palette.accent, size: 3.5, sizeAttenuation: false });
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

  const path = new THREE.Line(new THREE.BufferGeometry(), pathMaterial);
  const progress = new THREE.Line(new THREE.BufferGeometry(), progressMaterial);
  const stems = new THREE.LineSegments(new THREE.BufferGeometry(), stemMaterial);
  const grid = new THREE.Points(new THREE.BufferGeometry(), gridMaterial);
  scene.add(path, progress, stems, grid);

  const nodeGeometry = new THREE.SphereGeometry(0.085, 24, 16);
  const hitGeometry = new THREE.SphereGeometry(0.45, 8, 6);
  const nodes = [];
  const hits = [];
  for (let i = 0; i < count; i++) {
    const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
    const hit = new THREE.Mesh(hitGeometry, hitMaterial);
    hit.userData.index = i;
    node.add(hit);
    scene.add(node);
    nodes.push(node);
    hits.push(hit);
  }

  const halo = new THREE.Mesh(new THREE.RingGeometry(0.19, 0.215, 64), haloMaterial);
  const orbit = new THREE.Group();
  const satellites = new THREE.Points(new THREE.BufferGeometry(), satelliteMaterial);
  orbit.add(satellites);
  scene.add(halo, orbit);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const parallax = new THREE.Vector2();
  const direction = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const clock = new THREE.Clock();

  const points = layoutPoints(count);
  const center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  let distance = 10;
  let view = LANDSCAPE;
  let width = 1;
  let height = 1;
  let active = count - 1;
  let progressValue = active * SAMPLES_PER_PHASE;
  let visible = true;
  let pressed = null;
  let frame = 0;

  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const samples = curve.getPoints(SAMPLES_PER_PHASE * (count - 1));
  path.geometry.setFromPoints(samples);
  progress.geometry.setFromPoints(samples);
  stems.geometry.setAttribute('position', stemPositions(points));
  stems.computeLineDistances();
  grid.geometry.setAttribute('position', gridPositions());
  points.forEach((point, i) => nodes[i].position.copy(point));

  function framesAll(candidate) {
    camera.position.copy(center).addScaledVector(view.direction, candidate);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    return points.every((point) => {
      projected.copy(point).project(camera);
      return Math.abs(projected.x) <= view.limitX && projected.y <= view.limitTop && projected.y >= view.limitBottom;
    });
  }

  function fitCamera() {
    let low = 2;
    let high = 80;
    for (let i = 0; i < 30; i++) {
      const middle = (low + high) / 2;
      if (framesAll(middle)) {
        high = middle;
      } else {
        low = middle;
      }
    }
    distance = high;
    scene.fog.near = distance * 0.75;
    scene.fog.far = distance * 1.9;
  }

  function resize() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    view = camera.aspect < 0.9 ? PORTRAIT : LANDSCAPE;
    stage.classList.toggle('is-portrait', view === PORTRAIT);
    stage.classList.toggle('is-compact', width < 480);
    fitCamera();
    placeActive(true);
  }

  function placeActive(immediate) {
    const point = points[active];
    halo.position.copy(point);
    orbit.position.copy(point);
    satellites.geometry.setAttribute('position', satellitePositions(techCounts[active]));
    satellites.visible = techCounts[active] > 0;
    nodes.forEach((node, i) => {
      node.material = i === active ? activeMaterial : nodeMaterial;
      node.scale.setScalar(i === active ? 1.5 : 1);
    });
    if (immediate || reducedMotion) {
      progressValue = active * SAMPLES_PER_PHASE;
    }
  }

  function updateCamera(elapsed) {
    const sway = reducedMotion ? 0 : Math.sin(elapsed * 0.18) * 0.045;
    direction.copy(view.direction);
    direction.x += parallax.x * 0.06;
    direction.y -= parallax.y * 0.04;
    direction.applyAxisAngle(THREE.Object3D.DEFAULT_UP, sway).normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.lookAt(center);
  }

  function updateLabels() {
    for (let i = 0; i < count; i++) {
      projected.copy(points[i]).project(camera);
      const x = (projected.x + 1) / 2 * width;
      const y = (1 - projected.y) / 2 * height;
      labels[i].style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      labels[i].style.zIndex = String(1000 - Math.round(projected.z * 500));
    }
  }

  function render() {
    const delta = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.elapsedTime;
    const ease = reducedMotion ? 1 : 1 - Math.exp(-delta * 4);
    progressValue += (active * SAMPLES_PER_PHASE - progressValue) * ease;
    progress.geometry.setDrawRange(0, Math.round(progressValue) + 1);
    updateCamera(elapsed);
    halo.quaternion.copy(camera.quaternion);
    orbit.quaternion.copy(camera.quaternion);
    if (!reducedMotion) {
      halo.scale.setScalar(1 + Math.sin(elapsed * 2.2) * 0.1);
      satellites.rotation.z = elapsed * 0.35;
    }
    renderer.render(scene, camera);
    updateLabels();
  }

  function loop() {
    frame = 0;
    if (!visible || document.hidden) {
      return;
    }
    render();
    frame = requestAnimationFrame(loop);
  }

  function start() {
    if (frame === 0 && visible && !document.hidden) {
      clock.getDelta();
      frame = requestAnimationFrame(loop);
    }
  }

  function hitIndex(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObjects(hits, false);
    return hit ? hit.object.userData.index : -1;
  }

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    parallax.set((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1);
    if (event.pointerType === 'mouse') {
      canvas.style.cursor = hitIndex(event) >= 0 ? 'pointer' : '';
    }
  });

  canvas.addEventListener('pointerleave', () => {
    parallax.set(0, 0);
  });

  canvas.addEventListener('pointerdown', (event) => {
    pressed = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!pressed) {
      return;
    }
    const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
    pressed = null;
    if (moved > CLICK_TOLERANCE) {
      return;
    }
    const index = hitIndex(event);
    if (index >= 0) {
      onSelect(index);
    }
  });

  new ResizeObserver(resize).observe(stage);

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    start();
  }).observe(stage);

  document.addEventListener('visibilitychange', start);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const next = readPalette();
    scene.fog.color.copy(next.surface);
    pathMaterial.color.copy(next.line);
    stemMaterial.color.copy(next.line);
    gridMaterial.color.copy(next.grid);
    nodeMaterial.color.copy(next.fg);
    progressMaterial.color.copy(next.accent);
    activeMaterial.color.copy(next.accent);
    haloMaterial.color.copy(next.accent);
    satelliteMaterial.color.copy(next.accent);
  });

  stage.classList.add('is-3d');
  resize();
  start();

  return {
    select(index) {
      active = index;
      placeActive(false);
      start();
    },
  };
}
