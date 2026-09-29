// 3D-vy byggd på Three.js (global THREE från vendor/three.min.js).

const COLORS = {
    carcass: { color: 0xC9B79C, opacity: 0.92 },
    shelf: { color: 0xB5A386 },
    back: { color: 0x5b6270 },
    front: { color: 0xE6E9EF, opacity: 0.45, isFront: true },
    frontPanel: { color: 0xD4D8E0, opacity: 0.4, isFront: true },
    drawer: { color: 0x9FB6DB },
    bottom: { color: 0x7F93B5 },
    frame: { color: 0xC9B79C },
    panel: { color: 0xB5A386 }
};

export class Viewer {
    constructor(el, onToggle) {
        this.el = el;
        this.onToggle = onToggle;
        this.ok = false;
        this.frameKey = '';
        this.showFronts = true;
        if (!window.THREE || !THREE.OrbitControls) return this.fail('3D-vyn kunde inte laddas. Kaplistan fungerar ändå.');
        try {
            this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
        } catch {
            return this.fail('Din webbläsare saknar WebGL-stöd. Kaplistan fungerar ändå.');
        }
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        el.appendChild(this.renderer.domElement);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(40, 1, 1, 50000);
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dl = new THREE.DirectionalLight(0xffffff, 0.7); dl.position.set(1000, 2000, 1500); this.scene.add(dl);
        const dl2 = new THREE.DirectionalLight(0xffffff, 0.25); dl2.position.set(-1500, -500, -1000); this.scene.add(dl2);
        this.group = new THREE.Group();
        this.scene.add(this.group);
        this.mats = {};
        for (const [role, c] of Object.entries(COLORS)) {
            this.mats[role] = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.75, transparent: !!c.opacity, opacity: c.opacity ?? 1 });
        }
        this.matOff = new THREE.MeshStandardMaterial({ color: 0xef4444, transparent: true, opacity: 0.3, wireframe: true });
        this.edges = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });
        this.ok = true;

        const resize = () => {
            const w = el.clientWidth, h = el.clientHeight;
            if (!w || !h) return;
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h, false);
        };
        this.resize = resize;
        if ('ResizeObserver' in window) new ResizeObserver(resize).observe(el); else window.addEventListener('resize', resize);
        resize();

        // Klick (inte drag) växlar om en del ska ingå i kaplistan
        const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
        let down = null;
        el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
        el.addEventListener('pointerup', e => {
            if (!down || Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4) return;
            const r = el.getBoundingClientRect();
            mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
            ray.setFromCamera(mouse, this.camera);
            const hit = ray.intersectObjects(this.group.children.filter(o => o.isMesh && o.visible))[0];
            if (hit) this.onToggle(hit.object.userData.key);
        });

        let visible = true;
        if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(el);
        const loop = () => {
            requestAnimationFrame(loop);
            if (document.hidden || !visible) return;
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        };
        loop();
    }

    fail(msg) {
        this.el.innerHTML = `<p class="p-6 pt-16 text-sm text-gray-500">${msg}</p>`;
    }

    clear() {
        while (this.group.children.length) {
            const c = this.group.children[0];
            this.group.remove(c);
            c.geometry.dispose();
        }
    }

    /** parts: från core-byggarna. excluded: { key: true } */
    show(parts, excluded, frameKey) {
        if (!this.ok) return;
        this.clear();
        let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const p of parts) {
            if (!p.geo) continue;
            const [sx, sy, sz] = p.geo.size.map(n => Math.max(n, 0.5));
            const off = !!excluded[p.key];
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), off ? this.matOff : this.mats[p.geo.role] || this.mats.carcass);
            mesh.position.set(...p.geo.pos);
            mesh.userData = { key: p.key, isFront: !!COLORS[p.geo.role]?.isFront };
            mesh.visible = this.showFronts || !mesh.userData.isFront;
            this.group.add(mesh);
            if (!off) {
                const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), this.edges);
                line.position.copy(mesh.position);
                line.userData = { isFront: mesh.userData.isFront };
                line.visible = mesh.visible;
                this.group.add(line);
            }
            for (let i = 0; i < 3; i++) {
                min[i] = Math.min(min[i], p.geo.pos[i] - p.geo.size[i] / 2);
                max[i] = Math.max(max[i], p.geo.pos[i] + p.geo.size[i] / 2);
            }
        }
        if (frameKey !== this.frameKey && Number.isFinite(min[0])) {
            this.frameKey = frameKey; // behåll användarens vy så länge yttermåtten är desamma
            const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
            const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
            this.controls.target.set(cx, cy, cz);
            // Avstånd så att hela objektet ryms i bild oavsett bildformat
            const fov = this.camera.fov * Math.PI / 180;
            const fit = size / (2 * Math.tan(fov / 2)) / Math.min(1, this.camera.aspect || 1);
            const dir = new THREE.Vector3(0.55, 0.35, 1).normalize().multiplyScalar(fit * 1.6);
            this.camera.position.set(cx + dir.x, cy + dir.y, cz + dir.z);
            this.controls.update();
        }
    }

    setShowFronts(on) {
        this.showFronts = on;
        if (!this.ok) return;
        this.group.children.forEach(o => { if (o.userData.isFront) o.visible = on; });
    }
}
