// Camera → worker → landmarks. No frame backlog; render loop consumes each result once.
import { HandLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
    audio: false,
  });
  video.srcObject = stream;
  try { await video.play(); }
  catch (error) { stream.getTracks().forEach(t => t.stop()); throw error; }
  if (!video.videoWidth) await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
}

export async function createHandTracker({ fileset, model }) {
  let worker = null, direct = null, result = null, busy = false, closed = false;
  let lastVideoTime = -1, lastSubmit = -Infinity, submittedAt = 0, recovering = false;
  const metrics = { mode: 'starting', inferenceMs: 0, samples: 0 };
  const options = delegate => ({
    baseOptions: { modelAssetBuffer: model, delegate }, runningMode: 'VIDEO', numHands: 2,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  async function fallback() {
    if (closed || recovering) return;
    recovering = true;
    worker?.terminate(); worker = null; busy = false; result = null;
    try {
      let detector;
      try { detector = await HandLandmarker.createFromOptions(fileset, options('GPU')); }
      catch { detector = await HandLandmarker.createFromOptions(fileset, options('CPU')); }
      if (closed) detector.close();
      else { direct = detector; metrics.mode = 'compatibility'; }
    } finally { recovering = false; }
  }
  try {
    if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('Worker unavailable');
    worker = new Worker(new URL('./tracking-worker.js', import.meta.url));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker init timeout')), 15000);
      worker.onerror = error => { clearTimeout(timer); reject(error); };
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') { clearTimeout(timer); resolve(); }
        if (data.type === 'error') { clearTimeout(timer); reject(new Error(data.message)); }
      };
      // Retain the buffer for compatibility fallback; only video frames are transferred.
      worker.postMessage({ type: 'init', fileset, model });
    });
    metrics.mode = 'worker';
    worker.onmessage = ({ data }) => {
      if (data.type === 'result') {
        result = { ...data.result, sampleId: data.time };
        metrics.inferenceMs = data.inferenceMs; metrics.samples++; busy = false;
      } else if (data.type === 'error') fallback().catch(e => { metrics.error = String(e); });
    };
    worker.onerror = () => { fallback().catch(e => { metrics.error = String(e); }); };
  } catch { await fallback(); }

  return {
    metrics,
    detect(video, now) {
      const ready = result; result = null;
      if (closed || recovering) return ready;
      if (busy && now - submittedAt > 1800) { fallback().catch(e => { metrics.error = String(e); }); return ready; }
      if (video.readyState < 2 || video.currentTime === lastVideoTime || busy || now - lastSubmit < (direct ? 50 : 32)) return ready;
      lastVideoTime = video.currentTime; lastSubmit = now;
      if (direct) {
        const started = performance.now();
        let value;
        try { value = direct.detectForVideo(video, now); }
        catch (error) { metrics.error = String(error); return { landmarks: [], sampleId: now }; }
        metrics.inferenceMs = performance.now() - started; metrics.samples++;
        return { ...value, sampleId: now };
      }
      if (worker) {
        busy = true; submittedAt = now;
        const target = worker;
        createImageBitmap(video).then(bitmap => {
          if (closed || worker !== target) { bitmap.close(); return; }
          target.postMessage({ type: 'frame', bitmap, time: now }, [bitmap]);
        }).catch(() => { fallback().catch(e => { metrics.error = String(e); }); });
      }
      return ready;
    },
    close() { closed = true; worker?.terminate(); direct?.close(); result = null; },
  };
}
