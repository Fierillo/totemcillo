import { describe, expect, it } from 'vitest';
import { graphemes, truncateText } from '../src/text';

const len = (s: string) => graphemes(s).length;
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('truncateText', () => {
  it('no toca textos dentro del límite', () => {
    expect(truncateText('hola', 10)).toBe('hola');
    expect(truncateText('x'.repeat(10), 10)).toBe('x'.repeat(10));
  });
  it('corta en límite de palabra y agrega … sin pasarse del máximo', () => {
    expect(truncateText('uno dos tres cuatro', 10)).toBe('uno dos…');
    expect(truncateText('uno dos,   tres cuatro', 12)).toBe('uno dos,…');
    expect(truncateText('uno\ndos tres', 6)).toBe('uno…');
  });
  it('si la última palabra es muy larga corta por caracteres', () => {
    expect(truncateText('a ' + 'x'.repeat(50), 10)).toBe('a xxxxxxx…');
    expect(truncateText('x'.repeat(20), 10)).toBe('x'.repeat(9) + '…');
  });
  it('cuenta caracteres percibidos: no parte emojis ni pares sustitutos', () => {
    const r = truncateText('👍🏽'.repeat(20), 5);
    expect(r).toBe('👍🏽'.repeat(4) + '…');
    const fam = truncateText('👨‍👩‍👧'.repeat(10) + ' fin', 4);
    expect(fam).toBe('👨‍👩‍👧'.repeat(3) + '…');
    expect(len(fam)).toBe(4);
    expect(loneSurrogate.test(truncateText('𝔘𝔫𝔦𝔠𝔬𝔡𝔢 '.repeat(30), 33))).toBe(false);
    expect(len('👍🏽'.repeat(3))).toBe(3);
  });
});
