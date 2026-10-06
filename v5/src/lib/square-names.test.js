import { describe, expect, it } from 'vitest';
import { squareItemNames } from '../../../lib/square/names.js';

describe('squareItemNames', () => {
  it('keeps the menu name, or the stock name, when it is unique', () => {
    const { names, clashes } = squareItemNames([
      { id: 'a', name: 'Guinness 50L', menu_name: 'Guinness' },
      { id: 'b', name: 'Coca Cola' },
    ]);
    expect(names.get('a')).toBe('Guinness');
    expect(names.get('b')).toBe('Coca Cola');
    expect(clashes).toEqual([]);
  });

  it('separates a can and a keg of the same beer', () => {
    const { names, clashes } = squareItemNames([
      { id: 'k', name: 'Utopian Lager', case_size: '50L Keg', stock_unit: 'keg' },
      { id: 'c', name: 'Utopian Lager', case_size: '24×440ml Cans', stock_unit: 'case' },
    ]);
    expect(names.get('k')).toBe('Utopian Lager (Draught)');
    expect(names.get('c')).toBe('Utopian Lager (Can)');
    expect(clashes).toEqual(['Utopian Lager']);
  });

  it('falls back to the case size when two kegs clash, and the bottle size for spirits', () => {
    const { names } = squareItemNames([
      { id: '1', name: 'JUBEL Mango', case_size: '30L Keg', stock_unit: 'keg' },
      { id: '2', name: 'JUBEL Mango', case_size: '50L Keg', stock_unit: 'keg' },
      { id: '3', name: 'JUBEL Mango', case_size: '12×440ml Cans', stock_unit: 'case' },
      { id: '4', name: 'Finlandia Vodka', case_size: '70cl', stock_unit: 'bottle' },
      { id: '5', name: 'Finlandia Vodka', case_size: '1L', stock_unit: 'bottle' },
    ]);
    expect(names.get('1')).toBe('JUBEL Mango (30L Keg)');
    expect(names.get('2')).toBe('JUBEL Mango (50L Keg)');
    expect(names.get('3')).toBe('JUBEL Mango (Can)');
    expect(names.get('4')).toBe('Finlandia Vodka (70cl)');
    expect(names.get('5')).toBe('Finlandia Vodka (1L)');
  });

  it('numbers products that cannot be told apart', () => {
    const { names } = squareItemNames([
      { id: 'x', name: 'Carton Water', case_size: '12×330ml' },
      { id: 'y', name: 'Carton Water', case_size: '12×330ml' },
    ]);
    expect(new Set([names.get('x'), names.get('y')]).size).toBe(2);
  });
});
