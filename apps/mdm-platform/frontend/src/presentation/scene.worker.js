import { WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, Float32BufferAttribute, PointsMaterial, Points, IcosahedronGeometry, MeshBasicMaterial, Mesh } from 'three';
let renderer, scene, camera, particles, model, frame, disposed = false, visible = false, count = 96, angle = 0, target = { x: 0, y: 0 }, last;
const resources = [];
function cancel() { if (frame !== undefined) { self.cancelAnimationFrame?.(frame); clearTimeout(frame); frame = undefined; } last = undefined; }
function draw(now) {
  if (!visible || disposed || !renderer) return;
  const delta = Math.min(.05, last === undefined ? 0 : (now - last) / 1000); last = now; angle += delta * .12;
  model.rotation.y += (target.x - model.rotation.y) * .04; model.rotation.x += (target.y - model.rotation.x) * .04;
  particles.rotation.y = angle;
  try { renderer.render(scene, camera); } catch { fail('scene-render-failed'); return; }
  frame = self.requestAnimationFrame ? self.requestAnimationFrame(draw) : setTimeout(() => draw(performance.now()), 16);
}
function fail(reason) { visible = false; cancel(); self.postMessage({ type: 'error', reason }); }
function dispose() { if (disposed) return; disposed = true; visible = false; cancel(); resources.forEach(value => value.dispose()); renderer?.dispose(); renderer?.forceContextLoss(); self.postMessage({ type: 'disposed' }); }
self.onmessage = event => {
  const message = event.data;
  if (message.type === 'dispose') return dispose();
  if (disposed) return;
  try {
    if (message.type === 'init') {
      const canvas = message.canvas;
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fail('webgl-context-lost'); });
      renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
      scene = new Scene(); camera = new PerspectiveCamera(45, 1, .1, 100); camera.position.z = 7;
      const positions = [], geometry = new BufferGeometry();
      for (let index = 0; index < 300; index++) { const phase = index * 2.399963; const radius = 1.8 + (index % 13) / 8; positions.push(Math.cos(phase) * radius, Math.sin(phase) * radius * .65, (index % 17) / 8 - 1); }
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      const material = new PointsMaterial({ color: 0xa44e3c, size: .035, transparent: true, opacity: .6 }); particles = new Points(geometry, material); scene.add(particles);
      const modelGeometry = new IcosahedronGeometry(.95, 0), modelMaterial = new MeshBasicMaterial({ color: 0x667961, wireframe: true, transparent: true, opacity: .6 });
      model = new Mesh(modelGeometry, modelMaterial); scene.add(model); resources.push(geometry, material, modelGeometry, modelMaterial);
      count = message.quality === 'high' ? 300 : 96; geometry.setDrawRange(0, count);
      self.postMessage({ type: 'ready' });
    } else if (message.type === 'size' && renderer) { renderer.setPixelRatio(message.ratio); renderer.setSize(message.width, message.height, false); camera.aspect = message.width / message.height; camera.updateProjectionMatrix(); }
    else if (message.type === 'pointer') { target.x = Math.max(-.6, Math.min(.6, (message.x / 500 - .5) * .8)); target.y = Math.max(-.4, Math.min(.4, (message.y / 300 - .5) * .5)); }
    else if (message.type === 'quality' && particles) { count = message.value === 'high' ? 300 : 96; particles.geometry.setDrawRange(0, count); renderer.setPixelRatio(Math.min(renderer.getPixelRatio(), message.value === 'high' ? 1.5 : 1)); }
    else if (message.type === 'visible') { visible = message.value; cancel(); if (visible) draw(performance.now()); }
  } catch { fail('scene-initialization-failed'); }
};
