/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getStore, RealVaultItem, EncryptedMetadataItem } from './db.js';
import {
  getActiveMasterKey,
  generateMasterKey,
  wrapMasterKey,
  unwrapMasterKey,
  deriveKeyFromPin,
  generateSalt,
  encryptData,
  decryptData,
  encryptString,
  decryptString,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  wipeKeysFromMemory,
  setActiveMasterKey
} from './crypto.js';

/**
 * Interface representing the fully decrypted metadata entry for rendering lists
 */
export interface DecryptedMetadata {
  id: number;
  filename: string;
  type: string;
  size: number;
  timestamp: number;
  addedAt: number;
}

// Global registry of transient Object URLs to revoke when vault locks or closes
let activeBlobUrls: string[] = [];

/**
 * Track an active Blob URL for secure garbage collection
 */
export function trackBlobUrl(url: string) {
  activeBlobUrls.push(url);
}

/**
 * Revoke and clear all transient Blob URLs from the browser memory
 */
export function revokeAllBlobUrls() {
  activeBlobUrls.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Blob URL revocation failed:", e);
    }
  });
  activeBlobUrls = [];
}

/**
 * Handle initial vault setup:
 * 1. Generate salt and save it in settings
 * 2. Generate a random Master Key (AES-GCM 256)
 * 3. Derive key from the given PIN
 * 4. Wrap the Master Key with the PIN-derived key and save it
 */
export async function setupEncryptVault(pin: string): Promise<void> {
  const salt = generateSalt();
  const masterKey = await generateMasterKey();
  const pinKey = await deriveKeyFromPin(pin, salt);

  const { encryptedKey, iv } = await wrapMasterKey(masterKey, pinKey);

  // Store salt, encrypted master key, and iv in the settings store
  const settingsStore = await getStore("settings", "readwrite");

  await new Promise<void>((resolve, reject) => {
    settingsStore.put({ key: "salt", value: arrayBufferToBase64(salt.buffer) });
    settingsStore.put({ key: "wrapped_master_key", value: arrayBufferToBase64(encryptedKey) });
    settingsStore.put({ key: "wrapped_master_key_iv", value: arrayBufferToBase64(iv.buffer) });

    const req = settingsStore.put({ key: "vault_initialized", value: true });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  setActiveMasterKey(masterKey);
}

/**
 * Handle vault unlocking:
 * 1. Fetch salt and wrapped master key from settings
 * 2. Derive key from the user-entered PIN
 * 3. Unwrap the Master Key and store it in-memory
 */
export async function unlockEncryptVault(pin: string): Promise<boolean> {
  try {
    const settingsStore = await getStore("settings", "readonly");

    const saltBase64 = await new Promise<string>((r, j) => {
      settingsStore.get("salt").onsuccess = (e) => {
        const res = (e.target as IDBRequest).result;
        res ? r(res.value) : j(new Error("No salt found"));
      };
    });

    const wrappedKeyBase64 = await new Promise<string>((r, j) => {
      settingsStore.get("wrapped_master_key").onsuccess = (e) => {
        const res = (e.target as IDBRequest).result;
        res ? r(res.value) : j(new Error("No master key found"));
      };
    });

    const wrappedIvBase64 = await new Promise<string>((r, j) => {
      settingsStore.get("wrapped_master_key_iv").onsuccess = (e) => {
        const res = (e.target as IDBRequest).result;
        res ? r(res.value) : j(new Error("No master key iv found"));
      };
    });

    const salt = new Uint8Array(base64ToArrayBuffer(saltBase64));
    const wrappedKey = base64ToArrayBuffer(wrappedKeyBase64);
    const wrappedIv = new Uint8Array(base64ToArrayBuffer(wrappedIvBase64));

    const pinKey = await deriveKeyFromPin(pin, salt);
    const masterKey = await unwrapMasterKey(wrappedKey, pinKey, wrappedIv);

    setActiveMasterKey(masterKey);
    return true;
  } catch (error) {
    console.error("Unlock decryptions failed:", error);
    wipeKeysFromMemory();
    return false;
  }
}

/**
 * Encrypt a File and save its payload + metadata securely
 */
export async function encryptAndSaveFile(file: File): Promise<void> {
  const masterKey = getActiveMasterKey();
  if (!masterKey) {
    throw new Error("Vault is locked! Cannot encrypt file.");
  }

  // 1. Read files into clear ArrayBuffer in memory
  const arrayBuffer = await file.arrayBuffer();

  // 2. Encrypt the binary payload
  const { ciphertext, iv: payloadIv } = await encryptData(arrayBuffer, masterKey);

  // 3. Encrypt the individual pieces of metadata
  const encFilename = await encryptString(file.name, masterKey);
  const encType = await encryptString(file.type, masterKey);
  const encSize = await encryptString(file.size.toString(), masterKey);
  const encTimestamp = await encryptString(file.lastModified.toString(), masterKey);

  // 4. Save into IndexedDB using transactions to ensure both success together
  const realStore = await getStore("real_vault", "readwrite");
  const metaStore = await getStore("encrypted_metadata", "readwrite");

  // Add payload to real_vault
  const realItem: RealVaultItem = {
    encryptedPayload: ciphertext,
    iv: arrayBufferToBase64(payloadIv.buffer)
  };

  const addRealReq = realStore.add(realItem);

  await new Promise<void>((resolve, reject) => {
    addRealReq.onsuccess = (e) => {
      const insertedId = (e.target as IDBRequest).result as number;

      // Add corresponding metadata using same ID
      const metaItem: EncryptedMetadataItem = {
        id: insertedId,
        encryptedFilename: encFilename.ciphertext,
        filenameIv: encFilename.iv,
        encryptedType: encType.ciphertext,
        typeIv: encType.iv,
        encryptedSize: encSize.ciphertext,
        sizeIv: encSize.iv,
        encryptedTimestamp: encTimestamp.ciphertext,
        timestampIv: encTimestamp.iv,
        addedAt: Date.now()
      };

      const addMetaReq = metaStore.add(metaItem);
      addMetaReq.onsuccess = () => resolve();
      addMetaReq.onerror = () => reject(addMetaReq.error);
    };

    addRealReq.onerror = () => reject(addRealReq.error);
  });
}

/**
 * Fetch and decrypt all metadata items for UI rendering
 */
export async function getDecryptedMetadataList(): Promise<DecryptedMetadata[]> {
  const masterKey = getActiveMasterKey();
  if (!masterKey) return [];

  const metaStore = await getStore("encrypted_metadata", "readonly");

  const encryptedMetadataItems = await new Promise<EncryptedMetadataItem[]>((resolve, reject) => {
    const listReq = metaStore.getAll();
    listReq.onsuccess = (e) => resolve((e.target as IDBRequest).result);
    listReq.onerror = () => reject(listReq.error);
  });

  const decryptedList: DecryptedMetadata[] = [];

  for (const item of encryptedMetadataItems) {
    try {
      const filename = await decryptString(item.encryptedFilename, masterKey, item.filenameIv);
      const type = await decryptString(item.encryptedType, masterKey, item.typeIv);
      const sizeStr = await decryptString(item.encryptedSize, masterKey, item.sizeIv);
      const timestampStr = await decryptString(item.encryptedTimestamp, masterKey, item.timestampIv);

      decryptedList.push({
        id: item.id!,
        filename,
        type,
        size: parseInt(sizeStr, 10) || 0,
        timestamp: parseInt(timestampStr, 10) || Date.now(),
        addedAt: item.addedAt
      });
    } catch {
      // If decryption fails (e.g. wrong/stale key metadata), omit or skip securely.
      console.warn(`Omitted un-decryptable metadata item with ID ${item.id}`);
    }
  }

  // Newest first
  return decryptedList.sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * Decrypt a single file's payload, create a transient Blob URL and register it
 */
export async function decryptFilePayload(id: number): Promise<{ filename: string; mimeType: string; blobUrl: string }> {
  const masterKey = getActiveMasterKey();
  if (!masterKey) throw new Error("Vault is locked!");

  const realStore = await getStore("real_vault", "readonly");
  const metaStore = await getStore("encrypted_metadata", "readonly");

  const metaItem = await new Promise<EncryptedMetadataItem>((r, j) => {
    metaStore.get(id).onsuccess = (e) => {
      const res = (e.target as IDBRequest).result;
      res ? r(res) : j(new Error("Metadata not found"));
    };
  });

  const realItem = await new Promise<RealVaultItem>((r, j) => {
    realStore.get(id).onsuccess = (e) => {
      const res = (e.target as IDBRequest).result;
      res ? r(res) : j(new Error("File content stream not found"));
    };
  });

  // Decrypt metadata fields
  const filename = await decryptString(metaItem.encryptedFilename, masterKey, metaItem.filenameIv);
  const mimeType = await decryptString(metaItem.encryptedType, masterKey, metaItem.typeIv);

  // Decrypt file block
  const iv = new Uint8Array(base64ToArrayBuffer(realItem.iv));
  const rawBytes = await decryptData(realItem.encryptedPayload, masterKey, iv);

  // Generate a transient clean browser Blob
  const blob = new Blob([rawBytes], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);

  // Track to revoke upon vault locking & exit
  trackBlobUrl(blobUrl);

  return { filename, mimeType, blobUrl };
}

/**
 * Change the user PIN: re-encrypts ONLY the master key
 */
export async function changeUserPin(oldPin: string, newPin: string): Promise<boolean> {
  const masterKey = getActiveMasterKey();
  if (!masterKey) return false;

  try {
    const settingsStore = await getStore("settings", "readwrite");

    // Clear old wrapped info, generate clean random salt
    const newSalt = generateSalt();
    const newPinKey = await deriveKeyFromPin(newPin, newSalt);

    const { encryptedKey, iv } = await wrapMasterKey(masterKey, newPinKey);

    await new Promise<void>((resolve, reject) => {
      settingsStore.put({ key: "salt", value: arrayBufferToBase64(newSalt.buffer) });
      settingsStore.put({ key: "wrapped_master_key", value: arrayBufferToBase64(encryptedKey) });
      const pinIvReq = settingsStore.put({ key: "wrapped_master_key_iv", value: arrayBufferToBase64(iv.buffer) });

      pinIvReq.onsuccess = () => resolve();
      pinIvReq.onerror = () => reject(pinIvReq.error);
    });

    return true;
  } catch (err) {
    console.error("Changing PIN encryption failed:", err);
    return false;
  }
}

/**
 * Delete a file fully from both content & metadata stores
 */
export async function deleteRealVaultFile(id: number): Promise<void> {
  const realStore = await getStore("real_vault", "readwrite");
  const metaStore = await getStore("encrypted_metadata", "readwrite");

  await Promise.all([
    new Promise<void>((r, j) => {
      realStore.delete(id).onsuccess = () => r();
    }),
    new Promise<void>((r, j) => {
      metaStore.delete(id).onsuccess = () => r();
    })
  ]);
}
