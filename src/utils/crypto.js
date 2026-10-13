// src/utils/crypto.js

const toHex = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
};

export const sha256Hex = async (text) => {
  const enc = new TextEncoder();
  const data = enc.encode(String(text ?? ''));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return toHex(hash);
};

export const hashPin = async ({ pin, salt }) => {
  const s = String(salt ?? '');
  const p = String(pin ?? '');
  return sha256Hex(`${s}:${p}`);
};

