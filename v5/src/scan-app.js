/**
 * Kit phone entry — /v5/scan
 *
 * • ?s=<sessionId>  → event Kit companion scanner (posts barcodes to desktop)
 * • no session      → mobile container counting (create/scan box → add items)
 * • ?c=<productId>  → resume container counting
 */

import { BrowserMultiFormatReader, BarcodeFormat } from '@zxing/browser';
import DecodeHintType from '@zxing/library/esm/core/DecodeHintType.js';
import { loadDbScript } from './lib/load-db.js';
import {
  loadScanSession,
  isSessionExpired,
  postScanEvent,
  SCAN_MODE_LABELS,
  normalizeScanMode,
  PHONE_DEBOUNCE_MS,
} from './lib/kit-scan-session.js';
import { startKitCountApp } from './kit-count-app.js';
import { setupKitCountPwaInstall } from './lib/pwa-install.js';

function $(id) {
  return document.getElementById(id);
}

function sessionIdFromUrl() {
  const params = new URLSearchParams(location.search);
  return (params.get('s') || params.get('session') || '').trim();
}

function setFeedback(msg, kind = '') {
  const el = $('scanFeedback');
  if (!el) return;
  el.textContent = msg;
  el.className = 'scan-feedback' + (kind ? ` is-${kind}` : '');
}

function setFatal(msg) {
  const app = $('app');
  if (app) {
    app.innerHTML = `<div class="scan-error">${msg}</div>`;
    return;
  }
  const el = $('scanError');
  if (!el) return;
  el.hidden = false;
  el.textContent = msg;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
    setTimeout(() => ctx.close(), 200);
  } catch { /* ignore */ }
  try {
    navigator.vibrate?.(40);
  } catch { /* ignore */ }
}

function createZxingReader() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, 250);
}

function grabFrame(video, canvas, mode) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  if (mode === 'full') {
    canvas.width = vw;
    canvas.height = vh;
    ctx.drawImage(video, 0, 0, vw, vh);
    return canvas;
  }

  const cw = Math.max(160, Math.floor(vw * 0.78));
  const ch = Math.max(100, Math.floor(vh * 0.45));
  const sx = Math.floor((vw - cw) / 2);
  const sy = Math.floor((vh - ch) / 2);
  canvas.width = cw;
  canvas.height = ch;
  ctx.drawImage(video, sx, sy, cw, ch, 0, 0, cw, ch);
  return canvas;
}

function mountCompanionShell() {
  const app = $('app');
  if (!app) return;
  app.innerHTML = `
    <div class="scan-top">
      <div class="scan-brand">Measured · Kit</div>
      <div class="scan-mode" id="scanModeLabel">Scanner</div>
      <div class="scan-hint" id="scanHint">Point at a kit barcode</div>
    </div>
    <div class="scan-stage" id="scanStage">
      <video id="scanVideo" playsinline muted autoplay></video>
      <canvas id="scanCanvas"></canvas>
      <div class="scan-reticle" aria-hidden="true"></div>
      <div class="scan-stage-hint">Tap view to rescan · QR codes work best</div>
    </div>
    <div class="scan-feedback" id="scanFeedback">Ready</div>
    <form class="scan-manual" id="scanManualForm">
      <input id="scanManualInput" type="text" inputmode="text" autocomplete="off"
        placeholder="Or type / paste barcode" aria-label="Barcode">
      <button type="submit">Send</button>
    </form>
  `;
  app.style.display = 'flex';
  app.style.flexDirection = 'column';
  app.style.minHeight = '100%';
}

async function startCompanionScanner(DB, sessionId) {
  mountCompanionShell();

  let session = await loadScanSession(DB, sessionId);
  if (!session) {
    setFatal('Session not found. Start Scan mode on the Kit panel again.');
    return;
  }
  if (isSessionExpired(session)) {
    setFatal('This scan session has expired. Start Scan mode again on the desktop.');
    return;
  }

  function paintMode() {
    const mode = normalizeScanMode(session.mode);
    $('scanModeLabel').textContent = SCAN_MODE_LABELS[mode] || 'Scan';
    $('scanHint').textContent = mode === 'check_in'
      ? 'Scan items as you count them back in'
      : 'Scan items as you pack them';
  }
  paintMode();

  let stream = null;
  let stopped = false;
  let scanTimer = 0;
  let frameMode = 'crop';
  let frames = 0;
  const reader = createZxingReader();

  function stopCamera() {
    stopped = true;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = 0;
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    const video = $('scanVideo');
    if (video) video.srcObject = null;
  }

  setInterval(async () => {
    try {
      const next = await loadScanSession(DB, sessionId);
      if (!next || isSessionExpired(next)) {
        setFatal('Session ended. Start Scan mode again on the desktop.');
        stopCamera();
        return;
      }
      session = next;
      paintMode();
    } catch { /* ignore transient */ }
  }, 2500);

  let lastCode = '';
  let lastAt = 0;
  let sending = false;

  async function sendBarcode(raw) {
    const code = String(raw || '').trim();
    if (!code || sending || stopped) return;
    const now = Date.now();
    if (code === lastCode && now - lastAt < PHONE_DEBOUNCE_MS) return;
    lastCode = code;
    lastAt = now;
    sending = true;
    try {
      await postScanEvent(DB, sessionId, code);
      const short = code.length > 48 ? `${code.slice(0, 28)}…${code.slice(-12)}` : code;
      setFeedback(`Sent: ${short}`, 'ok');
      beep();
    } catch (err) {
      setFeedback(err.message || 'Send failed', 'err');
    } finally {
      sending = false;
    }
  }

  $('scanManualForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('scanManualInput');
    const val = input?.value || '';
    if (input) input.value = '';
    sendBarcode(val);
  });

  $('scanStage')?.addEventListener('click', () => {
    lastCode = '';
    lastAt = 0;
    setFeedback('Ready — aim at the QR / barcode');
    try { beep(); } catch { /* ignore */ }
    $('scanVideo')?.play?.().catch(() => {});
  });

  async function openCamera() {
    const constraintsList = [
      { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
      { audio: false, video: { facingMode: { ideal: 'environment' } } },
      { audio: false, video: true },
    ];
    let lastErr = null;
    for (const constraints of constraintsList) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('getUserMedia failed');
  }

  function scheduleTick(ms = 180) {
    if (stopped) return;
    scanTimer = window.setTimeout(tick, ms);
  }

  function tick() {
    if (stopped) return;
    const video = $('scanVideo');
    const canvas = $('scanCanvas');
    if (!video || !canvas) {
      scheduleTick(300);
      return;
    }

    frames += 1;
    if (frames % 6 === 0) frameMode = frameMode === 'crop' ? 'full' : 'crop';

    if (video.readyState >= 2) {
      try {
        const frame = grabFrame(video, canvas, frameMode);
        if (frame) {
          const result = reader.decodeFromCanvas(frame);
          const text = result?.getText?.() || '';
          if (text) {
            sendBarcode(text);
            scheduleTick(600);
            return;
          }
        }
      } catch { /* miss */ }
    }

    if (frames === 25) {
      setFeedback('Camera live — hold the Current RMS QR in the box');
    }
    scheduleTick(video.readyState >= 2 ? 160 : 280);
  }

  async function startCamera() {
    const video = $('scanVideo');
    if (!video) return;

    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('muted', '');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    try {
      stream = await openCamera();
    } catch {
      setFeedback('Camera unavailable — use the box below', 'err');
      $('scanManualInput')?.focus();
      return;
    }

    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      setFeedback('Tap the camera view to start', 'err');
    }

    setFeedback('Camera ready — aim at the QR / barcode');
    scheduleTick(120);
  }

  await startCamera();
  window.addEventListener('pagehide', stopCamera);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    $('scanVideo')?.play?.().catch(() => {});
  });
}

async function main() {
  await loadDbScript();
  const DB = window.DB;
  if (!DB) {
    setFatal('Could not load data layer.');
    return;
  }

  const sessionId = sessionIdFromUrl();
  if (sessionId) {
    document.title = 'Kit scanner';
    await startCompanionScanner(DB, sessionId);
    return;
  }

  document.title = 'Kit count';
  setupKitCountPwaInstall();
  await startKitCountApp(DB);
}

main().catch((err) => {
  setFatal(err.message || 'Failed to start');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/v5/sw.js', { scope: '/v5/' }).catch((err) => {
      console.warn('SW registration failed', err);
    });
  });
}
