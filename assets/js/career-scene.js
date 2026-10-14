import * as THREE from 'three';

const FOV = 30;
const SPACING_X = 1.6;
const DEPTH_WAVE = 0.85;
const PILLAR_SIZE = 0.6;
const HEIGHT_BASE = 0.5;
const HEIGHT_PER_MONTH = 0.075;
const FLOW_COUNT = 42;
const ORBIT_RADIUS = 0.7;
const CLICK_TOLERANCE = 6;
const INTRO_STAGGER = 0.12;
const INTRO_GROW = 0.9;
const LANDSCAPE = {
  direction: new THREE.Vector3(0.32, 0.5, 1).normalize(),
  azimuthRange: 0.16,
  limitX: 0.8,
  limitTop: 0.7,
  limitBottom: -0.66,
};
const PORTRAIT = {
  direction: new THREE.Vector3(1, 1.7, 0.45).normalize(),
  azimuthRange: 0.04,
  limitX: 0.5,
  limitTop: 0.8,
  limitBottom: -0.8,
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
  const surface = color('--surface');
  const hsl = surface.getHSL({});
  return {
    surface,
    fg: color('--fg'),
    line: color('--line'),
    grid: color('--grid'),
    accent: color('--accent'),
    isDark: hsl.l < 0.5,
  };
}

function shades(palette) {
  const { surface, fg, accent, line, isDark } = palette;
  const white = new THREE.Color(1, 1, 1);
  const mix = (from, to, amount) => from.clone().lerp(to, amount);
  return {
    idle: isDark
      ? { side: mix(surface, fg, 0.05), top: mix(surface, fg, 0.16), front: mix(surface, fg, 0.09) }
      : { side: mix(surface, fg, 0.15), top: mix(surface, white, 0.9), front: mix(surface, fg, 0.06) },
    active: isDark
      ? { side: mix(surface, accent, 0.28), top: mix(surface, accent, 0.7), front: mix(surface, accent, 0.45) }
      : { side: mix(surface, accent, 0.62), top: mix(surface, accent, 0.22), front: mix(surface, accent, 0.42) },
    edge: mix(line, fg, isDark ? 0.22 : 0.28),
    hover: mix(line, fg, 0.7),
    shadowOpacity: isDark ? 0.5 : 0.13,
  };
}

function gradientTexture(draw) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  draw(context);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function layoutBases(count) {
  const bases = [];
  for (let i = 0; i < count; i++) {
    const offset = i - (count - 1) / 2;
    bases.push(new THREE.Vector3(offset * SPACING_X, 0, Math.sin(i * 1.3) * DEPTH_WAVE));
  }
  return bases;
}

function gridPositions() {
  const positions = [];
  const step = 0.5;
  for (let x = -30; x <= 30; x += step) {
    for (let z = -40; z <= 12; z += step) {
      positions.push(x, -0.002, z);
    }
  }
  return new THREE.Float32BufferAttribute(positions, 3);
}

function ringPositions(count, radius) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  }
  return new THREE.Float32BufferAttribute(positions, 3);
}

function shadedBox() {
  const geometry = new THREE.BoxGeometry(PILLAR_SIZE, 1, PILLAR_SIZE).translate(0, 0.5, 0);
  const position = geometry.attributes.position;
  const colors = [];
  for (let i = 0; i < position.count; i++) {
    const tone = 0.84 + position.getY(i) * 0.16;
    colors.push(tone, tone, tone);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

export function createCareerScene({ canvas, stage, labels, techCounts, durations, onSelect, reducedMotion }) {
  const count = techCounts.length;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  let palette = readPalette();
  let tones = shades(palette);
  scene.fog = new THREE.Fog(palette.surface, 12, 34);

  const idleFaces = {
    side: new THREE.MeshBasicMaterial({ color: tones.idle.side, vertexColors: true }),
    top: new THREE.MeshBasicMaterial({ color: tones.idle.top }),
    front: new THREE.MeshBasicMaterial({ color: tones.idle.front, vertexColors: true }),
  };
  const activeFaces = {
    side: new THREE.MeshBasicMaterial({ color: tones.active.side, vertexColors: true }),
    top: new THREE.MeshBasicMaterial({ color: tones.active.top }),
    front: new THREE.MeshBasicMaterial({ color: tones.active.front, vertexColors: true }),
  };
  const faceSet = (faces) => [faces.side, faces.side, faces.top, faces.side, faces.front, faces.front];
  const idleMaterials = faceSet(idleFaces);
  const activeMaterials = faceSet(activeFaces);

  const shadowTexture = gradientTexture((context) => {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.45, '#7a7a7a');
    gradient.addColorStop(1, '#000000');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  });

  const pathMaterial = new THREE.LineBasicMaterial({ color: palette.line });
  const progressMaterial = new THREE.LineBasicMaterial({ color: palette.accent });
  const gridMaterial = new THREE.PointsMaterial({ color: palette.grid, size: 2, sizeAttenuation: false });
  const flowMaterial = new THREE.PointsMaterial({ color: palette.accent, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.85 });
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTexture, transparent: true, opacity: tones.shadowOpacity, depthWrite: false });
  const frameMaterial = new THREE.MeshBasicMaterial({ color: palette.accent, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false });
  const orbitLineMaterial = new THREE.LineBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.35 });
  const orbitDotMaterial = new THREE.PointsMaterial({ color: palette.accent, size: 4, sizeAttenuation: false });
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

  const bases = layoutBases(count);
  const heights = durations.map((months) => HEIGHT_BASE + months * HEIGHT_PER_MONTH);
  const tops = bases.map((base, i) => base.clone().setY(heights[i]));
  const center = new THREE.Box3().setFromPoints([...bases, ...tops]).getCenter(new THREE.Vector3());

  const curve = new THREE.CatmullRomCurve3(bases.map((base) => base.clone().setY(0.004)), false, 'centripetal');
  const segments = 48 * (count - 1);
  const samples = curve.getPoints(segments);
  const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(samples), pathMaterial);
  const progress = new THREE.Line(new THREE.BufferGeometry().setFromPoints(samples), progressMaterial);
  const grid = new THREE.Points(new THREE.BufferGeometry(), gridMaterial);
  grid.geometry.setAttribute('position', gridPositions());
  const flowPositions = new Float32Array(FLOW_COUNT * 3);
  const flow = new THREE.Points(new THREE.BufferGeometry(), flowMaterial);
  flow.geometry.setAttribute('position', new THREE.BufferAttribute(flowPositions, 3));
  flow.visible = !reducedMotion;
  scene.add(grid, path, progress, flow);

  const boxGeometry = shadedBox();
  const edgeGeometry = new THREE.EdgesGeometry(boxGeometry);
  const shadowGeometry = new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2);
  const hitGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const pillars = [];
  const edgeMaterials = [];
  const hits = [];
  bases.forEach((base, i) => {
    const group = new THREE.Group();
    group.position.copy(base);
    const pillar = new THREE.Mesh(boxGeometry, idleMaterials);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: tones.edge });
    pillar.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.position.y = 0.003;
    const hit = new THREE.Mesh(hitGeometry, hitMaterial);
    hit.scale.y = heights[i] + 0.3;
    hit.userData.index = i;
    group.add(shadow, pillar, hit);
    scene.add(group);
    pillars.push(pillar);
    edgeMaterials.push(edgeMaterial);
    hits.push(hit);
  });

  const frame = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.69, 4, 1).rotateZ(Math.PI / 4).rotateX(-Math.PI / 2), frameMaterial);
  const orbit = new THREE.Group();
  const orbitLine = new THREE.LineLoop(new THREE.BufferGeometry(), orbitLineMaterial);
  orbitLine.geometry.setAttribute('position', ringPositions(96, ORBIT_RADIUS));
  const orbitDots = new THREE.Points(new THREE.BufferGeometry(), orbitDotMaterial);
  orbit.add(orbitLine, orbitDots);
  scene.add(frame, orbit);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const parallax = new THREE.Vector2();
  const direction = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  const clock = new THREE.Clock();

  let distance = 10;
  let view = LANDSCAPE;
  let width = 1;
  let height = 1;
  let active = count - 1;
  let hovered = -1;
  let azimuth = 0;
  let progressValue = 0;
  let introStart = reducedMotion ? 0 : null;
  let visible = true;
  let pressed = null;
  let loopHandle = 0;

  function azimuthFor(index) {
    return (index / (count - 1) - 0.5) * 2 * view.azimuthRange;
  }

  function placeCamera(angle, candidate) {
    direction.copy(view.direction).applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
    camera.position.copy(center).addScaledVector(direction, candidate);
    camera.lookAt(center);
  }

  function framesAll(candidate) {
    return [-view.azimuthRange * 1.15, 0, view.azimuthRange * 1.15].every((angle) => {
      placeCamera(angle, candidate);
      camera.updateMatrixWorld();
      return [...bases, ...tops].every((point) => {
        projected.copy(point).project(camera);
        return Math.abs(projected.x) <= view.limitX && projected.y <= view.limitTop && projected.y >= view.limitBottom;
      });
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
    scene.fog.near = distance * 0.8;
    scene.fog.far = distance * 2;
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
  }

  function paintPillars() {
    pillars.forEach((pillar, i) => {
      pillar.material = i === active ? activeMaterials : idleMaterials;
      let edge = tones.edge;
      if (i === hovered) {
        edge = tones.hover;
      }
      if (i === active) {
        edge = palette.accent;
      }
      edgeMaterials[i].color.copy(edge);
      labels[i].classList.toggle('is-hover', i === hovered && i !== active);
    });
  }

  function placeActive() {
    orbitDots.geometry.setAttribute('position', ringPositions(techCounts[active], ORBIT_RADIUS));
    orbit.visible = techCounts[active] > 0;
    paintPillars();
  }

  function growth(index, elapsed) {
    if (reducedMotion) {
      return 1;
    }
    if (introStart === null) {
      return 0;
    }
    const local = (elapsed - introStart - index * INTRO_STAGGER) / INTRO_GROW;
    return easeOutCubic(THREE.MathUtils.clamp(local, 0, 1));
  }

  function updateLabels(grown) {
    for (let i = 0; i < count; i++) {
      if (view === PORTRAIT || i % 2 === 0) {
        anchor.copy(bases[i]).setY(heights[i] * grown[i]);
      } else {
        anchor.copy(bases[i]);
      }
      projected.copy(anchor).project(camera);
      const x = (projected.x + 1) / 2 * width;
      const y = (1 - projected.y) / 2 * height;
      labels[i].style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      labels[i].style.zIndex = String(1000 - Math.round(projected.z * 500));
      labels[i].style.opacity = String(THREE.MathUtils.clamp(grown[i] * 1.6 - 0.4, 0, 1));
    }
  }

  function render() {
    const delta = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.elapsedTime;
    const ease = reducedMotion ? 1 : 1 - Math.exp(-delta * 3.2);
    if (introStart === null && visible) {
      introStart = elapsed;
    }

    const grown = pillars.map((pillar, i) => {
      const value = growth(i, elapsed);
      pillar.scale.y = Math.max(heights[i] * value, 0.0001);
      return value;
    });
    const introPath = reducedMotion ? 1 : THREE.MathUtils.clamp((elapsed - (introStart ?? elapsed)) / (INTRO_STAGGER * count + INTRO_GROW * 0.5), 0, 1);
    path.geometry.setDrawRange(0, Math.round(segments * easeOutCubic(introPath)) + 1);
    progressValue += (active * 48 - progressValue) * ease;
    progress.geometry.setDrawRange(0, Math.round(Math.min(progressValue, segments * introPath)) + 1);

    azimuth += (azimuthFor(active) - azimuth) * ease;
    const sway = reducedMotion ? 0 : Math.sin(elapsed * 0.16) * 0.035;
    direction.copy(view.direction);
    direction.x += parallax.x * 0.05;
    direction.y -= parallax.y * 0.035;
    direction.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, azimuth + sway);
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.lookAt(center);

    const top = heights[active] * grown[active];
    frame.position.copy(bases[active]).setY(0.006);
    orbit.position.copy(bases[active]).setY(top * 0.55);
    if (!reducedMotion) {
      const pulse = 1 + Math.sin(elapsed * 2.4) * 0.06;
      frame.scale.set(pulse, 1, pulse);
      orbit.rotation.y = elapsed * 0.45;
      for (let k = 0; k < FLOW_COUNT; k++) {
        const t = (k / FLOW_COUNT + elapsed * 0.035) % 1;
        curve.getPointAt(t, anchor);
        flowPositions[k * 3] = anchor.x;
        flowPositions[k * 3 + 1] = 0.02;
        flowPositions[k * 3 + 2] = anchor.z;
      }
      flow.geometry.attributes.position.needsUpdate = true;
      flow.visible = introPath >= 1;
    }

    renderer.render(scene, camera);
    updateLabels(grown);
  }

  function loop() {
    loopHandle = 0;
    if (!visible || document.hidden) {
      return;
    }
    render();
    loopHandle = requestAnimationFrame(loop);
  }

  function start() {
    if (loopHandle === 0 && visible && !document.hidden) {
      clock.getDelta();
      loopHandle = requestAnimationFrame(loop);
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
    if (event.pointerType !== 'mouse') {
      return;
    }
    const index = hitIndex(event);
    canvas.style.cursor = index >= 0 ? 'pointer' : '';
    if (index !== hovered) {
      hovered = index;
      paintPillars();
    }
  });

  canvas.addEventListener('pointerleave', () => {
    parallax.set(0, 0);
    if (hovered !== -1) {
      hovered = -1;
      paintPillars();
    }
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
    palette = readPalette();
    tones = shades(palette);
    scene.fog.color.copy(palette.surface);
    for (const key of ['side', 'top', 'front']) {
      idleFaces[key].color.copy(tones.idle[key]);
      activeFaces[key].color.copy(tones.active[key]);
    }
    pathMaterial.color.copy(palette.line);
    gridMaterial.color.copy(palette.grid);
    shadowMaterial.opacity = tones.shadowOpacity;
    for (const material of [progressMaterial, flowMaterial, frameMaterial, orbitLineMaterial, orbitDotMaterial]) {
      material.color.copy(palette.accent);
    }
    paintPillars();
  });

  stage.classList.add('is-3d');
  resize();
  placeActive();
  progressValue = active * 48;
  azimuth = azimuthFor(active);
  start();

  return {
    select(index) {
      active = index;
      placeActive();
      if (reducedMotion) {
        progressValue = active * 48;
        azimuth = azimuthFor(active);
      }
      start();
    },
  };
}
