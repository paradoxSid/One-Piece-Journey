/* ───────────────────────────────────────────────────
       One Piece Journey Map — Realistic 3D Globe
       ─────────────────────────────────────────────────── */

    const GR = 5;           // Globe radius
    const D2R = Math.PI / 180;
    const TEX_W = 2048, TEX_H = 1024;

    let islands = {}, crew = [], selectedCrewIds = new Set(), lastSelectedCrew = null, islandEvents = {};
    let scene, camera, renderer, globeGroup, cloudMesh;
    let islandMeshes = {}, islandGlows = {}, islandPins = {};
    let journeyLines = [], shipMesh, journeyArrows = [], journeyGlows = [];
    let journeyDashOffset = 0;
    let labelEls = {};
    let seaLabelSprites = [];
    let seaKings = [];
    let globeMesh;
    let isEditMode = false;
    let draggedIsland = null;
    let autoRotate = true, rotSpeed = 0.0006;
    let isDragging = false, dragMoved = false, prevMouse = { x: 0, y: 0 };
    let targetRotY = 0, targetRotX = 0.25, currentRotY = 0, currentRotX = 0.25;
    let targetZoom = 12, currentZoom = 20;
    let raycaster, mouseVec;
    let hoveredIsland = null, tooltipTimeout = null;
    let focusedIsland = null;

    /* ════════════════════════════════════════════════ */
    /*  NOISE — Simple 2-octave value noise            */
    /* ════════════════════════════════════════════════ */
    const _P = new Uint8Array(512);
    (function () {
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[p[i], p[j]] = [p[j], p[i]]; }
        for (let i = 0; i < 512; i++) _P[i] = p[i & 255];
    })();
    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function lerp(a, b, t) { return a + t * (b - a); }
    function grad(h, x, y) {
        const v = h & 3;
        return (v === 0 ? x + y : v === 1 ? -x + y : v === 2 ? x - y : -x - y);
    }
    function noise2(x, y) {
        const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
        x -= Math.floor(x); y -= Math.floor(y);
        const u = fade(x), v = fade(y);
        const a = _P[X] + Y, b = _P[X + 1] + Y;
        return lerp(lerp(grad(_P[a], x, y), grad(_P[b], x - 1, y), u),
            lerp(grad(_P[a + 1], x, y - 1), grad(_P[b + 1], x - 1, y - 1), u), v);
    }
    function fbm(x, y, oct) {
        let v = 0, a = 0.5, f = 1;
        for (let i = 0; i < oct; i++) { v += a * noise2(x * f, y * f); a *= 0.5; f *= 2; }
        return v;
    }

    /* ════════════════════════════════════════════════ */
    /*  BOOT                                            */
    /* ════════════════════════════════════════════════ */
    document.addEventListener("DOMContentLoaded", loadData);

    function loadData() {
        islands = ISLAND_DATA;
        crew = CREW_DATA;
        islandEvents = ISLAND_EVENTS;
        initScene();
        buildCharPills();
        // Fade splash, show spoiler gate
        const splash = document.getElementById("splash");
        splash.style.transition = "opacity 0.5s";
        splash.style.opacity = "0";
        setTimeout(() => {
            splash.style.display = "none";
            showSpoilerGate();
        }, 500);
    }

    /* ════════════════════════════════════════════════ */
    /*  SCENE                                           */
    /* ════════════════════════════════════════════════ */
    function initScene() {
        const canvas = document.getElementById("globeCanvas");
        const W = window.innerWidth, H = window.innerHeight;

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
        camera.position.set(0, 0, currentZoom);

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(W, H);
        renderer.setClearColor(0x000308, 1);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;

        raycaster = new THREE.Raycaster();
        mouseVec = new THREE.Vector2(-999, -999);

        // Keep tooltip alive when mouse hovers over it
        const ttEl = document.getElementById("islandTooltip");
        ttEl.addEventListener("mouseenter", () => { tooltipHovered = true; clearTimeout(tooltipTimeout); });
        ttEl.addEventListener("mouseleave", () => { tooltipHovered = false; scheduleHideTooltip(); });

        // Lights — key/fill/rim like a satellite photo
        scene.add(new THREE.AmbientLight(0x8899bb, 0.35));
        const sun = new THREE.DirectionalLight(0xfff5e0, 1.3);
        sun.position.set(10, 6, 8);
        scene.add(sun);
        const fill = new THREE.DirectionalLight(0x5577aa, 0.25);
        fill.position.set(-8, -4, -6);
        scene.add(fill);
        const rim = new THREE.DirectionalLight(0x2244aa, 0.15);
        rim.position.set(0, 0, -10);
        scene.add(rim);

        globeGroup = new THREE.Group();
        scene.add(globeGroup);

        createStars();
        createGlobe();
        createSeaLabels();
        createIslands();
        createSeaKings();

        setupInteraction(canvas);
        window.addEventListener("resize", onResize);
        animate();
    }

    /* ════════════════════════════════════════════════ */
    /*  STARS                                           */
    /* ════════════════════════════════════════════════ */
    function createStars() {
        const n = 4000, pos = new Float32Array(n * 3), cols = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const r = 60 + Math.random() * 60;
            const th = Math.random() * Math.PI * 2;
            const ph = Math.acos(2 * Math.random() - 1);
            pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
            pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
            pos[i * 3 + 2] = r * Math.cos(ph);
            // Slight colour variation: blue-white-yellow
            const t = Math.random();
            cols[i * 3] = 0.8 + t * 0.2;
            cols[i * 3 + 1] = 0.85 + t * 0.15;
            cols[i * 3 + 2] = 1.0;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
        scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
            size: 0.06, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.7
        })));
    }

    /* ════════════════════════════════════════════════ */
    /*  GLOBE — realistic procedural Earth-like maps   */
    /* ════════════════════════════════════════════════ */
    function createGlobe() {
        // ---------- colour texture ----------
        const cColor = makeCanvas(TEX_W, TEX_H);
        const ctxC = cColor.getContext("2d");
        paintOcean(ctxC);
        paintRedLine(ctxC);
        paintReverseCanals(ctxC);
        paintCalm(ctxC);
        paintGrandLine(ctxC);
        paintSeaRegions(ctxC);
        paintIslandDots(ctxC);
        paintSeaText(ctxC);
        paintOceanDetail(ctxC);

        // ---------- bump map ----------
        const cBump = makeCanvas(TEX_W, TEX_H);
        const ctxB = cBump.getContext("2d");
        ctxB.fillStyle = "#808080";
        ctxB.fillRect(0, 0, TEX_W, TEX_H);
        paintBumpOcean(ctxB);
        paintBumpRedLine(ctxB);
        paintBumpCanals(ctxB);
        paintBumpIslands(ctxB);

        // ---------- specular map ----------
        const cSpec = makeCanvas(TEX_W, TEX_H);
        const ctxS = cSpec.getContext("2d");
        ctxS.fillStyle = "#555555";          // ocean = shiny
        ctxS.fillRect(0, 0, TEX_W, TEX_H);
        paintSpecLand(ctxS);                  // land = matte
        paintSpecCanals(ctxS);                // canals = shiny water
        paintSpecIslands(ctxS);               // islands = matte

        const texColor = new THREE.CanvasTexture(cColor);
        const texBump = new THREE.CanvasTexture(cBump);
        const texSpec = new THREE.CanvasTexture(cSpec);
        [texColor, texBump, texSpec].forEach(t => { t.wrapS = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); });

        const geo = new THREE.SphereGeometry(GR, 128, 80);
        const mat = new THREE.MeshPhongMaterial({
            map: texColor,
            bumpMap: texBump,
            bumpScale: 0.15,
            specularMap: texSpec,
            specular: 0x334466,
            shininess: 18,
            emissive: 0x020810,
            emissiveIntensity: 0.25,
        });
        globeMesh = new THREE.Mesh(geo, mat);
        globeGroup.add(globeMesh);

        // ── 3D Red Line mountain ridge ──
        createRedLineMesh();

        // ── Reverse Mountain canal tubes ──
        createReverseMountainCanals();

        // ── atmosphere layers ──
        addAtmoLayer(GR * 1.005, 0x4488cc, 0.06, THREE.FrontSide);   // thin haze
        addAtmoLayer(GR * 1.012, 0x3366aa, 0.08, THREE.BackSide);     // inner glow
        addAtmoLayer(GR * 1.04, 0x2255aa, 0.04, THREE.BackSide);     // outer bloom
        addAtmoLayer(GR * 1.08, 0x1133aa, 0.018, THREE.BackSide);    // space limb

        // ── thin cloud layer ──
        const cCloud = makeCanvas(TEX_W, TEX_H);
        paintClouds(cCloud.getContext("2d"));
        const texCloud = new THREE.CanvasTexture(cCloud);
        texCloud.wrapS = THREE.RepeatWrapping;
        const cloudGeo = new THREE.SphereGeometry(GR * 1.008, 80, 40);
        const cloudMat = new THREE.MeshPhongMaterial({
            map: texCloud, transparent: true, opacity: 0.28,
            depthWrite: false, side: THREE.FrontSide,
        });
        cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
        globeGroup.add(cloudMesh);
    }

    function makeCanvas(w, h) {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        return c;
    }

    function addAtmoLayer(radius, color, opacity, side) {
        const g = new THREE.SphereGeometry(radius, 64, 32);
        const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side, depthWrite: false });
        globeGroup.add(new THREE.Mesh(g, m));
    }

    /* ── Coordinate helpers ── */
    function lngToX(lng) { return ((lng + 180) / 360) * TEX_W; }
    function latToY(lat) { return ((90 - lat) / 180) * TEX_H; }

    /* ═══════ COLOUR TEXTURE PAINTERS ═══════ */

    function paintOcean(ctx) {
        // Deep ocean with per-sea-zone colour tinting baked into each pixel
        const img = ctx.createImageData(TEX_W, TEX_H);
        const d = img.data;
        // smoothstep helper
        function ss(lo, hi, x) {
            const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
            return t * t * (3 - 2 * t);
        }
        for (let y = 0; y < TEX_H; y++) {
            const lat = 90 - (y / TEX_H) * 180;
            const absLat = Math.abs(lat);
            const eqDist = absLat / 90;
            // Zone strengths (smooth transitions between belts)
            const calmStr = ss(9, 11, absLat) * (1 - ss(17, 20, absLat));
            const blueStr = ss(17, 22, absLat);
            const glStr   = 1 - ss(9, 11, absLat);
            for (let x = 0; x < TEX_W; x++) {
                const lng = (x / TEX_W) * 360 - 180;
                const i = (y * TEX_W + x) * 4;
                const n = fbm(x * 0.005, y * 0.005, 3) * 0.5 + 0.5;
                // Base colour: vibrant anime blue (One Piece style)
                let r = 15 + eqDist * 8 + n * 3;
                let g = 80 + (1 - eqDist) * 60 + n * 8;
                let b = 170 + (1 - eqDist) * 45 + n * 10;

                // ── Calm Belt: eerie pale teal, dead-still (Oda style) ──
                if (calmStr > 0) {
                    const s = calmStr * (0.50 + n * 0.06);
                    r = r * (1 - s) + (80 + n * 10) * s;
                    g = g * (1 - s) + (115 + n * 12) * s;
                    b = b * (1 - s) + (125 + n * 8) * s;
                }
                // ── Four Blues ──
                if (blueStr > 0) {
                    let tR, tG, tB;
                    if (lat > 0 && lng >= 0) {
                        // East Blue — bright anime cerulean
                        tR = 20 + n * 4; tG = 95 + n * 10; tB = 200 + n * 12;
                    } else if (lat > 0) {
                        // North Blue — cool anime blue-violet
                        tR = 35 + n * 6; tG = 55 + n * 8; tB = 165 + n * 12;
                    } else if (lng < 0) {
                        // West Blue — vivid teal-blue
                        tR = 12 + n * 4; tG = 105 + n * 10; tB = 145 + n * 10;
                    } else {
                        // South Blue — warm aquamarine
                        tR = 25 + n * 6; tG = 110 + n * 10; tB = 155 + n * 8;
                    }
                    const s = blueStr * (0.30 + n * 0.05);
                    r = r * (1 - s) + tR * s;
                    g = g * (1 - s) + tG * s;
                    b = b * (1 - s) + tB * s;
                }
                // ── Grand Line: deeper, dramatic anime waters ──
                if (glStr > 0) {
                    let tR, tG, tB, s;
                    if (lng < -5) {
                        // New World — dark stormy indigo
                        tR = 12 + n * 4; tG = 18 + n * 6; tB = 55 + n * 10;
                        s = glStr * (0.45 + n * 0.08);
                    } else if (lng > 5) {
                        // Paradise — rich deep blue
                        tR = 8 + n * 3; tG = 30 + n * 8; tB = 80 + n * 12;
                        s = glStr * (0.40 + n * 0.08);
                    } else { s = 0; tR = tG = tB = 0; }
                    if (s > 0) {
                        r = r * (1 - s) + tR * s;
                        g = g * (1 - s) + tG * s;
                        b = b * (1 - s) + tB * s;
                    }
                }
                d[i]     = Math.min(255, Math.round(r));
                d[i + 1] = Math.min(255, Math.round(g));
                d[i + 2] = Math.min(255, Math.round(b));
                d[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
    }

    // Compensate for longitude convergence at poles so Red Line looks
    // the same physical width everywhere on the globe
    function rlTaper(lat) {
        const cosLat = Math.cos(lat * D2R);
        // Widen longitude degrees at poles (1/cos); capped at 8× for performance
        return 1 / Math.max(0.12, cosLat);
    }

    function paintRedLine(ctx) {
        // The Red Line — massive mountain range dividing the globe
        const rlHalf = 7;

        [0, 180].forEach(cLng => {
            for (let y = 0; y < TEX_H; y++) {
                const lat = 90 - (y / TEX_H) * 180;
                const absLat = Math.abs(lat);
                const effHalf = Math.min(90, rlHalf * rlTaper(lat));
                const step = effHalf > 30 ? 1.2 : effHalf > 15 ? 0.7 : 0.5;

                for (let dx = -effHalf; dx <= effHalf; dx += step) {
                    const lng = cLng + dx;
                    const normLng = lng > 180 ? lng - 360 : lng < -180 ? lng + 360 : lng;
                    const px = lngToX(normLng);
                    const distCenter = Math.abs(dx) / effHalf;
                    if (distCenter >= 1) continue;

                    // Multi-octave noise for anime mountain look
                    const n1 = fbm(px * 0.02 + 50, y * 0.015, 2) * 0.5 + 0.5;
                    const n2 = fbm(px * 0.04 + 80, y * 0.03, 3) * 0.5 + 0.5;
                    const ridge = Math.abs(fbm(px * 0.008, y * 0.006 + 200, 3));
                    // Simulated light — reduced noise variation for cleaner anime look
                    const slopeX = fbm((px + 1) * 0.02 + 50, y * 0.015, 2) - fbm((px - 1) * 0.02 + 50, y * 0.015, 2);
                    const shade = Math.max(0.5, Math.min(1.15, 0.75 + slopeX * 2.0 + n2 * 0.15));
                    let r, g, b, a;

                    if (distCenter > 0.86) {
                        // Foothills fading — anime bright edge
                        const fade = (1 - distCenter) / 0.14;
                        r = lerp(150, 190, n1); g = lerp(35, 55, n1); b = lerp(25, 40, n1);
                        a = fade * 0.88;
                    } else if (distCenter > 0.7) {
                        // Lower slopes — saturated red
                        r = 175 + n1 * 20; g = 35 + n1 * 8; b = 22 + n1 * 6;
                        a = 0.96;
                    } else if (distCenter > 0.45) {
                        // Mid slopes — bold crimson
                        r = 210 + n1 * 15; g = 38 + n1 * 6; b = 24 + n1 * 5;
                        a = 0.97;
                    } else if (distCenter > 0.18) {
                        // Upper slopes — vivid bright red
                        r = 235 + n1 * 10; g = 40 + n1 * 5; b = 25 + n1 * 4;
                        a = 0.98;
                    } else {
                        // Peak zone — brightest red, snow at polar latitudes
                        if (absLat > 38 && n1 > 0.42) {
                            const snow = Math.min(1, (absLat - 38) / 30 + n1 * 0.25);
                            r = lerp(240, 252, snow); g = lerp(42, 240, snow); b = lerp(28, 238, snow);
                        } else {
                            r = 245 + n1 * 8; g = 35 + n1 * 5; b = 20 + n1 * 4;
                        }
                        a = 0.99;
                    }

                    r = Math.floor(Math.min(255, r * shade));
                    g = Math.floor(Math.min(255, g * shade));
                    b = Math.floor(Math.min(255, b * shade));

                    ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(2)})`;
                    ctx.fillRect(Math.floor(px), y, 2, 1);
                }
            }
        });
    }

    function paintCalm(ctx) {
        // Calm Belts: pale, eerie stillness — anime style muted band
        [[10, 18], [-18, -10]].forEach(([latMin, latMax]) => {
            const yMin = latToY(latMax), yMax = latToY(latMin);
            for (let y = Math.floor(yMin); y < Math.ceil(yMax); y++) {
                const t = (y - yMin) / (yMax - yMin);
                const center = 1 - Math.abs(t - 0.5) * 2;
                ctx.fillStyle = `rgba(95,120,130,${(center * 0.18).toFixed(2)})`;
                ctx.fillRect(0, y, TEX_W, 1);
            }
            // Thin clean border lines
            [yMin, yMax].forEach(yy => {
                ctx.strokeStyle = "rgba(150,190,210,0.15)";
                ctx.lineWidth = 0.8;
                ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(TEX_W, yy); ctx.stroke();
            });
        });
    }

    function paintGrandLine(ctx) {
        // Grand Line belt: ±10° of equator — deeper anime-blue tint
        const yMin = latToY(10), yMax = latToY(-10);
        for (let y = Math.floor(yMin); y < Math.ceil(yMax); y++) {
            ctx.fillStyle = "rgba(8,12,35,0.14)";
            ctx.fillRect(0, y, TEX_W, 1);
        }
        // Clean thin border lines
        [latToY(10), latToY(-10)].forEach(yy => {
            ctx.strokeStyle = "rgba(180,200,220,0.18)";
            ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(TEX_W, yy); ctx.stroke();
        });
    }

    function paintSeaRegions(ctx) {
        // Sea region tinting is now baked into paintOcean per-pixel
    }

    function paintIslandDots(ctx) {
        Object.entries(islands).forEach(([id, isl]) => {
            if (isl.elevation > 0) return;
            const cx = lngToX(isl.lng), cy = latToY(isl.lat);
            const shapeDef = ISLAND_SHAPES[id];
            // Use shape size to scale dot on texture (roughly proportional)
            const baseR = shapeDef ? Math.round(shapeDef.size * 80) : 5;
            const r = Math.max(4, Math.min(14, baseR));

            // Shallow water halo
            const reef = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.0);
            reef.addColorStop(0, "rgba(25,180,190,0.25)");
            reef.addColorStop(1, "rgba(15,100,120,0)");
            ctx.fillStyle = reef;
            ctx.beginPath(); ctx.arc(cx, cy, r * 2.0, 0, Math.PI * 2); ctx.fill();

            // Beach ring
            const beachC = shapeDef ? shapeDef.beach : '#e0d0a0';
            ctx.fillStyle = beachC || "rgba(220,205,160,0.7)";
            ctx.globalAlpha = 0.75;
            ctx.beginPath(); ctx.arc(cx, cy, r * 1.15, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;

            // Main land with island's actual color
            const c1 = shapeDef ? shapeDef.color1 : '#4a8040';
            const c2 = shapeDef ? shapeDef.color2 : '#7ab060';
            const land = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r);
            land.addColorStop(0, c2 || "rgba(80,150,50,0.9)");
            land.addColorStop(0.7, c1 || "rgba(60,120,40,0.85)");
            land.addColorStop(1, c1 || "rgba(100,170,65,0.75)");
            ctx.fillStyle = land;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        });
    }

    function paintSeaText(ctx) {
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const labels = [
            { text: "EAST BLUE", lat: 38, lng: 50, size: 24, color: "rgba(80,160,220,0.18)" },
            { text: "NORTH BLUE", lat: 38, lng: -50, size: 24, color: "rgba(150,120,210,0.16)" },
            { text: "WEST BLUE", lat: -38, lng: -50, size: 24, color: "rgba(80,185,140,0.16)" },
            { text: "SOUTH BLUE", lat: -38, lng: 50, size: 24, color: "rgba(210,170,90,0.16)" },
            { text: "PARADISE", lat: 0, lng: 90, size: 18, color: "rgba(200,180,80,0.14)" },
            { text: "NEW  WORLD", lat: 0, lng: -90, size: 18, color: "rgba(200,100,60,0.18)" },
            { text: "C A L M   B E L T", lat: 15, lng: 90, size: 9, color: "rgba(120,180,180,0.12)" },
            { text: "C A L M   B E L T", lat: -15, lng: 90, size: 9, color: "rgba(120,180,180,0.12)" },
        ];
        labels.forEach(l => {
            ctx.font = `600 ${l.size}px 'Inter', sans-serif`;
            ctx.fillStyle = l.color;
            ctx.fillText(l.text, lngToX(l.lng), latToY(l.lat));
        });
    }

    /* ═══════ REVERSE MOUNTAIN CANALS ═══════ */
    // Returns distance from a point (lat, lng) to the nearest canal path (0 = on canal)
    // Canals form an X at Reverse Mountain (lat=0, lng=0):
    //   East Blue (lat+, lng+) → center,  North Blue (lat+, lng-) → center
    //   South Blue (lat-, lng+) → center, West Blue (lat-, lng-) → center
    //   Exit canal: center → east along lat 0 into Paradise
    // Distance from point P to line segment AB, clamped to segment
    function distToSeg(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 0.0001) return Math.sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
        let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx, cy = ay + t * dy;
        return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
    }

    function canalDist(lat, lng) {
        let nLng = lng;
        if (nLng > 180) nLng -= 360;
        if (nLng < -180) nLng += 360;
        if (Math.abs(nLng) > 18) return 999;
        if (Math.abs(lat) > 24) return 999;

        let minD = 999;
        // 4 diagonal canals from Blue seas through Calm Belt to Reverse Mountain
        // East Blue:  (22, 7)  → (0, 0)
        // North Blue: (22, -7) → (0, 0)
        // South Blue: (-22, 7) → (0, 0)
        // West Blue:  (-22,-7) → (0, 0)
        const segs = [
            [22, 7, 0, 0],
            [22, -7, 0, 0],
            [-22, 7, 0, 0],
            [-22, -7, 0, 0],
            [0, 0, 0, 8],  // Exit canal into Paradise
        ];
        for (const [aLat, aLng, bLat, bLng] of segs) {
            minD = Math.min(minD, distToSeg(lat, nLng, aLat, aLng, bLat, bLng));
        }
        return minD;
    }

    function paintReverseCanals(ctx) {
        // Paint blue water channels through the Red Line at Reverse Mountain
        const canalW = 1.6;
        const yStart = latToY(24), yEnd = latToY(-24);
        const xStart = lngToX(-18), xEnd = lngToX(18);

        // Main water fill — fully opaque to overwrite the Red Line texture
        for (let y = Math.floor(yStart); y <= Math.ceil(yEnd); y++) {
            const lat = 90 - (y / TEX_H) * 180;
            for (let x = Math.floor(xStart); x <= Math.ceil(xEnd); x++) {
                const lng = (x / TEX_W) * 360 - 180;
                const d = canalDist(lat, lng);
                if (d > canalW) continue;

                const t = d / canalW; // 0=center, 1=edge
                const n = fbm(x * 0.03 + 200, y * 0.03, 2) * 0.1;

                // Deep water in center, lighter at edges
                const r = Math.floor(lerp(18, 45, t) + n * 15);
                const g = Math.floor(lerp(60, 100, t) + n * 20);
                const b = Math.floor(lerp(140, 175, t) + n * 10);

                // Smooth edge fade only at the very border
                const edgeFade = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;

                ctx.fillStyle = `rgba(${r},${g},${b},${edgeFade.toFixed(2)})`;
                ctx.fillRect(x, y, 1, 1);
            }
        }

        // White foam streaks along canal edges
        for (let y = Math.floor(yStart); y <= Math.ceil(yEnd); y++) {
            const lat = 90 - (y / TEX_H) * 180;
            for (let x = Math.floor(xStart); x <= Math.ceil(xEnd); x++) {
                const lng = (x / TEX_W) * 360 - 180;
                const d = canalDist(lat, lng);
                if (d < canalW * 0.6 || d > canalW * 1.1) continue;
                const edgeT = Math.abs(d - canalW * 0.85) / (canalW * 0.25);
                const foamN = fbm(x * 0.05 + 100, y * 0.05, 2) * 0.5 + 0.5;
                const foamA = Math.max(0, (1 - edgeT)) * 0.35 * foamN;
                if (foamA < 0.02) continue;
                ctx.fillStyle = `rgba(200,230,250,${foamA.toFixed(2)})`;
                ctx.fillRect(x, y, 1, 1);
            }
        }

        // Light specular highlight down the center of each canal
        for (let y = Math.floor(yStart); y <= Math.ceil(yEnd); y++) {
            const lat = 90 - (y / TEX_H) * 180;
            for (let x = Math.floor(xStart); x <= Math.ceil(xEnd); x++) {
                const lng = (x / TEX_W) * 360 - 180;
                const d = canalDist(lat, lng);
                if (d > canalW * 0.3) continue;
                const ct = d / (canalW * 0.3);
                const highlightA = (1 - ct) * 0.15;
                ctx.fillStyle = `rgba(140,200,240,${highlightA.toFixed(2)})`;
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }

    function paintOceanDetail(ctx) {
        // Subtle anime-style wave lines
        ctx.globalAlpha = 0.025;
        ctx.strokeStyle = "#8AD4FF";
        ctx.lineWidth = 0.6;
        for (let y = 0; y < TEX_H; y += 8) {
            ctx.beginPath();
            for (let x = 0; x <= TEX_W; x += 4) {
                const wy = y + Math.sin(x * 0.01 + y * 0.006) * 2 + fbm(x * 0.002, y * 0.002, 2) * 2;
                x === 0 ? ctx.moveTo(x, wy) : ctx.lineTo(x, wy);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    /* ═══════ BUMP MAP PAINTERS ═══════ */

    function paintBumpOcean(ctx) {
        // Subtle wave bump all over
        const img = ctx.createImageData(TEX_W, TEX_H);
        const d = img.data;
        for (let y = 0; y < TEX_H; y++) {
            for (let x = 0; x < TEX_W; x++) {
                const i = (y * TEX_W + x) * 4;
                const n = (fbm(x * 0.015, y * 0.015, 3) * 0.5 + 0.5); // 0-1
                const v = Math.floor(128 + (n - 0.5) * 30);
                d[i] = d[i + 1] = d[i + 2] = v;
                d[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
    }

    function paintBumpRedLine(ctx) {
        // Sharp mountain ridge terrain — dx range expands at poles
        const rlHalf = 7;
        [0, 180].forEach(cLng => {
            for (let y = 0; y < TEX_H; y++) {
                const lat = 90 - (y / TEX_H) * 180;
                const effHalf = Math.min(90, rlHalf * rlTaper(lat));
                const step = effHalf > 30 ? 1.2 : effHalf > 15 ? 0.7 : 0.5;
                for (let dx = -effHalf; dx <= effHalf; dx += step) {
                    const lng = cLng + dx;
                    const normLng = lng > 180 ? lng - 360 : lng < -180 ? lng + 360 : lng;
                    const px = lngToX(normLng);
                    const dist = Math.abs(dx) / effHalf;
                    if (dist >= 1) continue;
                    // Simple parabolic profile with noise
                    const profile = Math.pow(Math.max(0, 1 - dist * dist), 0.55);
                    const n1 = fbm(px * 0.02 + 50, y * 0.015, 2) * 0.5 + 0.5;
                    const height = profile * n1;
                    const v = Math.floor(128 + height * 127);
                    ctx.fillStyle = `rgb(${v},${v},${v})`;
                    ctx.fillRect(Math.floor(px), y, 2, 1);
                }
            }
        });
    }

    /* ═══════ SPECULAR MAP PAINTER ═══════ */

    function paintBumpIslands(ctx) {
        Object.entries(islands).forEach(([id, isl]) => {
            if (isl.elevation > 0) return;
            const cx = lngToX(isl.lng), cy = latToY(isl.lat);
            const shapeDef = ISLAND_SHAPES[id];
            const baseR = shapeDef ? Math.round(shapeDef.size * 80) : 7;
            const r = Math.max(5, Math.min(16, baseR));
            const seed = cx * 7.3 + cy * 13.7;
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    const dist = Math.sqrt(dx * dx + dy * dy) / r;
                    if (dist > 1) continue;
                    const height = (1 - dist * dist) * 0.8;
                    const n = fbm((cx + dx) * 0.08 + seed * 0.01, (cy + dy) * 0.08, 2) * 0.2;
                    const v = Math.floor(128 + (height + n) * 100);
                    ctx.fillStyle = `rgb(${v},${v},${v})`;
                    ctx.fillRect(Math.floor(cx + dx), Math.floor(cy + dy), 1, 1);
                }
            }
        });
    }

    function paintBumpCanals(ctx) {
        const canalW = 1.6;
        const yStart = latToY(24), yEnd = latToY(-24);
        const xStart = lngToX(-18), xEnd = lngToX(18);
        for (let y = Math.floor(yStart); y <= Math.ceil(yEnd); y++) {
            const lat = 90 - (y / TEX_H) * 180;
            for (let x = Math.floor(xStart); x <= Math.ceil(xEnd); x++) {
                const lng = (x / TEX_W) * 360 - 180;
                const d = canalDist(lat, lng);
                if (d > canalW) continue;
                const t = d / canalW;
                const edgeFade = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
                // Flat water surface — push to neutral 128 (flat)
                const v = Math.floor(lerp(118, 128, t));
                ctx.globalAlpha = edgeFade;
                ctx.fillStyle = `rgb(${v},${v},${v})`;
                ctx.fillRect(x, y, 1, 1);
            }
        }
        ctx.globalAlpha = 1;
    }

    function paintSpecCanals(ctx) {
        const canalW = 1.6;
        const yStart = latToY(24), yEnd = latToY(-24);
        const xStart = lngToX(-18), xEnd = lngToX(18);
        for (let y = Math.floor(yStart); y <= Math.ceil(yEnd); y++) {
            const lat = 90 - (y / TEX_H) * 180;
            for (let x = Math.floor(xStart); x <= Math.ceil(xEnd); x++) {
                const lng = (x / TEX_W) * 360 - 180;
                const d = canalDist(lat, lng);
                if (d > canalW) continue;
                const t = d / canalW;
                const edgeFade = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
                // Shiny water surface
                const shine = Math.floor(lerp(80, 40, t));
                ctx.globalAlpha = edgeFade;
                ctx.fillStyle = `rgb(${shine},${shine},${shine})`;
                ctx.fillRect(x, y, 1, 1);
            }
        }
        ctx.globalAlpha = 1;
    }

    function paintSpecIslands(ctx) {
        Object.entries(islands).forEach(([id, isl]) => {
            if (isl.elevation > 0) return;
            const cx = lngToX(isl.lng), cy = latToY(isl.lat);
            const shapeDef = ISLAND_SHAPES[id];
            const baseR = shapeDef ? Math.round(shapeDef.size * 85) : 8;
            const r = Math.max(6, Math.min(18, baseR));
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = "rgb(15,15,15)";
            ctx.fill();
        });
    }

    function paintSpecLand(ctx) {
        // Red Line — matte rock with noise, dx range expands at poles
        const rlHalf = 7;
        [0, 180].forEach(cLng => {
            for (let y = 0; y < TEX_H; y++) {
                const lat = 90 - (y / TEX_H) * 180;
                const effHalf = Math.min(90, rlHalf * rlTaper(lat));
                const step = effHalf > 30 ? 1.2 : effHalf > 15 ? 0.7 : 0.5;
                for (let dx = -effHalf; dx <= effHalf; dx += step) {
                    const lng = cLng + dx;
                    const normLng = lng > 180 ? lng - 360 : lng < -180 ? lng + 360 : lng;
                    const px = lngToX(normLng);
                    const dist = Math.abs(dx) / effHalf;
                    if (dist >= 1) continue;
                    const n = fbm(px * 0.05, y * 0.05, 2) * 0.3;
                    const dark = Math.floor(Math.max(0, 8 + dist * dist * 55 + n * 20));
                    ctx.fillStyle = `rgb(${dark},${dark},${dark})`;
                    ctx.fillRect(Math.floor(px), y, 2, 1);
                }
            }
        });
    }

    /* ═══════ 3D RED LINE MOUNTAIN RIDGE ═══════ */

    function createRedLineMesh() {
        // Actual 3D mountain geometry protruding from the globe — tall and dramatic
        const latSteps = 400;
        const crossSteps = 32;
        const rlHalfDeg = 7;
        const maxH = 0.4;   // 8% of globe radius

        [0, 180].forEach(centerLng => {
            const verts = [], cols = [], idxs = [];

            for (let li = 0; li <= latSteps; li++) {
                const lat = -90 + (li / latSteps) * 180;
                const absLat = Math.abs(lat);
                const ty = ((90 - lat) / 180) * TEX_H;

                const effHalfDeg = rlHalfDeg * rlTaper(lat);
                for (let ci = 0; ci <= crossSteps; ci++) {
                    const dLng = ((ci / crossSteps) - 0.5) * 2 * effHalfDeg;
                    const lng = centerLng + dLng;
                    const dist = Math.abs(dLng) / effHalfDeg;
                    const tx = ((lng + 180) / 360) * TEX_W;

                    // Mountain height — jagged peaks
                    // Notch: lower height near Reverse Mountain (lat≈0, centerLng=0)
                    // and Fish-Man Island (lat≈0, centerLng=180)
                    let gapFactor = 1;
                    if (Math.abs(lat) < 8) {
                        const latGap = 1 - Math.abs(lat) / 8;
                        gapFactor = 1 - latGap * 0.7; // reduce height by 70% at equator crossing
                    }
                    // Carve canals at Reverse Mountain (lng≈0 Red Line only)
                    if (centerLng === 0) {
                        const cd = canalDist(lat, lng);
                        const canalW = 1.6;
                        if (cd < canalW) {
                            const ct = cd / canalW;
                            // Smooth deep carve — center of canal drops to near globe surface
                            const carveFactor = ct * ct;
                            gapFactor *= Math.max(0.005, carveFactor);
                        }
                    }
                    const profile = Math.pow(Math.max(0, 1 - dist * dist), 0.45);
                    const n1 = fbm(tx * 0.015 + 50, ty * 0.012, 4) * 0.5 + 0.5;
                    const ridge = Math.abs(fbm(tx * 0.005, ty * 0.005 + 300, 3));
                    const peaks = Math.pow(fbm(tx * 0.04 + 100, ty * 0.04, 3) * 0.5 + 0.5, 0.7);
                    const spikes = Math.pow(Math.abs(fbm(tx * 0.08, ty * 0.08, 2)), 0.6) * 0.2;
                    const h = maxH * profile * (n1 * 0.3 + ridge * 0.25 + peaks * 0.3 + spikes) * gapFactor;

                    // Edges flush with globe, peaks dramatically rise
                    const height = dist > 0.95 ? 0.005 : Math.max(0.005, h);
                    const pos = latLngToVec3(lat, lng, GR + height);
                    verts.push(pos.x, pos.y, pos.z);

                    // Vertex colors — vivid RED mountain
                    const hNorm = Math.min(1, h / maxH);
                    let r, g, b;

                    // In canal areas, tint the low mesh vertices blue-grey
                    // so the carved channels look watery even from the mesh itself
                    let canalBlend = 0;
                    if (centerLng === 0) {
                        const cd = canalDist(lat, lng);
                        const cW = 1.6;
                        if (cd < cW) {
                            const ct = cd / cW;
                            canalBlend = (1 - ct * ct); // 1 at center, 0 at edge
                        }
                    }

                    if (hNorm > 0.55 && absLat > 45) {
                        // Snow-capped peaks at high latitudes
                        const s = Math.min(1, (absLat - 45) / 25);
                        r = lerp(0.88, 0.98, s); g = lerp(0.25, 0.94, s); b = lerp(0.15, 0.92, s);
                    } else if (hNorm > 0.5) {
                        // Vivid bright crimson peaks
                        r = 0.92 + n1 * 0.06; g = 0.15 + n1 * 0.03; b = 0.08 + n1 * 0.02;
                    } else if (hNorm > 0.3) {
                        // Bold red mid-slopes
                        r = 0.82 + n1 * 0.08; g = 0.14 + n1 * 0.03; b = 0.09 + n1 * 0.02;
                    } else if (hNorm > 0.1) {
                        // Saturated red lower slopes
                        r = 0.68 + n1 * 0.06; g = 0.13 + n1 * 0.03; b = 0.08 + n1 * 0.02;
                    } else {
                        // Red-brown base at edges
                        r = 0.55 + n1 * 0.05; g = 0.12 + n1 * 0.02; b = 0.07 + n1 * 0.02;
                    }
                    // Blend canal areas toward dark water blue
                    if (canalBlend > 0) {
                        r = lerp(r, 0.08, canalBlend);
                        g = lerp(g, 0.25, canalBlend);
                        b = lerp(b, 0.50, canalBlend);
                    }
                    cols.push(r, g, b);
                }
            }

            // Triangle indices
            for (let li = 0; li < latSteps; li++) {
                for (let ci = 0; ci < crossSteps; ci++) {
                    const a = li * (crossSteps + 1) + ci;
                    const b = a + 1;
                    const c = a + (crossSteps + 1);
                    const d = c + 1;
                    idxs.push(a, c, b, b, c, d);
                }
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
            geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
            geo.setIndex(idxs);
            geo.computeVertexNormals();

            const mat = new THREE.MeshPhongMaterial({
                vertexColors: true,
                shininess: 18,
                specular: 0x552222,
                emissive: 0x220808,
                emissiveIntensity: 0.25,
                side: THREE.DoubleSide,
            });

            globeGroup.add(new THREE.Mesh(geo, mat));
        });
    }

    /* ═══════ REVERSE MOUNTAIN — 3D CANAL CHANNELS ═══════ */

    function createReverseMountainCanals() {
        // Canals are purely visual via:
        // 1) Texture painting (paintReverseCanals) on globe surface
        // 2) Carved valleys in the 3D Red Line mesh (createRedLineMesh)
        // No additional 3D geometry needed — the carved Red Line
        // exposes the blue water texture underneath.
    }

    /* ═══════ CLOUD LAYER ═══════ */

    function paintClouds(ctx) {
        const img = ctx.createImageData(TEX_W, TEX_H);
        const d = img.data;
        for (let y = 0; y < TEX_H; y++) {
            for (let x = 0; x < TEX_W; x++) {
                const i = (y * TEX_W + x) * 4;
                const n = fbm(x * 0.004 + 50, y * 0.006 + 50, 4);
                const cloud = Math.max(0, n * 2.5); // threshold
                const a = Math.min(255, Math.floor(cloud * 180));
                d[i] = d[i + 1] = d[i + 2] = 255;
                d[i + 3] = a;
            }
        }
        ctx.putImageData(img, 0, 0);
    }

    /* ════════════════════════════════════════════════ */
    /*  3D SEA LABELS (Sprites)                         */
    /* ════════════════════════════════════════════════ */
    function createSeaLabels() {
        const labels = [
            { text: "East Blue", lat: 35, lng: 50, color: "#6ec6ff" },
            { text: "North Blue", lat: 35, lng: -50, color: "#c9a0e8" },
            { text: "West Blue", lat: -35, lng: -50, color: "#8ed6a0" },
            { text: "South Blue", lat: -35, lng: 50, color: "#f0c070" },
            { text: "Paradise", lat: 0, lng: 90, color: "#e0d080" },
            { text: "New World", lat: 0, lng: -90, color: "#e09070" },
        ];
        labels.forEach(l => {
            const sprite = makeTextSprite(l.text, l.color, 48);
            const pos = latLngToVec3(l.lat, l.lng, GR + 0.15);
            sprite.position.copy(pos);
            sprite.scale.set(1.8, 0.45, 1);
            sprite.material.opacity = 0.32;
            sprite.material.transparent = true;
            globeGroup.add(sprite);
            seaLabelSprites.push(sprite);
        });
    }

    function makeTextSprite(text, color, fontSize) {
        const c = makeCanvas(512, 128);
        const ctx = c.getContext("2d");
        ctx.font = `bold ${fontSize}px 'Inter', sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = color;
        ctx.fillText(text, 256, 64);
        const tex = new THREE.CanvasTexture(c);
        tex.minFilter = THREE.LinearFilter;
        return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    }

    /* ════════════════════════════════════════════════ */
    /*  ISLAND SHAPE DEFINITIONS — One Piece canonical  */
    /* ════════════════════════════════════════════════ */
    const ISLAND_SHAPES = {
        foosha:       { shape: 'round',     size: 0.08,  peaks: 2, color1: '#3d8c2f', color2: '#5ec04a', color3: '#2b6420', beach: '#f0dca0', foam: '#e8f4ff' },
        shells:       { shape: 'fortress',  size: 0.075, color1: '#4a6e52', color2: '#6a9470', color3: '#354e3a', beach: '#d8c890', foam: '#d8ecf0' },
        orange:       { shape: 'round',     size: 0.075, peaks: 0, color1: '#508838', color2: '#72b450', color3: '#3a6828', beach: '#f0dca0', foam: '#e0f0f8' },
        syrup:        { shape: 'round',     size: 0.08,  peaks: 1, color1: '#3e9035', color2: '#5cb84a', color3: '#2a6420', beach: '#f2dea0', foam: '#e4f2fc' },
        baratie:      { shape: 'ship',      size: 0.07,  color1: '#9a7030', color2: '#c09048', color3: '#7a5420', beach: '#d8bc78', foam: '#e0ecf4' },
        arlong:       { shape: 'fortress',  size: 0.075, color1: '#3a6858', color2: '#589878', color3: '#2a4a40', beach: '#c0b890', foam: '#d4e8ec' },
        loguetown:    { shape: 'round',     size: 0.085, peaks: 0, color1: '#4a6848', color2: '#6a8868', color3: '#384e38', beach: '#d8c8a0', foam: '#dce8f0' },
        reverse:      { shape: 'mountain',  size: 0.10,  color1: '#9a5028', color2: '#c07038', color3: '#703818', beach: '#c0a060', peakColor: '#f4ece0', foam: '#d0e0ea' },
        twincape:     { shape: 'round',     size: 0.065, peaks: 0, color1: '#4a8a58', color2: '#6cb87a', color3: '#386840', beach: '#e8dab0', foam: '#e0f0f8' },
        whisky:       { shape: 'round',     size: 0.075, peaks: 3, color1: '#506840', color2: '#709858', color3: '#3a5030', beach: '#d8c890', foam: '#dce8f0' },
        littlegarden: { shape: 'round',     size: 0.10,  peaks: 0, color1: '#1a7818', color2: '#30a828', color3: '#105010', beach: '#b0a868', foam: '#d4e8d8' },
        drum:         { shape: 'mountain',  size: 0.11,  color1: '#8898b0', color2: '#a8bcd4', color3: '#6878a0', beach: '#b8c0d0', peakColor: '#f8f8ff', foam: '#c8d8e8' },
        alabasta:     { shape: 'desert',    size: 0.15,  color1: '#d4a848', color2: '#ecc870', color3: '#b08830', beach: '#f0dca0', foam: '#e8f0e0' },
        jaya:         { shape: 'crescent',  size: 0.10,  color1: '#2e8828', color2: '#4cb840', color3: '#1e6018', beach: '#d8c890', foam: '#dcecd8' },
        skypiea:      { shape: 'cloud',     size: 0.10,  color1: '#f0e8d8', color2: '#f8f4ec', color3: '#e0d8c0', beach: '#c0daf0', foam: '#e8f4ff' },
        longring:     { shape: 'elongated', size: 0.11,  color1: '#4a8848', color2: '#6cb860', color3: '#386838', beach: '#dcd0a0', foam: '#dcecd8' },
        water7:       { shape: 'ring',      size: 0.13,  color1: '#3870a8', color2: '#58a0d8', color3: '#285890', beach: '#c8c0a0', foam: '#d8ecf8' },
        enies:        { shape: 'ring',      size: 0.09,  color1: '#6a8a58', color2: '#8ab878', color3: '#506840', beach: '#d8d0a8', foam: '#e0ecf0' },
        thriller:     { shape: 'ship',      size: 0.12,  color1: '#382848', color2: '#584870', color3: '#281838', beach: '#585060', foam: '#706878' },
        sabaody:      { shape: 'tree',      size: 0.11,  color1: '#308848', color2: '#50b868', color3: '#206830', beach: '#a8c898', foam: '#d8f0e0' },
        amazon:       { shape: 'round',     size: 0.085, peaks: 1, color1: '#1e8820', color2: '#38b838', color3: '#106010', beach: '#b0a860', foam: '#d0e8d0' },
        impel:        { shape: 'fortress',  size: 0.085, color1: '#6a2828', color2: '#904040', color3: '#4a1818', beach: '#987060', foam: '#c0a8a0' },
        marineford:   { shape: 'crescent',  size: 0.10,  color1: '#607888', color2: '#80a0b8', color3: '#485868', beach: '#c0b8a8', foam: '#d8e4ec' },
        kuraigana:    { shape: 'round',     size: 0.075, peaks: 1, color1: '#2c3830', color2: '#445848', color3: '#1c2820', beach: '#787870', foam: '#989898' },
        weatheria:    { shape: 'cloud',     size: 0.075, color1: '#d8d8e8', color2: '#ececf8', color3: '#c0c0d0', beach: '#a8c8e8', foam: '#d8ecf8' },
        boin:         { shape: 'round',     size: 0.085, peaks: 0, color1: '#18a018', color2: '#30d830', color3: '#107010', beach: '#98c060', foam: '#c8e8c0' },
        kamabakka:    { shape: 'round',     size: 0.075, peaks: 0, color1: '#a04898', color2: '#c868b8', color3: '#783078', beach: '#e0b0d0', foam: '#f0d8e8' },
        torino:       { shape: 'round',     size: 0.075, peaks: 2, color1: '#2e9028', color2: '#48b840', color3: '#1e6818', beach: '#b8b070', foam: '#d0e8d0' },
        baldimore:    { shape: 'mountain',  size: 0.08,  color1: '#7088a0', color2: '#90b0c8', color3: '#586880', beach: '#b0b8c0', peakColor: '#e8e8f0', foam: '#c8d8e8' },
        tequila:      { shape: 'elongated', size: 0.085, color1: '#506878', color2: '#708898', color3: '#3a5060', beach: '#a0a8b0', foam: '#c0d0d8' },
        harahettania: { shape: 'round',     size: 0.065, peaks: 1, color1: '#484038', color2: '#686058', color3: '#302820', beach: '#988870', foam: '#b8b0a8' },
        namakura:     { shape: 'round',     size: 0.065, peaks: 0, color1: '#4a4240', color2: '#6a6260', color3: '#343030', beach: '#988888', foam: '#b8b0b0' },
        rusukaina:    { shape: 'round',     size: 0.085, peaks: 2, color1: '#208820', color2: '#38b838', color3: '#106010', beach: '#a0a060', foam: '#c8e0c0' },
        fishman:      { shape: 'ring',      size: 0.10,  color1: '#2870b0', color2: '#48a0e0', color3: '#1858a0', beach: '#68b8e0', foam: '#c0e0f8' },
        punk:         { shape: 'volcano',   size: 0.10,  color1: '#984020', color2: '#3878b0', color3: '#682810', beach: '#887060', foam: '#b8a8a0' },
        dressrosa:    { shape: 'round',     size: 0.12,  peaks: 0, color1: '#d06080', color2: '#f080a0', color3: '#a84868', beach: '#f0d0c0', foam: '#f8e4e0' },
        zou:          { shape: 'round',     size: 0.10,  peaks: 3, color1: '#4a7848', color2: '#68a860', color3: '#385830', beach: '#c0b888', foam: '#dce8d8' },
        wholecake:    { shape: 'star',      size: 0.14,  color1: '#e07088', color2: '#f898b0', color3: '#c05070', beach: '#f8d8c8', foam: '#fff0e8' },
        wano:         { shape: 'samurai',   size: 0.15,  color1: '#3a9838', color2: '#58c050', color3: '#286828', beach: '#d0c088', foam: '#dce8d0' },
        egghead:      { shape: 'futuristic',size: 0.10,  color1: '#8898c0', color2: '#a8b8e0', color3: '#6878a0', beach: '#c0c8d8', foam: '#d8e4f0' },
        ohara:        { shape: 'tree',      size: 0.08,  color1: '#308838', color2: '#50b058', color3: '#206028', beach: '#b0a870', foam: '#d0e0d0' },
        germa:        { shape: 'ship',      size: 0.085, color1: '#506070', color2: '#708090', color3: '#384850', beach: '#909898', foam: '#b8c8d0' },
        cocoyashi:    { shape: 'round',     size: 0.07,  peaks: 0, color1: '#409048', color2: '#60b868', color3: '#306830', beach: '#d8d0a0', foam: '#e0ecd8' },

        // ── North Blue (additional) ──
        lvneel:       { shape: 'round',     size: 0.08,  peaks: 1, color1: '#4a7858', color2: '#6aa878', color3: '#385838', beach: '#d8d0a8', foam: '#e0ecf0' },
        flevance:     { shape: 'round',     size: 0.075, peaks: 0, color1: '#c0c0c0', color2: '#e0e0e0', color3: '#989898', beach: '#e8e8e8', foam: '#f0f0f0' },
        minion_island:{ shape: 'mountain',  size: 0.07,  color1: '#607080', color2: '#8098b0', color3: '#485868', beach: '#a0a8b0', peakColor: '#e8f0f8', foam: '#c0d0d8' },
        swallow:      { shape: 'round',     size: 0.06,  peaks: 0, color1: '#4a7050', color2: '#6a9870', color3: '#3a5840', beach: '#c8c0a0', foam: '#dce8d8' },
        spider_miles: { shape: 'round',     size: 0.065, peaks: 0, color1: '#484040', color2: '#686060', color3: '#303030', beach: '#908878', foam: '#b0a8a0' },
        notice:       { shape: 'round',     size: 0.055, peaks: 0, color1: '#507858', color2: '#70a078', color3: '#3a5840', beach: '#c8c0a0', foam: '#dce8d8' },

        // ── West Blue (additional) ──
        ilusia:       { shape: 'round',     size: 0.075, peaks: 1, color1: '#4878a0', color2: '#68a0c8', color3: '#386090', beach: '#c0c8d0', foam: '#d8e4f0' },
        sorbet:       { shape: 'round',     size: 0.07,  peaks: 0, color1: '#507848', color2: '#70a068', color3: '#3a5838', beach: '#c8c098', foam: '#dce8d0' },
        karate_island:{ shape: 'round',     size: 0.065, peaks: 0, color1: '#587060', color2: '#789880', color3: '#405848', beach: '#c0b898', foam: '#d8e4d8' },

        // ── South Blue (additional) ──
        briss:        { shape: 'round',     size: 0.065, peaks: 0, color1: '#488858', color2: '#68b078', color3: '#386840', beach: '#d0c8a0', foam: '#e0ecd8' },
        centaurea:    { shape: 'round',     size: 0.06,  peaks: 0, color1: '#508050', color2: '#70a870', color3: '#3a6038', beach: '#c8c0a0', foam: '#dce8d0' },

        // ── Grand Line — Paradise (additional) ──
        banaro:       { shape: 'round',     size: 0.08,  peaks: 2, color1: '#5a7848', color2: '#7aa068', color3: '#445a38', beach: '#d0c898', foam: '#dce8d0' },
        baltigo:      { shape: 'round',     size: 0.075, peaks: 0, color1: '#808068', color2: '#a8a888', color3: '#606048', beach: '#c8c0a0', foam: '#e0e0d0' },
        san_faldo:    { shape: 'round',     size: 0.065, peaks: 0, color1: '#488848', color2: '#68b068', color3: '#386838', beach: '#d0c898', foam: '#dce8d0' },
        pucci:        { shape: 'round',     size: 0.06,  peaks: 0, color1: '#a06080', color2: '#c080a0', color3: '#804868', beach: '#e0c8d0', foam: '#f0e0e8' },
        st_poplar:    { shape: 'round',     size: 0.065, peaks: 1, color1: '#4a8850', color2: '#68b068', color3: '#386840', beach: '#d0c898', foam: '#dce8d0' },

        // ── Government / Red Line ──
        mariejois:    { shape: 'fortress',  size: 0.12,  color1: '#c8a848', color2: '#e8c868', color3: '#a88838', beach: '#f0e0b0', foam: '#f8f0d8' },

        // ── New World (additional) ──
        raijin:       { shape: 'round',     size: 0.075, peaks: 3, color1: '#384068', color2: '#586090', color3: '#283050', beach: '#707888', foam: '#909ca8' },
        risky_red:    { shape: 'round',     size: 0.07,  peaks: 1, color1: '#8a3838', color2: '#b05050', color3: '#6a2828', beach: '#c09080', foam: '#d8b8b0' },
        mystoria:     { shape: 'round',     size: 0.065, peaks: 2, color1: '#484858', color2: '#686878', color3: '#383848', beach: '#888890', foam: '#a8a8b0' },
        greenbit:     { shape: 'round',     size: 0.06,  peaks: 0, color1: '#189818', color2: '#30c830', color3: '#107010', beach: '#98b868', foam: '#c8e0c0' },
        prodence:     { shape: 'round',     size: 0.075, peaks: 1, color1: '#5a7048', color2: '#7a9868', color3: '#445838', beach: '#c8c098', foam: '#dce8d0' },
        applenine:    { shape: 'round',     size: 0.06,  peaks: 0, color1: '#a04040', color2: '#c86060', color3: '#803030', beach: '#d0a898', foam: '#e8c8c0' },
        sphinx_island:{ shape: 'round',     size: 0.08,  peaks: 2, color1: '#c0a040', color2: '#e0c060', color3: '#a08030', beach: '#e0d0a0', foam: '#f0e8d0' },
        cacao:        { shape: 'round',     size: 0.075, peaks: 0, color1: '#704020', color2: '#905838', color3: '#583018', beach: '#c0a070', foam: '#d8c8a8' },
        nuts_island:  { shape: 'round',     size: 0.06,  peaks: 0, color1: '#c08848', color2: '#e0a868', color3: '#a07038', beach: '#e8d0a8', foam: '#f0e8d8' },
        wheat:        { shape: 'round',     size: 0.06,  peaks: 0, color1: '#c8a848', color2: '#e8c868', color3: '#a88838', beach: '#f0dca0', foam: '#f8f0d8' },
        elbaf:        { shape: 'mountain',  size: 0.14,  color1: '#4a8838', color2: '#68b050', color3: '#386828', beach: '#c0b070', peakColor: '#e8e0d0', foam: '#d8e8d0' },
        onigashima:   { shape: 'fortress',  size: 0.09,  color1: '#483838', color2: '#685858', color3: '#302828', beach: '#787068', foam: '#989088' },
        hachinosu:    { shape: 'fortress',  size: 0.10,  color1: '#3a3048', color2: '#5a4868', color3: '#2a2038', beach: '#686068', foam: '#888088' },
        lodestar:     { shape: 'star',      size: 0.08,  color1: '#486888', color2: '#68a0b8', color3: '#385070', beach: '#a8b8c8', foam: '#c8d8e8' },
        laughtale:    { shape: 'star',      size: 0.12,  color1: '#d8a030', color2: '#f8c848', color3: '#b88020', beach: '#f0dca0', foam: '#f8f0d8' },
        god_valley:   { shape: 'round',     size: 0.07,  peaks: 0, color1: '#585050', color2: '#787070', color3: '#403838', beach: '#808078', foam: '#a0a098' },
        winners:      { shape: 'round',     size: 0.06,  peaks: 0, color1: '#4a7850', color2: '#68a068', color3: '#385838', beach: '#c8c098', foam: '#dce8d0' },
        foodvalten:   { shape: 'round',     size: 0.065, peaks: 0, color1: '#508048', color2: '#70a868', color3: '#3a6038', beach: '#c8c098', foam: '#dce8d0' },

        // ── Sky Islands (additional) ──
        birka:        { shape: 'cloud',     size: 0.08,  color1: '#e0d8c8', color2: '#f0ece0', color3: '#d0c8b0', beach: '#b8d0e8', foam: '#d8e8f8' },
    };

    /* ════════════════════════════════════════════════ */
    /*  ISLAND TEXTURE GENERATOR — Hi-res anime style   */
    /* ════════════════════════════════════════════════ */
    function generateIslandCanvas(id, shapeDef) {
        const S = 256;
        const c = makeCanvas(S, S);
        const ctx = c.getContext('2d');
        const cx = S / 2, cy = S / 2, maxR = S * 0.40;
        const seed = hashStr(id);

        ctx.clearRect(0, 0, S, S);
        const path = getIslandPath(shapeDef, cx, cy, maxR, id);
        const path2d = getPath2D(path);

        // 1) Drop shadow — gives islands depth
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = 'rgba(0,0,0,0.01)';
        drawScaledPath(ctx, path, cx, cy, 1.02);
        ctx.fill();
        ctx.restore();

        // 2) Shallow water / reef glow
        ctx.save();
        const foam = shapeDef.foam || '#e0f0f8';
        const fr = parseInt(foam.slice(1,3),16), fg = parseInt(foam.slice(3,5),16), fb = parseInt(foam.slice(5,7),16);
        for (let ring = 3; ring >= 0; ring--) {
            const scale = 1.22 - ring * 0.04;
            const alpha = 0.08 + ring * 0.06;
            ctx.fillStyle = `rgba(${fr},${fg},${fb},${alpha})`;
            drawScaledPath(ctx, path, cx, cy, scale);
            ctx.fill();
        }
        ctx.restore();

        // 3) Beach / sand ring
        ctx.save();
        const beachC = shapeDef.beach || '#f0dca0';
        const bg = ctx.createRadialGradient(cx, cy, maxR * 0.5, cx, cy, maxR * 1.1);
        bg.addColorStop(0, beachC);
        bg.addColorStop(1, darkenHex(beachC, 0.85));
        ctx.fillStyle = bg;
        drawScaledPath(ctx, path, cx, cy, 1.08);
        ctx.fill();
        ctx.restore();

        // 4) Main terrain fill with multi-stop gradient
        ctx.save();
        const c1 = shapeDef.color1 || '#4a8040';
        const c2 = shapeDef.color2 || '#7ab060';
        const c3 = shapeDef.color3 || darkenHex(c1, 0.7);
        const landGrad = ctx.createRadialGradient(
            cx - maxR * 0.15, cy - maxR * 0.15, 0,
            cx + maxR * 0.1, cy + maxR * 0.1, maxR * 1.05
        );
        landGrad.addColorStop(0, c2);
        landGrad.addColorStop(0.35, c1);
        landGrad.addColorStop(0.7, c3);
        landGrad.addColorStop(1, darkenHex(c3, 0.8));
        ctx.fillStyle = landGrad;
        drawPath(ctx, path);
        ctx.fill();
        ctx.restore();

        // 5) Per-pixel noise terrain texture (clipped)
        ctx.save();
        ctx.clip(path2d);
        const img = ctx.getImageData(0, 0, S, S);
        const d = img.data;
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const i = (y * S + x) * 4;
                if (d[i + 3] < 10) continue;
                const n1 = fbm((x + seed) * 0.04, (y + seed * 0.7) * 0.04, 3);
                const n2 = fbm((x + seed * 1.3) * 0.08, (y + seed * 0.3) * 0.08, 2) * 0.5;
                const bright = (n1 + n2) * 20;
                d[i]     = Math.max(0, Math.min(255, d[i] + bright));
                d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + bright));
                d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + bright * 0.7));
            }
        }
        ctx.putImageData(img, 0, 0);

        // 6) Shape-specific iconic details
        drawShapeDetails(ctx, shapeDef, cx, cy, maxR, seed);
        ctx.restore();

        // 7) Coastline wave foam — white broken line along shore
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 5]);
        drawScaledPath(ctx, path, cx, cy, 1.06);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // 8) Anime-style dark outline
        ctx.save();
        ctx.strokeStyle = 'rgba(20,15,10,0.55)';
        ctx.lineWidth = 2.5;
        drawPath(ctx, path);
        ctx.stroke();
        ctx.restore();

        // 9) Top-left highlight (sun reflection)
        ctx.save();
        ctx.clip(path2d);
        const shine = ctx.createRadialGradient(cx - maxR * 0.3, cy - maxR * 0.3, 0, cx, cy, maxR * 0.9);
        shine.addColorStop(0, 'rgba(255,255,240,0.18)');
        shine.addColorStop(0.5, 'rgba(255,255,240,0.05)');
        shine.addColorStop(1, 'rgba(0,0,0,0.06)');
        ctx.fillStyle = shine;
        ctx.fillRect(0, 0, S, S);
        ctx.restore();

        return c;
    }

    function darkenHex(hex, factor) {
        const r = Math.floor(parseInt(hex.slice(1,3),16) * factor);
        const g = Math.floor(parseInt(hex.slice(3,5),16) * factor);
        const b = Math.floor(parseInt(hex.slice(5,7),16) * factor);
        return `rgb(${r},${g},${b})`;
    }

    /* ── Shape path generators ── */
    function getIslandPath(def, cx, cy, R, id) {
        const seed = hashStr(id);
        const pts = [];
        const steps = 48;

        switch (def.shape) {
            case 'crescent': {
                // Jaya / Marineford — crescent moon shape
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    let r = R * 0.9;
                    // Indent one side to create crescent
                    const indent = Math.max(0, Math.cos(a - 0.3)) * R * 0.45;
                    r -= indent;
                    r += wobble(a, seed) * R * 0.06;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                break;
            }
            case 'star': {
                // Whole Cake Island — star/flower shape
                const tips = 6;
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    const mod = Math.cos(a * tips) * 0.3 + 0.7;
                    const r = R * mod + wobble(a, seed) * R * 0.04;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                break;
            }
            case 'desert': {
                // Alabasta — large irregular blob
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    let r = R * (0.7 + 0.3 * Math.abs(Math.sin(a * 2.3 + 1)));
                    r += wobble(a, seed) * R * 0.1;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                break;
            }
            case 'mountain': {
                // Drum / Reverse Mountain — round with protruding peaks
                const peakCount = 3;
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    let r = R * 0.65;
                    for (let p = 0; p < peakCount; p++) {
                        const pa = (p / peakCount) * Math.PI * 2 + 0.5;
                        const dist = Math.abs(angleDiff(a, pa));
                        if (dist < 0.5) r += R * 0.4 * (1 - dist / 0.5);
                    }
                    r += wobble(a, seed) * R * 0.05;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                break;
            }
            case 'ring': {
                // Water 7 / Fish-Man Island — round with lagoon center
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    const r = R * 0.9 + wobble(a, seed) * R * 0.06;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                break;
            }
            case 'elongated': {
                // Long Ring Long Land — stretched ellipse
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    const rx = R * 1.1, ry = R * 0.45;
                    const r = (rx * ry) / Math.sqrt((ry * Math.cos(a)) ** 2 + (rx * Math.sin(a)) ** 2);
                    pts.push([cx + Math.cos(a) * (r + wobble(a, seed) * R * 0.04),
                              cy + Math.sin(a) * (r + wobble(a, seed + 50) * R * 0.04)]);
                }
                break;
            }
            case 'ship': {
                // Baratie / Thriller Bark / Germa — ship hull shape
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    const rx = R * 0.9, ry = R * 0.5;
                    let r = (rx * ry) / Math.sqrt((ry * Math.cos(a)) ** 2 + (rx * Math.sin(a)) ** 2);
                    // Sharpen the bow
                    if (Math.cos(a) > 0.7) r += R * 0.2 * (Math.cos(a) - 0.7) / 0.3;
                    r += wobble(a, seed) * R * 0.03;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                break;
            }
            case 'tree': {
                // Sabaody / Ohara — cluster of circular blobs
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    let r = R * 0.55;
                    // Multiple lobes
                    r += Math.abs(Math.sin(a * 3 + 1)) * R * 0.35;
                    r += wobble(a, seed) * R * 0.05;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                break;
            }
            case 'volcano': {
                // Punk Hazard — split island (fire/ice)
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    let r = R * 0.8;
                    // Slight pinch in middle to show split
                    if (Math.abs(Math.sin(a)) < 0.2) r *= 0.85;
                    r += wobble(a, seed) * R * 0.06;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                break;
            }
            case 'fortress': {
                // Shells Town / Arlong Park / Impel Down — angular, fortress-like
                const sides = 6;
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    const snap = Math.cos(a * sides) * 0.12 + 0.88;
                    const r = R * snap + wobble(a, seed) * R * 0.04;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                break;
            }
            case 'samurai': {
                // Wano — organic landmass with multiple peninsulas
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    let r = R * 0.6;
                    r += Math.abs(Math.sin(a * 2 + 0.8)) * R * 0.3;
                    r += Math.max(0, Math.cos(a * 3 - 1)) * R * 0.15;
                    r += wobble(a, seed) * R * 0.06;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                break;
            }
            case 'futuristic': {
                // Egghead — egg/dome shape
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    const ry = R * 0.95, rx = R * 0.75;
                    const r = (rx * ry) / Math.sqrt((ry * Math.cos(a)) ** 2 + (rx * Math.sin(a)) ** 2);
                    pts.push([cx + Math.cos(a) * r + wobble(a, seed) * R * 0.02,
                              cy + Math.sin(a) * r + wobble(a, seed + 30) * R * 0.02]);
                }
                break;
            }
            case 'cloud': {
                // Skypiea / Weatheria — fluffy cloud outline
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    let r = R * 0.6;
                    r += Math.abs(Math.sin(a * 4 + 2)) * R * 0.3;
                    r += wobble(a, seed) * R * 0.08;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                break;
            }
            default: { // 'round' with optional peaks
                const peaks = def.peaks || 0;
                for (let i = 0; i <= steps; i++) {
                    const a = (i / steps) * Math.PI * 2;
                    let r = R * 0.8;
                    for (let p = 0; p < peaks; p++) {
                        const pa = (p / Math.max(1, peaks)) * Math.PI * 2 + pseudoRand(seed + p) * 2;
                        const dist = Math.abs(angleDiff(a, pa));
                        if (dist < 0.6) r += R * 0.2 * (1 - dist / 0.6);
                    }
                    r += wobble(a, seed) * R * 0.07;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
            }
        }
        return pts;
    }

    function drawShapeDetails(ctx, def, cx, cy, R, seed) {
        switch (def.shape) {
            case 'mountain': {
                // Drum Island / Reverse Mountain: prominent snowy peaks with rocky sides
                const pc = def.peakColor || '#f0f0f8';
                const peakAngles = [0.5, 2.1, 4.0];
                peakAngles.forEach((pa, i) => {
                    const dist = 0.25 + pseudoRand(seed + i * 17) * 0.15;
                    const px = cx + Math.cos(pa) * R * dist;
                    const py = cy + Math.sin(pa) * R * dist;
                    const pr = R * (0.2 + pseudoRand(seed + i * 23) * 0.12);
                    // Rocky base
                    const rocky = ctx.createRadialGradient(px, py, pr * 0.3, px, py, pr);
                    rocky.addColorStop(0, 'rgba(130,120,110,0.4)');
                    rocky.addColorStop(1, 'rgba(130,120,110,0)');
                    ctx.fillStyle = rocky; ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
                    // Snow cap
                    const sg = ctx.createRadialGradient(px, py - pr * 0.15, 0, px, py, pr * 0.65);
                    sg.addColorStop(0, pc);
                    sg.addColorStop(0.6, 'rgba(240,240,250,0.5)');
                    sg.addColorStop(1, 'rgba(255,255,255,0)');
                    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(px, py, pr * 0.65, 0, Math.PI * 2); ctx.fill();
                });
                // Snow streaks
                ctx.strokeStyle = 'rgba(240,245,255,0.15)';
                ctx.lineWidth = 1;
                for (let i = 0; i < 8; i++) {
                    const sx = cx + (pseudoRand(seed + i * 31) - 0.5) * R * 1.4;
                    const sy = cy + (pseudoRand(seed + i * 37) - 0.5) * R * 1.4;
                    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 8, sy + 12); ctx.stroke();
                }
                break;
            }
            case 'desert': {
                // Alabasta: sand dunes with wind patterns, river, oasis, city
                ctx.strokeStyle = 'rgba(160,130,60,0.25)';
                ctx.lineWidth = 2;
                for (let i = 0; i < 8; i++) {
                    const y = cy - R * 0.7 + i * R * 0.2;
                    ctx.beginPath();
                    for (let x = cx - R; x <= cx + R; x += 2) {
                        const wy = y + Math.sin(x * 0.06 + i * 1.8 + seed * 0.01) * 5 + Math.sin(x * 0.12) * 2;
                        x === cx - R ? ctx.moveTo(x, wy) : ctx.lineTo(x, wy);
                    }
                    ctx.stroke();
                }
                // Sandstorm River through middle
                ctx.strokeStyle = 'rgba(80,140,180,0.35)';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(cx - R * 0.6, cy + R * 0.3);
                ctx.bezierCurveTo(cx - R * 0.2, cy - R * 0.1, cx + R * 0.1, cy + R * 0.2, cx + R * 0.5, cy - R * 0.15);
                ctx.stroke();
                // Alubarna (capital city dot)
                const cityG = ctx.createRadialGradient(cx + R * 0.1, cy - R * 0.1, 0, cx + R * 0.1, cy - R * 0.1, R * 0.15);
                cityG.addColorStop(0, 'rgba(220,200,140,0.6)');
                cityG.addColorStop(0.5, 'rgba(200,180,120,0.3)');
                cityG.addColorStop(1, 'rgba(200,180,120,0)');
                ctx.fillStyle = cityG; ctx.beginPath(); ctx.arc(cx + R * 0.1, cy - R * 0.1, R * 0.15, 0, Math.PI * 2); ctx.fill();
                // Oasis
                ctx.fillStyle = 'rgba(30,160,70,0.5)';
                ctx.beginPath(); ctx.arc(cx - R * 0.25, cy + R * 0.15, R * 0.09, 0, Math.PI * 2); ctx.fill();
                break;
            }
            case 'ring': {
                // Water 7 / Fish-Man Island: central lagoon or underwater dome
                const waterG = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 0.5);
                waterG.addColorStop(0, 'rgba(20,80,160,0.7)');
                waterG.addColorStop(0.5, 'rgba(30,120,200,0.5)');
                waterG.addColorStop(1, 'rgba(40,140,180,0.2)');
                ctx.fillStyle = waterG; ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2); ctx.fill();
                // Waterfall / fountain spray at center
                const sprayG = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.15);
                sprayG.addColorStop(0, 'rgba(200,230,255,0.6)');
                sprayG.addColorStop(1, 'rgba(200,230,255,0)');
                ctx.fillStyle = sprayG; ctx.beginPath(); ctx.arc(cx, cy, R * 0.15, 0, Math.PI * 2); ctx.fill();
                // Bridge lines
                ctx.strokeStyle = 'rgba(180,160,120,0.3)';
                ctx.lineWidth = 2;
                for (let i = 0; i < 4; i++) {
                    const a = (i / 4) * Math.PI * 2 + 0.4;
                    ctx.beginPath();
                    ctx.moveTo(cx + Math.cos(a) * R * 0.15, cy + Math.sin(a) * R * 0.15);
                    ctx.lineTo(cx + Math.cos(a) * R * 0.65, cy + Math.sin(a) * R * 0.65);
                    ctx.stroke();
                }
                break;
            }
            case 'star': {
                // Whole Cake Island: cream swirls, berry decorations, central cake tower
                // Cream swirl pattern
                ctx.strokeStyle = 'rgba(255,220,230,0.35)';
                ctx.lineWidth = 3;
                for (let i = 0; i < 3; i++) {
                    ctx.beginPath();
                    const startA = (i / 3) * Math.PI * 2;
                    for (let t = 0; t < 40; t++) {
                        const a = startA + t * 0.15;
                        const sr = R * 0.08 + t * R * 0.018;
                        const x = cx + Math.cos(a) * sr;
                        const y = cy + Math.sin(a) * sr;
                        t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                    }
                    ctx.stroke();
                }
                // Berry/fruit dots on tips
                for (let i = 0; i < 6; i++) {
                    const a = (i / 6) * Math.PI * 2;
                    const px = cx + Math.cos(a) * R * 0.65;
                    const py = cy + Math.sin(a) * R * 0.65;
                    const colors = ['rgba(220,60,80,0.5)', 'rgba(255,180,60,0.5)', 'rgba(180,80,200,0.5)'];
                    ctx.fillStyle = colors[i % 3];
                    ctx.beginPath(); ctx.arc(px, py, R * 0.07, 0, Math.PI * 2); ctx.fill();
                }
                // Central castle/cake
                const cakeG = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.22);
                cakeG.addColorStop(0, 'rgba(255,200,210,0.7)');
                cakeG.addColorStop(0.6, 'rgba(230,150,170,0.4)');
                cakeG.addColorStop(1, 'rgba(220,130,150,0)');
                ctx.fillStyle = cakeG; ctx.beginPath(); ctx.arc(cx, cy, R * 0.22, 0, Math.PI * 2); ctx.fill();
                break;
            }
            case 'volcano': {
                // Punk Hazard: fire/ice split, lava veins, ice crystals
                // Fire side
                const fireG = ctx.createLinearGradient(cx - R, cy, cx, cy);
                fireG.addColorStop(0, 'rgba(220,60,20,0.35)');
                fireG.addColorStop(0.7, 'rgba(180,40,10,0.2)');
                fireG.addColorStop(1, 'rgba(100,30,10,0)');
                ctx.fillStyle = fireG; ctx.fillRect(cx - R, cy - R, R, R * 2);
                // Lava veins
                ctx.strokeStyle = 'rgba(255,100,20,0.4)';
                ctx.lineWidth = 1.5;
                for (let i = 0; i < 4; i++) {
                    ctx.beginPath();
                    const sy = cy + (pseudoRand(seed + i * 43) - 0.5) * R * 1.2;
                    ctx.moveTo(cx - R * 0.8, sy);
                    ctx.bezierCurveTo(cx - R * 0.5, sy + 8, cx - R * 0.3, sy - 6, cx - R * 0.05, sy + 3);
                    ctx.stroke();
                }
                // Ice side
                const iceG = ctx.createLinearGradient(cx, cy, cx + R, cy);
                iceG.addColorStop(0, 'rgba(40,120,200,0)');
                iceG.addColorStop(0.3, 'rgba(100,180,240,0.2)');
                iceG.addColorStop(1, 'rgba(160,210,250,0.35)');
                ctx.fillStyle = iceG; ctx.fillRect(cx, cy - R, R, R * 2);
                // Ice crystals
                ctx.fillStyle = 'rgba(200,230,255,0.3)';
                for (let i = 0; i < 5; i++) {
                    const ix = cx + R * 0.2 + pseudoRand(seed + i * 53) * R * 0.5;
                    const iy = cy + (pseudoRand(seed + i * 59) - 0.5) * R * 1.2;
                    ctx.beginPath(); ctx.arc(ix, iy, 3 + pseudoRand(seed + i) * 5, 0, Math.PI * 2); ctx.fill();
                }
                // Center dividing line
                ctx.strokeStyle = 'rgba(60,40,30,0.4)';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
                break;
            }
            case 'samurai': {
                // Wano: Mt. Fuji, rivers, cherry blossom regions, waterfall
                // Mt. Fuji (top area)
                const fujiX = cx + R * 0.05, fujiY = cy - R * 0.2;
                ctx.beginPath();
                ctx.moveTo(fujiX - R * 0.22, fujiY + R * 0.2);
                ctx.lineTo(fujiX, fujiY - R * 0.18);
                ctx.lineTo(fujiX + R * 0.22, fujiY + R * 0.2);
                ctx.closePath();
                const fujiG = ctx.createLinearGradient(fujiX, fujiY - R * 0.18, fujiX, fujiY + R * 0.2);
                fujiG.addColorStop(0, 'rgba(240,240,255,0.7)');
                fujiG.addColorStop(0.35, 'rgba(160,140,130,0.5)');
                fujiG.addColorStop(1, 'rgba(100,120,80,0.2)');
                ctx.fillStyle = fujiG; ctx.fill();
                // Rivers
                ctx.strokeStyle = 'rgba(50,120,200,0.4)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(cx - R * 0.5, cy - R * 0.1);
                ctx.bezierCurveTo(cx - R * 0.2, cy + R * 0.1, cx + R * 0.1, cy - R * 0.05, cx + R * 0.5, cy + R * 0.3);
                ctx.stroke();
                // Cherry blossom patches
                const blossomColors = ['rgba(255,180,200,0.35)', 'rgba(255,150,180,0.3)', 'rgba(255,200,210,0.25)'];
                for (let i = 0; i < 7; i++) {
                    const bx = cx + (pseudoRand(seed + i * 67) - 0.5) * R * 1.4;
                    const by = cy + (pseudoRand(seed + i * 71) - 0.5) * R * 1.4;
                    ctx.fillStyle = blossomColors[i % 3];
                    ctx.beginPath(); ctx.arc(bx, by, R * 0.06 + pseudoRand(seed + i) * R * 0.06, 0, Math.PI * 2); ctx.fill();
                }
                // Waterfall line
                ctx.strokeStyle = 'rgba(180,220,255,0.4)';
                ctx.lineWidth = 2.5;
                ctx.beginPath(); ctx.moveTo(cx + R * 0.6, cy - R * 0.4); ctx.lineTo(cx + R * 0.62, cy + R * 0.15); ctx.stroke();
                break;
            }
            case 'futuristic': {
                // Egghead: dome with tech rings, holographic glow, circuit lines
                // Concentric tech rings
                ctx.strokeStyle = 'rgba(140,180,255,0.3)';
                ctx.lineWidth = 1.5;
                [0.65, 0.5, 0.35, 0.2].forEach(s => {
                    ctx.beginPath(); ctx.arc(cx, cy, R * s, 0, Math.PI * 2); ctx.stroke();
                });
                // Circuit lines
                ctx.strokeStyle = 'rgba(100,160,255,0.25)';
                ctx.lineWidth = 1;
                for (let i = 0; i < 6; i++) {
                    const a = (i / 6) * Math.PI * 2;
                    ctx.beginPath();
                    ctx.moveTo(cx, cy);
                    ctx.lineTo(cx + Math.cos(a) * R * 0.7, cy + Math.sin(a) * R * 0.7);
                    ctx.stroke();
                }
                // Central dome glow
                const domeG = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.3);
                domeG.addColorStop(0, 'rgba(180,220,255,0.5)');
                domeG.addColorStop(0.5, 'rgba(140,180,240,0.2)');
                domeG.addColorStop(1, 'rgba(140,180,240,0)');
                ctx.fillStyle = domeG; ctx.beginPath(); ctx.arc(cx, cy, R * 0.3, 0, Math.PI * 2); ctx.fill();
                // Pulsing data dots
                ctx.fillStyle = 'rgba(100,200,255,0.4)';
                for (let i = 0; i < 8; i++) {
                    const a = (i / 8) * Math.PI * 2 + 0.2;
                    const pr = R * (0.3 + pseudoRand(seed + i * 83) * 0.25);
                    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * pr, cy + Math.sin(a) * pr, 2.5, 0, Math.PI * 2); ctx.fill();
                }
                break;
            }
            case 'cloud': {
                // Skypiea / Weatheria: fluffy cloud layers, golden city hints
                for (let i = 0; i < 12; i++) {
                    const px = cx + (pseudoRand(seed + i * 5) - 0.5) * R * 1.4;
                    const py = cy + (pseudoRand(seed + i * 5 + 1) - 0.5) * R * 1.4;
                    const pr = R * 0.12 + pseudoRand(seed + i * 5 + 2) * R * 0.18;
                    const cg = ctx.createRadialGradient(px, py, 0, px, py, pr);
                    cg.addColorStop(0, 'rgba(255,255,255,0.3)');
                    cg.addColorStop(1, 'rgba(255,255,255,0)');
                    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
                }
                // Golden city shimmer
                const goldG = ctx.createRadialGradient(cx + R * 0.1, cy - R * 0.1, 0, cx, cy, R * 0.35);
                goldG.addColorStop(0, 'rgba(255,215,100,0.3)');
                goldG.addColorStop(0.5, 'rgba(255,200,80,0.1)');
                goldG.addColorStop(1, 'rgba(255,200,80,0)');
                ctx.fillStyle = goldG; ctx.beginPath(); ctx.arc(cx, cy, R * 0.35, 0, Math.PI * 2); ctx.fill();
                break;
            }
            case 'ship': {
                // Baratie / Thriller Bark / Germa: deck planks, masts, wake
                ctx.strokeStyle = 'rgba(80,60,30,0.25)';
                ctx.lineWidth = 1.5;
                for (let i = -3; i <= 3; i++) {
                    ctx.beginPath();
                    ctx.moveTo(cx - R * 0.7, cy + i * R * 0.09);
                    ctx.lineTo(cx + R * 0.7, cy + i * R * 0.09);
                    ctx.stroke();
                }
                // Masts
                ctx.strokeStyle = 'rgba(120,90,50,0.35)';
                ctx.lineWidth = 2.5;
                [-0.2, 0.15].forEach(off => {
                    ctx.beginPath(); ctx.moveTo(cx + R * off, cy - R * 0.35); ctx.lineTo(cx + R * off, cy + R * 0.35); ctx.stroke();
                });
                // Sails
                ctx.fillStyle = 'rgba(255,250,240,0.2)';
                [-0.2, 0.15].forEach(off => {
                    ctx.beginPath();
                    ctx.moveTo(cx + R * off, cy - R * 0.3);
                    ctx.quadraticCurveTo(cx + R * off + R * 0.15, cy - R * 0.15, cx + R * off, cy);
                    ctx.fill();
                });
                break;
            }
            case 'tree': {
                // Sabaody / Ohara: giant mangrove trees, bubbles, roots
                for (let i = 0; i < 7; i++) {
                    const a = (i / 7) * Math.PI * 2 + pseudoRand(seed + i) * 0.5;
                    const tr = R * (0.2 + pseudoRand(seed + i * 13) * 0.15);
                    const px = cx + Math.cos(a) * tr;
                    const py = cy + Math.sin(a) * tr;
                    // Trunk
                    ctx.fillStyle = 'rgba(90,65,30,0.35)';
                    ctx.beginPath(); ctx.ellipse(px, py, R * 0.04, R * 0.1, a, 0, Math.PI * 2); ctx.fill();
                    // Canopy
                    const canG = ctx.createRadialGradient(px, py - R * 0.1, 0, px, py - R * 0.1, R * 0.16);
                    canG.addColorStop(0, 'rgba(30,130,50,0.4)');
                    canG.addColorStop(1, 'rgba(30,130,50,0)');
                    ctx.fillStyle = canG; ctx.beginPath(); ctx.arc(px, py - R * 0.1, R * 0.16, 0, Math.PI * 2); ctx.fill();
                }
                // Bubbles
                ctx.strokeStyle = 'rgba(200,230,255,0.3)';
                ctx.lineWidth = 1;
                for (let i = 0; i < 6; i++) {
                    const bx = cx + (pseudoRand(seed + i * 97) - 0.5) * R * 1.2;
                    const by = cy + (pseudoRand(seed + i * 101) - 0.5) * R * 1.2;
                    ctx.beginPath(); ctx.arc(bx, by, 2 + pseudoRand(seed + i) * 4, 0, Math.PI * 2); ctx.stroke();
                }
                break;
            }
            case 'crescent': {
                // Jaya: jungle interior on the remaining half
                const jungleG = ctx.createRadialGradient(cx - R * 0.3, cy, 0, cx - R * 0.3, cy, R * 0.5);
                jungleG.addColorStop(0, 'rgba(20,100,30,0.3)');
                jungleG.addColorStop(1, 'rgba(20,100,30,0)');
                ctx.fillStyle = jungleG; ctx.beginPath(); ctx.arc(cx - R * 0.3, cy, R * 0.5, 0, Math.PI * 2); ctx.fill();
                // Cliff edge where it was torn
                ctx.strokeStyle = 'rgba(120,80,40,0.35)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(cx + R * 0.1, cy, R * 0.4, -0.8, 0.8);
                ctx.stroke();
                break;
            }
            case 'fortress': {
                // Shells / Arlong / Impel: walls, central structure
                ctx.strokeStyle = 'rgba(100,80,60,0.3)';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2); ctx.stroke();
                // Central tower
                ctx.fillStyle = 'rgba(80,70,60,0.3)';
                ctx.fillRect(cx - R * 0.08, cy - R * 0.2, R * 0.16, R * 0.4);
                // Flags/turrets
                for (let i = 0; i < 4; i++) {
                    const a = (i / 4) * Math.PI * 2 + 0.4;
                    const tx = cx + Math.cos(a) * R * 0.5;
                    const ty = cy + Math.sin(a) * R * 0.5;
                    ctx.fillStyle = 'rgba(120,100,70,0.35)';
                    ctx.beginPath(); ctx.arc(tx, ty, R * 0.06, 0, Math.PI * 2); ctx.fill();
                }
                break;
            }
            case 'elongated': {
                // Long Ring Long Land: sections of different terrain
                ctx.strokeStyle = 'rgba(100,130,80,0.2)';
                ctx.lineWidth = 1;
                for (let i = 1; i <= 3; i++) {
                    const sx = cx - R * 0.8 + i * R * 0.4;
                    ctx.beginPath(); ctx.moveTo(sx, cy - R * 0.5); ctx.lineTo(sx, cy + R * 0.5); ctx.stroke();
                }
                // Scattered lakes
                ctx.fillStyle = 'rgba(40,120,180,0.25)';
                for (let i = 0; i < 3; i++) {
                    const lx = cx - R * 0.5 + i * R * 0.5;
                    const ly = cy + (pseudoRand(seed + i * 41) - 0.5) * R * 0.3;
                    ctx.beginPath(); ctx.ellipse(lx, ly, R * 0.06, R * 0.04, 0, 0, Math.PI * 2); ctx.fill();
                }
                break;
            }
        }
    }

    /* ── Path drawing helpers ── */
    function drawPath(ctx, pts) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
            const prev = pts[i - 1], cur = pts[i];
            const mx = (prev[0] + cur[0]) / 2, my = (prev[1] + cur[1]) / 2;
            ctx.quadraticCurveTo(prev[0], prev[1], mx, my);
        }
        ctx.closePath();
    }

    function drawScaledPath(ctx, pts, cx, cy, scale) {
        const scaled = pts.map(([x, y]) => [cx + (x - cx) * scale, cy + (y - cy) * scale]);
        drawPath(ctx, scaled);
    }

    function getPath2D(pts) {
        const p = new Path2D();
        p.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
            const prev = pts[i - 1], cur = pts[i];
            const mx = (prev[0] + cur[0]) / 2, my = (prev[1] + cur[1]) / 2;
            p.quadraticCurveTo(prev[0], prev[1], mx, my);
        }
        p.closePath();
        return p;
    }

    function wobble(angle, seed) {
        return Math.sin(angle * 5 + seed * 0.1) * 0.5
             + Math.sin(angle * 8 + seed * 0.3) * 0.3
             + Math.sin(angle * 13 + seed * 0.7) * 0.2;
    }

    function angleDiff(a, b) {
        let d = a - b;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return d;
    }

    function hashStr(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
        return Math.abs(h);
    }

    function pseudoRand(seed) {
        const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    /* ════════════════════════════════════════════════ */
    /*  ISLANDS — 3D shaped meshes on globe surface     */
    /* ════════════════════════════════════════════════ */
    function createIslands() {
        const overlay = document.getElementById("labelsOverlay");
        overlay.innerHTML = "";

        Object.entries(islands).forEach(([id, isl]) => {
            const elevation = isl.elevation || 0;
            const surfR = GR + 0.012 + elevation;
            const surfPos = latLngToVec3(isl.lat, isl.lng, surfR);
            const normal = surfPos.clone().normalize();

            // Get shape definition or default
            const shapeDef = ISLAND_SHAPES[id] || { shape: 'round', size: 0.06, peaks: 0, color1: '#5a8a50', color2: '#7ab060', beach: '#e0d0a0' };
            const meshRadius = shapeDef.size;

            // Generate unique island texture
            const islandCanvas = generateIslandCanvas(id, shapeDef);
            const tex = new THREE.CanvasTexture(islandCanvas);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;

            // Flat disc mesh oriented tangent to globe
            const geo = new THREE.CircleGeometry(meshRadius, 32);
            const mat = new THREE.MeshPhongMaterial({
                map: tex,
                transparent: true,
                alphaTest: 0.02,
                side: THREE.DoubleSide,
                depthWrite: false,
                shininess: 10,
                emissive: 0x112211,
                emissiveIntensity: 0.15,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(surfPos);

            // Orient disc to face outward from globe
            const up = new THREE.Vector3(0, 0, 1);
            const quat = new THREE.Quaternion().setFromUnitVectors(up, normal);
            mesh.quaternion.copy(quat);

            mesh.userData = { islandId: id };
            globeGroup.add(mesh);
            islandMeshes[id] = mesh;

            // Invisible hitbox sphere for easy raycasting
            const hitGeo = new THREE.SphereGeometry(meshRadius * 0.8, 8, 8);
            const hitMat = new THREE.MeshBasicMaterial({ visible: false });
            const hitbox = new THREE.Mesh(hitGeo, hitMat);
            hitbox.position.copy(surfPos);
            hitbox.userData = { islandId: id };
            globeGroup.add(hitbox);
            islandGlows[id] = hitbox; // reuse glow dict for hitboxes

            // Subtle glow ring underneath
            const glowC = makeCanvas(64, 64);
            const gCtx = glowC.getContext('2d');
            const cHex = shapeDef.color1 || '#5a8a50';
            const cr = parseInt(cHex.slice(1, 3), 16), cg = parseInt(cHex.slice(3, 5), 16), cb = parseInt(cHex.slice(5, 7), 16);
            const gg = gCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
            gg.addColorStop(0, `rgba(${cr},${cg},${cb},0.5)`);
            gg.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.15)`);
            gg.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
            gCtx.fillStyle = gg;
            gCtx.fillRect(0, 0, 64, 64);
            const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: new THREE.CanvasTexture(glowC), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            }));
            glowSprite.position.copy(surfPos);
            glowSprite.scale.set(meshRadius * 2.5, meshRadius * 2.5, 1);
            glowSprite.material.opacity = 0.12;
            globeGroup.add(glowSprite);
            islandPins[id] = glowSprite; // reuse pins dict for glow sprites

            // Sky island cloud base + stem
            if (elevation > 0) {
                const base = latLngToVec3(isl.lat, isl.lng, GR + 0.008);
                const skyGeo = new THREE.BufferGeometry().setFromPoints([base, surfPos]);
                globeGroup.add(new THREE.Line(skyGeo, new THREE.LineBasicMaterial({ color: 0x80DEEA, transparent: true, opacity: 0.3 })));
                const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: new THREE.CanvasTexture(glowC), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
                }));
                cloud.position.copy(base); cloud.scale.set(0.1, 0.1, 1); cloud.material.opacity = 0.2;
                globeGroup.add(cloud);
            }

            // HTML label
            const label = document.createElement("div");
            label.className = "island-label-3d";
            label.textContent = isl.name;
            label.dataset.island = id;
            label.addEventListener("pointerenter", e => showTooltipFor(id, e));
            label.addEventListener("pointerleave", () => scheduleHideTooltip());
            label.addEventListener("click", () => focusOnIsland(id));
            overlay.append(label);
            labelEls[id] = label;
        });
    }

    function getIslandTerrainColor(sea) {
        return {
            east: 0x5a8a50, west: 0x6a9958, north: 0x4a7a55, south: 0x7a8a45,
            grandline: 0x8a9a55, newworld: 0x6a7a40, calm: 0x557755, sky: 0x88ccbb
        }[sea] || 0x5a8a50;
    }

    /* ════════════════════════════════════════════════ */
    /*  CHARACTER PILLS                                 */
    /* ════════════════════════════════════════════════ */
    function buildCharPills() {
        const container = document.getElementById("charPills");
        container.innerHTML = "";
        crew.forEach(c => {
            const pill = document.createElement("div");
            pill.className = "char-pill";
            pill.dataset.id = c.id;
            pill.style.setProperty("--pill-color", c.color);
            pill.innerHTML = '<span class="pill-emoji">' + c.emoji + '</span>' + c.name.split(" ").pop();
            pill.onclick = () => selectCrew(c.id);
            container.append(pill);
        });
    }

    /* ════════════════════════════════════════════════ */
    /*  SELECT CREW                                     */
    /* ════════════════════════════════════════════════ */
    function selectCrew(id) {
        const member = crew.find(c => c.id === id);
        if (!member) return;

        // Toggle: add or remove
        if (selectedCrewIds.has(id)) {
            selectedCrewIds.delete(id);
        } else {
            selectedCrewIds.add(id);
        }

        // Update pill active states
        document.querySelectorAll(".char-pill").forEach(p => p.classList.toggle("active", selectedCrewIds.has(p.dataset.id)));

        if (selectedCrewIds.size === 0) {
            // Nothing selected — clear everything
            lastSelectedCrew = null;
            clearAllJourneys();
            closeCard();
            document.getElementById("timelineBar").style.display = "none";
            return;
        }

        // Scroll to the just-toggled pill
        const ap = document.querySelector('.char-pill[data-id="' + id + '"]');
        if (ap) ap.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });

        // If the member was just added, make it the "last selected" for card/timeline
        if (selectedCrewIds.has(id)) {
            lastSelectedCrew = member;
        } else {
            // Removed — pick another one as last
            const remaining = crew.filter(c => selectedCrewIds.has(c.id));
            lastSelectedCrew = remaining[remaining.length - 1] || null;
        }

        // Redraw all selected journeys
        drawAllJourneys();

        // Show card and timeline for the last selected member
        if (lastSelectedCrew) {
            const filteredMember = Object.assign({}, lastSelectedCrew, { journey: getSpoilerFilteredJourney(lastSelectedCrew) });
            updateCard(filteredMember);
            setupTimeline(filteredMember);
            document.getElementById("timelineBar").style.display = "";
        }
    }

    function clearAllJourneys() {
        journeyLines.forEach(l => globeGroup.remove(l));
        journeyArrows.forEach(a => globeGroup.remove(a));
        journeyGlows.forEach(g => globeGroup.remove(g));
        journeyLines = []; journeyArrows = []; journeyGlows = [];
        if (shipMesh) { globeGroup.remove(shipMesh); shipMesh = null; }
        Object.entries(islandMeshes).forEach(([id, mesh]) => {
            mesh.material.emissive.set(0x112211);
            mesh.material.emissiveIntensity = 0.15;
            mesh.scale.setScalar(1);
            if (islandPins[id]) islandPins[id].material.opacity = 0.12;
        });
        Object.values(labelEls).forEach(l => l.classList.remove("active", "origin"));
    }

    function drawAllJourneys() {
        clearAllJourneys();
        const selected = crew.filter(c => selectedCrewIds.has(c.id));
        selected.forEach(member => {
            const filteredMember = Object.assign({}, member, { journey: getSpoilerFilteredJourney(member) });
            drawJourneySingle(filteredMember);
        });
    }

    /* ════════════════════════════════════════════════ */
    /*  DRAW JOURNEY                                    */
    /* ════════════════════════════════════════════════ */
    function drawJourney(member) {
        // Full clear + single draw (used by timeline scrub)
        clearAllJourneys();
        drawJourneySingle(member);
    }

    function drawJourneySingle(member) {
        // Draw one member's journey (additive — doesn't clear first)

        const journey = member.journey;
        const joinIdx = journey.indexOf(member.joinedAt);
        const visited = new Set(journey);
        const memberColor = new THREE.Color(member.color);

        visited.forEach(islId => {
            const mesh = islandMeshes[islId];
            if (!mesh) return;
            mesh.material.emissive.set(memberColor);
            mesh.material.emissiveIntensity = 0.5;
            mesh.scale.setScalar(1.3);
            if (islandPins[islId]) islandPins[islId].material.opacity = 0.4;
            if (labelEls[islId]) labelEls[islId].classList.add("active");
        });
        if (labelEls[member.origin]) labelEls[member.origin].classList.add("origin");

        // Pre-join path (before crew member joined — dashed, faded)
        if (joinIdx > 0) {
            const preJoinIds = journey.slice(0, joinIdx + 1);
            createJourneyPath(preJoinIds, member.color, 0.25, true);
        }

        // Post-join path (main journey — solid, bright, glowing)
        if (joinIdx < journey.length - 1) {
            const postJoinIds = journey.slice(joinIdx);
            createJourneyPath(postJoinIds, member.color, 1.0, false);
        }

        // Pulse last island
        const lastId = journey[journey.length - 1];
        if (islandMeshes[lastId]) { islandMeshes[lastId].scale.setScalar(1.5); startPulse(lastId, member.color); }

        // Ship at last island
        const lastIsl = islands[lastId];
        if (lastIsl) createShipMarker(lastIsl, member.color);
    }

    function createJourneyPath(ids, colorHex, intensity, isPreJoin) {
        const color = new THREE.Color(colorHex);

        // Build arcs per segment
        for (let i = 0; i < ids.length - 1; i++) {
            const a = islands[ids[i]], b = islands[ids[i + 1]];
            if (!a || !b) continue;
            const arcPts = greatCircleArc(a, b, 48);
            const t = (i + 1) / ids.length; // progress along journey

            // TubeGeometry for thick visible path
            const curve = new THREE.CatmullRomCurve3(arcPts);
            const tubeR = isPreJoin ? 0.006 : 0.012;
            const tubeGeo = new THREE.TubeGeometry(curve, 32, tubeR, 6, false);
            const tubeOp = isPreJoin ? 0.2 + t * 0.15 : 0.5 + t * 0.45;
            const tubeMat = new THREE.MeshPhongMaterial({
                color, emissive: color,
                emissiveIntensity: isPreJoin ? 0.2 : 0.4 + t * 0.3,
                transparent: true, opacity: tubeOp * intensity,
                shininess: 30, specular: 0x444444,
            });
            const tube = new THREE.Mesh(tubeGeo, tubeMat);
            globeGroup.add(tube);
            journeyLines.push(tube);

            // Outer glow tube (wider, additive)
            if (!isPreJoin) {
                const glowGeo = new THREE.TubeGeometry(curve, 24, tubeR * 3, 6, false);
                const glowMat = new THREE.MeshBasicMaterial({
                    color, transparent: true, opacity: 0.1 * intensity,
                    blending: THREE.AdditiveBlending, depthWrite: false,
                });
                const glow = new THREE.Mesh(glowGeo, glowMat);
                globeGroup.add(glow);
                journeyGlows.push(glow);
            }

            // Animated dash dots along each segment (small sphere beads)
            if (!isPreJoin) {
                const beadCount = Math.max(2, Math.floor(arcPts.length / 8));
                for (let b = 0; b < beadCount; b++) {
                    const bt = (b + 0.5) / beadCount;
                    const pos = curve.getPointAt(bt);
                    const bead = new THREE.Mesh(
                        new THREE.SphereGeometry(tubeR * 1.6, 6, 6),
                        new THREE.MeshBasicMaterial({
                            color: 0xffffff, transparent: true, opacity: 0.5,
                        })
                    );
                    bead.position.copy(pos);
                    bead.userData = { curve, baseT: bt, isDot: true };
                    globeGroup.add(bead);
                    journeyLines.push(bead);
                }
            }

            // Direction arrow at midpoint of each segment
            const midPt = curve.getPointAt(0.5);
            const aheadPt = curve.getPointAt(0.55);
            if (midPt && aheadPt) {
                const dir = aheadPt.clone().sub(midPt).normalize();
                const normal = midPt.clone().normalize();
                const arrowSize = isPreJoin ? 0.02 : 0.04;
                const arrowGeo = new THREE.ConeGeometry(arrowSize, arrowSize * 2.5, 6);
                const arrowMat = new THREE.MeshPhongMaterial({
                    color, emissive: color,
                    emissiveIntensity: isPreJoin ? 0.2 : 0.6,
                    transparent: true, opacity: isPreJoin ? 0.3 : 0.85,
                });
                const arrow = new THREE.Mesh(arrowGeo, arrowMat);
                arrow.position.copy(midPt);
                const tangent = dir.clone().projectOnPlane(normal).normalize();
                const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
                arrow.quaternion.copy(quat);
                globeGroup.add(arrow);
                journeyArrows.push(arrow);
            }
        }
    }

    function createShipCanvas(colorHex, isPostTimeskip) {
        // Draw a top-down ship sprite: Going Merry (pre-timeskip) or Thousand Sunny (post)
        const sz = 128;
        const c = makeCanvas(sz, sz);
        const ctx = c.getContext('2d');
        const cx = sz / 2, cy = sz / 2;
        const color = new THREE.Color(colorHex);
        const cr = (color.r * 255) | 0, cg = (color.g * 255) | 0, cb = (color.b * 255) | 0;

        // Glow aura
        const aura = ctx.createRadialGradient(cx, cy, 8, cx, cy, 56);
        aura.addColorStop(0, `rgba(${cr},${cg},${cb},0.5)`);
        aura.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.15)`);
        aura.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx.fillStyle = aura;
        ctx.beginPath(); ctx.arc(cx, cy, 56, 0, Math.PI * 2); ctx.fill();

        // Hull shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(cx + 2, cy + 2, 24, 10, 0, 0, Math.PI * 2);
        ctx.fill();

        // Main hull
        if (isPostTimeskip) {
            // Thousand Sunny — lion-themed, bright
            ctx.fillStyle = '#e8b830';
            ctx.beginPath();
            ctx.ellipse(cx, cy, 24, 10, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#c49520';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // Deck stripes (sunny's lawn deck)
            ctx.fillStyle = '#4a9040';
            ctx.beginPath();
            ctx.ellipse(cx, cy, 16, 6, 0, 0, Math.PI * 2);
            ctx.fill();
            // Lion head at bow
            ctx.fillStyle = '#f0c040';
            ctx.beginPath(); ctx.arc(cx + 22, cy, 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(cx + 24, cy - 1.5, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cx + 24, cy + 1.5, 1.5, 0, Math.PI * 2); ctx.fill();
            // Mane
            ctx.strokeStyle = '#d49010';
            ctx.lineWidth = 1;
            for (let a = -0.8; a <= 0.8; a += 0.3) {
                ctx.beginPath();
                ctx.moveTo(cx + 20, cy + Math.sin(a) * 5);
                ctx.lineTo(cx + 28, cy + Math.sin(a) * 8);
                ctx.stroke();
            }
        } else {
            // Going Merry — caravel, sheep head
            ctx.fillStyle = '#c8a868';
            ctx.beginPath();
            ctx.ellipse(cx, cy, 22, 9, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#a08040';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // Deck
            ctx.fillStyle = '#b09050';
            ctx.beginPath();
            ctx.ellipse(cx, cy, 14, 5, 0, 0, Math.PI * 2);
            ctx.fill();
            // Sheep figurehead
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(cx + 20, cy, 5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#333';
            ctx.beginPath(); ctx.arc(cx + 22, cy - 1, 1, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cx + 22, cy + 1, 1, 0, Math.PI * 2); ctx.fill();
        }

        // Mast + sail
        ctx.fillStyle = '#ddd';
        ctx.fillRect(cx - 1, cy - 16, 2, 32);
        // Sail (colored with crew color)
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.7)`;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 14);
        ctx.lineTo(cx + 10, cy - 6);
        ctx.lineTo(cx, cy + 2);
        ctx.closePath();
        ctx.fill();
        // Jolly roger on sail
        ctx.fillStyle = '#fff';
        ctx.font = '8px serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('☠', cx + 4, cy - 6);

        return c;
    }

    function createShipMarker(isl, colorHex) {
        const elevation = isl.elevation || 0;
        const pos = latLngToVec3(isl.lat, isl.lng, GR + 0.15 + elevation);
        const normal = pos.clone().normalize();
        const color = new THREE.Color(colorHex);

        // Determine if post-timeskip (after Sabaody return)
        const journey = lastSelectedCrew ? lastSelectedCrew.journey : [];
        const lastIdx = journey.length - 1;
        const sabaodyReturn = journey.lastIndexOf('sabaody');
        const isPostTimeskip = sabaodyReturn > journey.indexOf('sabaody');

        // Ship sprite using canvas
        const shipCanvas = createShipCanvas(colorHex, isPostTimeskip);
        const shipTex = new THREE.CanvasTexture(shipCanvas);
        shipMesh = new THREE.Sprite(new THREE.SpriteMaterial({
            map: shipTex, transparent: true, depthWrite: false,
        }));
        shipMesh.position.copy(pos);
        shipMesh.scale.set(0.45, 0.45, 1);

        // Glow ring beneath ship
        const glowC = makeCanvas(64, 64);
        const gCtx = glowC.getContext('2d');
        const cr = (color.r * 255) | 0, cg = (color.g * 255) | 0, cb = (color.b * 255) | 0;
        const gg = gCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gg.addColorStop(0, `rgba(${cr},${cg},${cb},0.8)`);
        gg.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.3)`);
        gg.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        gCtx.fillStyle = gg; gCtx.fillRect(0, 0, 64, 64);
        const shipGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(glowC), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        shipGlow.position.copy(pos);
        shipGlow.scale.set(0.4, 0.4, 1);
        shipGlow.material.opacity = 0.8;
        globeGroup.add(shipGlow);
        journeyGlows.push(shipGlow);

        globeGroup.add(shipMesh);
    }

    function createArcLine(ids, color, dashed) {
        const pts = [];
        for (let i = 0; i < ids.length - 1; i++) {
            const a = islands[ids[i]], b = islands[ids[i + 1]];
            if (a && b) pts.push(...greatCircleArc(a, b, 36));
        }
        if (!pts.length) return null;
        return new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: dashed ? 0.3 : 0.85 })
        );
    }

    function greatCircleArc(from, to, segs) {
        const e1 = from.elevation || 0, e2 = to.elevation || 0;
        const p1 = latLngToVec3(from.lat, from.lng, GR + 0.03 + e1);
        const p2 = latLngToVec3(to.lat, to.lng, GR + 0.03 + e2);
        const pts = [];
        for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const pt = new THREE.Vector3().lerpVectors(p1, p2, t);
            // Higher arc for longer distances, subtle for short ones
            const dist = p1.distanceTo(p2);
            const arcH = Math.min(0.25, dist * 0.08);
            pt.normalize().multiplyScalar(GR + 0.03 + Math.sin(t * Math.PI) * arcH + e1 * (1 - t) + e2 * t);
            pts.push(pt);
        }
        return pts;
    }

    /* ════════════════════════════════════════════════ */
    /*  SEA KINGS — simple 3D silhouettes in Calm Belt  */
    /* ════════════════════════════════════════════════ */
    function createSeaKingMesh(color) {
        const group = new THREE.Group();
        const mat = new THREE.MeshPhongMaterial({
            color: color,
            shininess: 15,
            transparent: true, opacity: 0.85,
        });
        // Neck: cylinder tapered (wider at base, thinner at top)
        const neckGeo = new THREE.CylinderGeometry(0.03, 0.06, 0.25, 8);
        const neck = new THREE.Mesh(neckGeo, mat);
        neck.position.y = 0.125; // half height
        group.add(neck);
        // Head: slightly squashed sphere
        const headGeo = new THREE.SphereGeometry(0.06, 8, 6);
        const head = new THREE.Mesh(headGeo, mat);
        head.position.y = 0.28;
        head.scale.set(1, 0.8, 1.2); // slightly elongated snout
        group.add(head);
        // Eyes: two small white spheres
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const eyeGeo = new THREE.SphereGeometry(0.012, 4, 4);
        const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
        eyeL.position.set(-0.04, 0.29, 0.04);
        group.add(eyeL);
        const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
        eyeR.position.set(0.04, 0.29, 0.04);
        group.add(eyeR);
        // Pupils
        const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
        const pupilGeo = new THREE.SphereGeometry(0.006, 4, 4);
        const pupilL = new THREE.Mesh(pupilGeo, pupilMat);
        pupilL.position.set(-0.04, 0.29, 0.052);
        group.add(pupilL);
        const pupilR = new THREE.Mesh(pupilGeo, pupilMat);
        pupilR.position.set(0.04, 0.29, 0.052);
        group.add(pupilR);
        return group;
    }

    function createSeaKings() {
        const placements = [
            { lat: 15, lngStart: 30,  dir: 1,  scale: 0.35, speed: 0.04 },
            { lat: 14, lngStart: 100, dir: -1, scale: 0.45, speed: 0.03 },
            { lat: 16, lngStart: -60, dir: 1,  scale: 0.3,  speed: 0.05 },
            { lat: -15, lngStart: 70,  dir: -1, scale: 0.4,  speed: 0.035 },
            { lat: -14, lngStart: -30, dir: 1,  scale: 0.38, speed: 0.03 },
            { lat: -16, lngStart: 140, dir: -1, scale: 0.35, speed: 0.04 },
            { lat: 13, lngStart: -120, dir: 1,  scale: 0.3,  speed: 0.05 },
            { lat: -13, lngStart: -140, dir: -1, scale: 0.38, speed: 0.04 },
        ];
        const colors = [0x1a3a3a, 0x2a2a40, 0x1a2a2a, 0x2a3a2a, 0x3a2a2a, 0x2a2a3a];
        placements.forEach(p => {
            const col = colors[Math.floor(Math.random() * colors.length)];
            const mesh = createSeaKingMesh(col);
            mesh.scale.setScalar(p.scale);
            mesh.userData = {
                lat: p.lat, lngOffset: p.lngStart, dir: p.dir,
                speed: p.speed, phase: Math.random() * Math.PI * 2,
                undulatePhase: Math.random() * 100,
            };
            const pos = latLngToVec3(p.lat, p.lngStart, GR);
            mesh.position.copy(pos);
            globeGroup.add(mesh);
            seaKings.push(mesh);
        });
    }

    function updateSeaKings(time) {
        seaKings.forEach(sk => {
            const ud = sk.userData;
            ud.lngOffset += ud.speed * ud.dir;
            if (ud.lngOffset > 180) ud.lngOffset -= 360;
            if (ud.lngOffset < -180) ud.lngOffset += 360;
            const undLat = ud.lat + Math.sin(time * 0.3 + ud.undulatePhase) * 0.8;
            const pos = latLngToVec3(undLat, ud.lngOffset, GR);
            sk.position.copy(pos);
            // Orient: Y-axis (head) points away from globe surface
            const normal = pos.clone().normalize();
            const aheadLng = ud.lngOffset + ud.dir * 2;
            const aheadPos = latLngToVec3(undLat, aheadLng, GR);
            const travelDir = aheadPos.clone().sub(pos).normalize();
            const tangent = travelDir.projectOnPlane(normal).normalize();
            const right = new THREE.Vector3().crossVectors(normal, tangent).normalize();
            const m = new THREE.Matrix4().makeBasis(right, normal, tangent);
            sk.quaternion.setFromRotationMatrix(m);
            // Gentle sway
            const sway = Math.sin(time * 1.5 + ud.phase) * 0.06;
            sk.rotateZ(sway);
        });
    }

    /* ════════════════════════════════════════════════ */
    /*  PULSE                                           */
    /* ════════════════════════════════════════════════ */
    let pulsingId = null, pulsePhase = 0;
    function startPulse(id) { pulsingId = id; pulsePhase = 0; }
    function updatePulse() {
        if (!pulsingId || !islandMeshes[pulsingId]) return;
        pulsePhase += 0.04;
        islandMeshes[pulsingId].scale.setScalar(1.5 + Math.sin(pulsePhase) * 0.2);
        const g = islandPins[pulsingId];
        if (g) { g.material.opacity = 0.3 + Math.sin(pulsePhase) * 0.2; }
    }

    function updateJourneyAnimation() {
        journeyDashOffset += 0.0018;
        // Animate bead dots flowing along their curves
        journeyLines.forEach(obj => {
            if (obj.userData && obj.userData.isDot && obj.userData.curve) {
                const t = (obj.userData.baseT + journeyDashOffset * 1.2) % 1;
                const pos = obj.userData.curve.getPointAt(t);
                obj.position.copy(pos);
                obj.material.opacity = 0.3 + Math.sin(t * Math.PI) * 0.5;
            }
        });
        // Gentle glow pulse on journey glow tubes
        const glowPulse = 0.08 + Math.sin(journeyDashOffset * 8) * 0.04;
        journeyGlows.forEach(g => {
            if (g.isMesh && g.material) g.material.opacity = glowPulse;
        });
        // Subtle arrow pulse
        const arrowPulse = 0.6 + Math.sin(journeyDashOffset * 6) * 0.2;
        journeyArrows.forEach(a => {
            a.material.emissiveIntensity = arrowPulse;
        });
        // Ship bob + scale pulse
        if (shipMesh) {
            const bob = 0.44 + Math.sin(journeyDashOffset * 8) * 0.03;
            shipMesh.scale.set(bob, bob, 1);
        }
    }

    /* ════════════════════════════════════════════════ */
    /*  ROTATION / ZOOM                                 */
    /* ════════════════════════════════════════════════ */
    function rotateGlobeTo(lat, lng) {
        targetRotY = -lng * D2R;
        targetRotX = lat * D2R * 0.5;
        autoRotate = false;
        document.getElementById("btnAutoRotate").classList.remove("active-toggle");
    }
    function toggleAutoRotate() {
        autoRotate = !autoRotate;
        document.getElementById("btnAutoRotate").classList.toggle("active-toggle", autoRotate);
    }
    function resetView() {
        targetZoom = 12; targetRotX = 0.25; targetRotY = 0;
        autoRotate = true;
        document.getElementById("btnAutoRotate").classList.add("active-toggle");
    }

    /* ════════════════════════════════════════════════ */
    /*  INTERACTION                                     */
    /* ════════════════════════════════════════════════ */
    function setupInteraction(canvas) {
        let pinchDist = 0;

        canvas.addEventListener("pointerdown", e => {
            if (e.target.closest(".char-card, .icon-btn, .char-pill, .legend-panel, .island-label-3d")) return;
            canvas.setPointerCapture(e.pointerId);
            isDragging = true; dragMoved = false;
            prevMouse = { x: e.clientX, y: e.clientY };
            autoRotate = false;
            document.getElementById("btnAutoRotate").classList.remove("active-toggle");

            // Check if clicking on island in edit mode
            if (isEditMode) {
                const clickVec = new THREE.Vector2(
                    (e.clientX / window.innerWidth) * 2 - 1,
                    -(e.clientY / window.innerHeight) * 2 + 1
                );
                raycaster.setFromCamera(clickVec, camera);
                const targets = [...Object.values(islandMeshes), ...Object.values(islandGlows)];
                const hits = raycaster.intersectObjects(targets, false);
                if (hits.length) {
                    const id = hits[0].object.userData.islandId;
                    if (id && islands[id]) {
                        draggedIsland = id;
                    }
                }
            }
        });

        canvas.addEventListener("pointermove", e => {
            mouseVec.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouseVec.y = -(e.clientY / window.innerHeight) * 2 + 1;
            if (isDragging) {
                const dx = e.clientX - prevMouse.x, dy = e.clientY - prevMouse.y;
                if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
                if (draggedIsland && isEditMode) {
                    // Drag island
                    raycaster.setFromCamera(mouseVec, camera);
                    const hits = raycaster.intersectObject(globeMesh);
                    if (hits.length) {
                        const point = hits[0].point;
                        // Transform to globe local space
                        const localPoint = point.clone().applyMatrix4(globeGroup.matrixWorld.clone().invert());
                        // Undo the globe tilt to get unrotated coordinates
                        const unrotatedPoint = localPoint.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), -currentRotX);
                        const {lat, lng} = vec3ToLatLng(unrotatedPoint);
                        islands[draggedIsland].lat = lat;
                        islands[draggedIsland].lng = lng;
                        updateIslandPosition(draggedIsland);
                    }
                } else {
                    // Rotate globe
                    targetRotY += dx * 0.005;
                    targetRotX += dy * 0.003;
                    targetRotX = Math.max(-1.2, Math.min(1.2, targetRotX));
                }
                prevMouse = { x: e.clientX, y: e.clientY };
            } else {
                checkHover(e);
            }
        });

        canvas.addEventListener("pointerup", e => {
            isDragging = false;
            draggedIsland = null;
            if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        });
        canvas.addEventListener("pointercancel", e => {
            isDragging = false;
            draggedIsland = null;
            if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        });
        canvas.addEventListener("pointerleave", () => { 
            isDragging = false; 
            draggedIsland = null; 
        });

        canvas.addEventListener("wheel", e => {
            e.preventDefault();
            targetZoom += e.deltaY * 0.005;
            targetZoom = Math.max(7, Math.min(25, targetZoom));
        }, { passive: false });

        canvas.addEventListener("touchstart", e => {
            if (e.touches.length === 2) { e.preventDefault(); pinchDist = getTouchDist(e.touches); }
        }, { passive: false });
        canvas.addEventListener("touchmove", e => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const d = getTouchDist(e.touches);
                targetZoom = Math.max(7, Math.min(25, targetZoom * (pinchDist / d)));
                pinchDist = d;
            }
        }, { passive: false });

        canvas.addEventListener("click", e => {
            if (dragMoved) return;
            // Raycast to check if an island was clicked
            const clickVec = new THREE.Vector2(
                (e.clientX / window.innerWidth) * 2 - 1,
                -(e.clientY / window.innerHeight) * 2 + 1
            );
            raycaster.setFromCamera(clickVec, camera);
            const targets = [...Object.values(islandMeshes), ...Object.values(islandGlows)];
            const hits = raycaster.intersectObjects(targets, false);
            if (hits.length) {
                const id = hits[0].object.userData.islandId;
                if (id && islands[id]) {
                    focusOnIsland(id);
                    return;
                }
            }
            // Click on empty space — unfocus
            if (focusedIsland) {
                focusedIsland = null;
                targetZoom = 12;
            }
            hideTooltip();
            const lp = document.getElementById("legendPanel");
            if (!lp.classList.contains("hidden")) lp.classList.add("hidden");
        });
    }

    function getTouchDist(ts) {
        return Math.sqrt((ts[0].clientX - ts[1].clientX) ** 2 + (ts[0].clientY - ts[1].clientY) ** 2);
    }

    /* ════════════════════════════════════════════════ */
    /*  CLICK-TO-FOCUS                                  */
    /* ════════════════════════════════════════════════ */
    function focusOnIsland(id) {
        const isl = islands[id];
        if (!isl) return;
        focusedIsland = id;
        autoRotate = false;
        document.getElementById("btnAutoRotate").classList.remove("active-toggle");

        // Calculate target rotation to center island on screen
        // latLngToVec3 places lng via theta=(lng+180)*D2R; camera is at +Z
        // To bring island to (0,0,+GR) facing camera: rotY = -(lng+90)*D2R
        let newRotY = -(isl.lng + 90) * D2R;
        // Normalize to nearest rotation to avoid spinning the long way around
        while (newRotY - currentRotY > Math.PI) newRotY -= Math.PI * 2;
        while (newRotY - currentRotY < -Math.PI) newRotY += Math.PI * 2;
        targetRotY = newRotY;

        // targetRotX: tilt globe so island's latitude is at eye level
        targetRotX = isl.lat * D2R;

        // Keep current zoom level — don't change zoom on focus

        // Show tooltip with island info after a short delay for the animation
        setTimeout(() => {
            if (focusedIsland === id) {
                const mesh = islandMeshes[id];
                if (mesh) {
                    const worldPos = new THREE.Vector3();
                    mesh.getWorldPosition(worldPos);
                    const proj = worldPos.clone().project(camera);
                    const cx = (proj.x * 0.5 + 0.5) * window.innerWidth;
                    const cy = (-proj.y * 0.5 + 0.5) * window.innerHeight;
                    showTooltipFor(id, { clientX: cx, clientY: cy });
                }
            }
        }, 600);
    }

    /* ════════════════════════════════════════════════ */
    /*  RAYCASTING HOVER                                */
    /* ════════════════════════════════════════════════ */
    function checkHover(e) {
        raycaster.setFromCamera(mouseVec, camera);
        // Raycast against both island disc meshes and invisible hitbox spheres
        const targets = [...Object.values(islandMeshes), ...Object.values(islandGlows)];
        const hits = raycaster.intersectObjects(targets, false);
        if (hits.length) {
            const id = hits[0].object.userData.islandId;
            if (id && id !== hoveredIsland) { hoveredIsland = id; showTooltipFor(id, e); }
        } else if (hoveredIsland) { hoveredIsland = null; scheduleHideTooltip(); }
    }

    /* ════════════════════════════════════════════════ */
    /*  LABELS                                          */
    /* ════════════════════════════════════════════════ */
    function updateLabels() {
        const W = window.innerWidth, H = window.innerHeight;
        const camPos = camera.position.clone();

        Object.entries(labelEls).forEach(([id, el]) => {
            const mesh = islandMeshes[id];
            if (!mesh) { el.style.opacity = "0"; return; }
            const worldPos = new THREE.Vector3();
            mesh.getWorldPosition(worldPos);
            const toCamera = camPos.clone().sub(worldPos).normalize();
            const dot = toCamera.dot(worldPos.clone().normalize());
            if (dot < 0.1) { el.style.opacity = "0"; return; }
            const proj = worldPos.clone().project(camera);
            el.style.left = ((proj.x * 0.5 + 0.5) * W) + "px";
            el.style.top = ((-proj.y * 0.5 + 0.5) * H - 14) + "px";
            el.style.opacity = String(Math.min(1, (dot - 0.1) * 3));
        });

        seaLabelSprites.forEach(s => {
            const wp = new THREE.Vector3();
            s.getWorldPosition(wp);
            const d = camPos.clone().sub(wp).normalize().dot(wp.clone().normalize());
            s.material.opacity = d > 0.1 ? Math.min(0.32, (d - 0.1) * 1.5) : 0;
        });
    }

    /* ════════════════════════════════════════════════ */
    /*  TOOLTIP                                         */
    /* ════════════════════════════════════════════════ */
    function showTooltipFor(islandId, e) {
        const isl = islands[islandId];
        if (!isl) return;
        clearTimeout(tooltipTimeout);
        const tt = document.getElementById("islandTooltip");
        document.getElementById("tooltipName").textContent = isl.name;
        document.getElementById("tooltipWiki").href = "https://onepiece.fandom.com/wiki/" + isl.name.replace(/ /g, "_");
        document.getElementById("tooltipArc").textContent = "Arc: " + isl.arc;
        const seaNames = {
            east: "East Blue", west: "West Blue", north: "North Blue", south: "South Blue",
            grandline: "Grand Line", newworld: "New World", calm: "Calm Belt", sky: "Sky Island"
        };
        document.getElementById("tooltipSea").textContent = seaNames[isl.sea] || isl.sea;
        document.getElementById("tooltipDesc").textContent = isl.desc || "";
        /* ── Crew-specific event info ── */
        const crewSec = document.getElementById("tooltipCrewSection");
        const selectedMembers = crew.filter(c => selectedCrewIds.has(c.id));
        const eventsForIsland = selectedMembers.filter(m => islandEvents[m.id] && islandEvents[m.id][islandId]);
        if (eventsForIsland.length > 0) {
            const lines = eventsForIsland.map(m => m.emoji + " " + m.name + ": " + islandEvents[m.id][islandId]);
            document.getElementById("tooltipCrewHeader").textContent = eventsForIsland.map(m => m.emoji).join(" ");
            document.getElementById("tooltipCrewHeader").style.color = eventsForIsland[0].color;
            document.getElementById("tooltipCrewEvent").textContent = lines.join("\n");
            crewSec.style.display = "";
        } else {
            crewSec.style.display = "none";
        }
        let tx = e.clientX + 16, ty = e.clientY - 60;
        if (tx + 280 > window.innerWidth) tx = e.clientX - 290;
        if (ty < 10) ty = e.clientY + 16;
        tt.style.left = tx + "px"; tt.style.top = ty + "px";
        tt.classList.remove("hidden");
    }
    let tooltipHovered = false;
    function scheduleHideTooltip() { tooltipTimeout = setTimeout(() => { if (!tooltipHovered) hideTooltip(); }, 400); }
    function hideTooltip() { clearTimeout(tooltipTimeout); tooltipHovered = false; document.getElementById("islandTooltip").classList.add("hidden"); }

    /* ════════════════════════════════════════════════ */
    /*  LEGEND / CARD                                   */
    /* ════════════════════════════════════════════════ */
    function toggleLegend() { document.getElementById("legendPanel").classList.toggle("hidden"); }

    /* ════════════════════════════════════════════════ */
    /*  SPOILER SHIELD                                  */
    /* ════════════════════════════════════════════════ */
    const STORY_SAGAS = [
        { label: "East Blue",        emoji: "⛵", upTo: "Loguetown" },
        { label: "Alabasta",         emoji: "🏜️", upTo: "Alabasta" },
        { label: "Sky Island",       emoji: "☁️", upTo: "Skypiea" },
        { label: "Water 7",          emoji: "🚂", upTo: "Thriller Bark" },
        { label: "Summit War",       emoji: "⚔️", upTo: "Marineford" },
        { label: "Fish-Man Island",  emoji: "🐠", upTo: "Fish-Man Island" },
        { label: "Dressrosa",        emoji: "🌹", upTo: "Zou" },
        { label: "Whole Cake",       emoji: "🍰", upTo: "Whole Cake Island" },
        { label: "Wano",             emoji: "✨", upTo: "Wano" },
        { label: "Egghead",          emoji: "🧠", upTo: "Egghead" },
        { label: "Elbaf",            emoji: "🌲", upTo: "Elbaf" },
    ];

    const STORY_ARCS = [
        "Romance Dawn","Orange Town","Syrup Village","Baratie","Arlong Park","Loguetown",
        "Reverse Mountain","Whisky Peak","Little Garden","Drum Island","Alabasta",
        "Jaya","Skypiea","Long Ring Long Land","Water 7","Enies Lobby",
        "Thriller Bark","Sabaody Archipelago","Amazon Lily","Impel Down","Marineford",
        "Timeskip","Fish-Man Island","Punk Hazard","Dressrosa","Zou",
        "Whole Cake Island","Wano","Egghead","Elbaf"
    ];
    let spoilerArcLimit = null;

    function toggleSpoilerPanel() {
        const panel = document.getElementById("spoilerPanel");
        panel.classList.toggle("hidden");
        // close about if open
        document.getElementById("aboutPopup").classList.add("hidden");
    }

    function buildSpoilerArcs() {
        const container = document.getElementById("spoilerArcs");
        container.innerHTML = "";
        STORY_ARCS.forEach((arc, i) => {
            const btn = document.createElement("button");
            btn.className = "spoiler-arc-btn";
            if (spoilerArcLimit === arc) btn.classList.add("active");
            else if (spoilerArcLimit && i < STORY_ARCS.indexOf(spoilerArcLimit)) btn.classList.add("past");
            btn.innerHTML = '<span class="arc-dot"></span>' + arc;
            btn.onclick = () => setSpoilerArc(arc);
            container.appendChild(btn);
        });
    }

    function setSpoilerArc(arc) {
        spoilerArcLimit = arc;
        document.getElementById("btnSpoiler").classList.add("active-toggle");
        buildSpoilerArcs();
        // Re-apply to current crew if any are selected
        if (selectedCrewIds.size > 0) drawAllJourneys();
        if (lastSelectedCrew && selectedCrewIds.has(lastSelectedCrew.id)) {
            const filteredMember = Object.assign({}, lastSelectedCrew, { journey: getSpoilerFilteredJourney(lastSelectedCrew) });
            updateCard(filteredMember);
            setupTimeline(filteredMember);
        }
    }

    function resetSpoilerFilter() {
        spoilerArcLimit = null;
        document.getElementById("btnSpoiler").classList.remove("active-toggle");
        buildSpoilerArcs();
        if (selectedCrewIds.size > 0) drawAllJourneys();
        if (lastSelectedCrew && selectedCrewIds.has(lastSelectedCrew.id)) {
            const filteredMember = Object.assign({}, lastSelectedCrew, { journey: getSpoilerFilteredJourney(lastSelectedCrew) });
            updateCard(filteredMember);
            setupTimeline(filteredMember);
        }
        document.getElementById("spoilerPanel").classList.add("hidden");
    }

    function showSpoilerGate() {
        const gate = document.getElementById("spoilerGate");
        gate.style.display = "";
        const select = document.getElementById("gateSelect");
        select.innerHTML = '<option value="" disabled selected>Select a saga...</option>';
        STORY_SAGAS.forEach(saga => {
            const opt = document.createElement("option");
            opt.value = saga.upTo;
            opt.textContent = saga.emoji + "  " + saga.label;
            select.appendChild(opt);
        });
    }

    function onGateSelect(upToArc) {
        if (!upToArc) return;
        spoilerArcLimit = upToArc;
        document.getElementById("btnSpoiler").classList.add("active-toggle");
        buildSpoilerArcs();
        enterApp();
    }

    function skipSpoilerGate() {
        spoilerArcLimit = null;
        enterApp();
    }

    function enterApp() {
        const gate = document.getElementById("spoilerGate");
        gate.style.transition = "opacity 0.4s";
        gate.style.opacity = "0";
        setTimeout(() => {
            gate.style.display = "none";
            document.getElementById("app").style.display = "";
            selectCrew("luffy");
        }, 400);
    }

    function getSpoilerFilteredJourney(member) {
        if (!spoilerArcLimit) return member.journey;
        const arcIdx = STORY_ARCS.indexOf(spoilerArcLimit);
        const allowedArcs = new Set(STORY_ARCS.slice(0, arcIdx + 1));
        // Also allow backstory/misc arcs that are not in the main story arcs list
        const filtered = [];
        for (const islId of member.journey) {
            const isl = islands[islId];
            if (!isl) continue;
            // Allow if island's arc is in allowed set or is a backstory/misc arc not in STORY_ARCS
            if (allowedArcs.has(isl.arc) || !STORY_ARCS.includes(isl.arc)) {
                filtered.push(islId);
            } else {
                break; // Stop at first island from a future arc
            }
        }
        return filtered.length > 0 ? filtered : [member.journey[0]];
    }

    /* ════════════════════════════════════════════════ */
    /*  SEARCH                                          */
    /* ════════════════════════════════════════════════ */
    let searchOpen = false, searchIdx = -1;
    function toggleAbout() {
        const popup = document.getElementById("aboutPopup");
        popup.classList.toggle("hidden");
        // close spoiler if open
        document.getElementById("spoilerPanel").classList.add("hidden");
    }

    function toggleSearch() {
        const bar = document.getElementById("searchBar");
        searchOpen = !searchOpen;
        bar.classList.toggle("hidden", !searchOpen);
        if (searchOpen) {
            document.getElementById("searchInput").value = "";
            document.getElementById("searchResults").innerHTML = "";
            setTimeout(() => document.getElementById("searchInput").focus(), 50);
        }
    }
    function clearSearch() {
        document.getElementById("searchInput").value = "";
        document.getElementById("searchResults").innerHTML = "";
        searchIdx = -1;
        document.getElementById("searchInput").focus();
    }
    function performSearch(query) {
        const results = document.getElementById("searchResults");
        results.innerHTML = ""; searchIdx = -1;
        if (!query.trim()) return;
        const q = query.trim().toLowerCase();
        const matches = Object.entries(islands)
            .filter(([, isl]) => isl.name.toLowerCase().includes(q))
            .sort((a, b) => {
                const ai = a[1].name.toLowerCase().indexOf(q);
                const bi = b[1].name.toLowerCase().indexOf(q);
                return ai - bi || a[1].name.localeCompare(b[1].name);
            })
            .slice(0, 12);
        matches.forEach(([id, isl]) => {
            const item = document.createElement("div");
            item.className = "search-result-item";
            const nameIdx = isl.name.toLowerCase().indexOf(q);
            const highlighted = isl.name.substring(0, nameIdx)
                + "<mark>" + isl.name.substring(nameIdx, nameIdx + q.length) + "</mark>"
                + isl.name.substring(nameIdx + q.length);
            item.innerHTML = '<div><div class="search-result-name">' + highlighted + '</div>'
                + '<div class="search-result-meta">' + (isl.arc || isl.sea || '') + '</div></div>';
            item.addEventListener("click", () => selectSearchResult(id));
            results.appendChild(item);
        });
    }
    function selectSearchResult(id) {
        document.getElementById("searchBar").classList.add("hidden");
        searchOpen = false;
        focusOnIsland(id);
    }
    (function initSearch() {
        document.addEventListener("DOMContentLoaded", () => {
            const input = document.getElementById("searchInput");
            if (!input) return;
            input.addEventListener("input", e => performSearch(e.target.value));
            input.addEventListener("keydown", e => {
                const items = document.querySelectorAll(".search-result-item");
                if (e.key === "ArrowDown") { e.preventDefault(); searchIdx = Math.min(searchIdx + 1, items.length - 1); updateSearchActive(items); }
                else if (e.key === "ArrowUp") { e.preventDefault(); searchIdx = Math.max(searchIdx - 1, 0); updateSearchActive(items); }
                else if (e.key === "Enter" && searchIdx >= 0 && items[searchIdx]) { items[searchIdx].click(); }
                else if (e.key === "Escape") { toggleSearch(); }
            });
        });
    })();
    function updateSearchActive(items) {
        items.forEach((el, i) => el.classList.toggle("active", i === searchIdx));
        if (items[searchIdx]) items[searchIdx].scrollIntoView({ block: "nearest" });
    }

    /* ════════════════════════════════════════════════ */
    /*  TIMELINE SLIDER                                 */
    /* ════════════════════════════════════════════════ */
    let timelineJourney = [];
    function setupTimeline(member) {
        timelineJourney = member.journey;
        const slider = document.getElementById("timelineSlider");
        const bar = document.getElementById("timelineBar");
        bar.style.setProperty('--crew-color', member.color);
        const maxIdx = timelineJourney.length - 1;
        slider.min = 0;
        slider.max = maxIdx;
        slider.value = maxIdx;

        // Dot indicators
        const dotsContainer = document.getElementById("timelineDots");
        dotsContainer.innerHTML = "";
        const joinIdx = timelineJourney.indexOf(member.joinedAt);
        // Only show dots if ≤ 40 steps, otherwise too crowded
        if (timelineJourney.length <= 40) {
            timelineJourney.forEach((id, i) => {
                const dot = document.createElement("div");
                dot.className = "timeline-dot visited" + (i === joinIdx ? " join" : "") + (i === maxIdx ? " current" : "");
                dotsContainer.appendChild(dot);
            });
        }

        // Edge labels
        const first = islands[timelineJourney[0]];
        const last = islands[timelineJourney[maxIdx]];
        document.getElementById("timelineStart").textContent = first ? first.name : "";
        document.getElementById("timelineEnd").textContent = last ? last.name : "";

        updateTimelineStep(maxIdx, member);
        bar.classList.remove("hidden");
    }

    function updateTimelineStep(idx, member) {
        const isl = islands[timelineJourney[idx]];
        const stepEl = document.getElementById("timelineStep");
        stepEl.textContent = isl ? isl.name + " (" + (idx + 1) + "/" + timelineJourney.length + ")" : "";

        // Update bounty in crew card
        const bountyEl = document.getElementById("cardBounty");
        if (member.bountyHistory) {
            let currentBounty = 0;
            for (let i = idx; i >= 0; i--) {
                const islId = timelineJourney[i];
                if (member.bountyHistory[islId] !== undefined) {
                    currentBounty = member.bountyHistory[islId];
                    break;
                }
            }
            bountyEl.textContent = "\u0e3f" + currentBounty.toLocaleString();
        }

        // Update dots
        const dots = document.querySelectorAll(".timeline-dot");
        dots.forEach((d, i) => {
            d.className = "timeline-dot" + (i <= idx ? " visited" : "");
            if (i === idx) d.classList.add("current");
        });
    }

    function drawJourneyUpTo(member, stepIdx) {
        // Clean up previous journey
        journeyLines.forEach(l => globeGroup.remove(l));
        journeyArrows.forEach(a => globeGroup.remove(a));
        journeyGlows.forEach(g => globeGroup.remove(g));
        journeyLines = []; journeyArrows = []; journeyGlows = [];
        if (shipMesh) { globeGroup.remove(shipMesh); shipMesh = null; }

        // Reset all markers
        Object.entries(islandMeshes).forEach(([id, mesh]) => {
            mesh.material.emissive.set(0x112211);
            mesh.material.emissiveIntensity = 0.15;
            mesh.scale.setScalar(1);
            if (islandPins[id]) islandPins[id].material.opacity = 0.12;
        });
        Object.values(labelEls).forEach(l => l.classList.remove("active", "origin"));

        const journey = member.journey.slice(0, stepIdx + 1);
        const joinIdx = member.journey.indexOf(member.joinedAt);
        const memberColor = new THREE.Color(member.color);
        const visited = new Set(journey);

        visited.forEach(islId => {
            const mesh = islandMeshes[islId];
            if (!mesh) return;
            mesh.material.emissive.set(memberColor);
            mesh.material.emissiveIntensity = 0.5;
            mesh.scale.setScalar(1.3);
            if (islandPins[islId]) islandPins[islId].material.opacity = 0.4;
            if (labelEls[islId]) labelEls[islId].classList.add("active");
        });
        if (labelEls[member.origin]) labelEls[member.origin].classList.add("origin");

        // Pre-join path
        const effectiveJoinIdx = Math.min(joinIdx, stepIdx);
        if (effectiveJoinIdx > 0) {
            const preJoinIds = journey.slice(0, effectiveJoinIdx + 1);
            createJourneyPath(preJoinIds, member.color, 0.25, true);
        }

        // Post-join path
        if (stepIdx > joinIdx) {
            const postJoinIds = journey.slice(joinIdx, stepIdx + 1);
            createJourneyPath(postJoinIds, member.color, 1.0, false);
        }

        // Pulse and ship at current step island
        const currentId = journey[journey.length - 1];
        if (islandMeshes[currentId]) { islandMeshes[currentId].scale.setScalar(1.5); startPulse(currentId, member.color); }
        const currentIsl = islands[currentId];
        if (currentIsl) createShipMarker(currentIsl, member.color);
    }

    (function initTimeline() {
        document.addEventListener("DOMContentLoaded", () => {
            const slider = document.getElementById("timelineSlider");
            if (!slider) return;
            slider.addEventListener("input", () => {
                if (!lastSelectedCrew) return;
                const filtered = Object.assign({}, lastSelectedCrew, { journey: getSpoilerFilteredJourney(lastSelectedCrew) });
                const idx = parseInt(slider.value);
                updateTimelineStep(idx, filtered);
                drawJourneyUpTo(filtered, idx);
                const islId = timelineJourney[idx];
                if (islId) focusOnIsland(islId);
            });
            // Build spoiler arc list
            buildSpoilerArcs();
        });
    })();

    function updateCard(member) {
        document.getElementById("cardEmoji").textContent = member.emoji;
        document.getElementById("cardName").textContent = member.name;
        document.getElementById("cardName").style.color = member.color;
        document.getElementById("cardEpithet").textContent = '"' + member.epithet + '"';
        document.getElementById("cardRole").textContent = member.role;
        document.getElementById("cardBounty").textContent = "\u0e3f" + member.bounty;
        document.getElementById("cardFruit").textContent = member.devilFruit;
        const uniq = new Set(member.journey);
        document.getElementById("cardIslands").textContent = uniq.size;
        document.getElementById("cardBio").textContent = member.bio;
        document.getElementById("cardWiki").href = "https://onepiece.fandom.com/wiki/" + member.name.replace(/ /g, "_");
        document.getElementById("charCard").classList.remove("hidden");
    }
    function closeCard() { document.getElementById("charCard").classList.add("hidden"); }

    /* ════════════════════════════════════════════════ */
    /*  ANIMATE                                         */
    /* ════════════════════════════════════════════════ */
    function animate() {
        requestAnimationFrame(animate);
        const time = performance.now() * 0.001;
        if (autoRotate) targetRotY += rotSpeed;
        currentRotY += (targetRotY - currentRotY) * 0.06;
        currentRotX += (targetRotX - currentRotX) * 0.06;
        currentZoom += (targetZoom - currentZoom) * 0.06;
        globeGroup.rotation.y = currentRotY;
        globeGroup.rotation.x = currentRotX;
        camera.position.z = currentZoom;
        camera.lookAt(0, 0, 0);
        // Slow cloud drift
        if (cloudMesh) cloudMesh.rotation.y += 0.00012;
        updatePulse();
        updateJourneyAnimation();
        updateSeaKings(time);
        renderer.render(scene, camera);
        updateLabels();
    }

    /* ════════════════════════════════════════════════ */
    /*  RESIZE                                          */
    /* ════════════════════════════════════════════════ */
    function onResize() {
        const W = window.innerWidth, H = window.innerHeight;
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
        renderer.setSize(W, H);
    }

    /* ════════════════════════════════════════════════ */
    /*  UTILITY                                         */
    /* ════════════════════════════════════════════════ */
    function latLngToVec3(lat, lng, radius) {
        const phi = (90 - lat) * D2R, theta = (lng + 180) * D2R;
        return new THREE.Vector3(
            -radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.sin(theta)
        );
    }

    function toggleEditMode() {
        isEditMode = !isEditMode;
        document.getElementById("btnEdit").classList.toggle("active-toggle", isEditMode);
        if (!isEditMode) {
            draggedIsland = null;
        }
    }

    function exportIslands() {
        console.log(JSON.stringify(islands, null, 2));
        alert('Islands exported to console');
    }

    function vec3ToLatLng(vec) {
        const radius = vec.length();
        const phi = Math.acos(vec.y / radius);
        const lat = 90 - phi / D2R;
        const lng = Math.atan2(vec.z, -vec.x) / D2R - 180;
        return {lat, lng};
    }

    // Make functions global
    window.toggleEditMode = toggleEditMode;
    window.exportIslands = exportIslands;

    function updateIslandPosition(id) {
        const isl = islands[id];
        const elevation = isl.elevation || 0;
        const surfR = GR + 0.012 + elevation;
        const surfPos = latLngToVec3(isl.lat, isl.lng, surfR);
        const normal = surfPos.clone().normalize();
        islandMeshes[id].position.copy(surfPos);
        const up = new THREE.Vector3(0, 0, 1);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, normal);
        islandMeshes[id].quaternion.copy(quat);
        islandGlows[id].position.copy(surfPos);
        islandPins[id].position.copy(surfPos);
    }
