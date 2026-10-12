player.threeRevision = THREE.REVISION;
player.camera = camera;
player.renderer = renderer;
player.raycaster = new THREE.Raycaster();
player.mouse = new THREE.Vector2();
player.isEditor = window.location.href.includes('editor');
player.isPaused = false;
player.imageTargets = [];
player.assets = {
    models: [],
    textures: [],
    audios: [],
    videos: [],
}

window.player = player;

function start() {

    if (player.isEditor) {
        const playButton = document.querySelector('#app .Button');
        if (playButton) {
            const menuBar = document.getElementById('menubar');
            menuBar.appendChild(playButton);
        }
    }

    player.raycaster.enabled = true;
    document.addEventListener('mousemove', onPointerMove);
    setTimeout(() => document.addEventListener('click', onPointerClick), 0);
    document.addEventListener('visibilitychange', onVisibilityChange);
}

function stop() {
    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('click', onPointerClick);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    player.assets.audios.forEach(audio => { audio.stop(); });
    player.assets.videos.forEach(video => { video.stop(); });
}

function onVisibilityChange() { player.setPaused(document.hidden, 'visibility'); }

function onPointerClick(ev) {
    // onPointerMove(ev);
    castRay((object) => {
        if (object.onClick && typeof object.onClick === 'function' && player.objIsActive(object)) {
            object.onClick();
            return true;
        }
        return false;
    });
}

function onPointerMove(ev) {
    const rect = player.renderer.domElement.getBoundingClientRect();
    player.mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    player.mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

    castRay(
        (object) => {
            // console.log(`Mouse over object: ${object.name}`);
            if (object.onClick && typeof object.onClick === 'function' && player.objIsActive(object)) {
                document.body.style.cursor = 'pointer';
                return true;
            }
            return false;
        },
        () => {
            document.body.style.cursor = 'default';
        });
}

function castRay(detectCallback, noDetectCallback) {
    if (player.raycaster && player.raycaster.enabled) {
        player.raycaster.setFromCamera(player.mouse, player.camera);
        const intersects = player.raycaster.intersectObjects(scene.children);
        for (const intersect of intersects) {
            if (detectCallback && detectCallback(intersect.object)) return;
        }
        if (noDetectCallback) noDetectCallback();
    }
}

player.loadOrbitControls = function () {
    const SCRIPT_ID = 'three-editor-orbit-controls';
    const revision = THREE.REVISION;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.type = 'module';

    script.textContent = `
            import { OrbitControls as ThreeOrbitControls } 
                from 'https://cdn.jsdelivr.net/npm/three@0.${revision}.0/examples/jsm/controls/OrbitControls.js';

            const player = window.player;

            const controls = new ThreeOrbitControls(
                player.camera,
                player.renderer.domElement
            );

            window.player.orbitControls = controls;
        `;
    document.body.appendChild(script);
    console.log(`Loaded OrbitControls.js (THREE.REVISION: ${revision})`);
}


//Generic asset lookup functions
player.getAssetByType = function (type, name) {
    const list = player.assets[type];
    if (!list) {
        console.warn(`Unknown asset type "${type}".`);
        return null;
    }
    const asset = list.find(asset => asset.name === name);
    if (!asset) {
        console.warn(`Asset "${name}" of type "${type}" not found.`);
        return null;
    }
    return asset;
}

player.getAssetByUrl = function (url) {
    for (const type in player.assets) {
        const asset = player.assets[type].find(asset => asset.url === url);
        if (asset) return asset;
    }
    return null;
}

//Audio management functions
player.loadAudio = function (name, url, onLoadCallback) {
    const existingAudio = player.getAssetByUrl(url);
    if (existingAudio) { return existingAudio; }
    const audio = new Audio(url);
    const audioAsset = {
        name: name,
        url: url,
        audio: audio,
        setLoop: function (loop) { this.audio.loop = loop; },
        setVolume: function (volume) { this.audio.volume = volume; },
        play: function () { this.audio.currentTime = 0; this.audio.play(); },
        pause: function () { this.audio.pause(); },
        stop: function () { this.audio.pause(); this.audio.currentTime = 0; }
    }
    player.assets.audios.push(audioAsset);
    console.log(`Loaded audio: ${name}`);
    if (onLoadCallback) onLoadCallback(audioAsset);
    return audioAsset;
}

//Video management functions
player.loadVideo = function (name, url, onLoadCallback) {
    const existingVideo = player.getAssetByUrl(url);
    if (existingVideo) { return existingVideo; }
    const video = document.createElement('video');
    video.src = url;
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    const videoAsset = {
        name: name,
        url: url,
        video: video,
        texture: new THREE.VideoTexture(video),
        setLoop: function (loop) { this.video.loop = loop; },
        setVolume: function (volume) { this.video.volume = volume; },
        play: function () { this.video.play(); },
        pause: function () { this.video.pause(); },
        stop: function () { this.video.pause(); this.video.currentTime = 0; }
    }
    player.assets.videos.push(videoAsset);
    console.log(`Loaded video: ${name}`);
    if (onLoadCallback) onLoadCallback(videoAsset);
    return videoAsset;
}

//Texture management functions
player.loadTexture = function (name, url, onLoadCallback) {
    const existingTexture = player.getAssetByUrl(url);
    if (existingTexture) { return existingTexture; }
    const loader = new THREE.TextureLoader();
    loader.load(url, (texture) => {
        const textureAsset = {
            name: name,
            url: url,
            texture: texture,
        };
        player.assets.textures.push(textureAsset);
        console.log(`Loaded texture: ${name}`);
        if (onLoadCallback) onLoadCallback(textureAsset);
    });
}

//Model management functions
player.loadModel = function (name, url, onLoadCallback) {
    const existingModel = player.getAssetByUrl(url);
    if (existingModel) { return existingModel; }

    const modelAsset = {
        name: name,
        url: url,
        scene: null,
        gltf: null,
        animations: [],
        loaded: false,
    };
    player.assets.models.push(modelAsset);

    const loadWithLoader = () => {
        const loader = new window.ThreeGLTFLoader();
        loader.load(url, (gltf) => {
            modelAsset.scene = gltf.scene;
            modelAsset.animations = gltf.animations;
            modelAsset.gltf = gltf;
            modelAsset.loaded = true;
            console.log(`Loaded model: ${name}`);
            if (onLoadCallback) onLoadCallback(modelAsset);
        }, undefined, (error) => {
            console.error(`Failed to load model: ${name}`, error);
        });
    };

    if (window.ThreeGLTFLoader) {
        loadWithLoader();
    } else {
        const SCRIPT_ID = 'three-editor-gltf-loader';
        const loaderScript = document.getElementById(SCRIPT_ID);
        if (loaderScript) {
            loaderScript.addEventListener('load', loadWithLoader);
        } else {
            const script = document.createElement('script');
            script.id = SCRIPT_ID;
            script.type = 'module';
            script.textContent = `
                import { GLTFLoader as ThreeGLTFLoader } 
                    from 'https://cdn.jsdelivr.net/npm/three@0.${THREE.REVISION}.0/examples/jsm/loaders/GLTFLoader.js';

                window.ThreeGLTFLoader = ThreeGLTFLoader;
            `;
            script.addEventListener('load', loadWithLoader);
            document.body.appendChild(script);
        }
    }

    return modelAsset;
}

player.objIsActive = function (obj) {
    let isActive = true;
    if (obj.visible === false) { return false; }
    obj.traverseAncestors((ancestor) => {
        if (ancestor.visible === false) {
            isActive = false;
            return false;
        }
    });
    return isActive;
}

player.setPaused = function (paused, reason = 'manual') {
    player.pauseReasons = player.pauseReasons || new Set();
    const wasPaused = player.pauseReasons.size > 0;

    if (paused) player.pauseReasons.add(reason);
    else player.pauseReasons.delete(reason);

    const isPaused = player.pauseReasons.size > 0;
    if (wasPaused === isPaused) return;
    player.isPaused = isPaused;

    if (isPaused) {
        player.pausedState = {
            raycasterEnabled: player.raycaster ? player.raycaster.enabled : false,
            orbitControlsEnabled: player.orbitControls ? player.orbitControls.enabled : false,
            audios: player.assets.audios.map(audioAsset => ({
                audioAsset: audioAsset,
                wasPlaying: !audioAsset.audio.paused,
            })),
            videos: player.assets.videos.map(videoAsset => ({
                videoAsset: videoAsset,
                wasPlaying: !videoAsset.video.paused,
            })),
        };

        if (player.raycaster) player.raycaster.enabled = false;
        if (player.orbitControls) player.orbitControls.enabled = false;
        player.pausedState.audios.forEach(({ audioAsset, wasPlaying }) => {
            if (wasPlaying) audioAsset.pause();
        });
        player.pausedState.videos.forEach(({ videoAsset, wasPlaying }) => {
            if (wasPlaying) videoAsset.pause();
        });
    } else {
        const state = player.pausedState;
        if (!state) return;

        if (player.raycaster) player.raycaster.enabled = state.raycasterEnabled;
        if (player.orbitControls) player.orbitControls.enabled = state.orbitControlsEnabled;
        state.audios.forEach(({ audioAsset, wasPlaying }) => {
            if (wasPlaying) audioAsset.play();
        });
        state.videos.forEach(({ videoAsset, wasPlaying }) => {
            if (wasPlaying) videoAsset.play();
        });

        player.pausedState = null;
    }
}

console.log(player);















