/**
 * What a right-click offers on each admin page.
 * Colour, copy, paste and clear are added by the menu. These are the
 * actions that match the job of that page.
 */

function goto(id, label) {
  return { id, label };
}

/**
 * @param {{
 *   kind: string,
 *   hasInput?: boolean,
 *   inputDisabled?: boolean,
 *   hasName?: boolean,
 *   card?: boolean,
 *   canOpenOrder?: boolean,
 *   canAddBar?: boolean,
 *   canRemoveBar?: boolean,
 *   canReturn?: boolean,
 *   canTransfer?: boolean,
 *   canSticker?: boolean,
 *   canEdit?: boolean,
 *   canEditRecipe?: boolean,
 *   canActivate?: boolean,
 *   canInvoice?: boolean,
 *   toggleLabel?: string,
 *   onEvent?: boolean,
 * }} info
 */
export function gridContextActions(info) {
  const kind = info.kind || 'row';
  const cell = [];
  const item = [];
  const editable = !!info.hasInput && !info.inputDisabled;
  if (editable) cell.push({ id: 'paste', label: 'Paste' });
  cell.push({ id: 'copy', label: info.card ? 'Copy' : 'Copy cell' });
  if (info.hasName) cell.push({ id: 'copy-name', label: 'Copy name' });
  cell.push({
    id: 'copy-row',
    label: info.card ? 'Copy details' : 'Copy row',
  });
  if (editable) cell.push({ id: 'clear', label: 'Clear cell' });

  if (kind === 'orders') {
    if (info.canOpenOrder) item.push({ id: 'open-order', label: 'Open purchase order' });
    if (info.onEvent) item.push(goto('goto-planning', 'Open on Menu & GP'));
  } else if (kind === 'order-card') {
    item.push({ id: 'open-card', label: 'Open order' });
  } else if (kind === 'distribution') {
    if (info.canAddBar) item.push({ id: 'add-bar', label: 'Add to this bar' });
    if (info.canRemoveBar) item.push({ id: 'remove-bar', label: 'Remove from this bar', danger: true });
    if (info.onEvent) item.push(goto('goto-products', 'Open on Products'));
  } else if (kind === 'products') {
    item.push({ id: 'edit-row', label: 'Edit product' });
    if (info.onEvent) item.push(goto('goto-planning', 'Open on Menu & GP'));
  } else if (kind === 'counts') {
    if (info.onEvent) item.push(goto('goto-distribution', 'Open on Distribution'));
  } else if (kind === 'closing') {
    if (info.canReturn) item.push({ id: 'return', label: 'Return to supplier' });
    if (info.canTransfer) item.push({ id: 'transfer', label: 'Transfer to warehouse' });
    if (info.canSticker) item.push({ id: 'sticker', label: 'Print pallet sticker' });
    if (info.onEvent) item.push(goto('goto-recon', 'Open on Recon'));
  } else if (kind === 'recon') {
    if (info.canEdit) item.push({ id: 'edit-recon', label: 'Edit details' });
    if (info.onEvent) item.push(goto('goto-closing', 'Open on Closing'));
  } else if (kind === 'library' || kind === 'kit-library') {
    if (info.canEdit) item.push({ id: 'edit-button', label: kind === 'library' ? 'Edit product' : 'Edit item' });
  } else if (kind === 'delivery' || kind === 'wastage' || kind === 'transfer') {
    if (info.canEdit) {
      const label = kind === 'delivery' ? 'Edit delivery' : kind === 'wastage' ? 'Edit wastage' : 'Edit transfer';
      item.push({ id: 'edit-button', label });
    }
    if (info.onEvent) item.push(goto('goto-products', 'Open on Products'));
  } else if (kind === 'event') {
    item.push({ id: 'open-card', label: 'Open dashboard' });
  } else if (kind === 'catalog') {
    item.push({ id: 'open-card', label: 'Open' });
  } else if (kind === 'kit') {
    if (info.onEvent) item.push(goto('goto-products', 'Open on Products'));
  } else if (kind === 'sales') {
    if (info.canEditRecipe) item.push({ id: 'edit-recipe', label: 'Edit recipe' });
    if (info.onEvent) item.push(goto('goto-planning', 'Open on Menu & GP'));
  } else if (kind === 'user') {
    item.push({ id: 'edit-user', label: 'Edit user' });
    if (info.canActivate) item.push({ id: 'activate-user', label: 'Activate' });
  } else if (kind === 'bug') {
    if (info.toggleLabel) item.push({ id: 'toggle-bug', label: info.toggleLabel });
    item.push({ id: 'edit-bug', label: 'Edit report' });
  } else if (kind === 'settings') {
    item.push({ id: 'open-card', label: 'Open' });
  } else if (kind === 'card') {
    if (info.canInvoice) item.push({ id: 'invoice', label: 'Export invoice' });
  }

  return { cell, item };
}
