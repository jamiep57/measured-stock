/**
 * Split a quantity across pallets (no PDF dependency).
 * Full pallets get `perPallet`; the last gets the remainder (if any).
 * @param {number} qty
 * @param {number} perPallet
 * @returns {number[]}
 */
export function splitPalletQtys(qty, perPallet) {
  const total = Math.max(0, Number(qty) || 0);
  const per = Math.max(0, Math.floor(Number(perPallet) || 0));
  if (total <= 0) return [];
  if (per <= 0) return [total];
  const full = Math.floor(total / per);
  const rem = Math.round((total - full * per) * 1000) / 1000;
  const pallets = Array.from({ length: full }, () => per);
  if (rem > 0) pallets.push(rem);
  return pallets;
}
