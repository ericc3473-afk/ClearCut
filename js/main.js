// UI logic: dropzone (click / drag&drop / paste), validation, view state.

import { removeBackground } from './remover.js';

const MAX_FILE_BYTES = 22 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function el(id) {
  return document.getElementById(id);
}

export function setView(view) {
  const dropzone = el('dropzone');
  const resultSection = el('result-section');
  switch (view) {
    case 'upload':
      dropzone.classList.remove('is-hidden');
      resultSection.classList.add('is-hidden');
      break;
    case 'processing':
      dropzone.classList.add('is-hidden');
      resultSection.classList.add('is-hidden');
      break;
    case 'result':
      dropzone.classList.add('is-hidden');
      resultSection.classList.remove('is-hidden');
      break;
    default:
      throw new Error(`unknown view: ${view}`);
  }
}

export function setStatus(message) {
  el('status-area').textContent = message === null ? '' : message;
}

// Inference pipeline: validated file -> model/download phases -> result view.
let originalUrl = null;
let resultUrl = null;
let currentFileName = '';
let processingToken = 0;

const PHASE_MESSAGES = {
  'downloading-model': 'First run: fetching the AI model (~40 MB, cached for next time)…',
  'processing': 'Removing the background…',
};

const ERROR_MESSAGES = {
  'model-download-failed': 'Could not load the AI model. Check your connection and try again.',
  'no-foreground': 'No clear subject found. Try a photo of a person, product, animal or car.',
  'inference-failed': 'That image did not work. Try a photo with a clear subject (person, product, animal, car).',
};

function showResult(name, resultBlob) {
  resultUrl = URL.createObjectURL(resultBlob);
  el('before-img').src = originalUrl;
  el('after-img').src = resultUrl;
  const downloadBtn = el('download-btn');
  downloadBtn.classList.remove('is-hidden');
  downloadBtn.href = resultUrl;
  downloadBtn.download = `${name.replace(/\.[^.]+$/, '')}-no-bg.png`;
  el('reset-btn').classList.remove('is-hidden');
  setView('result');
}

// Shared teardown so success -> failure -> retry never leaves revoked URLs
// wired into visible <img> elements or a stale slider position behind.
function clearResultState() {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  originalUrl = null;
  resultUrl = null;
  el('before-img').removeAttribute('src');
  el('after-img').removeAttribute('src');
  const downloadBtn = el('download-btn');
  downloadBtn.removeAttribute('href');
  downloadBtn.classList.add('is-hidden');
  el('reset-btn').classList.add('is-hidden');
  el('compare').style.setProperty('--cut', '50%');
}

// A result with no foreground (e.g. a blueprint, landscape or flat texture)
// decodes to a near-fully-transparent PNG; detect that and treat it as an
// error the user understands instead of a silent invisible "result".
async function isEffectivelyEmpty(resultBlob) {
  const url = URL.createObjectURL(resultBlob);
  try {
    const img = document.createElement('img');
    img.src = url;
    await Promise.race([
      img.decode(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('decode timeout')), 10000)),
    ]);
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    let maxAlpha = 0;
    for (let y = 0; y < size; y += 4) {
      for (let x = 0; x < size; x += 4) {
        const alpha = ctx.getImageData(x, y, 1, 1).data[3];
        if (alpha > maxAlpha) maxAlpha = alpha;
      }
    }
    return maxAlpha < 10;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function handleFile(file) {
  if (!(file instanceof File) && !(file instanceof Blob)) {
    setStatus('That does not look like a file. Try an image.');
    return false;
  }
  const type = file.type || '';
  if (!ALLOWED_TYPES.includes(type)) {
    setStatus(`Unsupported file type (${type || 'unknown'}). Use JPG, PNG or WebP.`);
    return false;
  }
  if (file.size > MAX_FILE_BYTES) {
    setStatus('The image is too large. The maximum file size is 22 MB.');
    return false;
  }
  if (!(file instanceof File)) {
    file = new File([file], 'pasted-image.png', { type: file.type });
  }

  const token = ++processingToken;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  originalUrl = URL.createObjectURL(file);
  resultUrl = null;
  currentFileName = file.name || 'image';
  setView('processing');
  setStatus('Preparing…');

  try {
    const blob = await removeBackground(file, (phase) => {
      if (token !== processingToken) return;
      setStatus(PHASE_MESSAGES[phase] || PHASE_MESSAGES['processing']);
    });
    if (token !== processingToken) return true; // superseded by a newer run
    if (await isEffectivelyEmpty(blob)) {
      clearResultState();
      setView('upload');
      setStatus(ERROR_MESSAGES['no-foreground']);
      return false;
    }
    showResult(currentFileName, blob);
    setStatus(null);
    return true;
  } catch (err) {
    if (token !== processingToken) return false;
    clearResultState();
    setView('upload');
    const code = err && err.code;
    setStatus(ERROR_MESSAGES[code] || ERROR_MESSAGES['inference-failed']);
    return false;
  }
}

export function resetView() {
  processingToken++; // invalidate any in-flight run
  clearResultState();
  el('download-btn').download = 'no-bg.png';
  setView('upload');
  setStatus(null);
}

function initCompareDrag() {
  const compare = el('compare');
  let dragging = false;

  function setCut(clientX) {
    const rect = compare.getBoundingClientRect();
    const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    compare.style.setProperty('--cut', pct + '%');
  }

  compare.addEventListener('pointerdown', (e) => {
    dragging = true;
    setCut(e.clientX);
    try {
      compare.setPointerCapture(e.pointerId);
    } catch {
      // synthetic or already-released pointer ids: drag still works un-captured
    }
  });
  compare.addEventListener('pointermove', (e) => {
    if (dragging) setCut(e.clientX);
  });
  const stop = (e) => {
    if (dragging) {
      dragging = false;
      if (compare.hasPointerCapture(e.pointerId)) compare.releasePointerCapture(e.pointerId);
    }
  };
  compare.addEventListener('pointerup', stop);
  compare.addEventListener('pointercancel', stop);
}

function wireEntryPoints() {
  const dropzone = el('dropzone');
  const input = el('file-input');

  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });

  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = ''; // allow re-picking the same file
    if (file) handleFile(file);
  });

  ['dragenter', 'dragover'].forEach(eventName =>
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    })
  );
  ['dragleave', 'dragend'].forEach(eventName =>
    dropzone.addEventListener(eventName, () => dropzone.classList.remove('is-dragover'))
  );
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  window.addEventListener('paste', (e) => {
    const file = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
    if (file) {
      e.preventDefault();
      handleFile(file);
    }
  });

  el('reset-btn').addEventListener('click', resetView);
  initCompareDrag();
}

wireEntryPoints();
