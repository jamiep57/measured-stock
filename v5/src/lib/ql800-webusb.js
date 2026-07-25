/**
 * Brother QL-800 printing via WebUSB (Chrome / Edge).
 *
 * Leave the QL-800 out of macOS Printers & Scanners and close P-touch
 * Editor while printing so the browser can claim the USB device.
 */

export const QL_DPI = 300;

/** Continuous 62mm (DK-22205) — @thermal-label/brother-ql-core MEDIA id */
export const QL_MEDIA_62_CONTINUOUS = 259;

export function mmToPx(mm) {
  return Math.round((Number(mm) * QL_DPI) / 25.4);
}

export function webUsbSupported() {
  return typeof navigator !== 'undefined'
    && !!navigator.usb
    && typeof window !== 'undefined'
    && window.isSecureContext;
}

export function canvasToRawImage(canvas) {
  const ctx = canvas.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width,
    height,
    data: new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
  };
}

/**
 * Open a previously authorized QL, or show the USB device picker.
 * @returns {Promise<import('@thermal-label/brother-ql-web').BrotherQLPrinter>}
 */
export async function openQlPrinter() {
  const { requestPrinter, fromUSBDevice, DEFAULT_FILTERS } = await import('@thermal-label/brother-ql-web');

  const authorized = await navigator.usb.getDevices();
  const known = authorized.find((d) => DEFAULT_FILTERS.some(
    (f) => (!f.vendorId || f.vendorId === d.vendorId)
      && (!f.productId || f.productId === d.productId),
  ));
  if (known) {
    try {
      return await fromUSBDevice(known);
    } catch (_) {
      /* fall through to picker */
    }
  }
  return requestPrinter();
}

function mapUsbOpenError(err) {
  if (err?.name === 'NotFoundError') {
    return new Error('No printer selected — pick Brother QL-800 in the USB dialog.');
  }
  const msg = err?.message || String(err);
  if (/claim|busy|access|in use|SecurityError/i.test(msg)) {
    return new Error(
      'Could not open the QL-800 — close P-touch Editor and make sure the printer is not added in macOS Printers & Scanners, then try again.',
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

/**
 * Print one or more canvases to the QL-800.
 *
 * @param {HTMLCanvasElement|HTMLCanvasElement[]} canvases
 * @param {{ thermalMediaId?: number, rotate?: 0|90|180|270 }} [opts]
 */
export async function printCanvasesToQl800(canvases, opts = {}) {
  const list = (Array.isArray(canvases) ? canvases : [canvases]).filter(Boolean);
  if (!list.length) throw new Error('Nothing to print.');
  if (!webUsbSupported()) {
    throw new Error(
      'Direct printing needs Chrome or Edge over https/localhost. Safari cannot talk to the QL-800 from the browser.',
    );
  }

  const thermalId = opts.thermalMediaId ?? QL_MEDIA_62_CONTINUOUS;
  const rotate = opts.rotate ?? 0;
  const { MEDIA } = await import('@thermal-label/brother-ql-core');
  const thermalMedia = MEDIA[thermalId];
  if (!thermalMedia) throw new Error(`Unknown label media id ${thermalId}`);

  let printer;
  try {
    printer = await openQlPrinter();
  } catch (err) {
    throw mapUsbOpenError(err);
  }

  try {
    for (const canvas of list) {
      await printer.print(canvasToRawImage(canvas), thermalMedia, { rotate });
    }
  } finally {
    try {
      await printer.close();
    } catch (_) { /* ignore */ }
  }

  return { labelCount: list.length, thermalMediaId: thermalId };
}
