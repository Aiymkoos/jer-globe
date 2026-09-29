// Classic worker: MediaPipe's WASM loader uses importScripts.
// Only one transferred camera frame is processed at a time.
let landmarker;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const { HandLandmarker } = await import('./../vendor/mediapipe/vision_bundle.mjs');
      const options = delegate => ({
        baseOptions: { modelAssetBuffer: data.model, delegate },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      try { landmarker = await HandLandmarker.createFromOptions(data.fileset, options('GPU')); }
      catch { landmarker = await HandLandmarker.createFromOptions(data.fileset, options('CPU')); }
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'frame') {
      try {
        const started = performance.now();
        const result = landmarker.detectForVideo(data.bitmap, data.time);
        self.postMessage({ type: 'result', result, time: data.time, inferenceMs: performance.now() - started });
      } finally { data.bitmap.close(); }
    }
  } catch (error) { self.postMessage({ type: 'error', message: String(error?.message || error) }); }
};
