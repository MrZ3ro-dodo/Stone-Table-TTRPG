(() => {
  const THREE_URL = 'https://unpkg.com/three@0.180.0/build/three.module.js';
  const THEME_ASSET = 'https://unpkg.com/@3d-dice/dice-box@1.1.4/dist/assets/themes/default/';
  const D20_REFERENCE_RADIUS = 1.05;
  const templates = new Map();
  const style = { background: '#222a24', die: '#a34a91', shadow: '#120d18' };
  let threePromise = null;
  let fontPromise = null;
  let themeTexturePromise = null;
  let rendererState = null;
  let coinRendererState = null;
  let coinTemplatePromise = null;

  function dieRadius(sides) {
    return D20_REFERENCE_RADIUS * Math.sqrt(sides / 20);
  }

  function loadThree() {
    if (!threePromise) threePromise = import(THREE_URL);
    return threePromise;
  }

  async function loadFaceFont(THREE) {
    if (!fontPromise) {
      const [fontLoaderModule, textGeometryModule] = await Promise.all([
        import('https://unpkg.com/three@0.180.0/examples/jsm/loaders/FontLoader.js'),
        import('https://unpkg.com/three@0.180.0/examples/jsm/geometries/TextGeometry.js')
      ]);
      const loader = new fontLoaderModule.FontLoader();
      fontPromise = new Promise((resolve, reject) => {
        loader.load(
          'https://unpkg.com/three@0.180.0/examples/fonts/helvetiker_bold.typeface.json',
          font => resolve({ font, TextGeometry: textGeometryModule.TextGeometry }),
          undefined,
          error => reject(error)
        );
      }).catch(error => {
        fontPromise = null;
        throw error;
      });
    }
    return fontPromise;
  }

  function loadThemeTextures(THREE) {
    if (!themeTexturePromise) {
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      themeTexturePromise = Promise.all([
        loader.loadAsync(`${THEME_ASSET}normal.png`),
        loader.loadAsync(`${THEME_ASSET}specular.jpg`)
      ]).then(([normal, specular]) => {
        normal.colorSpace = THREE.NoColorSpace;
        specular.colorSpace = THREE.NoColorSpace;
        normal.anisotropy = 8;
        specular.anisotropy = 8;
        return { normal, specular };
      }).catch(error => {
        themeTexturePromise = null;
        throw error;
      });
    }
    return themeTexturePromise;
  }

  function createHullFace(THREE, vertices, indices, interior) {
    let [first, second, third] = indices;
    let normal = new THREE.Vector3().subVectors(vertices[second], vertices[first])
      .cross(new THREE.Vector3().subVectors(vertices[third], vertices[first])).normalize();
    const center = vertices[first].clone().add(vertices[second]).add(vertices[third]).multiplyScalar(1 / 3);
    if (normal.dot(center.clone().sub(interior)) < 0) {
      [second, third] = [third, second];
      normal.negate();
    }
    return { indices: [first, second, third], normal };
  }

  function createConvexHull(THREE, vertices) {
    const first = 0;
    let second = 1;
    for (let index = 2; index < vertices.length; index++) {
      if (vertices[index].distanceToSquared(vertices[first]) > vertices[second].distanceToSquared(vertices[first])) second = index;
    }
    const axis = vertices[second].clone().sub(vertices[first]).normalize();
    let third = -1;
    let widestLineDistance = -1;
    for (let index = 0; index < vertices.length; index++) {
      if (index === first || index === second) continue;
      const distance = vertices[index].clone().sub(vertices[first]).cross(axis).lengthSq();
      if (distance > widestLineDistance) { widestLineDistance = distance; third = index; }
    }
    const planeNormal = vertices[second].clone().sub(vertices[first])
      .cross(vertices[third].clone().sub(vertices[first])).normalize();
    let fourth = -1;
    let widestPlaneDistance = -1;
    for (let index = 0; index < vertices.length; index++) {
      if (index === first || index === second || index === third) continue;
      const distance = Math.abs(planeNormal.dot(vertices[index].clone().sub(vertices[first])));
      if (distance > widestPlaneDistance) { widestPlaneDistance = distance; fourth = index; }
    }

    const simplex = [first, second, third, fourth];
    const interior = simplex.reduce((center, index) => center.add(vertices[index]), new THREE.Vector3()).multiplyScalar(1 / 4);
    let faces = [
      [first, second, third], [first, fourth, second],
      [first, third, fourth], [second, fourth, third]
    ].map(indices => createHullFace(THREE, vertices, indices, interior));
    const initialVertices = new Set(simplex);

    for (let pointIndex = 0; pointIndex < vertices.length; pointIndex++) {
      if (initialVertices.has(pointIndex)) continue;
      const point = vertices[pointIndex];
      const visible = faces.filter(face => face.normal.dot(point.clone().sub(vertices[face.indices[0]])) > 1e-8);
      if (!visible.length) continue;

      const horizon = new Map();
      for (const face of visible) {
        const [a, b, c] = face.indices;
        for (const [start, end] of [[a, b], [b, c], [c, a]]) {
          const key = start < end ? `${start}:${end}` : `${end}:${start}`;
          if (horizon.has(key)) horizon.delete(key);
          else horizon.set(key, [start, end]);
        }
      }
      const visibleFaces = new Set(visible);
      faces = faces.filter(face => !visibleFaces.has(face));
      for (const [start, end] of horizon.values()) {
        faces.push(createHullFace(THREE, vertices, [start, end, pointIndex], interior));
      }
    }
    return faces;
  }

  async function createTemplate(THREE, sides) {
    if (templates.has(sides)) return templates.get(sides);
    const vertexCount = sides / 2 + 2;
    const radius = dieRadius(sides);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const vertices = Array.from({ length: vertexCount }, (_, index) => {
      const height = 1 - 2 * (index + 0.5) / vertexCount;
      const ringRadius = Math.sqrt(1 - height * height);
      const angle = index * goldenAngle;
      return new THREE.Vector3(Math.cos(angle) * ringRadius * radius, height * radius, Math.sin(angle) * ringRadius * radius);
    });
    const hullFaces = createConvexHull(THREE, vertices);
    if (hullFaces.length !== sides) throw new Error(`O d${sides} gerou ${hullFaces.length} faces triangulares.`);
    const positions = [];
    const normals = [];
    const faces = [];
    const faceRotations = [];
    const faceDecorations = [];
    const { font, TextGeometry } = await loadFaceFont(THREE);

    for (let faceIndex = 0; faceIndex < hullFaces.length; faceIndex++) {
      const hullFace = hullFaces[faceIndex];
      const face = hullFace.indices.map(index => vertices[index]);
      positions.push(...face.flatMap(vertex => vertex.toArray()));
      normals.push(hullFace.normal.clone());
      faces.push(face.map(vertex => vertex.clone()));
      const faceCenter = face[0].clone().add(face[1]).add(face[2]).multiplyScalar(1 / 3);
      const faceUp = face[0].clone().sub(faceCenter)
        .addScaledVector(hullFace.normal, -face[0].clone().sub(faceCenter).dot(hullFace.normal)).normalize();
      const faceRight = faceUp.clone().cross(hullFace.normal).normalize();
      faceUp.crossVectors(hullFace.normal, faceRight).normalize();
      const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(faceRight, faceUp, hullFace.normal));
      faceRotations.push(rotation);

      const label = String(faceIndex + 1);
      const labelScale = sides === 30 ? 2.4 : sides === 60 ? 1.35 : 1;
      const textGeometry = new TextGeometry(label, {
        font,
        size: radius * 0.1 * labelScale,
        depth: radius * 0.0025,
        curveSegments: 4,
        bevelEnabled: false
      });
      textGeometry.center();
      const decoration = new THREE.Mesh(
        textGeometry,
        new THREE.MeshStandardMaterial({
          color: '#eef6ff',
          roughness: 0.35,
          metalness: 0.04,
          emissive: '#1c2233',
          emissiveIntensity: 0.03,
          flatShading: false
        })
      );
      decoration.position.copy(faceCenter.clone().add(hullFace.normal.clone().multiplyScalar(radius * 0.003)));
      decoration.quaternion.copy(rotation);
      decoration.scale.setScalar(0.85);
      decoration.renderOrder = 25;
      decoration.castShadow = true;
      decoration.receiveShadow = true;
      faceDecorations.push(decoration);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: style.die,
      roughness: 0.46,
      metalness: 0,
      flatShading: true,
      side: THREE.DoubleSide
    });
    const edgeGeometry = new THREE.EdgesGeometry(geometry, 8);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: style.die, transparent: true, opacity: 0.72 });
    const template = { geometry, material, normals, faces, faceRotations, edgeGeometry, edgeMaterial, faceDecorations };
    templates.set(sides, template);
    return template;
  }


  async function createRenderer(stage) {
    const THREE = await loadThree();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(stage.clientWidth, stage.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;

    const scene = new THREE.Scene();
    const hemisphereLight = new THREE.HemisphereLight('#ffffff', '#39323b', 0.95);
    hemisphereLight.position.set(1, 1, 0);
    scene.add(hemisphereLight);
    const keyLight = new THREE.DirectionalLight('#fff7e9', 1.45);
    keyLight.position.set(0.3, 1, -0.4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.blurSamples = 8;
    keyLight.shadow.radius = 4;
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight('#d9e8ff', 0.48);
    fillLight.position.set(0, 4, 8);
    scene.add(fillLight);

    const floorGeometry = new THREE.PlaneGeometry(200, 200);
    const floorMaterial = new THREE.ShadowMaterial({ color: style.shadow, opacity: 0.42 });

    const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 250);
    camera.position.set(0, 6, 9);
    camera.lookAt(0, 0, 0);
    return { THREE, renderer, scene, camera, floorGeometry, floorMaterial };
  }

  async function createCoinTemplate(THREE) {
    if (!coinTemplatePromise) {
      coinTemplatePromise = (async () => {
        const radius = D20_REFERENCE_RADIUS;
        const thickness = radius * 0.12;
        const geometry = new THREE.CylinderGeometry(radius, radius, thickness, 64, 1, false);
        const rimMaterial = new THREE.MeshStandardMaterial({ color: '#a96b18', metalness: 0.82, roughness: 0.25 });
        const faceMaterial = new THREE.MeshStandardMaterial({ color: '#edbf50', metalness: 0.72, roughness: 0.3 });
        const reliefMaterial = new THREE.MeshStandardMaterial({ color: '#b9812b', metalness: 0.76, roughness: 0.3 });
        const engravingMaterial = new THREE.MeshStandardMaterial({ color: '#684315', metalness: 0.68, roughness: 0.34 });
        const highlightMaterial = new THREE.MeshStandardMaterial({ color: '#ffe08a', metalness: 0.78, roughness: 0.22 });
        const decorations = [];
        const point = (x, y) => [x * radius * 1.18, -y * radius * 1.18];
        const addRelief = (shape, side, material = reliefMaterial) => {
          const depth = thickness * 0.18;
          const reliefGeometry = new THREE.ExtrudeGeometry(shape, {
            depth,
            curveSegments: 8,
            bevelEnabled: true,
            bevelThickness: thickness * 0.035,
            bevelSize: thickness * 0.025,
            bevelSegments: 2
          });
          const relief = new THREE.Mesh(reliefGeometry, material);
          const sign = side === 'cara' ? 1 : -1;
          relief.position.y = sign * (thickness / 2 + 0.002);
          relief.rotation.x = side === 'cara' ? -Math.PI / 2 : Math.PI / 2;
          relief.castShadow = true;
          relief.receiveShadow = true;
          decorations.push(relief);
        };
        const addRaisedLine = (points, material, lineRadius = radius * 0.012, closed = false) => {
          const curve = new THREE.CatmullRomCurve3(
            points.map(([x, y]) => new THREE.Vector3(...point(x, y), thickness * 0.18)),
            closed,
            'centripetal'
          );
          const lineGeometry = new THREE.TubeGeometry(curve, Math.max(16, points.length * 8), lineRadius, 8, closed);
          const line = new THREE.Mesh(lineGeometry, material);
          line.position.y = thickness / 2 + 0.002;
          line.rotation.x = -Math.PI / 2;
          line.castShadow = true;
          decorations.push(line);
        };

        const profile = new THREE.Shape();
        profile.moveTo(...point(-0.3, -0.48));
        profile.lineTo(...point(0.18, -0.48));
        profile.lineTo(...point(0.14, -0.3));
        profile.quadraticCurveTo(...point(0.29, -0.22), ...point(0.24, -0.09));
        profile.lineTo(...point(0.37, 0.01));
        profile.lineTo(...point(0.24, 0.08));
        profile.quadraticCurveTo(...point(0.29, 0.16), ...point(0.17, 0.21));
        profile.lineTo(...point(0.19, 0.35));
        profile.quadraticCurveTo(...point(0.12, 0.51), ...point(-0.05, 0.52));
        profile.quadraticCurveTo(...point(-0.25, 0.5), ...point(-0.31, 0.35));
        profile.lineTo(...point(-0.32, 0.19));
        profile.quadraticCurveTo(...point(-0.4, 0.03), ...point(-0.32, -0.14));
        profile.lineTo(...point(-0.3, -0.48));
        addRelief(profile, 'cara');

        const eye = new THREE.Shape();
        eye.moveTo(...point(0.015, 0.275));
        eye.quadraticCurveTo(...point(0.09, 0.325), ...point(0.18, 0.275));
        eye.quadraticCurveTo(...point(0.1, 0.235), ...point(0.015, 0.275));
        addRelief(eye, 'cara', highlightMaterial);
        const pupil = new THREE.Shape();
        pupil.absarc(...point(0.1, 0.28), radius * 0.022, 0, Math.PI * 2, false);
        addRelief(pupil, 'cara', engravingMaterial);
        addRaisedLine([[0.015, 0.35], [0.09, 0.37], [0.18, 0.34]], engravingMaterial, radius * 0.014);
        addRaisedLine([[0.19, 0.28], [0.25, 0.16], [0.34, 0.045]], highlightMaterial, radius * 0.012);
        addRaisedLine([[0.27, -0.025], [0.31, -0.045], [0.25, -0.06], [0.2, -0.05]], engravingMaterial, radius * 0.012);
        addRaisedLine([[-0.18, 0.24], [-0.22, 0.17], [-0.18, 0.1], [-0.13, 0.16]], highlightMaterial, radius * 0.013);
        addRaisedLine([[-0.27, 0.3], [-0.23, 0.43], [-0.11, 0.48], [0.025, 0.45]], reliefMaterial, radius * 0.018);

        const crown = new THREE.Shape();
        crown.moveTo(...point(-0.4, -0.28));
        crown.lineTo(...point(0.4, -0.28));
        crown.lineTo(...point(0.32, 0.3));
        crown.lineTo(...point(0.1, 0.08));
        crown.lineTo(...point(0, 0.46));
        crown.lineTo(...point(-0.14, 0.08));
        crown.lineTo(...point(-0.34, 0.3));
        crown.closePath();
        addRelief(crown, 'coroa');

        const crownBand = new THREE.Shape();
        crownBand.moveTo(...point(-0.4, -0.34));
        crownBand.lineTo(...point(0.4, -0.34));
        crownBand.lineTo(...point(0.4, -0.2));
        crownBand.lineTo(...point(-0.4, -0.2));
        crownBand.closePath();
        addRelief(crownBand, 'coroa', highlightMaterial);

        for (const [x, y] of [[-0.34, 0.3], [0, 0.46], [0.32, 0.3]]) {
          const jewel = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.045, 12, 8), highlightMaterial);
          jewel.position.set(x * radius * 1.18, -thickness / 2 - thickness * 0.22, -y * radius * 1.18);
          jewel.castShadow = true;
          decorations.push(jewel);
        }

        for (const face of [
          { y: thickness / 2, rotation: -Math.PI / 2 },
          { y: -thickness / 2, rotation: Math.PI / 2 }
        ]) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.82, radius * 0.025, 8, 64), highlightMaterial);
          ring.position.y = face.y + Math.sign(face.y) * thickness * 0.08;
          ring.rotation.x = face.rotation;
          decorations.push(ring);
        }

        const materials = [rimMaterial, faceMaterial, faceMaterial];
        return { geometry, materials, decorations, radius, thickness };
      })().catch(error => {
        coinTemplatePromise = null;
        throw error;
      });
    }
    return coinTemplatePromise;
  }

  async function rollCoins(stage, coins) {
    if (!coinRendererState) coinRendererState = await createRenderer(stage);
    const { THREE, renderer, scene, camera, floorGeometry, floorMaterial } = coinRendererState;
    const template = await createCoinTemplate(THREE);
    if (renderer.domElement.parentElement !== stage) stage.append(renderer.domElement);
    scene.children.filter(child => child.userData.coinFloor || child.userData.polyhedralCoin).forEach(child => scene.remove(child));

    const aspect = Math.max(0.7, stage.clientWidth / Math.max(1, stage.clientHeight));
    const viewHeight = D20_REFERENCE_RADIUS * 8.5;
    const viewWidth = viewHeight * aspect;
    const halfWidth = viewWidth / 2;
    const halfDepth = viewHeight / 2;
    const floorY = -template.thickness / 2 - 0.04;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfDepth;
    camera.bottom = -halfDepth;
    camera.far = Math.max(250, viewHeight * 3);
    camera.position.set(0, floorY + viewHeight * 0.95, floorY + viewHeight * 0.62);
    camera.lookAt(0, floorY, 0);
    camera.updateProjectionMatrix();
    const keyLight = scene.children.find(child => child.isDirectionalLight);
    keyLight.shadow.camera.left = -halfWidth;
    keyLight.shadow.camera.right = halfWidth;
    keyLight.shadow.camera.top = halfDepth;
    keyLight.shadow.camera.bottom = -halfDepth;
    keyLight.shadow.camera.far = Math.max(100, viewHeight * 3);
    keyLight.shadow.camera.updateProjectionMatrix();
    renderer.setSize(stage.clientWidth, stage.clientHeight, false);

    const animations = coins.map((coin, index) => {
      const mesh = new THREE.Mesh(template.geometry, template.materials);
      mesh.userData.polyhedralCoin = true;
      template.decorations.forEach(decoration => mesh.add(decoration.clone()));
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const targetX = (Math.random() * 2 - 1) * (halfWidth - template.radius);
      const targetZ = (Math.random() * 2 - 1) * (halfDepth - template.radius);
      const startEdges = [
        { distance: targetX + halfWidth - template.radius, x: -halfWidth + template.radius, z: (Math.random() * 2 - 1) * (halfDepth - template.radius) },
        { distance: halfWidth - template.radius - targetX, x: halfWidth - template.radius, z: (Math.random() * 2 - 1) * (halfDepth - template.radius) },
        { distance: targetZ + halfDepth - template.radius, x: (Math.random() * 2 - 1) * (halfWidth - template.radius), z: -halfDepth + template.radius },
        { distance: halfDepth - template.radius - targetZ, x: (Math.random() * 2 - 1) * (halfWidth - template.radius), z: halfDepth - template.radius }
      ];
      const start = startEdges.reduce((farthest, edge) => edge.distance > farthest.distance ? edge : farthest);
      const startRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI));
      const faceRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), coin.value === 2 ? Math.PI : 0);
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
      const targetRotation = yaw.multiply(faceRotation);
      mesh.position.set(start.x, floorY + template.radius * 0.4, start.z);
      mesh.quaternion.copy(startRotation);
      scene.add(mesh);
      return { mesh, start, startRotation, targetRotation, targetX, targetZ, index };
    });

    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.userData.coinFloor = true;
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = floorY;
    floor.receiveShadow = true;
    scene.add(floor);

    await new Promise(resolve => {
      const startedAt = performance.now();
      const duration = 1450;
      const flipAxis = new THREE.Vector3(1, 0, 0);
      const flip = new THREE.Quaternion();
      for (const animation of animations) animation.mesh.updateMatrixWorld();
      const frame = now => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = progress * progress * (3 - 2 * progress);
        for (const animation of animations) {
          animation.mesh.quaternion.slerpQuaternions(animation.startRotation, animation.targetRotation, eased);
          flip.setFromAxisAngle(flipAxis, (1 - progress) * Math.PI * 6);
          animation.mesh.quaternion.multiply(flip);
          const arc = Math.sin(progress * Math.PI);
          const bounce = Math.abs(Math.sin(progress * Math.PI * 8)) * (1 - eased) * template.radius * 0.16;
          animation.mesh.position.set(
            animation.start.x + (animation.targetX - animation.start.x) * eased,
            floorY + template.thickness / 2 + arc * template.radius * 2.2 + bounce,
            animation.start.z + (animation.targetZ - animation.start.z) * eased
          );
        }
        renderer.render(scene, camera);
        if (progress < 1) window.setTimeout(() => frame(performance.now()), 16);
        else resolve();
      };
      window.setTimeout(() => frame(performance.now()), 16);
    });

    for (const animation of animations) {
      animation.mesh.quaternion.copy(animation.targetRotation);
      animation.mesh.position.set(animation.targetX, floorY + template.thickness / 2, animation.targetZ);
    }
    renderer.render(scene, camera);
    return { canvas: renderer.domElement };
  }

  async function roll(stage, dice, options = {}) {
    if (!rendererState) rendererState = await createRenderer(stage);
    const { THREE, renderer, scene, camera, floorGeometry, floorMaterial } = rendererState;
    if (renderer.domElement.parentElement !== stage) stage.append(renderer.domElement);
    while (scene.children.some(child => child.userData.polyhedralFloor)) {
      const floor = scene.children.find(child => child.userData.polyhedralFloor);
      scene.remove(floor);
    }
    while (scene.children.some(child => child.userData.polyhedralDie)) {
      const die = scene.children.find(child => child.userData.polyhedralDie);
      scene.remove(die);
    }

    const aspect = Math.max(0.7, stage.clientWidth / Math.max(1, stage.clientHeight));
    const radii = dice.map(die => dieRadius(die.sides));
    const largestRadius = Math.max(...radii);
    const totalFootprint = radii.reduce((area, radius) => area + Math.PI * radius * radius, 0);
    const viewHeight = Math.max(D20_REFERENCE_RADIUS * 8.5, Math.sqrt(totalFootprint * 2.8 / aspect));
    const viewWidth = viewHeight * aspect;
    const halfWidth = viewWidth / 2;
    const halfDepth = viewHeight / 2;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfDepth;
    camera.bottom = -halfDepth;
    camera.far = Math.max(250, viewHeight * 3);
    const floorY = -largestRadius - 0.12;
    const lookAtY = floorY + largestRadius;
    camera.position.set(0, lookAtY + viewHeight * 0.58, lookAtY + viewHeight * 0.88);
    camera.lookAt(0, lookAtY, 0);
    camera.updateProjectionMatrix();
    const keyLight = scene.children.find(child => child.isDirectionalLight);
    keyLight.shadow.camera.left = -halfWidth;
    keyLight.shadow.camera.right = halfWidth;
    keyLight.shadow.camera.top = halfDepth;
    keyLight.shadow.camera.bottom = -halfDepth;
    keyLight.shadow.camera.far = Math.max(100, viewHeight * 3);
    keyLight.shadow.camera.updateProjectionMatrix();
    renderer.setSize(stage.clientWidth, stage.clientHeight, false);

    const restingPositions = new Array(dice.length);
    const placed = [];
    const placementOrder = dice.map((_, index) => index).sort((first, second) => radii[second] - radii[first]);
    for (const index of placementOrder) {
      const radius = radii[index];
      const maxX = halfWidth - radius;
      const maxZ = halfDepth - radius;
      let position = null;
      for (let attempt = 0; attempt < 300; attempt++) {
        const candidate = { x: (Math.random() * 2 - 1) * maxX, z: (Math.random() * 2 - 1) * maxZ };
        if (placed.every(other => Math.hypot(candidate.x - other.x, candidate.z - other.z) >= radius + other.radius + 0.08)) {
          position = candidate;
          break;
        }
      }
      if (!position) position = { x: (Math.random() * 2 - 1) * maxX, z: (Math.random() * 2 - 1) * maxZ };
      restingPositions[index] = position;
      placed.push({ ...position, radius });
    }

    const faceViewDirection = new THREE.Vector3(0, 0.55, 1).normalize();
    const templatePromises = new Map();
    const animations = await Promise.all(dice.map(async (die, index) => {
      if (!templatePromises.has(die.sides)) templatePromises.set(die.sides, createTemplate(THREE, die.sides));
      const template = await templatePromises.get(die.sides);
      const mesh = new THREE.Mesh(template.geometry, template.material);
      mesh.userData.polyhedralDie = true;
      template.faceDecorations.forEach(decoration => {
        mesh.add(decoration.clone());
      });
      mesh.add(new THREE.LineSegments(template.edgeGeometry, template.edgeMaterial));
      const radius = radii[index];
      const centerX = restingPositions[index].x;
      const centerZ = restingPositions[index].z;
      const centerY = floorY + radius;
      const startEdges = [
        { distance: centerX + halfWidth - radius, x: -halfWidth + radius, z: (Math.random() * 2 - 1) * (halfDepth - radius) },
        { distance: halfWidth + radius * -1 - centerX, x: halfWidth - radius, z: (Math.random() * 2 - 1) * (halfDepth - radius) },
        { distance: centerZ + halfDepth - radius, x: (Math.random() * 2 - 1) * (halfWidth - radius), z: -halfDepth + radius },
        { distance: halfDepth + radius * -1 - centerZ, x: (Math.random() * 2 - 1) * (halfWidth - radius), z: halfDepth - radius }
      ];
      const startEdge = startEdges.reduce((farthest, edge) => edge.distance > farthest.distance ? edge : farthest);
      const startX = startEdge.x;
      const startZ = startEdge.z;
      mesh.position.set(startX, centerY, startZ);
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      mesh.castShadow = true;
      scene.add(mesh);

      const faceIndex = die.value - 1;
      let targetUp = new THREE.Vector3(0, 1, 0).addScaledVector(faceViewDirection, -faceViewDirection.y).normalize();
      if (targetUp.lengthSq() < 0.001) targetUp.set(1, 0, 0);
      const targetRight = targetUp.clone().cross(faceViewDirection).normalize();
      targetUp = faceViewDirection.clone().cross(targetRight).normalize();
      const targetBasis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(targetRight, targetUp, faceViewDirection));
      const targetRotation = targetBasis.multiply(template.faceRotations[faceIndex].clone().invert());
      const startRotation = mesh.quaternion.clone();
      return {
        mesh, startX, startZ, centerX, centerY, centerZ, radius, startRotation, targetRotation,
        rollEuler: new THREE.Euler(),
        rollTurns: new THREE.Vector3(...Array.from({ length: 3 }, () => (2 + Math.floor(Math.random() * 4)) * (Math.random() < 0.5 ? -1 : 1))),
        index, template, faceIndex, critical: Boolean(die.critical)
      };
    }));
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.userData.polyhedralFloor = true;
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, floorY, 0);
    floor.receiveShadow = true;
    scene.add(floor);

    await new Promise(resolve => {
      const startedAt = performance.now();
      const duration = 1900 + Math.min(animations.length * 8, 700);
      const spin = new THREE.Quaternion();
      const frame = now => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - (1 - progress) ** 3;
        for (const animation of animations) {
          animation.mesh.quaternion.slerpQuaternions(animation.startRotation, animation.targetRotation, eased);
          animation.rollEuler.set(
            animation.rollTurns.x * (1 - eased) * Math.PI * 2,
            animation.rollTurns.y * (1 - eased) * Math.PI * 2,
            animation.rollTurns.z * (1 - eased) * Math.PI * 2
          );
          spin.setFromEuler(animation.rollEuler);
          animation.mesh.quaternion.multiply(spin);
          const phase = animation.index * 0.8;
          const arc = Math.sin(progress * Math.PI) * (1 - eased);
          animation.mesh.position.set(
            animation.startX + (animation.centerX - animation.startX) * eased + Math.cos(phase) * arc * animation.radius * 0.2,
            animation.centerY + Math.abs(Math.sin(progress * Math.PI * 6 + phase)) * (1 - eased) * animation.radius * 0.55,
            animation.startZ + (animation.centerZ - animation.startZ) * eased + Math.sin(phase) * arc * animation.radius * 0.2
          );
        }
        renderer.render(scene, camera);
        if (progress < 1) window.setTimeout(() => frame(performance.now()), 16);
        else resolve();
      };
      window.setTimeout(() => frame(performance.now()), 16);
    });
    for (const animation of animations) {
      animation.mesh.quaternion.copy(animation.targetRotation);
      animation.mesh.position.set(animation.centerX, animation.centerY, animation.centerZ);
    }
    const landedFaces = animations.map(animation => {
      const face = animation.template.faces[animation.faceIndex];
      const normal = animation.template.normals[animation.faceIndex];
      const points = face.map(vertex => vertex.clone().addScaledVector(normal, 0.018));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(vertex => vertex.toArray()), 3));
      const glow = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: animation.critical ? '#ffe48a' : style.die,
        transparent: true,
        opacity: 0.04,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3
      }));
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: animation.critical ? '#fff0ad' : style.die, transparent: true, opacity: 0.28 })
      );
      animation.mesh.add(glow, outline);
      return { glow: glow.material, outline: outline.material, critical: animation.critical };
    });
    renderer.render(scene, camera);
    await new Promise(resolve => {
      const startedAt = performance.now();
      const pulse = now => {
        const progress = Math.min(1, (now - startedAt) / 900);
        const intensity = 0.5 + 0.5 * Math.sin(progress * Math.PI * 4) * (1 - progress) + (1 - progress);
        for (const landed of landedFaces) {
          if (landed.critical) {
            landed.glow.opacity = 0.08 + intensity * 0.15;
            landed.outline.opacity = 0.42 + intensity * 0.5;
          } else {
            landed.glow.opacity = 0.04 * (1 - progress);
            landed.outline.opacity = 0.28;
          }
        }
        renderer.render(scene, camera);
        if (progress < 1) window.setTimeout(() => pulse(performance.now()), 16);
        else resolve();
      };
      window.setTimeout(() => pulse(performance.now()), 16);
    });
    renderer.render(scene, camera);
    return {
      canvas: renderer.domElement,
      faceCounts: dice.map(die => templates.get(die.sides).geometry.attributes.position.count / 3)
    };
  }

  function setStyle(nextStyle = {}) {
    for (const key of Object.keys(style)) {
      if (typeof nextStyle[key] === 'string' && /^#[0-9a-f]{6}$/i.test(nextStyle[key])) style[key] = nextStyle[key];
    }
    templates.forEach(template => template.material.color.set(style.die));
    if (rendererState) rendererState.floorMaterial.color.set(style.shadow);
    if (coinRendererState) coinRendererState.floorMaterial.color.set(style.shadow);
    return { ...style };
  }

  window.StonePlatePolyhedralDice = { roll, rollCoins, setStyle };
})();