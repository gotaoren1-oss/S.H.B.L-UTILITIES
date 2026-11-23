// =====================================================================
//  REEF · Ashkelon — live 3D scene
//  Procedural model of the hotel (3 towers, podium, infinity pool,
//  rooftop gardens, landscaped plaza, beach & sea) with real-sun lighting
//  for Ashkelon, night mode, water "x-ray" risers and a tower/floor picker.
//  Built for ש.ה.ב.ל תשתיות ומערכות מים
// =====================================================================
import * as THREE from './three.module.min.js';
import { OrbitControls } from './OrbitControls.js';

const LAT = 31.668, LON = 34.571;           // Ashkelon
const FLOOR_H = 3.3;
const LEVELS = 10;                          // levels 0..9 above ground
const PAL = {
  white: 0xf3f0ea, glass: 0x22423a, sage: 0x5e775e, forest: 0x132b23,
  gold: 0xba9b5f, alabaster: 0xe9e0cf, grass: 0x6d8a55, lawn: 0x7f9d5f,
  paving: 0xd9d2c3, sand: 0xe6d3a8, water: 0x2fb6c9, aqua: 0x5fe3f0
};

// ---------- sun position (NOAA simplified) ----------
function sunPosition(date) {
  const rad = Math.PI / 180;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date - start) / 864e5;
  const g = 2 * Math.PI / 365 * (doy - 1 + (date.getUTCHours() - 12) / 24);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const tst = utcMin + eot + 4 * LON;
  const ha = (tst / 4 - 180) * rad;
  const phi = LAT * rad;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZ)));
  let az = Math.acos(Math.min(1, Math.max(-1, (Math.sin(phi) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(phi) * Math.sin(zen)))));
  az = ha > 0 ? (az + Math.PI) % (2 * Math.PI) : (3 * Math.PI - az) % (2 * Math.PI);
  return { elevation: 90 - zen / rad, azimuth: az / rad };
}

// date for a given local Jerusalem hour today
export function jerusalemDateAtHour(hour) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':');
  const localNow = (+parts[0]) + (+parts[1]) / 60;
  return new Date(now.getTime() + (hour - localNow) * 36e5);
}
export function jerusalemHourNow() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':');
  return (+p[0]) + (+p[1]) / 60;
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = v => Math.max(0, Math.min(1, v));
const smooth = t => t * t * (3 - 2 * t);
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// seeded random for stable layouts
let _seed = 7;
const rnd = () => ((_seed = (_seed * 16807) % 2147483647) - 1) / 2147483646;

export class ReefScene {
  constructor(container) {
    this.container = container;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.mode = 'pre';
    this.night = 0;
    this.xray = 0; this.xrayTarget = 0;
    this.listeners = {};
    this.selected = null;
    this.hoverBld = null; this.hoverFloor = null;
    this.floorStats = {};
    this.lowPower = window.matchMedia('(max-width: 760px)').matches;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.lowPower ? 1.5 : 1.75));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 3000);
    this.camera.position.set(-160, 70, 160);

    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 35;
    this.controls.maxDistance = 220;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.target.set(0, 14, -6);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-9, -9);

    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildPodium();
    this._buildTowers();
    this._buildLandscape();
    this._buildRoadAndCars();
    this._buildRisers();

    this.setTimeOfDay(null);
    this._bindEvents();
    this.resize();
    this._loop = this._loop.bind(this);
    this.running = true;
    requestAnimationFrame(this._loop);
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  emit(evt, ...a) { (this.listeners[evt] || []).forEach(f => f(...a)); }

  // ------------------------------------------------------------------ SKY
  _buildSky() {
    const geo = new THREE.SphereGeometry(1400, 32, 16);
    this.skyUni = {
      top: { value: new THREE.Color(0x3f86c8) }, hor: { value: new THREE.Color(0xcfe4f2) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xfff2d6) }, glow: { value: 1 }
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: this.skyUni,
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; varying vec3 vP;
        void main(){ float h = max(vP.y,0.); vec3 c = mix(hor, top, pow(h, .55));
          if(vP.y<0.) c = mix(hor, hor*.75, min(-vP.y*4.,1.));
          float s = max(dot(vP, normalize(sunDir)),0.);
          c += sunCol * (pow(s, 600.)*2.2 + pow(s, 12.)*.35*glow + pow(s,3.)*.12*glow);
          gl_FragColor = vec4(c,1.); }`
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);

    // stars
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd(), v = rnd() * 0.9 + 0.08;
      const th = u * Math.PI * 2, ph = Math.acos(v);
      pos.set([Math.sin(ph) * Math.cos(th) * 1300, Math.cos(ph) * 1300, Math.sin(ph) * Math.sin(th) * 1300], i * 3);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.scene.add(this.stars);
    this.scene.fog = new THREE.Fog(0xcfe4f2, 260, 1100);
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xdbeaff, 0x5a6b48, 0.9);
    this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.lowPower ? 1024 : 2048, this.lowPower ? 1024 : 2048);
    const s = sun.shadow.camera; s.left = -110; s.right = 110; s.top = 110; s.bottom = -110; s.near = 10; s.far = 500;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    this.scene.add(sun); this.scene.add(sun.target);
    this.moon = new THREE.DirectionalLight(0x8fb2ff, 0);
    this.moon.position.set(120, 160, 80);
    this.scene.add(this.moon);
  }

  // ------------------------------------------------------------------ GROUND
  _buildGround() {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), new THREE.MeshStandardMaterial({ color: PAL.grass, roughness: 1 }));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true;
    this.scene.add(g);

    // sand + sea toward west (-X) / front (+Z)
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(80, 1600), new THREE.MeshStandardMaterial({ color: PAL.sand, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2; sand.rotation.z = 0.35; sand.position.set(-215, 0.05, 60); sand.receiveShadow = true;
    this.scene.add(sand);

    this.waterUni = { t: { value: 0 }, night: { value: 0 }, deep: { value: new THREE.Color(0x1a6f86) }, shallow: { value: new THREE.Color(0x46bfcf) } };
    const seaMat = new THREE.ShaderMaterial({
      uniforms: this.waterUni, fog: false,
      vertexShader: `uniform float t; varying vec2 vUv; varying float vH; void main(){ vUv=uv; vec3 p=position; float h = sin(p.x*.05+t*.9)*.6+sin(p.y*.08+t*1.3)*.35; p.z+=h; vH=h; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);} `,
      fragmentShader: `uniform float t; uniform float night; uniform vec3 deep; uniform vec3 shallow; varying vec2 vUv; varying float vH;
        void main(){ float shore = smoothstep(.0,.18,vUv.x); vec3 c = mix(shallow, deep, shore);
        float sp = smoothstep(.75,1.,sin(vUv.y*900.+t*2.)*sin(vUv.x*700.-t*1.5)); c += sp*.25*(1.-night);
        float foam = smoothstep(.02,.0,abs(vUv.x-.012-sin(vUv.y*120.+t)*.004)); c = mix(c, vec3(1.), foam*.8);
        c *= mix(1., .18, night); c += vec3(.02,.04,.08)*night;
        gl_FragColor=vec4(c,1.);} `
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1800, 120, 120), seaMat);
    sea.rotation.x = -Math.PI / 2; sea.rotation.z = 0.35;
    sea.position.set(-945, 0.2, 300);
    this.scene.add(sea);
  }

  // ------------------------------------------------------------------ helpers
  _shapeXZ(pts) { const s = new THREE.Shape(); pts.forEach((p, i) => i ? s.lineTo(p[0], -p[1]) : s.moveTo(p[0], -p[1])); return s; }
  _extrude(shape, h, mat, y = 0) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 48 });
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; m.receiveShadow = true; return m;
  }
  _curve(a, c, b, n = 40) { const out = []; for (let i = 0; i <= n; i++) { const t = i / n; out.push([lerp(lerp(a[0], c[0], t), lerp(c[0], b[0], t), t), lerp(lerp(a[1], c[1], t), lerp(c[1], b[1], t), t)]); } return out; }
  _offsetCurve(pts, d) {
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      return [p[0] - dz / L * d, p[1] + dx / L * d];
    });
  }

  // ------------------------------------------------------------------ PODIUM
  _buildPodium() {
    const white = this.matWhite = new THREE.MeshStandardMaterial({ color: PAL.white, roughness: 0.82, transparent: true });
    const glass = this.matGlass = new THREE.MeshStandardMaterial({ color: PAL.glass, roughness: 0.15, metalness: 0.6, emissive: 0xffe2b8, emissiveIntensity: 0, transparent: true });
    this.fadeMats = [white, glass];

    const front = this._curve([-36, 4], [-2, 30], [34, 6]);
    const back = [[34, -3], [-36, -3]];
    const podShape = this._shapeXZ([...front, ...back]);
    // glass ground floor (slightly inset) + white slabs
    const inner = this._offsetCurve(front, 1.2);
    const pg = this._extrude(this._shapeXZ([...inner, [33, -2], [-35, -2]]), 3.4, glass, 0.3);
    this.scene.add(pg);
    const slab1 = this._extrude(podShape, 0.6, white, 3.6); this.scene.add(slab1);
    const mid = this._extrude(this._shapeXZ([...this._offsetCurve(front, .6), [33.5, -2.5], [-35.5, -2.5]]), 2.6, glass, 4.2); this.scene.add(mid);
    const roof = this._extrude(podShape, 0.9, white, 6.8); this.scene.add(roof);
    this.podiumTop = 7.7;

    // parapet along front
    const parapetPts = [...front, ...this._offsetCurve(front, 0.35).reverse()];
    this.scene.add(this._extrude(this._shapeXZ(parapetPts), 1.0, white, 7.7));

    // infinity pool on the podium roof (front-right)
    const poolOuter = this._curve([2, 22.2], [16, 18.5], [29, 8.2], 30);
    const poolInner = this._offsetCurve(poolOuter, 6.5);
    const poolShape = this._shapeXZ([...poolOuter, ...poolInner.reverse()]);
    this.poolUni = { t: { value: 0 }, night: { value: 0 } };
    const poolMat = new THREE.ShaderMaterial({
      uniforms: this.poolUni,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform float t; uniform float night; varying vec3 vW;
        float caus(vec2 p){ return sin(p.x*1.7+t*1.6)*sin(p.y*1.9-t*1.2)+sin((p.x+p.y)*1.1+t)*.6; }
        void main(){ float c = caus(vW.xz); vec3 base = mix(vec3(.18,.72,.8), vec3(.36,.88,.92), smoothstep(-.6,1.2,c));
        vec3 nightC = mix(vec3(.02,.35,.5), vec3(.15,.85,1.), smoothstep(-.4,1.4,c));
        gl_FragColor = vec4(mix(base, nightC, night),1.); }`
    });
    const pool = this._extrude(poolShape, 0.12, poolMat, 7.75);
    pool.castShadow = false; this.scene.add(pool);
    this.poolGlow = new THREE.PointLight(0x5fe3f0, 0, 40, 2); this.poolGlow.position.set(16, 9.5, 14); this.scene.add(this.poolGlow);

    // deck (warm stone) on the rest of the roof
    const deckMat = new THREE.MeshStandardMaterial({ color: 0xcdbfa3, roughness: .9 });
    const deck = this._extrude(this._shapeXZ([...this._offsetCurve(front, 1), [33, -2], [-35, -2]]), 0.06, deckMat, 7.7);
    deck.castShadow = false; this.scene.add(deck);

    // rooftop garden planters + loungers
    const green = new THREE.MeshStandardMaterial({ color: PAL.sage, roughness: 1 });
    for (let i = 0; i < 12; i++) {
      const t = i / 11; const x = lerp(-31, 0, t); const z = 4 + Math.sin(t * Math.PI) * 9 + (i % 2) * 3;
      const p = new THREE.Mesh(new THREE.BoxGeometry(4 + rnd() * 3, 0.9, 2.5 + rnd() * 2), green);
      p.position.set(x, 8.15, z); p.rotation.y = rnd(); p.castShadow = p.receiveShadow = true; this.scene.add(p);
    }
    const lounger = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .6 });
    const lg = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.35, 2), lounger, 22);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 22; i++) {
      const t = i / 21; const p = this._curve([4, 13.5], [15, 10.5], [24, 3], 21)[i];
      e.set(0, -0.5 + t * -0.4, 0); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(p[0] - 1.5, 7.95, p[1] - 2.5), q, new THREE.Vector3(1, 1, 1)); lg.setMatrixAt(i, m4);
    }
    lg.castShadow = true; this.scene.add(lg);
    // umbrellas
    const umb = new THREE.MeshStandardMaterial({ color: PAL.alabaster, roughness: .9 });
    for (let i = 0; i < 6; i++) {
      const p = this._curve([3, 12], [14, 9], [22, 2], 5)[i];
      const u = new THREE.Mesh(new THREE.ConeGeometry(1.8, 0.7, 10), umb); u.position.set(p[0] - 3, 10.2, p[1] - 3.5); u.castShadow = true; this.scene.add(u);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 2.4), lounger); pole.position.set(p[0] - 3, 9, p[1] - 3.5); this.scene.add(pole);
    }

    // left low annex with small rooftop pool
    const annex = new THREE.Group();
    const ab = new THREE.Mesh(new THREE.BoxGeometry(18, 3.2, 12), glass); ab.position.y = 1.9; annex.add(ab);
    const as = new THREE.Mesh(new THREE.BoxGeometry(19, 0.7, 13), white); as.position.y = 3.9; annex.add(as);
    const ab2 = new THREE.Mesh(new THREE.BoxGeometry(17.5, 2.4, 11.5), glass); ab2.position.y = 5.4; annex.add(ab2);
    const ar = new THREE.Mesh(new THREE.BoxGeometry(19, 0.8, 13), white); ar.position.y = 7; annex.add(ar);
    const ap = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 5), poolMat); ap.position.set(-4, 7.45, 1.5); annex.add(ap);
    annex.children.forEach(c => { c.castShadow = c.receiveShadow = true; });
    annex.position.set(-50, 0, 8); annex.rotation.y = 0.32; this.scene.add(annex);
  }

  // ------------------------------------------------------------------ TOWERS
  _buildTowers() {
    this.towers = [];
    const defs = [
      { id: 'A', name: 'בניין A', x: -21, z: -10, w: 15, d: 13, rot: 0.30, crown: 1 },
      { id: 'B', name: 'בניין B', x: -2.5, z: -12, w: 15, d: 13, rot: 0.06, crown: 2 },
      { id: 'C', name: 'בניין C', x: 16, z: -9, w: 14, d: 13, rot: -0.12, crown: 1 }
    ];
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const lightMat = this.matWin = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1d3a35, roughness: 0.12, metalness: 0.7, transparent: true });
    const solarMat = new THREE.MeshStandardMaterial({ color: 0x1b2b4a, roughness: .3, metalness: .5 });
    this.fadeMats.push(panelMat);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const H = LEVELS * FLOOR_H;

    defs.forEach(def => {
      const g = new THREE.Group(); g.position.set(def.x, 0, def.z); g.rotation.y = def.rot;
      g.userData = { buildingId: def.id };
      const { w, d } = def;
      // core
      const core = new THREE.Mesh(new THREE.BoxGeometry(w - 1.6, H, d - 1.6), this.matWhite);
      core.position.y = H / 2; core.castShadow = core.receiveShadow = true; g.add(core);

      // balcony slabs + fins (front +Z and back -Z) and side frames
      const bays = 5, bw = w / bays;
      const items = [];
      for (let f = 1; f <= LEVELS; f++) {
        for (const side of [1, -1]) {
          items.push([0, f * FLOOR_H, side * (d / 2 - 0.2), w + 0.3, 0.28, 2.2]);
        }
      }
      for (const side of [1, -1]) {
        for (let b = 0; b <= bays; b++) items.push([-w / 2 + b * bw, H / 2 + 1.5, side * (d / 2 - 0.2), 0.28, H - 3, 2.2]);
        items.push([0, H + 0.6, side * (d / 2 - 0.2), w + 0.3, 1.2, 2.3]);
      }
      // side faces: vertical frames
      for (const sx of [1, -1]) {
        items.push([sx * (w / 2 - 0.5), H / 2, 0, 1.0, H, d - 1.2]);
      }
      const frames = new THREE.InstancedMesh(unit, this.matWhite, items.length);
      items.forEach((it, i) => { m4.compose(v.set(it[0], it[1], it[2]), q.identity(), s.set(it[3], it[4], it[5])); frames.setMatrixAt(i, m4); });
      frames.castShadow = frames.receiveShadow = true; g.add(frames);

      // glazing panels + night window lights
      const panels = [];
      for (let f = 1; f < LEVELS; f++) for (const side of [1, -1]) for (let b = 0; b < bays; b++)
        panels.push([-w / 2 + bw * (b + 0.5), f * FLOOR_H + FLOOR_H / 2, side * (d / 2 - 0.7), bw - 0.35, FLOOR_H - 0.45, 0.1, f, side]);
      const pm = new THREE.InstancedMesh(unit, panelMat, panels.length);
      const lm = new THREE.InstancedMesh(unit, lightMat, panels.length);
      const col = new THREE.Color();
      panels.forEach((p, i) => {
        m4.compose(v.set(p[0], p[1], p[2]), q.identity(), s.set(p[3], p[4], p[5])); pm.setMatrixAt(i, m4);
        m4.compose(v.set(p[0], p[1], p[2] + p[7] * 0.12), q.identity(), s.set(p[3] * 0.96, p[4] * 0.9, 0.05)); lm.setMatrixAt(i, m4);
        const on = rnd() < 0.62; const warm = rnd();
        col.setRGB(on ? 1 : 0.05, on ? 0.78 + warm * 0.12 : 0.06, on ? 0.5 + warm * 0.2 : 0.08); lm.setColorAt(i, col);
      });
      lm.renderOrder = 3; g.add(pm); g.add(lm);

      // roof: parapet, plant room, solar arrays
      const plant = new THREE.Mesh(new THREE.BoxGeometry(w * 0.38, 3 + def.crown, d * 0.42), this.matWhite);
      plant.position.set(w * 0.18, H + 1.5 + def.crown / 2, -d * 0.1); plant.castShadow = true; g.add(plant);
      const sol = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.12, 1.3), solarMat, 8);
      for (let i = 0; i < 8; i++) {
        q.setFromEuler(new THREE.Euler(-0.4, 0, 0));
        m4.compose(v.set(-w * 0.32 + (i % 4) * 2.5 - 1.5 + 1.2, H + 1.6, -1 + Math.floor(i / 4) * 2.4), q, s.set(1, 1, 1)); sol.setMatrixAt(i, m4);
      }
      sol.castShadow = true; g.add(sol);
      // roof plaque in gold
      const plaque = new THREE.Mesh(new THREE.BoxGeometry(w * 0.38 + 0.05, 0.35, 0.05), new THREE.MeshStandardMaterial({ color: PAL.gold, metalness: .8, roughness: .3, emissive: PAL.gold, emissiveIntensity: 0 }));
      plaque.position.set(w * 0.18, H + 2.6 + def.crown, -d * 0.1 + d * 0.21 + 0.03); g.add(plaque);
      this.fadeMats.push(plaque.material);

      // picking: hit box + floor slices
      const hit = new THREE.Mesh(new THREE.BoxGeometry(w + 1, H + 4, d + 1), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = H / 2 + 1; hit.userData = { buildingId: def.id, kind: 'tower' }; g.add(hit);

      const slices = [];
      const sliceGeo = new THREE.BoxGeometry(w + 2.6, FLOOR_H - 0.25, d + 2.6);
      for (let f = -1; f < LEVELS; f++) {
        const mat = new THREE.MeshBasicMaterial({ color: 0x5fe3f0, transparent: true, opacity: 0, depthWrite: false });
        const sl = new THREE.Mesh(sliceGeo, mat);
        sl.position.y = f * FLOOR_H + FLOOR_H / 2 + (f < 0 ? -0.2 : 0);
        sl.userData = { buildingId: def.id, floor: f < 0 ? 'B' : String(f), kind: 'floor' };
        sl.visible = false; g.add(sl); slices.push(sl);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(sliceGeo), new THREE.LineBasicMaterial({ color: 0xe9e0cf, transparent: true, opacity: 0 }));
        sl.add(edges); sl.userData.edges = edges;
      }

      // floating label ring (selection highlight)
      const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(w, d) * 0.78, Math.max(w, d) * 0.82, 64), new THREE.MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = this.podiumTop + 0.25; g.add(ring);

      this.scene.add(g);
      this.towers.push({ def, group: g, hit, slices, ring, H, plaque });
    });
  }

  // ------------------------------------------------------------------ LANDSCAPE
  _buildLandscape() {
    // paved plaza in front of podium
    const paveMat = new THREE.MeshStandardMaterial({ color: PAL.paving, roughness: 0.95 });
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(70, 64, Math.PI * 0.05, Math.PI * 0.9), paveMat);
    plaza.rotation.x = -Math.PI / 2; plaza.rotation.z = Math.PI; plaza.position.set(-4, 0.06, 6); plaza.scale.set(1, 0.72, 1); plaza.receiveShadow = true;
    this.scene.add(plaza);

    // organic lawn islands
    const lawnMat = new THREE.MeshStandardMaterial({ color: PAL.lawn, roughness: 1 });
    const islands = [[-30, 40, 12, 6, .3], [-6, 46, 14, 7, -.1], [20, 38, 11, 6, -.4], [-44, 26, 8, 5, .6], [36, 26, 9, 5, -.7], [6, 58, 10, 5, .2], [-22, 58, 9, 4.5, -.3]];
    islands.forEach(([x, z, a, b, r]) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 40), lawnMat);
      m.rotation.x = -Math.PI / 2; m.rotation.z = r; m.scale.set(a, b, 1); m.position.set(x, 0.1, z); m.receiveShadow = true; this.scene.add(m);
      const edge = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 40), new THREE.MeshStandardMaterial({ color: 0xbfb49d }));
      edge.rotation.copy(m.rotation); edge.scale.copy(m.scale); edge.position.set(x, 0.12, z); this.scene.add(edge);
    });
    // cycle path (sage line) arc
    const arc = new THREE.Mesh(new THREE.RingGeometry(62, 64, 80, 1, Math.PI * 1.08, Math.PI * 0.84), new THREE.MeshStandardMaterial({ color: 0x7fa36a, roughness: 1 }));
    arc.rotation.x = -Math.PI / 2; arc.position.set(-4, 0.09, 6); arc.scale.set(1, 0.72, 1); this.scene.add(arc);

    // trees: round canopy (instanced) + palms
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x4f6d3f, roughness: 1, flatShading: true });
    const canopy2 = new THREE.MeshStandardMaterial({ color: 0x3e5a34, roughness: 1, flatShading: true });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a7458, roughness: 1 });
    const blob = new THREE.IcosahedronGeometry(1, 1);
    const spots = [];
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2, r = 50 + rnd() * 60;
      const x = Math.cos(a) * r * 1.2, z = Math.sin(a) * r * 0.9 - 10;
      if (z < 30 && z > -45 && x > -60 && x < 50) continue;      // keep building area clear
      if (x < -95) continue;                                     // no trees on sand
      spots.push([x, z, 2.2 + rnd() * 3]);
    }
    for (let i = 0; i < 26; i++) spots.push([-40 + rnd() * 80, 28 + rnd() * 40, 1.2 + rnd() * 1.6]);
    const tA = new THREE.InstancedMesh(blob, canopyMat, spots.length);
    const tB = new THREE.InstancedMesh(blob, canopy2, spots.length);
    const tr = new THREE.InstancedMesh(new THREE.CylinderGeometry(.18, .25, 1, 6), trunkMat, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    spots.forEach(([x, z, r], i) => {
      m4.compose(v.set(x, r * 1.25 + 1.2, z), q.identity(), s.set(r, r * 0.9, r)); tA.setMatrixAt(i, m4);
      m4.compose(v.set(x + r * .35, r * 1.55 + 1.2, z - r * .2), q.identity(), s.set(r * .7, r * .6, r * .7)); tB.setMatrixAt(i, m4);
      m4.compose(v.set(x, r * 0.6, z), q.identity(), s.set(1, r * 1.3, 1)); tr.setMatrixAt(i, m4);
    });
    [tA, tB, tr].forEach(o => { o.castShadow = true; o.receiveShadow = true; this.scene.add(o); });

    // palms
    const palmSpots = [];
    for (let i = 0; i < 16; i++) palmSpots.push([-48 + i * 6.2 + rnd() * 2, 22 + Math.sin(i * .5) * 6 + rnd() * 4]);
    for (let i = 0; i < 8; i++) palmSpots.push([42 + rnd() * 18, -30 + i * 7]);
    for (let i = 0; i < 6; i++) palmSpots.push([-28 + i * 9, 4 + rnd() * 6, true]); // on podium roof
    const leafGeo = new THREE.ConeGeometry(0.5, 4.2, 3); leafGeo.translate(0, 2.1, 0); leafGeo.rotateZ(Math.PI / 2.4);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x5f7f3c, roughness: 1, flatShading: true });
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, palmSpots.length * 7);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.18, .3, 1, 6), trunkMat, palmSpots.length);
    let li = 0;
    palmSpots.forEach(([x, z, roof], i) => {
      const base = roof ? this.podiumTop : 0; const h = (roof ? 4 : 7) + rnd() * 3;
      m4.compose(v.set(x, base + h / 2, z), q.identity(), s.set(1, h, 1)); trunks.setMatrixAt(i, m4);
      for (let k = 0; k < 7; k++) {
        q.setFromEuler(new THREE.Euler(0, k / 7 * Math.PI * 2 + rnd(), 0.15 * rnd()));
        m4.compose(v.set(x, base + h, z), q, s.set(1, 1, 1)); leaves.setMatrixAt(li++, m4);
      }
    });
    [leaves, trunks].forEach(o => { o.castShadow = true; this.scene.add(o); });

    // path lamps (glow at night)
    const lampGeo = new THREE.SphereGeometry(0.28, 8, 6);
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.25 });
    const lamps = new THREE.InstancedMesh(lampGeo, this.lampMat, 40);
    for (let i = 0; i < 40; i++) {
      const a = Math.PI * (1.1 + i / 40 * 0.8);
      m4.compose(v.set(-4 + Math.cos(a) * 58, 3.2, 6 - Math.sin(a) * 58 * 0.72), q.identity(), s.set(1, 1, 1)); lamps.setMatrixAt(i, m4);
    }
    this.scene.add(lamps);
  }

  _buildRoadAndCars() {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(900, 14), new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 1 }));
    road.rotation.x = -Math.PI / 2; road.rotation.z = -0.12; road.position.set(60, 0.08, -62); road.receiveShadow = true; this.scene.add(road);
    const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(3, 0.3), new THREE.MeshBasicMaterial({ color: 0xe9e0cf }), 120);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, -0.12)), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < 120; i++) { const x = -390 + i * 7.5; m4.compose(v.set(60 + x * Math.cos(0.12), 0.1, -62 + x * Math.sin(0.12)), q, s); dash.setMatrixAt(i, m4); }
    this.scene.add(dash);
    this.cars = [];
    const colors = [0xffffff, 0x9aa3ab, 0x1e2a33, 0xba9b5f, 0x5e775e, 0xd8d8d8];
    for (let i = 0; i < 9; i++) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 1.9), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: .35, metalness: .5 }));
      body.position.y = 0.8; body.castShadow = true; car.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.7), new THREE.MeshStandardMaterial({ color: 0x15202a, roughness: .2, metalness: .6 }));
      cab.position.set(-0.2, 1.7, 0); car.add(cab);
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 1.6), new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0.2 }));
      hl.position.set(2.12, 0.9, 0); car.add(hl); car.userData.hl = hl;
      this.scene.add(car);
      this.cars.push({ car, off: rnd() * 800, speed: 9 + rnd() * 7, lane: i % 2 ? 3 : -3, dir: i % 2 ? -1 : 1 });
    }
  }

  // ------------------------------------------------------------------ WATER RISERS (x-ray)
  _buildRisers() {
    this.riserUni = { t: { value: 0 }, amt: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.riserUni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float t; uniform float amt; varying vec2 vUv;
        void main(){ float flow = fract(vUv.x*14. - t*1.4); float pulse = smoothstep(.0,.15,flow)*smoothstep(.6,.15,flow);
        vec3 c = mix(vec3(.15,.55,.95), vec3(.55,1.,1.), pulse); float a = (.35 + pulse*.9)*amt; gl_FragColor = vec4(c*a, a); }`
    });
    const hot = mat.clone(); hot.uniforms = this.riserUni;
    hot.fragmentShader = mat.fragmentShader.replace('vec3(.15,.55,.95), vec3(.55,1.,1.)', 'vec3(.9,.35,.2), vec3(1.,.8,.45)');
    this.risers = new THREE.Group();
    const towerBase = [];
    this.towers.forEach(T => {
      const { w, d } = T.def;
      const g = new THREE.Group(); g.position.copy(T.group.position); g.rotation.copy(T.group.rotation);
      for (let k = 0; k < 4; k++) {
        const x = -w / 2 + 2 + k * (w - 4) / 3;
        for (const [dx, m] of [[0, mat], [0.7, hot]]) {
          const path = new THREE.LineCurve3(new THREE.Vector3(x + dx, -3, -1.5), new THREE.Vector3(x + dx, T.H + 1, -1.5));
          g.add(new THREE.Mesh(new THREE.TubeGeometry(path, 40, 0.22, 6), m));
          // branch to each floor
          for (let f = 1; f < LEVELS; f++) {
            const br = new THREE.LineCurve3(new THREE.Vector3(x + dx, f * FLOOR_H + 0.6, -1.5), new THREE.Vector3(x + dx, f * FLOOR_H + 0.6, d / 2 - 2.5));
            g.add(new THREE.Mesh(new THREE.TubeGeometry(br, 6, 0.09, 5), m));
          }
        }
      }
      this.risers.add(g);
      towerBase.push(new THREE.Vector3(T.group.position.x, -3, T.group.position.z));
    });
    // main distribution line in basement linking the towers + water room
    const pts = [new THREE.Vector3(-40, -3, 0), ...towerBase, new THREE.Vector3(34, -3, -6)];
    const main = new THREE.CatmullRomCurve3(pts);
    this.risers.add(new THREE.Mesh(new THREE.TubeGeometry(main, 120, 0.55, 8), mat));
    this.risers.visible = false;
    this.scene.add(this.risers);
  }

  // ------------------------------------------------------------------ TIME OF DAY
  setTimeOfDay(hour) {
    this.todHour = hour;
    const date = hour == null ? new Date() : jerusalemDateAtHour(hour);
    const { elevation, azimuth } = sunPosition(date);
    this.sunInfo = { elevation, azimuth };
    const el = elevation * Math.PI / 180, az = azimuth * Math.PI / 180;
    // world: +X east? we treat -X as west (sea). north = -Z.
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const dayF = smooth(clamp01((elevation + 4) / 14));          // 0 night .. 1 day
    const golden = clamp01(1 - Math.abs(elevation - 3) / 10) * (elevation > -6 ? 1 : 0);
    this.night = 1 - dayF;

    const top = new THREE.Color(0x060d1a).lerp(new THREE.Color(0x3d83c6), dayF);
    const hor = new THREE.Color(0x0e1c2c).lerp(new THREE.Color(0xd2e6f2), dayF).lerp(new THREE.Color(0xf29a5c), golden * 0.75);
    this.skyUni.top.value.copy(top.lerp(new THREE.Color(0x2c3e66), golden * 0.35));
    this.skyUni.hor.value.copy(hor);
    this.skyUni.sunDir.value.copy(dir);
    this.skyUni.sunCol.value.set(0xfff0d0).lerp(new THREE.Color(0xff8a40), golden);
    this.skyUni.glow.value = elevation > -6 ? 1 : 0;
    this.scene.fog.color.copy(hor);

    const sunVisible = clamp01((elevation + 1) / 6);
    this.sun.position.copy(dir.clone().multiplyScalar(260)).add(new THREE.Vector3(0, 0, -5));
    this.sun.target.position.set(0, 0, -5);
    this.sun.color.set(0xffffff).lerp(new THREE.Color(0xffa060), golden);
    this.sun.intensity = 2.6 * sunVisible;
    this.sun.castShadow = sunVisible > 0.05;
    this.hemi.intensity = lerp(0.18, 0.95, dayF);
    this.hemi.color.set(0x8fa8ff).lerp(new THREE.Color(0xdbeaff), dayF);
    this.moon.intensity = this.night * 0.45;
    this.stars.material.opacity = smooth(clamp01((-elevation - 3) / 8));
    this.renderer.toneMappingExposure = lerp(0.85, 1.05, dayF);

    const phase = elevation < -6 ? 'לילה' : elevation < 6 ? (azimuth < 180 ? 'זריחה' : 'שקיעה') : elevation < 25 ? (azimuth < 180 ? 'בוקר' : 'אחר הצהריים') : 'צהריים';
    this.phase = phase;
    this.emit('tod', { phase, elevation, hour: hour == null ? jerusalemHourNow() : hour });
  }

  _applyNight() {
    const n = this.night;
    this.matWin.opacity = n * 0.95;
    this.matGlass.emissiveIntensity = n * 0.32;
    this.lampMat.opacity = 0.15 + n * 0.85;
    this.waterUni.night.value = n;
    this.poolUni.night.value = n;
    this.poolGlow.intensity = n * 60;
    this.cars.forEach(c => c.car.userData.hl.material.opacity = 0.2 + n * 0.8);
    this.towers.forEach(T => { if (T.plaque) T.plaque.material.emissiveIntensity = n * 0.8; });
  }

  // ------------------------------------------------------------------ INTRO CAMERA
  playIntro(onCaption, onDone) {
    this.mode = 'intro';
    this.controls.enabled = false;
    const P = (x, y, z) => new THREE.Vector3(x, y, z);
    this.introPath = new THREE.CatmullRomCurve3([P(-330, 120, 260), P(-190, 60, 170), P(-80, 26, 95), P(10, 18, 70), P(70, 30, 40), P(80, 60, -20), P(20, 75, -70), P(-70, 60, -40), P(-115, 52, 85), P(-80, 48, 112)]);
    this.introLook = new THREE.CatmullRomCurve3([P(-30, 6, 10), P(-10, 8, 0), P(5, 9, 10), P(10, 10, 5), P(5, 16, -8), P(0, 22, -10), P(-5, 22, -10), P(-5, 18, -8), P(-2, 20, -6), P(-2, 25, -6)]);
    this.introT0 = this.time; this.introDur = 22;
    this.introCaption = onCaption; this.introDone = onDone; this._lastCap = -1;
    this.risers.visible = true;
  }
  skipIntro() { if (this.mode === 'intro') { this.introT0 = this.time - this.introDur; } }

  _updateIntro() {
    const t = clamp01((this.time - this.introT0) / this.introDur);
    const e = easeInOut(t);
    this.camera.position.copy(this.introPath.getPoint(e));
    this.camera.lookAt(this.introLook.getPoint(e));
    const caps = [[0, 'חוף אשקלון · הים התיכון'], [0.22, 'פודיום מלון · בריכת אינפיניטי · גני גג'], [0.42, 'מערכות המים של המלון — מבט פנימי'], [0.66, 'צנרת מים קרים / חמים · ניקוז · 98 חדרים'], [0.86, '']];
    let ci = 0; caps.forEach((c, i) => { if (t >= c[0]) ci = i; });
    if (ci !== this._lastCap) { this._lastCap = ci; this.introCaption && this.introCaption(caps[ci][1], ci); }
    this.xrayTarget = (t > 0.4 && t < 0.84) ? 1 : 0;
    if (t >= 1) { this.mode = 'idle'; this.idleT0 = this.time; this.idleBase = this.camera.position.clone(); this.introDone && this.introDone(); }
  }

  _updateIdle() {
    const a = (this.time - this.idleT0) * 0.035;
    const r = Math.hypot(this.idleBase.x + 2, this.idleBase.z + 6);
    const a0 = Math.atan2(this.idleBase.z + 6, this.idleBase.x + 2);
    this.camera.position.set(-2 + Math.cos(a0 - a) * r, this.idleBase.y, -6 + Math.sin(a0 - a) * r);
    this.camera.lookAt(-2, 25, -6);
  }

  // ------------------------------------------------------------------ PICKER
  mount(el) {
    if (this.renderer.domElement.parentNode !== el) el.prepend(this.renderer.domElement);
    this.container = el; this.resize();
  }
  enterPicker() {
    this.mode = 'picker';
    this.xrayTarget = 0;
    this.controls.enabled = true;
    this.camera.position.set(-75, 62, 95);
    this.controls.target.set(-2, 14, -8);
    this.controls.update();
    this._tweenCam = null;
    this.resume();
  }
  setFloorStats(stats) { this.floorStats = stats || {}; this._refreshSlices(); }

  selectBuilding(id) {
    this.selected = id ? { b: id, f: null } : null;
    this.towers.forEach(T => {
      const on = T.def.id === id;
      T.slices.forEach(s => { s.visible = on; });
    });
    this._refreshSlices();
    const T = this.towers.find(t => t.def.id === id);
    if (T) {
      const p = T.group.position;
      const dir = new THREE.Vector3(Math.sin(T.def.rot), 0, Math.cos(T.def.rot));
      this._tween(p.clone().add(dir.multiplyScalar(88)).add(new THREE.Vector3(-30, 30, 0)), new THREE.Vector3(p.x, 16, p.z));
    } else {
      this._tween(new THREE.Vector3(-75, 62, 95), new THREE.Vector3(-2, 14, -8));
    }
  }
  selectFloor(f) { if (this.selected) { this.selected.f = f; this._refreshSlices(); } }

  _refreshSlices() {
    this.towers.forEach(T => T.slices.forEach(s => {
      const key = `${s.userData.buildingId}|${s.userData.floor}`;
      const st = this.floorStats[key];
      const sel = this.selected && this.selected.b === s.userData.buildingId && this.selected.f === s.userData.floor;
      const hov = this.hoverFloor === s;
      let col = new THREE.Color(0x3a4a44);
      if (st && st.total) {
        if (st.gaps) col.set(0xe0675a); else if (st.pct >= 1) col.set(0x7fd18b); else if (st.pct > 0) col.set(0xe6c27a); else col.set(0x6c7f78);
      }
      if (st && !st.total) col.set(0x2a3a35);
      s.material.color.copy(col);
      s.material.opacity = sel ? 0.85 : hov ? 0.7 : 0.42;
      s.userData.edges.material.opacity = sel || hov ? 1 : 0.35;
      s.scale.setScalar(sel ? 1.04 : 1);
    }));
  }

  _tween(pos, target, dur = 1.4) {
    this._tweenCam = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos, t1: target, s: this.time, dur };
  }

  _bindEvents() {
    window.addEventListener('resize', () => this.resize());
    const el = this.renderer.domElement;
    const setP = e => { const r = el.getBoundingClientRect(); this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
    el.addEventListener('pointermove', e => { setP(e); this._needsPick = true; });
    el.addEventListener('pointerleave', () => { this.pointer.set(-9, -9); this._needsPick = true; });
    let down = null;
    el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', e => {
      if (!down || this.mode !== 'picker') return;
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      setP(e); const hit = this._pick();
      if (!hit) return;
      if (hit.kind === 'floor') this.emit('pickFloor', hit.buildingId, hit.floor);
      else this.emit('pickBuilding', hit.buildingId);
    });
  }

  _pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const objs = [];
    this.towers.forEach(T => { if (this.selected && this.selected.b === T.def.id) objs.push(...T.slices); objs.push(T.hit); });
    const hits = this.raycaster.intersectObjects(objs, false);
    const h = hits.find(x => x.object.userData.kind === 'floor') || hits[0];
    return h ? h.object.userData : null;
  }

  _updatePickerHover() {
    if (!this._needsPick) return; this._needsPick = false;
    const hit = this._pick();
    const hb = hit ? hit.buildingId : null;
    let hf = null;
    if (hit && hit.kind === 'floor') { const T = this.towers.find(t => t.def.id === hit.buildingId); hf = T.slices.find(s => s.userData.floor === hit.floor); }
    if (hb !== this.hoverBld || hf !== this.hoverFloor) {
      this.hoverBld = hb; this.hoverFloor = hf; this._refreshSlices();
      this.renderer.domElement.style.cursor = hb ? 'pointer' : 'grab';
      this.emit('hover', hb, hf ? hf.userData.floor : null);
    }
  }

  // ------------------------------------------------------------------ LOOP
  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.fov = w < h ? 58 : 42; this.camera.updateProjectionMatrix();
  }
  pause() { this.running = false; }
  resume() { if (!this.running) { this.running = true; this.clock.getDelta(); requestAnimationFrame(this._loop); } }

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    if (this.todHour == null && Math.floor(this.time) % 60 === 0 && Math.floor(this.time - dt) % 60 !== 0) this.setTimeOfDay(null);

    // uniforms
    this.waterUni.t.value = this.time; this.poolUni.t.value = this.time; this.riserUni.t.value = this.time;
    this._applyNight();
    // x-ray fade
    this.xray += (this.xrayTarget - this.xray) * Math.min(1, dt * 2.5);
    this.riserUni.amt.value = this.xray;
    this.risers.visible = this.xray > 0.01;
    const op = 1 - this.xray * 0.82;
    this.fadeMats.forEach(m => { m.opacity = op; m.depthWrite = op > 0.95; });

    // cars
    this.cars.forEach(c => {
      const xx = c.dir * (((c.off + this.time * c.speed) % 800) - 400);
      const co = Math.cos(0.12), si = Math.sin(0.12);
      c.car.position.set(60 + xx * co - si * c.lane, 0, -62 + xx * si + co * c.lane);
      c.car.rotation.y = -0.12 + (c.dir < 0 ? Math.PI : 0);
    });

    if (this.mode === 'intro') this._updateIntro();
    else if (this.mode === 'idle') this._updateIdle();
    else if (this.mode === 'picker') {
      if (this._tweenCam) {
        const k = easeInOut(clamp01((this.time - this._tweenCam.s) / this._tweenCam.dur));
        this.camera.position.lerpVectors(this._tweenCam.p0, this._tweenCam.p1, k);
        this.controls.target.lerpVectors(this._tweenCam.t0, this._tweenCam.t1, k);
        if (k >= 1) this._tweenCam = null;
      }
      this.controls.update();
      this._updatePickerHover();
      this.towers.forEach(T => {
        const on = (this.selected && this.selected.b === T.def.id) || this.hoverBld === T.def.id;
        T.ring.material.opacity += ((on ? 0.9 : 0) - T.ring.material.opacity) * 0.15;
        T.ring.rotation.z += dt * 0.4;
      });
    }
    this.renderer.render(this.scene, this.camera);
  }
}
