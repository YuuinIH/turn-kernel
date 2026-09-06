import { record } from './json.js';
export type Parser<T> = (value: unknown) => T;
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error('Invalid object fields');
  return value;
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw Error('Expected nonempty string');
  return value;
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw Error('Invalid integer');
  return value;
}
export function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('Expected finite number');
  return value;
}
export function list<T>(value: unknown, parse: Parser<T>): T[] {
  if (!Array.isArray(value)) throw Error('Expected array');
  return value.map((item: unknown) => parse(item));
}
