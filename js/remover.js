// Model wrapper: runs @imgly/background-removal in the browser.
// removeBackground(source, onPhase) -> Promise<PNG Blob>
//   onPhase receives 'downloading-model' | 'processing' | 'done'
//   Errors carry code: 'model-download-failed' | 'no-foreground' | 'inference-failed'

const LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
// observed in the 1.7.0 ESM bundle: keys are
//   `fetch:resources.json` / `fetch:wasm` / `fetch:onnx_f16`  (bytes totals)
//   `compute:decode` / `compute:inference` / `compute:mask` / `compute:encode`

let loadLibrary = null; // cached promise for the dynamic import
let hasCompletedOnce = false; // model verified with a successful run in this page session
let modelReady = false; // preload() resolved at least once in this page session

function importLibraryOnce() {
  if (!loadLibrary) {
    loadLibrary = import(LIBRARY_URL).then(m => {
      if (typeof m.removeBackground !== 'function') {
        const err = new Error('library import returned an unexpected module shape');
        err.code = 'model-download-failed';
        throw err;
      }
      return m; // keep the whole namespace: removeBackground + preload
    }, err => {
      // allow a retry: a cached failed import would fail every future
      // "try again" without touching the network
      loadLibrary = null;
      err.code = 'model-download-failed';
      throw err;
    });
  }
  return loadLibrary;
}

export async function removeBackground(source, onPhase) {
  if (typeof onPhase !== 'function') onPhase = () => {};
  let computeStarted = false;

  function makeConfig() {
    return {
      device: 'cpu',
      model: 'isnet_fp16',
      output: { quality: 1.0, format: 'image/png' },
      progress: (key, current, total) => {
        if (typeof key !== 'string') return;
        if (!key.startsWith('compute:')) {
          onPhase('downloading-model'); // model data still being fetched
        } else if (!computeStarted) {
          computeStarted = true;
          onPhase('processing');
        }
      },
    };
  }

  function wrapError(err, fallbackMessage) {
    const source = err instanceof Error ? err : new Error((err && err.message) || fallbackMessage || 'background removal failed');
    let code = (hasCompletedOnce || modelReady) ? 'inference-failed' : 'model-download-failed';
    if (source.code === 'no-foreground') code = 'no-foreground';
    try {
      source.code = code; // may throw when the class defines a read-only `code` getter
      return source;
    } catch {
      const copy = source.message ? source.message : 'background removal failed';
      const wrapped = new Error(`background removal failed: ${code} (${copy})`, { cause: source });
      wrapped.code = code;
      wrapped.contextMessage = copy;
      return wrapped;
    }
  }

  onPhase(hasCompletedOnce ? 'processing' : 'downloading-model');
  let library;
  try {
    library = await importLibraryOnce();
  } catch (err) {
    throw wrapError(err, 'library load failed');
  }

  // Separate model fetching from inference: preload() downloads (or reads from
  // the browser cache) the wasm + onnx assets and succeeds/fails on its own.
  try {
    await library.preload(makeConfig());
    modelReady = true;
  } catch (err) {
    throw wrapError(err, 'AI model download failed');
  }

  try {
    const blob = await (library.removeBackground)(source, makeConfig());
    if (!(blob instanceof Blob)) {
      throw new Error('unexpected inference output');
    }
    hasCompletedOnce = true;
    onPhase('done');
    return blob;
  } catch (err) {
    throw wrapError(err, 'background removal failed');
  }
}
