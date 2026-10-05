#!/usr/bin/env python3
"""
Import Current RMS product CSV into kit library.

Maps:
  Id              -> products.sku
  Name            -> products.name (match existing kit rows)
  Product Group   -> kit category
  Purchase Price  -> unit_price
  Sale Price / Replacement Charge -> case_price
  Description + meta -> notes
  Active          -> archived (inverse)
  Rental/Sale Bulk Quantity -> warehouse_stock at Crediton
  Image Url       -> download + upload to product-images bucket

Usage:
  python3 scripts/import-current-rms-kit.py "/path/to/export.csv"
"""

from __future__ import annotations

import csv
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SUPABASE_URL = os.environ.get(
  'SUPABASE_URL', 'https://qqdvzcaukstfdixnfuqq.supabase.co'
).rstrip('/')
SUPABASE_KEY = os.environ.get(
  'SUPABASE_ANON_KEY',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxZHZ6Y2F1a3N0ZmRpeG5mdXFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTg2NzQsImV4cCI6MjA5MjM3NDY3NH0.pEli5ZEliJIwBTsNLb5JW4mFW1nV1TAnUO0f5_1UhGU',
)
WAREHOUSE_NAME = os.environ.get('KIT_WAREHOUSE_NAME', 'Crediton')
BUCKET = 'product-images'
SKIP_IMAGES = os.environ.get('SKIP_IMAGES', '').lower() in ('1', 'true', 'yes')


def api(method: str, path: str, body=None, content_type='application/json', prefer=None):
  url = SUPABASE_URL + path
  headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Accept': 'application/json',
  }
  if prefer:
    headers['Prefer'] = prefer
  data = None
  if body is not None:
    if isinstance(body, (dict, list)):
      data = json.dumps(body).encode('utf-8')
      headers['Content-Type'] = 'application/json'
    else:
      data = body
      headers['Content-Type'] = content_type
  req = urllib.request.Request(url, data=data, headers=headers, method=method)
  try:
    with urllib.request.urlopen(req, timeout=60) as res:
      raw = res.read()
      if not raw:
        return None
      ctype = res.headers.get('content-type', '')
      if 'json' in ctype:
        return json.loads(raw.decode('utf-8'))
      return raw
  except urllib.error.HTTPError as e:
    err = e.read().decode('utf-8', errors='replace')
    raise RuntimeError(f'{method} {path} -> {e.code}: {err}') from e


def num(v):
  if v is None:
    return None
  s = str(v).strip()
  if not s:
    return None
  try:
    return float(s)
  except ValueError:
    return None


def build_notes(row: dict) -> str | None:
  parts = []
  desc = (row.get('Description') or '').strip()
  if desc:
    parts.append(desc)
  meta = []
  weight = num(row.get('Weight'))
  if weight is not None and weight > 0:
    meta.append(f'Weight: {weight:g} kg')
  rental = num(row.get('Rental Price'))
  if rental is not None and rental > 0:
    meta.append(f'Rental: £{rental:g}')
  barcode = (row.get('Barcode') or '').strip()
  if barcode:
    meta.append(f'Barcode: {barcode}')
  stock_type = (row.get('Allowed Stock Type') or '').strip()
  if stock_type:
    meta.append(f'Type: {stock_type}')
  if meta:
    parts.append(' · '.join(meta))
  text = '\n'.join(parts).strip()
  return text or None


def guess_ext(url: str, content_type: str | None) -> str:
  path = urllib.parse.urlparse(url).path
  name = Path(path).name
  if '.' in name:
    ext = '.' + name.rsplit('.', 1)[-1].lower()
    if ext in ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'):
      return '.jpg' if ext == '.jpeg' else ext
  if content_type:
    ext = mimetypes.guess_extension(content_type.split(';')[0].strip())
    if ext == '.jpe':
      return '.jpg'
    if ext:
      return ext
  return '.jpg'


def download_image(url: str) -> tuple[bytes, str]:
  req = urllib.request.Request(url, headers={'User-Agent': 'StockV4-KitImport/1.0'})
  with urllib.request.urlopen(req, timeout=60) as res:
    data = res.read()
    ctype = res.headers.get('content-type')
    return data, guess_ext(url, ctype)


def upload_image(product_id: str, rms_id: str, data: bytes, ext: str) -> str:
  path = f'kit/{product_id}/rms-{rms_id}{ext}'
  ctype = mimetypes.guess_type('x' + ext)[0] or 'application/octet-stream'
  encoded = urllib.parse.quote(path)
  api(
    'POST',
    f'/storage/v1/object/{BUCKET}/{encoded}',
    body=data,
    content_type=ctype,
  )
  # force upsert header — PostgREST storage needs x-upsert
  # Re-upload with upsert if conflict; first call may fail on exists
  return f'{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{encoded}'


def upload_image_upsert(product_id: str, rms_id: str, data: bytes, ext: str) -> str:
  path = f'kit/{product_id}/rms-{rms_id}{ext}'
  ctype = mimetypes.guess_type('x' + ext)[0] or 'application/octet-stream'
  encoded = urllib.parse.quote(path)
  url = f'{SUPABASE_URL}/storage/v1/object/{BUCKET}/{encoded}'
  headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': ctype,
    'x-upsert': 'true',
    'Cache-Control': '3600',
  }
  req = urllib.request.Request(url, data=data, headers=headers, method='POST')
  try:
    with urllib.request.urlopen(req, timeout=60) as res:
      res.read()
  except urllib.error.HTTPError as e:
    err = e.read().decode('utf-8', errors='replace')
    raise RuntimeError(f'upload failed {e.code}: {err}') from e
  return f'{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{path}'


def main():
  if len(sys.argv) < 2:
    print('Usage: import-current-rms-kit.py <csv-path>', file=sys.stderr)
    sys.exit(1)
  csv_path = Path(sys.argv[1])
  if not csv_path.exists():
    print(f'CSV not found: {csv_path}', file=sys.stderr)
    sys.exit(1)

  with csv_path.open(newline='', encoding='utf-8-sig') as f:
    rows = list(csv.DictReader(f))
  print(f'CSV rows: {len(rows)}')

  cats = api('GET', '/rest/v1/categories?kind=eq.kit&select=id,name') or []
  cat_by_name = {c['name']: c['id'] for c in cats}
  print(f'Kit categories: {len(cat_by_name)}')

  # ensure missing categories
  for group in sorted({(r.get('Product Group') or '').strip() for r in rows if (r.get('Product Group') or '').strip()}):
    if group not in cat_by_name:
      created = api('POST', '/rest/v1/categories', {
        'name': group,
        'kind': 'kit',
        'colour_key': 'rtd',
        'sort_order': len(cat_by_name),
      }, prefer='return=representation')
      row = created[0] if isinstance(created, list) else created
      cat_by_name[group] = row['id']
      print(f'  + category {group}')

  products = api(
    'GET',
    '/rest/v1/products?product_kind=eq.kit&select=id,name,sku,image_url&limit=2000',
  ) or []
  by_name = {p['name'].strip().lower(): p for p in products}
  print(f'Existing kit products: {len(products)}')

  warehouses = api('GET', '/rest/v1/warehouses?select=id,name') or []
  wh = next((w for w in warehouses if w['name'] == WAREHOUSE_NAME), None)
  if not wh:
    raise SystemExit(f'Warehouse “{WAREHOUSE_NAME}” not found: {[w["name"] for w in warehouses]}')
  print(f'Warehouse: {wh["name"]} ({wh["id"]})')

  updated = created = stock_set = images_ok = images_fail = 0
  missing_match = []

  for i, row in enumerate(rows, 1):
    name = (row.get('Name') or '').strip()
    if not name:
      continue
    rms_id = (row.get('Id') or '').strip()
    group = (row.get('Product Group') or '').strip()
    category_id = cat_by_name.get(group)
    purchase = num(row.get('Purchase Price'))
    sale = num(row.get('Sale Price'))
    replacement = num(row.get('Replacement Charge'))
    case_price = sale if sale is not None else replacement
    active = (row.get('Active') or 'Yes').strip().lower() == 'yes'
    notes = build_notes(row)
    patch = {
      'name': name,
      'sku': rms_id or None,
      'barcode': (row.get('Barcode') or '').strip() or None,
      'product_kind': 'kit',
      'stock_unit': 'unit',
      'units_per_case': 1,
      'case_size': 'unit',
      'category_id': category_id,
      'unit_price': purchase,
      'case_price': case_price,
      'notes': notes,
      'archived': not active,
    }

    existing = by_name.get(name.lower())
    if existing:
      api('PATCH', f'/rest/v1/products?id=eq.{existing["id"]}', patch, prefer='return=minimal')
      product_id = existing['id']
      updated += 1
    else:
      created_rows = api('POST', '/rest/v1/products', patch, prefer='return=representation')
      product_id = created_rows[0]['id']
      by_name[name.lower()] = {'id': product_id, 'name': name, 'sku': rms_id}
      created += 1

    rental_qty = num(row.get('Rental Bulk Quantity')) or 0
    sale_qty = num(row.get('Sale Bulk Quantity')) or 0
    qty = rental_qty + sale_qty
    if qty > 0:
      api(
        'POST',
        '/rest/v1/warehouse_stock?on_conflict=warehouse_id,product_id',
        {
          'warehouse_id': wh['id'],
          'product_id': product_id,
          'qty_on_hand': qty,
          'last_updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        },
        prefer='resolution=merge-duplicates,return=minimal',
      )
      stock_set += 1

    img_url = (row.get('Image Url') or '').strip()
    if img_url and not SKIP_IMAGES:
      try:
        data, ext = download_image(img_url)
        if len(data) < 50:
          raise RuntimeError('image too small')
        public_url = upload_image_upsert(product_id, rms_id or str(i), data, ext)
        api('PATCH', f'/rest/v1/products?id=eq.{product_id}', {'image_url': public_url}, prefer='return=minimal')
        images_ok += 1
        if images_ok % 10 == 0:
          print(f'  images uploaded: {images_ok}')
      except Exception as e:
        images_fail += 1
        if images_fail <= 3:
          print(f'  image fail [{name}]: {e}')
    elif img_url and SKIP_IMAGES:
      images_fail += 0  # skipped intentionally

    if i % 50 == 0:
      print(f'  … {i}/{len(rows)}')

  print('---')
  print(f'Updated: {updated}')
  print(f'Created: {created}')
  print(f'Stock rows set: {stock_set}')
  print(f'Images uploaded: {images_ok}')
  print(f'Images failed/skipped: {images_fail}')
  if images_fail and images_ok == 0:
    print(
      '\nNOTE: Current RMS image URLs are short-lived signed S3 links.\n'
      'This export’s links appear expired. Re-export the CSV from Current RMS\n'
      'and re-run with a fresh file to import pictures.',
    )


if __name__ == '__main__':
  main()
