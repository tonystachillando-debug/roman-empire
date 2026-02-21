import * as THREE from 'three';
import { GameEngine } from './Game.js';
import { AudioSynth } from './AudioSynth.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- Configuration ---
const MAP_SIZE = 100; // 100x100 grid cells
const CELL_PIXELS = 10; // Each cell is 10x10 pixels on the texture map
const TEXTURE_SIZE = MAP_SIZE * CELL_PIXELS;

// Colors mapping: 0=Empty(Fog), 1=Player, 101=Player Trail, 2=Enemy, 102=Enemy Trail
const COLORS = {
    0: { r: 154, g: 194, b: 120, hex: 0x9abe78 }, // Roman Grass / Tuff

    // Player
    1: { r: 192, g: 57, b: 43, hex: 0xc0392b },  // Roman Red
    101: { r: 231, g: 76, b: 60, hex: 0xe74c3c, alpha: 0.5 }, // Trail Red

    // Enemies
    2: { r: 41, g: 128, b: 185, hex: 0x2980b9 }, // Blue
    102: { r: 52, g: 152, b: 219, hex: 0x3498db, alpha: 0.5 }, // Trail Blue

    3: { r: 142, g: 68, b: 173, hex: 0x8e44ad }, // Purple
    103: { r: 155, g: 89, b: 182, hex: 0x9b59b6, alpha: 0.5 },

    4: { r: 39, g: 174, b: 96, hex: 0x27ae60 }, // Green
    104: { r: 46, g: 204, b: 113, hex: 0x2ecc71, alpha: 0.5 },

    5: { r: 211, g: 84, b: 0, hex: 0xd35400 }, // Orange
    105: { r: 230, g: 126, b: 34, hex: 0xe67e22, alpha: 0.5 },

    6: { r: 22, g: 160, b: 133, hex: 0x16a085 }, // Teal
    106: { r: 26, g: 188, b: 156, hex: 0x1abc9c, alpha: 0.5 },

    7: { r: 243, g: 156, b: 18, hex: 0xf39c12 }, // Yellow/Gold
    107: { r: 241, g: 196, b: 15, hex: 0xf1c40f, alpha: 0.5 },

    8: { r: 44, g: 62, b: 80, hex: 0x2c3e50 }, // Dark Navy
    108: { r: 52, g: 73, b: 94, hex: 0x34495e, alpha: 0.5 },

    9: { r: 192, g: 57, b: 160, hex: 0xc039a0 }, // Pink
    109: { r: 231, g: 76, b: 200, hex: 0xe74cc8, alpha: 0.5 },
};

let scene, camera, renderer, composer, ssaoPass;
let engine;
let gladiatorModelProto = null;
let textureCanvas, textureContext, mapTexture;
let baseMapImage;
let offscreenMapCanvas, offscreenMapContext;
let gladiatorMeshes = new Map();

// UI Elements
const uiOverlay = document.getElementById('overlay');
const victoryOverlay = document.getElementById('victory-overlay');
const btnStart = document.getElementById('btn-start');
const btnTutorial = document.getElementById('btn-tutorial');
const btnToggleHud = document.getElementById('btn-toggle-hud');
const rulesOverlay = document.getElementById('rules-overlay');
const btnRulesClose = document.getElementById('btn-rules-close');
const btnRestartVictory = document.getElementById('btn-restart-victory');
const hud = document.getElementById('hud');
const hudRight = document.getElementById('hud-right');
const scoreboardPanel = document.getElementById('scoreboard');
const centerPopup = document.getElementById('center-popup');
const popupIcon = document.getElementById('popup-icon');
const popupText = document.getElementById('popup-text');
const invCrown = document.getElementById('inv-crown');
const invCrownCount = document.getElementById('inv-crown-count');
const invSword = document.getElementById('inv-sword');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d', { willReadFrequently: true }) : null;
const sfx = new AudioSynth();

let popupTimeout;
const displayScores = new Map();

function showCenterPopup(icon, text) {
    if (!centerPopup) return;
    popupIcon.innerText = icon;
    popupText.innerText = text;
    centerPopup.style.display = 'flex';
    centerPopup.classList.remove('popup-anim');
    void centerPopup.offsetWidth; // trigger reflow
    centerPopup.classList.add('popup-anim');

    clearTimeout(popupTimeout);
    popupTimeout = setTimeout(() => {
        centerPopup.style.display = 'none';
        centerPopup.classList.remove('popup-anim');
    }, 2500);
}

function showFloatingMessage(text, color = "#ffffff") {
    const msg = document.createElement('div');
    msg.className = 'floating-message';
    msg.innerText = text;
    msg.style.color = color;
    document.body.appendChild(msg);

    // Trigger reflow for animation
    void msg.offsetWidth;
    msg.style.opacity = '1';
    msg.style.transform = 'translate(-50%, -50px)'; // move up a bit

    setTimeout(() => {
        msg.style.opacity = '0';
        msg.style.transform = 'translate(-50%, -80px)';
        setTimeout(() => msg.remove(), 500); // wait for fade out
    }, 2000); // stay on screen for 2s
}

// Input state
const keys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false, ' ': false };
let spacePressed = false;

let isGameRunning = false;
let isPaused = false;
let lastTime = 0;
let botTimers = new Map();

// Tutorial state hooks
let isTutorial = false;
let tutorialState = -1;
let tutEnemyId = 2;

const BOT_NAMES = [
    "Legio II", "Legio III", "Legio IV", "Legio V", "Auxilia Gaul", "Auxilia Brit",
    "Praetori", "Gladiator", "Centurion", "Barbarian", "Carthage", "Spartacus",
    "Maximus", "Commodus", "Hannibal", "Scipio", "Brutus", "Nero"
];
let playerNames = new Map();
playerNames.set(1, "Legio I (You)");
let lastLeaderboardUpdate = 0;

// Camera Zoom state (wider on mobile)
const baseZoom = window.innerWidth <= 768 ? 22.5 : 15;
let targetFrustumSize = baseZoom; // Closer macro view by default
let currentFrustumSize = baseZoom;

// Meshes
const powerupMeshes = new Map();
const projectileMeshes = new Map();

initThreeJS();

// --- Event Listeners ---
if (btnStart) {
    btnStart.addEventListener('click', () => {
        isTutorial = false;
        startGame();
    });
}
if (btnRestartVictory) {
    btnRestartVictory.addEventListener('click', () => {
        isTutorial = false;
        startGame();
    });
}

if (btnTutorial) {
    btnTutorial.addEventListener('click', () => {
        isTutorial = true;
        startGame();
    });
}
if (btnRulesClose) {
    btnRulesClose.addEventListener('click', () => {
        rulesOverlay.style.display = 'none';
        btnRulesClose.blur();
    });
}

if (btnToggleHud) {
    const handleToggle = (e) => {
        if (e && e.cancelable) e.preventDefault();
        if (scoreboardPanel.style.display === 'none') {
            scoreboardPanel.style.display = 'flex';
            btnToggleHud.style.opacity = '1';
        } else {
            scoreboardPanel.style.display = 'none';
            btnToggleHud.style.opacity = '0.5';
        }
    };
    btnToggleHud.addEventListener('click', handleToggle);
    btnToggleHud.addEventListener('touchstart', handleToggle, { passive: false });
}

// Pause Menu Buttons
const btnResume = document.getElementById('btn-resume');
const btnQuit = document.getElementById('btn-quit');

if (btnResume) {
    btnResume.addEventListener('click', () => {
        togglePause();
    });
}
if (btnQuit) {
    btnQuit.addEventListener('click', () => {
        // Quit to main menu
        isPaused = false;
        document.getElementById('pause-overlay').style.display = 'none';
        document.getElementById('pause-overlay').classList.remove('active');
        gameOver(null); // Force game over to return to menu
    });
}

function togglePause() {
    if (!isGameRunning) return;

    // Actually wait, returning to main menu destroys the game, let's fix
    // the UI cleanly.
    isPaused = !isPaused;
    const pauseOverlay = document.getElementById('pause-overlay');
    if (isPaused) {
        pauseOverlay.style.display = 'flex';
        // Add a tiny delay before adding active for CSS transition
        setTimeout(() => pauseOverlay.classList.add('active'), 10);
    } else {
        pauseOverlay.classList.remove('active');
        setTimeout(() => pauseOverlay.style.display = 'none', 300);
        // Reset lastTime so we don't get a huge dt spike when unpausing
        lastTime = performance.now();
    }
}

if (btnToggleHud) {
    btnToggleHud.addEventListener('click', () => {
        const scoreboard = document.getElementById('scoreboard');
        if (scoreboard.style.display === 'none') {
            scoreboard.style.display = 'flex';
            btnToggleHud.innerText = '👁️';
        } else {
            scoreboard.style.display = 'none';
            btnToggleHud.innerText = '🙈';
        }
    });
}

const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');

if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => { targetFrustumSize = Math.max(8, targetFrustumSize - 5); });
}
if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => { targetFrustumSize = Math.min(90, targetFrustumSize + 5); });
}

window.addEventListener('wheel', (e) => {
    if (!isGameRunning) return;
    // zoom by scrolling
    if (e.deltaY < 0) {
        targetFrustumSize = Math.max(8, targetFrustumSize - 3); // zoom in
    } else {
        targetFrustumSize = Math.min(90, targetFrustumSize + 3); // zoom out
    }
});

window.addEventListener('keydown', (e) => {
    if (keys.hasOwnProperty(e.key)) {
        keys[e.key] = true;
        // Prevent spacebar from scrolling or clicking focused buttons!
        if (e.key === ' ') {
            e.preventDefault();
        }
    }
});

window.addEventListener('keyup', (e) => {
    if (keys.hasOwnProperty(e.key)) {
        keys[e.key] = false;
        if (e.key === ' ') spacePressed = false;
    }
    if (e.key === 'Escape') {
        togglePause();
    }
});

window.addEventListener('resize', onWindowResize);

// Mobile Controls wiring
// Mobile Action Button
const btnAction = document.getElementById('btn-action');
if (btnAction) {
    const handleActionPress = (e) => {
        e.preventDefault();
        keys[' '] = true;
    };
    const handleActionRelease = (e) => {
        e.preventDefault();
        keys[' '] = false;
        spacePressed = false;
    };
    btnAction.addEventListener('touchstart', handleActionPress, { passive: false });
    btnAction.addEventListener('touchend', handleActionRelease, { passive: false });
    btnAction.addEventListener('mousedown', handleActionPress);
    btnAction.addEventListener('mouseup', handleActionRelease);
    btnAction.addEventListener('mouseleave', handleActionRelease);
}

// Virtual Joystick
const joystickZone = document.getElementById('joystick-zone');
const joystickKnob = document.getElementById('joystick-knob');
let joystickActive = false;
let joystickCenter = { x: 0, y: 0 };
const maxRadius = 35; // How far the knob can move

if (joystickZone && joystickKnob) {
    const handleJoyStart = (e) => {
        e.preventDefault();
        joystickActive = true;
        const rect = joystickZone.getBoundingClientRect();
        joystickCenter = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        joystickKnob.style.transition = 'none';
        handleJoyMove(e);
    };

    const handleJoyMove = (e) => {
        if (!joystickActive) return;
        e.preventDefault();

        let clientX, clientY;
        if (e.type.includes('touch')) {
            clientX = e.targetTouches[0].clientX;
            clientY = e.targetTouches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        let dx = clientX - joystickCenter.x;
        let dy = clientY - joystickCenter.y;

        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > maxRadius) {
            dx = (dx / distance) * maxRadius;
            dy = (dy / distance) * maxRadius;
        }

        joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

        // Reset movement keys
        keys.w = false; keys.s = false; keys.a = false; keys.d = false;

        // Apply movement if outside deadzone
        if (distance > 10) {
            const angle = Math.atan2(dy, dx);
            // -PI to PI
            // Angle mapping:
            // Right: -pi/4 to pi/4
            // Down: pi/4 to 3pi/4
            // Left: 3pi/4 to pi OR -pi to -3pi/4
            // Up: -3pi/4 to -pi/4

            if (angle > -Math.PI / 4 && angle <= Math.PI / 4) {
                keys.d = true;
            } else if (angle > Math.PI / 4 && angle <= 3 * Math.PI / 4) {
                keys.s = true;
            } else if (angle < -Math.PI / 4 && angle >= -3 * Math.PI / 4) {
                keys.w = true;
            } else {
                keys.a = true;
            }
        }
    };

    const handleJoyEnd = (e) => {
        e.preventDefault();
        joystickActive = false;
        joystickKnob.style.transition = 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        joystickKnob.style.transform = 'translate(-50%, -50%)';
        keys.w = false; keys.s = false; keys.a = false; keys.d = false;
    };

    joystickZone.addEventListener('touchstart', handleJoyStart, { passive: false });
    joystickZone.addEventListener('touchmove', handleJoyMove, { passive: false });
    joystickZone.addEventListener('touchend', handleJoyEnd, { passive: false });
    joystickZone.addEventListener('touchcancel', handleJoyEnd, { passive: false });

    // Mouse fallback
    joystickZone.addEventListener('mousedown', handleJoyStart);
    window.addEventListener('mousemove', handleJoyMove, { passive: false });
    window.addEventListener('mouseup', handleJoyEnd);
}

// --- Functions ---

function initThreeJS() {
    // Load 3D Asset asynchronously
    const loader = new GLTFLoader();
    loader.load('./models/gladiator.glb', (gltf) => {
        gladiatorModelProto = gltf.scene;

        // Compute bounding box and scale to be roughly 1.6 units tall
        const box = new THREE.Box3().setFromObject(gladiatorModelProto);
        const height = box.max.y - box.min.y;
        if (height > 0) {
            const scale = 1.6 / height;
            gladiatorModelProto.scale.set(scale, scale, scale);
            // Do NOT use bounding box X and Z center because asymmetrical meshes 
            // (like a sword sticking out) will offset the physical body from the tile center!
            // Assume the 3D AI generator centered the character mass at origin (0,0)
            gladiatorModelProto.position.set(0, -box.min.y * scale, 0);
        }

        gladiatorModelProto.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                    child.material.roughness = 0.5;
                }
            }
        });

        // Hot swap instantly if the game is already running or players exist!
        if (typeof engine !== 'undefined' && engine && engine.players) {
            for (const [id, p] of engine.players.entries()) {
                if (p.isAlive && gladiatorMeshes.has(id)) {
                    // Find their assigned color
                    const pMesh = gladiatorMeshes.get(id);
                    scene.remove(pMesh);
                    gladiatorMeshes.delete(id);

                    const hex = COLORS[id] ? COLORS[id].hex : (id === 1 ? COLORS[1].hex : 0xffffff);
                    createGladiator(id, hex);
                }
            }
        }
    });

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Bright Sky Blue
    // Push the fog way back and make it match the sky so the map fades beautifully into the horizon
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.008);

    // Camera setup (True Isometric view, MACRO ZOOM)
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.OrthographicCamera(
        currentFrustumSize * aspect / -2, currentFrustumSize * aspect / 2,
        currentFrustumSize / 2, currentFrustumSize / -2,
        -100, 1000 // allow negative near plane because isometric pulls camera back
    );

    // Isometric angle: Rotated 45deg on Y, looking down ~35deg on X
    camera.position.set(MAP_SIZE / 2 + 20, 20, MAP_SIZE / 2 + 20);
    camera.lookAt(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    // Actually, setting Rotation directly for perfect isometric:
    camera.rotation.order = 'YXZ';
    camera.rotation.y = -Math.PI / 4;
    camera.rotation.x = -Math.atan(1 / Math.sqrt(2));
    camera.rotation.z = 0;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows
    document.body.appendChild(renderer.domElement);

    // Post-Processing
    const renderScene = new RenderPass(scene, camera);
    ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
    ssaoPass.kernelRadius = 16;
    ssaoPass.minDistance = 0.005;
    ssaoPass.maxDistance = 0.1;

    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.6; // Only bloom bright colors
    bloomPass.strength = 0.8; // subtle
    bloomPass.radius = 0.5;

    composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(ssaoPass);
    composer.addPass(bloomPass);

    // Lighting - Bright Day
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    // Directional light from top-left isometric angle
    dirLight.position.set(20, 60, -20);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    dirLight.shadow.mapSize.width = 4096;
    dirLight.shadow.mapSize.height = 4096;
    scene.add(dirLight);

    createMap();
    createProps();
}

function updateCamera(playerMesh) {
    const targetX = playerMesh.position.x;
    const targetZ = playerMesh.position.z;

    // Fixed distance to maintain true isometric orthographic scale
    const offset = 30;
    const isoYOffset = 42.42; // offset * sqrt(2) roughly for isometric pitch

    // Smooth follow
    camera.position.x += ((targetX + offset) - camera.position.x) * 0.1;
    camera.position.y += ((isoYOffset) - camera.position.y) * 0.1;
    camera.position.z += ((targetZ + offset) - camera.position.z) * 0.1;

    // Always look at the player's actual coordinate to keep perfectly centered
    camera.lookAt(camera.position.x - offset, 0, camera.position.z - offset);
}

function createMap() {
    // 1. Create permanent background environment on offscreen canvas
    offscreenMapCanvas = document.createElement('canvas');
    offscreenMapCanvas.width = TEXTURE_SIZE;
    offscreenMapCanvas.height = TEXTURE_SIZE;
    offscreenMapContext = offscreenMapCanvas.getContext('2d', { willReadFrequently: true });

    // Fill with base grass
    offscreenMapContext.fillStyle = `rgb(${COLORS[0].r}, ${COLORS[0].g}, ${COLORS[0].b})`;
    offscreenMapContext.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

    // Draw organic dirt paths
    offscreenMapContext.fillStyle = '#8c7b64'; // Dirt color
    for (let paths = 0; paths < 25; paths++) {
        let x = Math.random() * TEXTURE_SIZE;
        let y = Math.random() * TEXTURE_SIZE;
        let radius = Math.random() * 15 + 10;
        let length = Math.random() * 150 + 50;

        offscreenMapContext.beginPath();
        for (let step = 0; step < length; step++) {
            offscreenMapContext.arc(x, y, radius, 0, Math.PI * 2);
            offscreenMapContext.fill();
            x += (Math.random() - 0.5) * 30;
            y += (Math.random() - 0.5) * 30;
            radius = Math.max(8, Math.min(30, radius + (Math.random() - 0.5) * 4));
        }
    }

    // Draw straight Roman roads
    offscreenMapContext.fillStyle = '#7f8c8d'; // Stone gray
    for (let roads = 0; roads < 7; roads++) {
        let isHoriz = Math.random() > 0.5;
        let roadWidth = Math.random() * 20 + 10;
        if (isHoriz) {
            let ry = Math.random() * TEXTURE_SIZE;
            offscreenMapContext.fillRect(0, ry, TEXTURE_SIZE, roadWidth);
        } else {
            let rx = Math.random() * TEXTURE_SIZE;
            offscreenMapContext.fillRect(rx, 0, roadWidth, TEXTURE_SIZE);
        }
    }

    // Add noise over everything for texture
    const imgData = offscreenMapContext.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        let noise = (Math.random() - 0.5) * 20;
        data[i] = Math.min(255, Math.max(0, data[i] + noise));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }
    offscreenMapContext.putImageData(imgData, 0, 0);

    // 2. Create the active texture canvas
    textureCanvas = document.createElement('canvas');
    textureCanvas.width = TEXTURE_SIZE;
    textureCanvas.height = TEXTURE_SIZE;
    textureContext = textureCanvas.getContext('2d', { willReadFrequently: true });

    // Copy the permanent background to the active texture canvas
    textureContext.drawImage(offscreenMapCanvas, 0, 0);

    // 2. Wrap it in a Three.js CanvasTexture
    mapTexture = new THREE.CanvasTexture(textureCanvas);
    mapTexture.magFilter = THREE.NearestFilter; // keep pixels crispy
    mapTexture.minFilter = THREE.NearestFilter;

    // 3. Create the thick map block
    const mapDepth = 4;
    const boxGeo = new THREE.BoxGeometry(MAP_SIZE, mapDepth, MAP_SIZE);

    // The top face is at y = mapDepth/2 in a normal box.
    // We want the top face to literally be at y = 0.
    // So we translate the box down by mapDepth/2.
    // We also map the top-left corner to match our grid logic by translating MAP_SIZE/2 on X and Z.
    boxGeo.translate(MAP_SIZE / 2, -mapDepth / 2, MAP_SIZE / 2);

    const topMat = new THREE.MeshStandardMaterial({
        map: mapTexture,
        roughness: 0.8,
        metalness: 0.1
    });

    const sideMat = new THREE.MeshStandardMaterial({
        color: 0x5c4033, // Earth / Dirt brown
        roughness: 1.0
    });

    const materials = [
        sideMat, // right
        sideMat, // left
        topMat,  // top
        sideMat, // bottom
        sideMat, // front
        sideMat  // back
    ];

    const ground = new THREE.Mesh(boxGeo, materials);
    ground.receiveShadow = true;
    ground.castShadow = true; // Cast shadows down into the ocean!
    scene.add(ground);

    // Infinite Ocean Background - Solid Celeste Plane
    const oceanGeo = new THREE.PlaneGeometry(3000, 3000);
    const oceanMat = new THREE.MeshStandardMaterial({
        color: 0x3498db, // Solid "celeste" (light blue)
        roughness: 0.2,
        metalness: 0.1
    });

    const oceanPlane = new THREE.Mesh(oceanGeo, oceanMat);
    oceanPlane.rotation.x = -Math.PI / 2;
    // Lowered slightly below the map's floating depth so the roots of the world show
    oceanPlane.position.set(MAP_SIZE / 2, -mapDepth + 0.5, MAP_SIZE / 2);
    oceanPlane.receiveShadow = true;
    scene.add(oceanPlane);
}

function createProps() {
    const propGroup = new THREE.Group();

    // Marble Material for pillars
    const marbleMat = new THREE.MeshStandardMaterial({ color: 0xecf0f1, roughness: 0.9 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 1.0 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x27ae60, roughness: 0.8 });
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x795548, roughness: 1.0 });

    const numProps = 200;

    // Procedural generation across the map
    for (let i = 0; i < numProps; i++) {
        const px = Math.random() * MAP_SIZE;
        const pz = Math.random() * MAP_SIZE;

        const type = Math.random();

        let mesh;
        if (type < 0.4) {
            // Pine Tree (Cypress style)
            const trunkGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.5);
            const foliageGeo = new THREE.ConeGeometry(0.4, 2.0, 8);
            const m = new THREE.Group();

            const trunk = new THREE.Mesh(trunkGeo, woodMat);
            trunk.position.y = 0.25;
            trunk.castShadow = true;
            trunk.receiveShadow = true;
            m.add(trunk);

            const foliage = new THREE.Mesh(foliageGeo, leafMat);
            foliage.position.y = 1.25;
            foliage.castShadow = true;
            foliage.receiveShadow = true;
            m.add(foliage);
            mesh = m;
        } else if (type < 0.7) {
            // Roman Column (Broken or Full)
            const isBroken = Math.random() > 0.5;
            const h = isBroken ? (Math.random() * 1.5 + 0.5) : 2.5;

            const colGeo = new THREE.CylinderGeometry(0.2, 0.2, h, 8);
            const baseGeo = new THREE.BoxGeometry(0.5, 0.2, 0.5);

            const m = new THREE.Group();
            const col = new THREE.Mesh(colGeo, marbleMat);
            col.position.y = h / 2 + 0.2;
            col.castShadow = true;
            col.receiveShadow = true;
            m.add(col);

            const base = new THREE.Mesh(baseGeo, marbleMat);
            base.position.y = 0.1;
            base.castShadow = true;
            base.receiveShadow = true;
            m.add(base);

            if (!isBroken) { // Top capital
                const top = new THREE.Mesh(baseGeo, marbleMat);
                top.position.y = h + 0.3;
                top.castShadow = true;
                top.receiveShadow = true;
                m.add(top);
            }
            mesh = m;
        } else if (type < 0.85) {
            // Random Rock / Ruins block
            const w = Math.random() * 0.8 + 0.2;
            const h = Math.random() * 0.6 + 0.2;
            const d = Math.random() * 0.8 + 0.2;
            const rockGeo = new THREE.BoxGeometry(w, h, d);
            const m = new THREE.Group();
            const rock = new THREE.Mesh(rockGeo, Math.random() > 0.5 ? marbleMat : dirtMat);
            rock.position.y = h / 2;
            rock.rotation.y = Math.random() * Math.PI;
            rock.castShadow = true;
            rock.receiveShadow = true;
            m.add(rock);
            mesh = m;
        } else {
            // Small bush/shrub
            const shrubGeo = new THREE.SphereGeometry(Math.random() * 0.3 + 0.2, 8, 8);
            const m = new THREE.Mesh(shrubGeo, leafMat);
            m.position.y = 0.2;
            m.castShadow = true;
            m.receiveShadow = true;
            mesh = m;
        }

        mesh.position.set(px, 0, pz);
        // Make sure it's placed exactly on the ground plane (0 y)
        propGroup.add(mesh);
    }

    scene.add(propGroup);
}

function createGladiator(id, colorHex) {
    const group = new THREE.Group();

    // 5. Team identifier Ring
    const ringGeo = new THREE.RingGeometry(0.5, 0.7, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);

    if (gladiatorModelProto) {
        // Use the actual 3D model!
        const model = gladiatorModelProto.clone();
        // Give it a name so we know not to animate primitive arms
        model.name = 'real3DModel';
        group.add(model);

        // Add a colored point light to tint the model with team color since the texture is baked
        const teamLight = new THREE.PointLight(colorHex, 0.7, 3);
        teamLight.position.set(0, 2.0, 0);
        group.add(teamLight);
    } else {
        // Fallback to primitive generation
        const armorMat = new THREE.MeshStandardMaterial({ color: 0x7f8c8d, metalness: 0.6, roughness: 0.4 });
        const teamMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6 });
        const skinMat = new THREE.MeshStandardMaterial({ color: 0xd2b48c });
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 });
        const ironMat = new THREE.MeshStandardMaterial({ color: 0xbdc3c7, metalness: 0.9, roughness: 0.2 });
        const goldMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, metalness: 0.8, roughness: 0.3 });

        const torsoGeo = new THREE.CylinderGeometry(0.3, 0.25, 0.7, 8);
        const torso = new THREE.Mesh(torsoGeo, armorMat);
        torso.position.y = 0.85; torso.castShadow = true;
        group.add(torso);

        const skirtGeo = new THREE.ConeGeometry(0.32, 0.4, 8);
        const skirt = new THREE.Mesh(skirtGeo, teamMat);
        skirt.position.y = 0.4; skirt.castShadow = true;
        group.add(skirt);

        const headGroup = new THREE.Group();
        headGroup.position.set(0, 1.35, 0);
        const face = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), skinMat); face.castShadow = true; headGroup.add(face);
        const helm = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), armorMat); helm.castShadow = true; headGroup.add(helm);
        const crest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.5), teamMat); crest.position.y = 0.3; crest.castShadow = true; headGroup.add(crest);
        group.add(headGroup);

        const armGeo = new THREE.CylinderGeometry(0.08, 0.06, 0.5);
        const armR = new THREE.Mesh(armGeo, skinMat);
        armR.name = 'armR'; armR.position.set(0.4, 0.8, 0); armR.rotation.z = -Math.PI / 6; armR.castShadow = true;

        const swordGroup = new THREE.Group();
        swordGroup.position.set(0.55, 0.6, 0.3); swordGroup.rotation.x = Math.PI / 2;
        swordGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.15), woodMat));
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.02), ironMat); blade.position.y = 0.35; swordGroup.add(blade);
        group.add(armR); group.add(swordGroup);

        const armL = new THREE.Mesh(armGeo, skinMat);
        armL.name = 'armL'; armL.position.set(-0.4, 0.8, 0.1); armL.rotation.z = Math.PI / 6; armL.rotation.x = -Math.PI / 4; armL.castShadow = true;
        const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 16, 1, false, 0, Math.PI), teamMat);
        shield.position.set(-0.35, 0.7, 0.3); shield.rotation.y = -Math.PI / 2; shield.castShadow = true;
        const boss = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), ironMat); boss.position.set(0, 0, 0.3); shield.add(boss);
        group.add(armL); group.add(shield);
    }

    // Scale down a bit to match the 1x1 grid cell nicely
    group.scale.set(0.6, 0.6, 0.6);

    scene.add(group);
    gladiatorMeshes.set(id, group);

    return group;
}

function startGame() {
    uiOverlay.classList.remove('active');
    if (victoryOverlay) victoryOverlay.classList.remove('active');
    hud.style.display = 'flex'; // Changed from 'block' due to flex layout
    if (hudRight) hudRight.style.display = 'block';
    if (centerPopup) centerPopup.style.display = 'none';

    if (isTutorial) {
        document.getElementById('tutorial-overlay').style.display = 'flex';
        document.getElementById('tutorial-overlay').classList.add('active');
        tutorialState = 0;
        updateTutorialUI();
    } else {
        document.getElementById('tutorial-overlay').style.display = 'none';
        document.getElementById('tutorial-overlay').classList.remove('active');
        tutorialState = -1;
    }

    // Blur the button so pressing space later doesn't click it again
    btnStart.blur();

    // Reset Engine
    engine = new GameEngine(MAP_SIZE, MAP_SIZE);

    // Repaint the base grass canvas from the generated offscreen map
    textureContext.drawImage(offscreenMapCanvas, 0, 0);
    mapTexture.needsUpdate = true;

    // Clear existing meshes
    for (const mesh of gladiatorMeshes.values()) {
        scene.remove(mesh);
    }
    gladiatorMeshes.clear();
    botTimers.clear();

    // Hook up engine events
    engine.onCellsUpdated = (updates) => {
        let playerCaptured = false;
        // Draw to 2D canvas texture
        for (const u of updates) {
            if (u.val === 1) playerCaptured = true;
            const px = u.x * CELL_PIXELS;
            // Texture canvas Y goes down. Our grid Y goes up/down depending on mapping.
            // PlaneGeometry maps top-left of image to top-left of plane(X:- Y:+) by default if we don't flip.
            // But we mapped 0,0 to corner.
            const py = (MAP_SIZE - 1 - u.y) * CELL_PIXELS; // Flip Y for Three.js plane mapping

            const c = COLORS[u.val];
            if (!c || u.val === 0) {
                // If empty, restore the background environment map
                textureContext.drawImage(offscreenMapCanvas, px, py, CELL_PIXELS, CELL_PIXELS, px, py, CELL_PIXELS, CELL_PIXELS);
                continue;
            }

            if (c.alpha) {
                // Trail: Environment underneath, then solid bright color
                textureContext.drawImage(offscreenMapCanvas, px, py, CELL_PIXELS, CELL_PIXELS, px, py, CELL_PIXELS, CELL_PIXELS);

                textureContext.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, 0.8)`;
                textureContext.fillRect(px, py, CELL_PIXELS, CELL_PIXELS);
                textureContext.fillStyle = 'rgba(255,255,255,0.4)';
                textureContext.fillRect(px + 2, py + 2, CELL_PIXELS - 4, CELL_PIXELS - 4);
            } else {
                // OWNED: Solid territory color on the grass!
                textureContext.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
                textureContext.fillRect(px, py, CELL_PIXELS, CELL_PIXELS);

                // Optional: draw thin solid border
                textureContext.strokeStyle = 'rgba(255,255,255,0.2)';
                textureContext.lineWidth = 1;
                textureContext.strokeRect(px + 1, py + 1, CELL_PIXELS - 2, CELL_PIXELS - 2);
            }
        }
        mapTexture.needsUpdate = true;
        if (playerCaptured) sfx.playCapture();
    };

    engine.onTerritoryCaptured = (pid, count) => {
        if (pid === 1) {
            let message = "";
            let color = "#ffffff";
            if (count > 30) {
                message = `AVE CAESAR! (+${count})`;
                color = "#f1c40f"; // Gold
            } else if (count >= 20) {
                message = `AMAZING WORK (+${count})`;
                color = "#3498db"; // Blue
            } else if (count >= 10) {
                message = `WELL DONE PRAETORIAN (+${count})`;
                color = "#2ecc71"; // Green
            }

            if (message) {
                showFloatingMessage(message, color);
            }
        }
    };

    function createExplosion(position, colorHex, particleCount = 20) {
        const material = new THREE.MeshStandardMaterial({
            color: colorHex,
            emissive: colorHex,
            emissiveIntensity: 0.8
        });
        const particleGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);

        for (let i = 0; i < particleCount; i++) {
            const particle = new THREE.Mesh(particleGeo, material);
            particle.position.copy(position);

            // Random explosion velocity (burst outward and up)
            particle.userData.velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 10,
                (Math.random() * 8) + 4,
                (Math.random() - 0.5) * 10
            );
            // Random spin
            particle.userData.rotationSpeed = new THREE.Vector3(
                (Math.random() - 0.5) * 0.4,
                (Math.random() - 0.5) * 0.4,
                (Math.random() - 0.5) * 0.4
            );

            scene.add(particle);

            // Simple physics loop for particle
            const animateParticle = () => {
                if (particle.position.y < -1) {
                    scene.remove(particle);
                    return;
                }
                particle.position.addScaledVector(particle.userData.velocity, 0.016);
                particle.userData.velocity.y -= 15 * 0.016; // Gravity

                particle.rotation.x += particle.userData.rotationSpeed.x;
                particle.rotation.y += particle.userData.rotationSpeed.y;
                particle.rotation.z += particle.userData.rotationSpeed.z;

                // Shrink over time
                particle.scale.multiplyScalar(0.95);

                requestAnimationFrame(animateParticle);
            };
            animateParticle();
        }
    }

    engine.onPlayerDied = (pid) => {
        if (pid === 1) sfx.playDeath();
        const mesh = gladiatorMeshes.get(pid);
        if (mesh) {
            // Create blood/team-color explosion where they died
            createExplosion(mesh.position, COLORS[pid].hex, 30);
            scene.remove(mesh);
            gladiatorMeshes.delete(pid);
        }

        if (pid === 1 && !isTutorial) { // Player died, only show Game Over if not in tutorial
            gameOver();
        }
    };

    engine.onExtraLifeUsed = (pid, livesLeft) => {
        if (pid === 1) {
            if (invCrownCount) invCrownCount.innerText = livesLeft.toString();
            if (livesLeft === 0) {
                if (invCrown) invCrown.style.display = 'none';
            }
        }
    };

    engine.onPowerupSpawned = (p) => {
        let mesh;
        if (p.type === 'crown') {
            mesh = new THREE.Group();

            // Base ring
            const ringGeo = new THREE.TorusGeometry(0.3, 0.05, 8, 24);
            const ringMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, metalness: 0.6, roughness: 0.4 }); // Gold base
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI / 2;
            ring.castShadow = true;
            mesh.add(ring);

            // Add some "leaves"
            const leafGeo = new THREE.ConeGeometry(0.08, 0.2, 4);
            const leafMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.2 }); // Shiny Gold
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                const leaf = new THREE.Mesh(leafGeo, leafMat);
                leaf.position.set(Math.cos(angle) * 0.3, 0, Math.sin(angle) * 0.3);
                // Rotate leaf to point slightly outward and along the curve
                leaf.rotation.y = -angle + Math.PI / 2;
                leaf.rotation.x = Math.PI / 8;
                leaf.castShadow = true;
                mesh.add(leaf);
            }
            // Make crowns larger and more visible
            mesh.scale.set(1.5, 1.5, 1.5);
            // Move it slightly up to account for scaling
            mesh.position.y += 0.2;
        } else {
            // Sword (Gladius) shape
            mesh = new THREE.Group();
            const silver = new THREE.MeshStandardMaterial({ color: 0xbdc3c7, metalness: 0.9, roughness: 0.1 });
            const darkWood = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.8 });
            const gold = new THREE.MeshStandardMaterial({ color: 0xf1c40f, metalness: 0.8, roughness: 0.2 });

            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.2), silver);
            blade.position.y = 0.4;
            blade.castShadow = true;
            mesh.add(blade);

            const guard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.25), darkWood);
            guard.castShadow = true;
            mesh.add(guard);

            const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2), darkWood);
            handle.position.y = -0.15;
            handle.castShadow = true;
            mesh.add(handle);

            const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.08), gold);
            pommel.position.y = -0.3;
            pommel.castShadow = true;
            mesh.add(pommel);

            // Initial angle so it looks good when spinning
            mesh.rotation.z = Math.PI / 4;
        }

        mesh.position.set(p.x - MAP_SIZE / 2 + 0.5, 0.5, p.y - MAP_SIZE / 2 + 0.5);
        scene.add(mesh);
        powerupMeshes.set(p.id, mesh);
    };

    engine.onPowerupCollected = (pId, playerId, puType) => {
        const mesh = powerupMeshes.get(pId);
        if (mesh) {
            scene.remove(mesh);
            powerupMeshes.delete(pId);
        }

        if (playerId === 1) {
            const p = engine.players.get(1);
            if (p) {
                if (puType === 'sword') {
                    const attackMsg = window.innerWidth <= 768 ? '[PRESS ⚔️ TO ATTACK]' : '[SPACE BAR TO ATTACK]';
                    showCenterPopup('⚔️', attackMsg);
                    if (invSword) invSword.style.display = 'flex';
                } else if (puType === 'crown') {
                    showCenterPopup('👑', "YOU'RE THE KING!");
                    if (invCrown) invCrown.style.display = 'flex';
                }

                if (p.extraLives > 0) {
                    if (invCrownCount) invCrownCount.innerText = p.extraLives.toString();
                }
            }
        }
    };

    engine.onProjectileSpawned = (proj) => {
        if (proj.ownerId === 1) sfx.playSword();
        const mesh = new THREE.Group();
        const silver = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbdc3c7, metalness: 1.0 });

        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.2), silver);
        blade.position.y = 0.4;
        mesh.add(blade);

        const gold = new THREE.MeshStandardMaterial({ color: 0xf1c40f, emissive: 0xbdc3c7, metalness: 1.0, roughness: 0.2 });
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.25), gold);
        mesh.add(guard);

        mesh.position.set(proj.x - MAP_SIZE / 2 + 0.5, 0.5, proj.y - MAP_SIZE / 2 + 0.5);
        // Face moving direction initially
        if (proj.dirX === 1) mesh.rotation.z = -Math.PI / 2;
        else if (proj.dirX === -1) mesh.rotation.z = Math.PI / 2;
        else if (proj.dirY === 1) mesh.rotation.x = -Math.PI / 2;
        else if (proj.dirY === -1) mesh.rotation.x = Math.PI / 2;

        // Save initial rotation axis for clean tumbling
        mesh.userData.axis = new THREE.Vector3(proj.dirY, 0, proj.dirX).normalize();

        scene.add(mesh);
        projectileMeshes.set(proj.id, mesh);
    };

    engine.onProjectileRemoved = (projId) => {
        const mesh = projectileMeshes.get(projId);
        if (mesh) {
            // Shatter Effect
            const silver = new THREE.MeshStandardMaterial({ color: 0xbdc3c7, emissive: 0xbdc3c7, emissiveIntensity: 0.5 });
            const particleGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);

            for (let i = 0; i < 8; i++) {
                const particle = new THREE.Mesh(particleGeo, silver);
                particle.position.copy(mesh.position);

                // Random explosion velocity
                particle.userData.velocity = new THREE.Vector3(
                    (Math.random() - 0.5) * 5,
                    (Math.random() * 5) + 2,
                    (Math.random() - 0.5) * 5
                );
                // Random spin
                particle.userData.rotationSpeed = new THREE.Vector3(
                    Math.random() * 0.2, Math.random() * 0.2, Math.random() * 0.2
                );

                scene.add(particle);

                // Animate particles down with gravity
                const animateParticle = () => {
                    if (particle.position.y < -1) {
                        scene.remove(particle);
                        return;
                    }
                    particle.position.addScaledVector(particle.userData.velocity, 0.016);
                    particle.userData.velocity.y -= 9.8 * 0.016; // Gravity

                    particle.rotation.x += particle.userData.rotationSpeed.x;
                    particle.rotation.y += particle.userData.rotationSpeed.y;
                    particle.rotation.z += particle.userData.rotationSpeed.z;

                    requestAnimationFrame(animateParticle);
                };
                animateParticle();
            }

            scene.remove(mesh);
            projectileMeshes.delete(projId);
        }
    };

    engine.onGameOver = (winnerId) => {
        // In tutorial, we never want a Game Over. The player instantly respawns.
        if (isTutorial) return;

        if (winnerId === 1) {
            showVictoryScreen();
        } else {
            gameOver(winnerId);
        }
    };

    const spawnPoints = [];

    // Add Player (ID=1)
    const pStartX = Math.random() * (MAP_SIZE - 20) + 10;
    const pStartY = Math.random() * (MAP_SIZE - 20) + 10;
    spawnPoints.push({ x: pStartX, y: pStartY });
    engine.addPlayer(1, pStartX, pStartY, 'red');
    createGladiator(1, COLORS[1].hex);

    // Reset Inventory UI
    if (invCrown) invCrown.style.display = 'none';
    if (invSword) invSword.style.display = 'none';

    // Spawn 15 NPCs procedurally with random names and colors
    if (!isTutorial) {
        const numEnemies = 15;
        for (let i = 2; i <= numEnemies + 1; i++) {
            const hue = Math.random();
            const color = new THREE.Color().setHSL(hue, 0.8, 0.4);
            const r = Math.floor(color.r * 255);
            const g = Math.floor(color.g * 255);
            const b = Math.floor(color.b * 255);
            const hex = (r << 16) | (g << 8) | b;

            let sx, sy;
            let valid = false;
            let attempts = 0;

            // Find a safe spawn distance
            while (!valid && attempts < 200) {
                sx = Math.random() * (MAP_SIZE - 20) + 10;
                sy = Math.random() * (MAP_SIZE - 20) + 10;
                valid = true;
                for (const pt of spawnPoints) {
                    const dist = Math.sqrt((sx - pt.x) ** 2 + (sy - pt.y) ** 2);
                    if (dist < 15) { // Guarantee a huge 15-tile safe zone radius to grow in
                        valid = false;
                        break;
                    }
                }
                attempts++;
            }
            spawnPoints.push({ x: sx, y: sy });

            spawnEnemy(i, sx, sy, r, g, b, hex);
        }
    }

    isGameRunning = true;
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

function spawnEnemy(id, x, y, r, g, b, hex) {
    if (!COLORS[id]) COLORS[id] = { r, g, b, hex };

    // Whiten trail
    const tr = Math.min(255, r + 40);
    const tg = Math.min(255, g + 40);
    const tb = Math.min(255, b + 40);
    const trailHex = (tr << 16) | (tg << 8) | tb;
    if (!COLORS[100 + id]) COLORS[100 + id] = { r: tr, g: tg, b: tb, hex: trailHex, alpha: 0.5 };

    engine.addPlayer(id, x, y, hex);
    createGladiator(id, hex);

    // Assign random unused name
    let n = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    playerNames.set(id, n + " #" + id);

    botTimers.set(id, 0);
}

function updateBotAI(id) {
    if (!isGameRunning || !engine.players.has(id)) return;
    const p = engine.players.get(id);
    if (!p.isAlive) return;

    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];

    // Helper to evaluate a cell safely
    const getCell = (gx, gy) => {
        if (gx < 0 || gx >= MAP_SIZE || gy < 0 || gy >= MAP_SIZE) return -1; // Wall
        return engine.grid[gy * MAP_SIZE + gx];
    };

    // Evaluate safe directions (don't reverse, don't hit own trail, don't hit wall immediately)
    let safeDirs = dirs.filter(d => {
        if (p.dirX === -d[0] && p.dirY === -d[1] && (d[0] !== 0 || d[1] !== 0)) return false;

        // Look 1, 2, and 3 cells ahead to be safe from instant death at higher speed
        const nx1 = Math.floor(p.x + d[0]);
        const ny1 = Math.floor(p.y + d[1]);
        const nx2 = Math.floor(p.x + d[0] * 2.0);
        const ny2 = Math.floor(p.y + d[1] * 2.0);
        const nx3 = Math.floor(p.x + d[0] * 3.0);
        const ny3 = Math.floor(p.y + d[1] * 3.0);

        const val1 = getCell(nx1, ny1);
        const val2 = getCell(nx2, ny2);
        const val3 = getCell(nx3, ny3);

        if (val1 === -1 || val2 === -1 || val3 === -1) return false; // Wall imminent
        if (val1 === p.id + 100 || val2 === p.id + 100 || val3 === p.id + 100) return false; // Own trail imminent

        return true;
    });

    if (safeDirs.length === 0) safeDirs = dirs; // Desperation (usually rip)

    // Current Status
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const currVal = getCell(px, py);
    const isOut = (currVal !== p.id);

    // --- PRO AI STATE MACHINE ---
    let chosenDir = safeDirs[Math.floor(Math.random() * safeDirs.length)];
    let bestScore = -Infinity;

    // 1. If currently inside territory, decide where to strike or hunt
    if (!isOut) {
        // Evaluate all safe directions to find the best launch point
        for (let d of safeDirs) {
            let score = 0;
            // Prefer keeping momentum occasionally to cleanly exit
            if (d[0] === p.dirX && d[1] === p.dirY) score += 5;

            // Look far ahead: is there a vulnerable player trail nearby?
            for (let dist = 1; dist < 12; dist++) {
                const tx = px + d[0] * dist;
                const ty = py + d[1] * dist;
                const lookVal = getCell(tx, ty);
                if (lookVal > 100 && lookVal !== p.id + 100) {
                    // Enemy trail spotted! HIGH PRIORITY HUNT!
                    score += 1000 / dist; // Closer is better
                }
                // Try to expand into empty territory
                if (lookVal === 0) {
                    score += 2;
                }
                // Try to expand into ENEMY territory ONLY if we are big enough
                else if (lookVal > 0 && lookVal <= 100 && lookVal !== p.id) {
                    const enemyP = engine.players.get(lookVal);
                    if (enemyP) {
                        const myScore = (p.score * 10) + (p.kills * 1000);
                        const enemyScore = (enemyP.score * 10) + (enemyP.kills * 1000);
                        if (myScore > enemyScore) {
                            score += 5; // Tasty weak enemy
                        } else {
                            score -= 100; // DO NOT ENTER, SUICIDE!
                        }
                    }
                }
            }
            if (score > bestScore) {
                bestScore = score;
                chosenDir = d;
            }
        }
    }
    // 2. If currently outside (vulnerable), balance drawing vs fleeing vs hunting
    // 2. If currently outside (vulnerable), balance drawing vs fleeing vs hunting
    else {
        let isHunting = false;
        for (let d of safeDirs) {
            let score = 0;

            // Keep drawing lines unless we need to turn
            if (d[0] === p.dirX && d[1] === p.dirY) score += 10;

            // Danger evaluation: is an enemy nearby? 
            let enemyNear = false;
            for (const [eId, enemy] of engine.players) {
                if (eId !== p.id && enemy.isAlive) {
                    const distToEnemy = Math.abs(px - enemy.x) + Math.abs(py - enemy.y);
                    if (distToEnemy < 12) { // Increased distance to 12 for 8.0 speed
                        enemyNear = true;
                        // Avoid them if we are out!
                        const distIfMove = Math.abs((px + d[0]) - enemy.x) + Math.abs((py + d[1]) - enemy.y);
                        if (distIfMove < distToEnemy) {
                            score -= 300; // RUN AWAY MUCH FASTER!
                        }
                    }
                }
            }

            // Look ahead for opportunities / path closing
            for (let dist = 1; dist < 12; dist++) { // Look ahead 12 cells instead of 8
                const tx = px + d[0] * dist;
                const ty = py + d[1] * dist;
                const lookVal = getCell(tx, ty);

                // If we see an enemy trail, try to cut it!
                if (lookVal > 100 && lookVal !== p.id + 100) {
                    let huntBonus = 600 / dist;
                    if (lookVal === 101) huntBonus = 1200 / dist; // Aggressively hunt the player!
                    score += huntBonus;
                    isHunting = true;
                }

                // If we see our own territory, and our trail is getting long, go home!
                // CHANGED: Bots are much more conservative now, returning at 12 instead of 20
                if (lookVal === p.id && (p.currentTrail.length > 12 || enemyNear)) {
                    score += 500 / dist;
                }

                // Slight penalty for running into other people's solid territory as it slows you down
                if (lookVal > 0 && lookVal <= 100 && lookVal !== p.id) {
                    score -= 10;
                }
            }

            // Target Powerups
            for (const pu of engine.powerups) {
                const distToPu = Math.abs((px + d[0]) - pu.x) + Math.abs((py + d[1]) - pu.y);
                if (distToPu < 10) {
                    score += 50 / (distToPu + 1); // Lure them to items
                }
            }

            // Hard limit: If trail is getting long, force return home
            // CHANGED: 25 instead of 45
            if (p.currentTrail.length > 20 && !isHunting) {
                if (p.currentTrail.length > 0) {
                    const origin = p.currentTrail[0];
                    const distToOrigin = Math.abs((px + d[0]) - origin.x) + Math.abs((py + d[1]) - origin.y);
                    score -= distToOrigin * 10; // Heavily penalize moving away from home
                }
            }

            // Close loops to make chunks
            // CHANGED: Start closing at 12 length
            if (p.currentTrail.length > 12 && Math.random() < 0.6 && !isHunting) {
                // Try to hook back towards home loosely
                const hx = p.currentTrail[0].x;
                const hy = p.currentTrail[0].y;
                const dx = px - hx;
                const dy = py - hy;
                // Choose direction that minimizes difference
                if (Math.abs(dx) > Math.abs(dy)) {
                    if (d[0] === -Math.sign(dx)) score += 100;
                } else {
                    if (d[1] === -Math.sign(dy)) score += 100;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                chosenDir = d;
            }
        }
    }

    // AI using Sword
    if (p.hasSword) {
        // Fire if enemy is in line of sight within 10 tiles!
        for (const [eId, enemy] of engine.players) {
            if (eId !== p.id && enemy.isAlive) {
                if (Math.abs(enemy.x - px) < 1 && Math.sign(enemy.y - py) === chosenDir[1] && Math.abs(enemy.y - py) < 12) {
                    engine.fireProjectile(p.id);
                }
                else if (Math.abs(enemy.y - py) < 1 && Math.sign(enemy.x - px) === chosenDir[0] && Math.abs(enemy.x - px) < 12) {
                    engine.fireProjectile(p.id);
                }
            }
        }
    }

    // Add some random human unpredictability occasionally if nothing pressing is happening
    if (bestScore < 30 && Math.random() < 0.05) {
        chosenDir = safeDirs[Math.floor(Math.random() * safeDirs.length)];
    }

    engine.setPlayerDirection(id, chosenDir[0], chosenDir[1]);
}

function gameOver(winnerId) {
    isGameRunning = false;
    uiOverlay.classList.add('active');
    const winnerName = winnerId ? playerNames.get(winnerId) : "Someone else";
    const descText = window.innerWidth <= 768 ? "Your empire has fallen." : `Your empire has fallen. ${winnerName} has conquered the world.`;
    document.getElementById('overlay-desc').innerText = descText;

    // Hide keyboard shortcut on mobile
    if (btnStart) {
        btnStart.innerText = window.innerWidth <= 768 ? "PLAY AGAIN" : "PLAY AGAIN (OR PRESS R)";
    }

    hud.style.display = 'none';
    if (hudRight) hudRight.style.display = 'none';
}

function showVictoryScreen() {
    isGameRunning = false;
    if (victoryOverlay) victoryOverlay.classList.add('active');
    hud.style.display = 'none';
    if (hudRight) hudRight.style.display = 'none';
    createFireworks();
}

function createFireworks() {
    const container = document.getElementById('fireworks-container');
    if (!container) return;
    container.innerHTML = ''; // clear old

    // CSS Fireworks logic
    for (let i = 0; i < 20; i++) {
        setTimeout(() => {
            if (!victoryOverlay.classList.contains('active')) return;
            const fw = document.createElement('div');
            fw.style.position = 'absolute';
            fw.style.left = Math.random() * 100 + '%';
            fw.style.top = Math.random() * 100 + '%';
            fw.style.width = '5px';
            fw.style.height = '5px';
            fw.style.backgroundColor = ['#f39c12', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6'][Math.floor(Math.random() * 5)];
            fw.style.borderRadius = '50%';
            fw.style.boxShadow = `0 0 20px 10px ${fw.style.backgroundColor}`;
            fw.style.transition = 'all 1s ease-out';
            container.appendChild(fw);

            requestAnimationFrame(() => {
                fw.style.transform = `scale(${Math.random() * 20 + 10})`;
                fw.style.opacity = '0';
            });
            setTimeout(() => fw.remove(), 1000);
        }, i * 300);
    }
}

function updateLeaderboard(time) {
    if (time - lastLeaderboardUpdate < 500) return; // limit to twice a second
    lastLeaderboardUpdate = time;

    // Update Minimap
    if (minimapCtx && textureCanvas) {
        minimapCtx.drawImage(textureCanvas, 0, 0, minimapCanvas.width, minimapCanvas.height);

        // Draw player dot
        if (engine.players.has(1) && engine.players.get(1).isAlive) {
            const p = engine.players.get(1);
            const mx = (p.x / MAP_SIZE) * minimapCanvas.width;
            // The texture canvas maps Y backwards from screen
            const my = (1 - (p.y / MAP_SIZE)) * minimapCanvas.height;
            minimapCtx.fillStyle = '#ffffff';
            minimapCtx.beginPath();
            minimapCtx.arc(mx, my, 3, 0, Math.PI * 2);
            minimapCtx.fill();
            minimapCtx.strokeStyle = '#000000';
            minimapCtx.lineWidth = 1;
            minimapCtx.stroke();
        }
    }

    const totalCells = MAP_SIZE * MAP_SIZE;
    let scores = [];
    const playerP = engine.players.get(1);
    const playerScore = playerP ? (playerP.score * 10) + (playerP.kills * 1000) : 0;

    for (const [id, p] of engine.players) {
        if (p.isAlive) {
            const rawScore = (p.score * 10) + (p.kills * 1000);

            scores.push({
                id: id,
                name: playerNames.get(id),
                score: rawScore,
                pct: (p.score / totalCells) * 100,
                color: `#${COLORS[id].hex.toString(16).padStart(6, '0')}`
            });
        }
    }

    // Sort descending
    scores.sort((a, b) => b.score - a.score);

    // Build HTML for top 10
    let html = '';
    let shownPlayer = false;
    for (let i = 0; i < Math.min(scores.length, 10); i++) {
        const s = scores[i];
        if (s.id === 1) shownPlayer = true;

        let invadableStyle = '';
        let invadableIcon = '';

        html += `
            <div class="score-entry ${s.id === 1 ? 'is-player' : ''}" style="${invadableStyle}">
                <div class="color-box" style="background-color: ${s.color};"></div>
                <div style="flex-grow: 1;">${i + 1}. ${s.name} ${invadableIcon}</div>
                <div style="text-align: right;" class="score-text-container">
                    <div style="font-size: 0.9em; transition: all 0.1s ease;" id="score-val-${s.id}">${Math.floor(displayScores.get(s.id) || s.score).toLocaleString()} pts</div>
                    <div style="font-size: 0.7em; color: rgba(255,255,255,0.6);">${s.pct.toFixed(2)}%</div>
                </div>
            </div>
        `;
    }

    // If player is not in top 10 but is alive, append to bottom
    if (!shownPlayer && engine.players.has(1) && engine.players.get(1).isAlive) {
        const pIndex = scores.findIndex(s => s.id === 1);
        if (pIndex !== -1) {
            const s = scores[pIndex];
            html += `
                <div style="text-align:center; color:rgba(255,255,255,0.5); font-size: 0.8em; margin: 4px 0;">...</div>
                <div class="score-entry is-player">
                    <div class="color-box" style="background-color: ${s.color};"></div>
                    <div style="flex-grow: 1;">${pIndex + 1}. ${s.name}</div>
                    <div style="text-align: right;">
                        <div style="font-size: 0.9em;">${s.score.toLocaleString()} pts</div>
                        <div style="font-size: 0.7em; color: rgba(255,255,255,0.6);">${s.pct.toFixed(2)}%</div>
                    </div>
                </div>
            `;
        }
    }

    scoreboardPanel.innerHTML = html;
}

function processInput() {
    // Player is id 1
    if (keys.w || keys.ArrowUp) engine.setPlayerDirection(1, 0, 1);
    // Remember Three geometry has +z going down, so our map +y going up means we visually go down on screen.
    // Adjust visual mapping accordingly in rendering.
    else if (keys.s || keys.ArrowDown) engine.setPlayerDirection(1, 0, -1);
    else if (keys.a || keys.ArrowLeft) engine.setPlayerDirection(1, -1, 0);
    else if (keys.d || keys.ArrowRight) engine.setPlayerDirection(1, 1, 0);

    // Fire projectile
    if (keys[' '] && !spacePressed) {
        spacePressed = true;

        if (typeof invSword !== 'undefined' && invSword) {
            invSword.style.display = 'none';
        }
        engine.fireProjectile(1);
    }
}

// Add keyup listener for spacebar to reset `spacePressed`
document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
        spacePressed = false;
    }
});

// Add keydown listener to restart game on R or r
document.addEventListener('keydown', (event) => {
    if ((event.key === 'r' || event.key === 'R') && !isGameRunning) {
        startGame();
    }
});


function gameLoop(time) {
    if (!isGameRunning) return;
    requestAnimationFrame(gameLoop);

    let dt = (time - lastTime) / 1000;
    lastTime = time;

    // CAP DT to prevent tunneling/trail skipping during lag spikes (max 50ms)
    if (dt > 0.05) dt = 0.05;

    if (!isPaused) {
        processInput();

        // AI Tick
        for (const [id, lastUpdate] of botTimers.entries()) {
            if (time - lastUpdate > 400) { // Check AI every 400ms
                if (!isTutorial || id !== tutEnemyId) {
                    updateBotAI(id);
                }
                botTimers.set(id, time);
            }
        }

        // Randomly spawn powerups
        if (!isTutorial && Math.random() < 0.03) { // Roughly 2 per second
            const rType = Math.random() < 0.5 ? 'crown' : 'sword'; // Equal chance
            const rx = Math.random() * (MAP_SIZE - 4) + 2;
            const ry = Math.random() * (MAP_SIZE - 4) + 2;
            // Don't spawn too many items
            if (engine.powerups.length < 50) {
                engine.spawnPowerup(rType, rx, ry);
            }
        }

        // The engine ticks with a fixed logical speed, but we use actual time dt
        engine.update(dt);

        if (isTutorial) {
            checkTutorialLogic(dt);
        }
    }

    // Lerp smooth zoom
    if (Math.abs(currentFrustumSize - targetFrustumSize) > 0.01) {
        currentFrustumSize += (targetFrustumSize - currentFrustumSize) * 0.1;

        const aspect = window.innerWidth / window.innerHeight;
        camera.left = -currentFrustumSize * aspect / 2;
        camera.right = currentFrustumSize * aspect / 2;
        camera.top = currentFrustumSize / 2;
        camera.bottom = -currentFrustumSize / 2;
        camera.updateProjectionMatrix();
    }

    // Sync 3D Meshes to logical Grid Coordinates
    let playerP = null;
    for (const [id, p] of engine.players) {
        if (p.isAlive) {
            const mesh = gladiatorMeshes.get(id);
            if (mesh) {
                // Logical coordinates are X,Y where 0,0 is bottom left.
                // Three.js Plane coordinates are X,Z.
                // We mapped the plane to start at 0,0 and go positive X and positive Z.
                // So grid X -> mesh.x
                // grid Y -> map size - mesh.z (Because texture mapping is weird, let's just make sure it matches!)
                // Wait, if Plane start is 0,0 and goes to MAP_SIZE, MAP_SIZE.

                // Let's make an explicit mapping:
                // Grid 0,0 is at Three.js x:0, z:MAP_SIZE
                mesh.position.x = p.x + 0.5; // +0.5 to center on the cell
                mesh.position.z = (MAP_SIZE - p.y) - 0.5;

                // Rotation based on dir
                // Standard unrotated container faces Z
                let targetRot = 0;
                if (p.dirX === 1) targetRot = Math.PI / 2;
                if (p.dirX === -1) targetRot = -Math.PI / 2;
                if (p.dirY === 1) targetRot = Math.PI; // facing "up" on grid, away from camera
                if (p.dirY === -1) targetRot = 0; // facing "down" on grid, toward camera

                // Smooth sort of rotation
                mesh.rotation.y += (targetRot - mesh.rotation.y) * 0.2;

                // Marching animation while moving!
                if (p.dirX !== 0 || p.dirY !== 0) {
                    // Firm marching waddle (side-to-side shifting) with very subtle vertical lift
                    mesh.position.y = Math.abs(Math.sin(time * 0.018)) * 0.02; // drastically reduce hop
                    mesh.rotation.z = Math.sin(time * 0.012) * 0.12; // increased leaning for waddle

                    // Swing arms opposite to each other
                    const armR = mesh.getObjectByName('armR');
                    const armL = mesh.getObjectByName('armL');
                    if (armR) armR.rotation.x = Math.sin(time * 0.015) * 0.6;
                    if (armL) armL.rotation.x = -Math.PI / 4 - Math.sin(time * 0.015) * 0.4;
                } else {
                    // Standing still
                    mesh.position.y = 0;
                    mesh.rotation.z = 0;
                    const armR = mesh.getObjectByName('armR');
                    if (armR) armR.rotation.x = 0;
                    const armL = mesh.getObjectByName('armL');
                    if (armL) armL.rotation.x = -Math.PI / 4;
                }
            }
            if (id === 1) {
                playerP = p;
                // Update crown UI just in case it was used
                if (p.extraLives >= 0 && invCrown) {
                    if (p.extraLives === 0) {
                        invCrown.style.display = 'none';
                    } else {
                        if (invCrownCount) invCrownCount.innerText = p.extraLives.toString();
                    }
                }
            }
        } else {
            // They died, but haven't been cleaned up by event (sanity check)
            if (gladiatorMeshes.has(id)) {
                scene.remove(gladiatorMeshes.get(id));
                gladiatorMeshes.delete(id);
            }
        }
    }

    // Smooth Score Animation Loop
    for (const [id, p] of engine.players) {
        if (!p.isAlive) {
            displayScores.delete(id);
            continue;
        }
        const realScore = (p.score * 10) + (p.kills * 1000);
        let currDisp = displayScores.get(id);
        if (currDisp === undefined) {
            currDisp = realScore;
            displayScores.set(id, currDisp);
        }

        if (Math.abs(currDisp - realScore) > 1) {
            const diff = realScore - currDisp;
            if (Math.abs(diff) < 2) currDisp = realScore;
            else currDisp += diff * 0.1; // Smooth interpolate 10% each frame

            displayScores.set(id, currDisp);

            // Only update DOM if the element currently exists
            const el = document.getElementById('score-val-' + id);
            if (el) {
                el.innerText = Math.floor(currDisp).toLocaleString() + ' pts';

                // Add a little CSS pop effect if it's the player and they gained score
                if (id === 1 && diff > 10) {
                    el.style.transform = 'scale(1.1)';
                    el.style.color = '#f1c40f'; // highlight gold
                    setTimeout(() => {
                        if (el) {
                            el.style.transform = 'scale(1)';
                            el.style.color = '';
                        }
                    }, 50);
                }
            }
        }
    }

    // Animate Powerups
    for (const [id, mesh] of powerupMeshes) {
        mesh.rotation.y += 0.05;
        mesh.position.y = 0.5 + Math.sin(time * 0.005 + id) * 0.1;
    }

    // Animate Projectiles (clean tumbling)
    for (const proj of engine.projectiles) {
        const mesh = projectileMeshes.get(proj.id);
        if (mesh) {
            mesh.position.set(proj.x - MAP_SIZE / 2 + 0.5, 0.5, MAP_SIZE - proj.y - MAP_SIZE / 2 - 0.5);
            // End over end tumbling using precalculated axis
            mesh.rotateOnWorldAxis(mesh.userData.axis, 0.4);
        }
    }

    if (playerP && gladiatorMeshes.has(1)) {
        updateCamera(gladiatorMeshes.get(1));
    }

    updateLeaderboard(time);

    composer.render();
}

function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;

    // Maintain current zoom level on resize
    camera.left = -currentFrustumSize * aspect / 2;
    camera.right = currentFrustumSize * aspect / 2;
    camera.top = currentFrustumSize / 2;
    camera.bottom = -currentFrustumSize / 2;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
    }
    if (ssaoPass) {
        ssaoPass.setSize(window.innerWidth, window.innerHeight);
    }
}

// --- Tutorial Logic ---
function updateTutorialUI() {
    const textEl = document.getElementById('tutorial-text');
    const keys = {
        w: document.getElementById('tut-key-w'),
        a: document.getElementById('tut-key-a'),
        s: document.getElementById('tut-key-s'),
        d: document.getElementById('tut-key-d'),
        space: document.getElementById('tut-key-space')
    };

    // Reset all highlights
    Object.values(keys).forEach(k => {
        k.classList.remove('highlight');
        k.style.display = 'flex';
    });
    keys.space.style.display = 'none'; // hide space initially

    switch (tutorialState) {
        case 0:
            textEl.innerText = "Welcome Emperor. Use WASD to explore outside your borders.";
            keys.w.classList.add('highlight');
            keys.a.classList.add('highlight');
            keys.s.classList.add('highlight');
            keys.d.classList.add('highlight');
            break;
        case 1:
            textEl.innerText = "Danger! Draw carefully and return to your solid territory to capture the area!";
            // Dynamically highlight based on player direction?
            // For now, highlight all WASD to just say "move"
            keys.w.classList.add('highlight');
            keys.a.classList.add('highlight');
            keys.s.classList.add('highlight');
            keys.d.classList.add('highlight');
            break;
        case 2:
            textEl.innerText = "Great! An enemy approaches. Press [SPACE] to throw your sword and cut their trail!";
            Object.values(keys).forEach(k => { k.classList.remove('highlight'); k.style.display = 'none'; });
            keys.space.style.display = 'flex';
            keys.space.classList.add('highlight');
            break;
        case 3:
            textEl.innerText = "You are ready to rule. The Campaign awaits.";
            Object.values(keys).forEach(k => k.style.display = 'none');
            // Show a button to start
            keys.space.style.display = 'flex';
            keys.space.innerText = 'START CAMPAIGN';
            keys.space.classList.add('highlight');
            keys.space.onclick = () => {
                isTutorial = false;
                startGame();
            };
            break;
    }
}

function checkTutorialLogic(dt) {
    const player = engine.players.get(1);

    // Revive player instantly if they die during the tutorial
    if (!player || !player.isAlive) {
        if (tutorialState < 3) {
            engine.addPlayer(1, MAP_SIZE / 2, MAP_SIZE / 2, 'red');
            createGladiator(1, COLORS[1].hex);
            if (tutorialState === 1) {
                // Put them back in state 0 so they can try again
                tutorialState = 0;
                updateTutorialUI();
            }
        }
        return;
    }

    switch (tutorialState) {
        case 0:
            // Wait for player to go outside territory
            if (player.currentTrail.length > 5) { // Need to move a bit
                tutorialState = 1;
                updateTutorialUI();
            }
            break;
        case 1:
            // Wait for player to close the territory
            // They closed it if trail length is 0, but they were outside.
            // Also ensure they actually gained score.
            if (player.currentTrail.length === 0 && player.score > 9) {
                tutorialState = 2;
                updateTutorialUI();

                // Spawn enemy nearby for target practice
                const ex = player.x + 10;
                const ey = player.y;
                spawnEnemy(tutEnemyId, ex, ey, 41, 128, 185, COLORS[2].hex);
                // Give player a sword immediately
                player.hasSword = true;
                if (invSword) invSword.style.display = 'flex';

                // Force the tutorial enemy to move predictably
                const enemy = engine.players.get(tutEnemyId);
                if (enemy) {
                    enemy.dirX = 0;
                    enemy.dirY = 1; // Move up continuously to draw a nice target trail
                }
            }
            break;
        case 2:
            // Wait for enemy to die
            const enemy = engine.players.get(tutEnemyId);
            if (enemy) {
                // Force enemy to keep moving and drawing trail to be an easy target
                if (Math.random() < 0.02) {
                    if (enemy.dirX === 0) { enemy.dirX = 1; enemy.dirY = 0; }
                    else { enemy.dirX = 0; enemy.dirY = 1; }
                }
                engine.setPlayerDirection(tutEnemyId, enemy.dirX, enemy.dirY);
            }

            if (!enemy || !enemy.isAlive) {
                tutorialState = 3;
                updateTutorialUI();
                if (invSword) invSword.style.display = 'none';
            }
            break;
    }
}

// Initial render call to show empty map before start
function initialRender() {
    if (!isGameRunning) {
        composer.render();
        requestAnimationFrame(initialRender);
    }
}
requestAnimationFrame(initialRender);
