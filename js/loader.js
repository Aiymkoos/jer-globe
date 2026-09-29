// Заранее скачивает движок MediaPipe (≈12 МБ) и модель (≈6 МБ) с нашего же сайта
// и сообщает прогресс. Загрузка стартует сразу при открытии страницы,
// пока человек читает инструкцию.

const ROOT = new URL('../', import.meta.url);
const FILES = {
  loader: new URL('vendor/mediapipe/wasm/vision_wasm_internal.js', ROOT).href,
  wasm: new URL('vendor/mediapipe/wasm/vision_wasm_internal.wasm', ROOT).href,
  model: new URL('models/hand_landmarker.task', ROOT).href,
};
// Примерные размеры — если сервер не прислал Content-Length.
const APPROX = { wasm: 11_756_954, model: 7_819_105 };

// Повторяет загрузку при обрыве связи (до 3 попыток).
async function download(url, onChunk) {
  for (let attempt = 1; ; attempt++) {
    let got = 0;
    try {
      return await downloadOnce(url, n => { got += n; onChunk(n); });
    } catch (e) {
      onChunk(-got); // откатываем прогресс неудачной попытки
      if (attempt >= 3) throw e;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

async function downloadOnce(url, onChunk) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    onChunk(value.length);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

let started = null;

/** onProgress(0..1). Возвращает { fileset, model } для createHandTracker. */
export function preload(onProgress = () => {}) {
  if (started) return started;
  const total = APPROX.wasm + APPROX.model;
  let loaded = 0;
  const tick = n => {
    loaded += n;
    onProgress(Math.min(1, loaded / total));
  };
  started = Promise.all([download(FILES.wasm, tick), download(FILES.model, tick)]).then(([wasm, model]) => ({
    // движок отдаём из памяти, чтобы браузер не качал его второй раз
    fileset: {
      wasmLoaderPath: FILES.loader,
      wasmBinaryPath: URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })),
    },
    model,
  }));
  started.catch(() => { started = null; });
  return started;
}
