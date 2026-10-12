import * as THREE from 'three';
import { MindARThree } from 'mindar-image-three';

class MindARController {

    constructor(container, threePlayer, debug = false) {
        this.container = container;
        this.threePlayer = threePlayer;
        this.debug = debug;
        this.isMobile = /Android|iPhone|iPod|iPad/i.test(navigator.userAgent);

        this.imageTargetSrc = 'assets/marker/targets.mind';

        this.mindar = null;
        this.anchors = [];
        this.started = false;

        // Se asignan desde index.html
        this.onPrecioTap = null; // código de barras (espalda)
        this.onLogoTap = null;   // logo Panda Cha (frente)
        this.onHistoriaTap = null; // panda de la etiqueta (espalda) -> video
        this.onSloganTap = null;   // slogan "Good Tea Brighter Days" (espalda) -> canción

        this.listeners = {
            start: [],
            found: [],
            lost: [],
            update: [],
        };

        this.clickHandlerBound = false;
        this.billboards = [];
    }

    addListener(type, callback) { this.listeners[type].push(callback); }

    dispatch(type, event) {
        for (const listener of this.listeners[type]) {
            listener(event);
        }
    }

    async start() {

        if (this.started) return;

        // Limpia restos de un intento anterior (p.ej. un <video> huérfano).
        if (this.mindar) { this.stop(); }
        this.container.replaceChildren();

        const player = this.threePlayer;
        const imageTargets = player?.imageTargets;

        if (!imageTargets || !imageTargets.length) {
            throw new Error('player.imageTargets está vacío. Asegurate de que los scripts de la escena se ejecutaron.');
        }

        this.mindar = new MindARThree({
            container: this.container,
            imageTargetSrc: this.imageTargetSrc,
            filterMinCF: 0.00005,
            filterBeta: 20,
            warmupTolerance: 3,
            missTolerance: 12,
            uiLoading: 'no',
            uiScanning: 'no',
            uiError: 'yes',
        });

        const { scene, camera, renderer } = this.mindar;

        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x000000, 0);

        // Un solo contenido (el del editor) que se muestra sobre el marcador
        // que esté viendo la cámara: 0 = frente, 1 = espalda.
        const it = imageTargets[0];
        const content = it.arContent;
        const NUM_MARCADORES = 2;
        let activo = -1;
        const zonas = []; // zonas tocables invisibles (logo, código de barras, panda trasero, slogan)

        // El contenido cuelga de este nodo y no directo del marcador.
        // Cada cuadro seguimos al marcador con amortiguación para quitar el temblor.
        const SUAVIDAD = 0.08; // segundos: más alto = más suave pero más lento
        const suavizado = new THREE.Group();
        scene.add(suavizado);
        let primera = true;
        const posObj = new THREE.Vector3();
        const quatObj = new THREE.Quaternion();
        const escObj = new THREE.Vector3();
        let ultimo = performance.now();

        if (content) {
            // Cada marcador mide la mitad de la etiqueta (0.825 unidades del editor)
            const escala = 1 / 0.825;
            content.scale.setScalar(escala);
            content.rotation.set(THREE.MathUtils.degToRad(90), 0, 0);
            // El contenido se diseñó respecto al centro de la etiqueta completa
            // (el panda está en x = -0.35). Aquí lo centramos en cada marcador.
            const BAJAR = 0.18; // sube este número para bajar más; bájalo para bajar menos
            content.position.set(0.35 * escala, -BAJAR, 0);

            // Cilindro invisible con la forma de la lata: tapa lo que pasa por detrás (los lazos)
            const R = 0.26; // radio de la lata en unidades del editor
            const lata = new THREE.Mesh(
                new THREE.CylinderGeometry(R, R, 1.15, 32),
                new THREE.MeshBasicMaterial({ colorWrite: false })
            );
            lata.rotation.x = Math.PI / 2;
            lata.position.set(-0.35, -R, 0.075);
            lata.renderOrder = -1;
            content.add(lata);

            // Zonas invisibles tocables sobre la etiqueta. Con ?debug=1 se ven de color.
            // x: izquierda (-) / derecha (+)   z: arriba (-) / abajo (+)
            // marcador: 0 = solo se activa viendo el frente, 1 = solo viendo la espalda
            const crearZona = (x, z, ancho, alto, color, marcador, alTocar) => {
                const zona = new THREE.Mesh(
                    new THREE.PlaneGeometry(ancho, alto),
                    new THREE.MeshBasicMaterial({
                        color,
                        transparent: true,
                        opacity: this.debug ? 0.35 : 0,
                        depthWrite: false,
                        side: THREE.DoubleSide
                    })
                );
                zona.rotation.x = -Math.PI / 2;
                zona.position.set(x, 0.03, z);
                zona.visible = false;
                zona.userData.prioridad = true; // gana aunque haya algo delante
                zona.userData.marcador = marcador;
                zona.onClick = alTocar;
                content.add(zona);
                zonas.push(zona);
                return zona;
            };

            // Código de barras (espalda) -> precio
            crearZona(-0.28, 0.24, 0.20, 0.2, 0xff00ff, 1, () => {
                if (this.onPrecioTap) this.onPrecioTap();
            });

            // Panda de la etiqueta (espalda) -> historia en video
            crearZona(-0.47, 0.22, 0.17, 0.24, 0x00ccff, 1, () => {
                if (this.onHistoriaTap) this.onHistoriaTap();
            });

            // Slogan "Good Tea Brighter Days" (espalda) -> canción
            crearZona(-0.37, -0.45, 0.30, 0.26, 0x33dd66, 1, () => {
                if (this.onSloganTap) this.onSloganTap();
            });

            // Logo Panda Cha (frente) -> la marca
            crearZona(-0.34, -0.36, 0.4, 0.22, 0xffcc00, 0, () => {
                if (this.onLogoTap) this.onLogoTap();
            });

            this.setupPandaBillboard(content);
        }

        for (let i = 0; i < NUM_MARCADORES; i++) {
            const anchor = this.mindar.addAnchor(i);

            if (content && i === 0) suavizado.add(content);

            if (this.debug) {
                this.addMarkerDebugHelpers(anchor.group);
            }

            anchor.onTargetFound = () => {
                console.log(`MindARController: target detectado ${i}`);
                activo = i;
                primera = true;
                if (content) {
                    content.visible = true;
                }
                zonas.forEach((z) => { z.visible = (z.userData.marcador === i); });
                if (it.onFound) it.onFound.call(it);
                this.dispatch('found', it);
            };

            anchor.onTargetLost = () => {
                console.log(`MindARController: target perdido ${i}`);
                if (activo !== i) return;
                activo = -1;
                if (content) content.visible = false;
                zonas.forEach((z) => { z.visible = false; });
                if (it.onLost) it.onLost.call(it);
                this.dispatch('lost', it);
            };

            this.anchors.push(anchor);
        }

        this.copyEnvironment(scene, player);
        this.copyLights(scene, player);
        this.copyRendererSettings(renderer, player);

        // El player sigue corriendo (events update/audio) pero deja de pintar.
        if (player?.setRenderEnabled) player.setRenderEnabled(false);

        this.bindClickEvents();

        try {
            await this.mindar.start();
        } catch (e) {
            this.mindar = null;
            this.started = false;
            const detail = (e && e.message) ? `: ${e.message}` : '. Comprobá que la cámara esté disponible y permitas el acceso';
            throw new Error(`No se pudo iniciar la cámara AR${detail}`);
        }

        renderer.setAnimationLoop(() => {
            const ahora = performance.now();
            const dt = Math.min(0.1, (ahora - ultimo) / 1000);
            ultimo = ahora;

            if (activo >= 0) {
                this.anchors[activo].group.matrix.decompose(posObj, quatObj, escObj);
                if (primera) {
                    suavizado.position.copy(posObj);
                    suavizado.quaternion.copy(quatObj);
                    suavizado.scale.copy(escObj);
                    primera = false;
                } else {
                    const k = 1 - Math.exp(-dt / SUAVIDAD);
                    suavizado.position.lerp(posObj, k);
                    suavizado.quaternion.slerp(quatObj, k);
                    suavizado.scale.lerp(escObj, k);
                }
            }

            this.dispatch('update', {});
            this.updateBillboards(camera);
            renderer.render(scene, camera);
        });

        this.started = true;
        this.dispatch('start', {});
    }

    // El panda se separa en un pivote que siempre mira a la cámara.
    setupPandaBillboard(content) {
        const panda = content.getObjectByName('Panda');
        if (!panda) return;
        const pivot = new THREE.Object3D();
        pivot.position.copy(panda.position);
        content.add(pivot);
        panda.position.set(0, 0, 0);
        panda.quaternion.identity();
        pivot.add(panda);
        this.billboards.push({ pivot, parent: content });
    }

    updateBillboards(camera) {
        const q = new THREE.Quaternion();
        for (const b of this.billboards) {
            b.parent.getWorldQuaternion(q);
            b.pivot.quaternion.copy(q.invert()).multiply(camera.quaternion);
        }
    }

    stop() {
        if (!this.mindar) return;
        if (this.mindar.renderer?.setAnimationLoop) {
            this.mindar.renderer.setAnimationLoop(null);
        }
        this.mindar.stop();
        this.mindar = null;
        this.started = false;
    }

    switchCamera() {
        this.mindar?.switchCamera();
    }

    copyEnvironment(scene, player) {
        const appScene = player?.scene;
        if (!appScene) return;

        if (appScene.environment) {
            scene.environment = appScene.environment;
        }
        if (appScene.environmentIntensity !== undefined) {
            scene.environmentIntensity = appScene.environmentIntensity;
        }
        if (appScene.environmentRotation) {
            scene.environmentRotation.copy(appScene.environmentRotation);
        }
    }

    copyLights(scene, player) {
        const appScene = player?.scene;
        if (!appScene) return;

        appScene.traverse((obj) => {
            if (obj.isLight && obj !== appScene) {
                scene.add(obj.clone());
            }
        });
    }

    copyRendererSettings(renderer, player) {
        const appRenderer = player?.renderer;
        if (!appRenderer || !renderer) return;

        renderer.toneMapping = appRenderer.toneMapping;
        renderer.toneMappingExposure = appRenderer.toneMappingExposure;
        renderer.shadowMap.enabled = appRenderer.shadowMap?.enabled === true && !this.isMobile;
        renderer.shadowMap.type = appRenderer.shadowMap?.type ?? THREE.PCFShadowMap;
    }

    bindClickEvents() {
        if (this.clickHandlerBound) return;
        this.clickHandlerBound = true;

        if (window.PointerEvent) {
            document.addEventListener('pointerdown', (ev) => this.onArClick(ev));
        } else {
            document.addEventListener('touchstart', (ev) => {
                const touch = ev.changedTouches?.[0];
                if (touch) this.onArClick(touch);
            });
            document.addEventListener('click', (ev) => this.onArClick(ev));
        }
    }

    onArClick(ev) {
        const mindar = this.mindar;
        if (!mindar) return;

        const { scene, camera, renderer } = mindar;
        const canvas = renderer?.domElement;

        const rect = canvas.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((ev.clientX - rect.left) / rect.width) * 2 - 1,
            -((ev.clientY - rect.top) / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);

        const hits = raycaster.intersectObjects(scene.children, true);

        // 1) Las zonas con prioridad (logo, precio, panda trasero, slogan) ganan aunque haya algo delante.
        //    Si el toque cae en dos zonas a la vez, gana la que tenga su centro más cerca del dedo.
        let mejor = null;
        let mejorDist = Infinity;
        for (const hit of hits) {
            let obj = hit.object;
            while (obj) {
                if (obj.userData && obj.userData.prioridad && typeof obj.onClick === 'function' && this.objIsActive(obj)) {
                    const p = obj.worldToLocal(hit.point.clone());
                    const g = obj.geometry.parameters;
                    const d = Math.max(Math.abs(p.x) / g.width, Math.abs(p.y) / g.height);
                    if (d < mejorDist) { mejorDist = d; mejor = obj; }
                    break;
                }
                obj = obj.parent;
            }
        }
        if (mejor) {
            mejor.onClick();
            return;
        }

        // 2) El resto: el primero que tenga onClick
        for (const hit of hits) {
            let obj = hit.object;
            while (obj) {
                if (obj.onClick && typeof obj.onClick === 'function' && this.objIsActive(obj)) {
                    obj.onClick();
                    return;
                }
                obj = obj.parent;
            }
        }
    }

    objIsActive(obj) {
        if (obj.visible === false) return false;
        let active = true;
        obj.traverseAncestors((ancestor) => {
            if (ancestor.visible === false) active = false;
        });
        return active;
    }

    addMarkerDebugHelpers(root) {
        const planeSize = 0.5;
        const planeGeometry = new THREE.PlaneGeometry(planeSize, planeSize, 1, 1);
        const planeMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        root.add(new THREE.Mesh(planeGeometry, planeMaterial));
        root.add(new THREE.LineSegments(
            new THREE.EdgesGeometry(planeGeometry),
            new THREE.LineBasicMaterial({ color: 0x00ffff })
        ));
        root.add(new THREE.AxesHelper(0.3));
    }

}

export { MindARController };