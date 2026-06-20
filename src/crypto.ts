/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Cryptographic Constants
const PBKDF2_ITERATIONS = 250000;
const AES_KEY_LEN = 256; // bits
const IV_LEN = 12; // bytes (standard for AES-GCM)
const SALT_LEN = 16; // bytes

// In-memory sensitive variables cache (wiped on lock)
let activeMasterKey: CryptoKey | null = null;
let activeDerivedKey: CryptoKey | null = null;

/**
 * Wipe all sensitive key references from memory
 */
export function wipeKeysFromMemory() {
  activeMasterKey = null;
  activeDerivedKey = null;
}

/**
 * Get active master key if decrypted
 */
export function getActiveMasterKey(): CryptoKey | null {
  return activeMasterKey;
}

/**
 * Set active master key manually (e.g. after setup/unlock)
 */
export function setActiveMasterKey(key: CryptoKey | null) {
  activeMasterKey = key;
}

/**
 * Helper to convert a string to a UTF-8 ArrayBuffer
 */
function stringToArrayBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str);
}

/**
 * Helper to convert an ArrayBuffer to a string
 */
function arrayBufferToString(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

/**
 * Helper to convert an ArrayBuffer to a Base64 string for safe storage
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Helper to convert a Base64 string back to an ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Derive a 256-bit AES-GCM key from a user PIN and salt using PBKDF2
 */
export async function deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    stringToArrayBuffer(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const derived = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_LEN },
    true, // extractable
    ['encrypt', 'decrypt']
  );

  activeDerivedKey = derived;
  return derived;
}

/**
 * Generate a new cryptographically random Master Encryption Key (AES-GCM 256-bit)
 */
export async function generateMasterKey(): Promise<CryptoKey> {
  const key = await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: AES_KEY_LEN,
    },
    true, // extractable so we can wrap/encrypt it
    ['encrypt', 'decrypt']
  );
  return key;
}

/**
 * Encrypt the Master Key using a derived PIN key
 * Stored as AES-GCM ciphertext + IV
 */
export async function wrapMasterKey(
  masterKey: CryptoKey,
  pinKey: CryptoKey
): Promise<{ encryptedKey: ArrayBuffer; iv: Uint8Array }> {
  // Export the raw master key material
  const rawMasterKeyBytes = await window.crypto.subtle.exportKey('raw', masterKey);

  // Generate a random IV
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_LEN));

  // Encrypt raw master key bytes with the pin key
  const encryptedKey = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    pinKey,
    rawMasterKeyBytes
  );

  return { encryptedKey, iv };
}

/**
 * Decrypt the Master Key using a derived PIN key
 */
export async function unwrapMasterKey(
  encryptedMasterKey: ArrayBuffer,
  pinKey: CryptoKey,
  iv: Uint8Array
): Promise<CryptoKey> {
  const decryptedBytes = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    pinKey,
    encryptedMasterKey
  );

  const masterKey = await window.crypto.subtle.importKey(
    'raw',
    decryptedBytes,
    'AES-GCM',
    true,
    ['encrypt', 'decrypt']
  );

  activeMasterKey = masterKey;
  return masterKey;
}

/**
 * Encrypt arbitrary binary payload (ArrayBuffer) using the Master Key
 */
export async function encryptData(
  data: ArrayBuffer,
  key: CryptoKey
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> {
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_LEN));

  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    data
  );

  return { ciphertext, iv };
}

/**
 * Decrypt arbitrary binary payload (ArrayBuffer) using the Master Key
 */
export async function decryptData(
  ciphertext: ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array
): Promise<ArrayBuffer> {
  return await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    ciphertext
  );
}

/**
 * Generate a random salt for PBKDF2
 */
export function generateSalt(): Uint8Array {
  return window.crypto.getRandomValues(new Uint8Array(SALT_LEN));
}

/**
 * Encrypt a string value (like filename or mime-type) with the Master Key
 * Useful for encrypting metadatas
 */
export async function encryptString(text: string, key: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
  const buf = stringToArrayBuffer(text);
  const result = await encryptData(buf, key);
  return {
    ciphertext: arrayBufferToBase64(result.ciphertext),
    iv: arrayBufferToBase64(result.iv.buffer),
  };
}

/**
 * Decrypt a string value with the Master Key
 */
export async function decryptString(ciphertextBase64: string, key: CryptoKey, ivBase64: string): Promise<string> {
  const ciphertext = base64ToArrayBuffer(ciphertextBase64);
  const iv = new Uint8Array(base64ToArrayBuffer(ivBase64));
  const decryptedBuf = await decryptData(ciphertext, key, iv);
  return arrayBufferToString(decryptedBuf);
}
