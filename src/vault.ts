/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getStore, RealVaultItem, EncryptedMetadataItem, openVaultDatabase } from './db.js';
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

  const db = await openVaultDatabase();
  const tx = db.transaction("settings", "readwrite");
  const settingsStore = tx.objectStore("settings");

  settingsStore.put({ key: "salt", value: arrayBufferToBase64(salt.buffer) });
  settingsStore.put({ key: "wrapped_master_key", value: arrayBufferToBase64(encryptedKey) });
  settingsStore.put({ key: "wrapped_master_key_iv", value: arrayBufferToBase64(iv.buffer) });
  settingsStore.put({ key: "vault_initialized", value: true });

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Save settings transaction failed"));
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
  console.log("[CalculatorVault Unlock] Initiating atomic vault unlock procedure...");
  try {
    const db = await openVaultDatabase();
    const tx = db.transaction("settings", "readonly");
    const settingsStore = tx.objectStore("settings");

    const reqSalt = settingsStore.get("salt");
    const reqKey = settingsStore.get("wrapped_master_key");
    const reqIv = settingsStore.get("wrapped_master_key_iv");

    const [saltBase64, wrappedKeyBase64, wrappedIvBase64] = await new Promise<[string, string, string]>((resolve, reject) => {
      tx.oncomplete = () => {
        const sVal = reqSalt.result?.value;
        const kVal = reqKey.result?.value;
        const iVal = reqIv.result?.value;
        if (sVal !== undefined && kVal !== undefined && iVal !== undefined) {
          resolve([sVal, kVal, iVal]);
        } else {
          reject(new Error(`Settings store has incomplete credentials. Salt: ${!!sVal}, Key: ${!!kVal}, IV: ${!!iVal}`));
        }
      };
      tx.onerror = () => {
        reject(tx.error || new Error("IDB transaction failed during unlock payload fetch"));
      };
    });

    console.log("[CalculatorVault Unlock] Atomic payload retrieved successfully.");

    const salt = new Uint8Array(base64ToArrayBuffer(saltBase64));
    const wrappedKey = base64ToArrayBuffer(wrappedKeyBase64);
    const wrappedIv = new Uint8Array(base64ToArrayBuffer(wrappedIvBase64));

    const pinKey = await deriveKeyFromPin(pin, salt);
    const masterKey = await unwrapMasterKey(wrappedKey, pinKey, wrappedIv);

    setActiveMasterKey(masterKey);
    console.log("[CalculatorVault Unlock] Successful PBKDF2 verification & master key extraction.");
    return true;
  } catch (error: any) {
    console.error("[CalculatorVault Unlock Error] Decryption/Unlock phase failed completely:", error);
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
    throw new Error("Vault is locked!");
  }

  const arrayBuffer = await file.arrayBuffer();

  const { ciphertext, iv: payloadIv } = await encryptData(arrayBuffer, masterKey);

  const encFilename = await encryptString(file.name, masterKey);
  const encType = await encryptString(file.type, masterKey);
  const encSize = await encryptString(file.size.toString(), masterKey);
  const encTimestamp = await encryptString(file.lastModified.toString(), masterKey);

  const db = await openVaultDatabase();

  const tx = db.transaction(
    ["real_vault", "encrypted_metadata"],
    "readwrite"
  );

  const realStore = tx.objectStore("real_vault");
  const metaStore = tx.objectStore("encrypted_metadata");

  const realItem: RealVaultItem = {
    encryptedPayload: ciphertext,
    iv: arrayBufferToBase64(payloadIv.buffer)
  };

  await new Promise<void>((resolve, reject) => {

    const addRealReq = realStore.add(realItem);

    addRealReq.onsuccess = (e) => {
      const insertedId = (e.target as IDBRequest).result as number;

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

      metaStore.add(metaItem);
    };

    tx.oncomplete = () => resolve();

    tx.onerror = () => reject(tx.error);

    tx.onabort = () => reject(new Error("Transaction aborted"));
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
  console.log("%c[CalculatorVault PIN Rotation Diagnostic Tool]", "color: #2563eb; font-weight: bold; font-size: 13px;");
  
  // 1. Check in-memory master key
  let masterKey = getActiveMasterKey();
  if (!masterKey) {
    console.error("[CalculatorVault PIN Rotation Error] Access Denied: Master Key not found in active state context.");
    return false;
  }

  // 2. Load wrapped data to verify old PIN unwrap integrity
  try {
    const db = await openVaultDatabase();
    const txRead = db.transaction("settings", "readonly");
    const settingsStoreRead = txRead.objectStore("settings");

    const reqSalt = settingsStoreRead.get("salt");
    const reqKey = settingsStoreRead.get("wrapped_master_key");
    const reqIv = settingsStoreRead.get("wrapped_master_key_iv");

    const [saltBase64, wrappedKeyBase64, wrappedIvBase64] = await new Promise<[string, string, string]>((resolve, reject) => {
      txRead.oncomplete = () => {
        const saltVal = reqSalt.result?.value;
        const keyVal = reqKey.result?.value;
        const ivVal = reqIv.result?.value;
        if (saltVal && keyVal && ivVal) {
          resolve([saltVal, keyVal, ivVal]);
        } else {
          reject(new Error("Unable to recover original setup values from settings store."));
        }
      };
      txRead.onerror = () => reject(txRead.error || new Error("Read settings transaction error."));
    });

    console.log("[CalculatorVault PIN Rotation Diagnostic] Backup of wrapping credentials recovered from DB.");

    // Validate if the old pin key can actually recover the master key first!
    const testSalt = new Uint8Array(base64ToArrayBuffer(saltBase64));
    const testWrappedKey = base64ToArrayBuffer(wrappedKeyBase64);
    const testWrappedIv = new Uint8Array(base64ToArrayBuffer(wrappedIvBase64));

    const testPinKey = await deriveKeyFromPin(oldPin, testSalt);
    const verifiedMasterKey = await unwrapMasterKey(testWrappedKey, testPinKey, testWrappedIv);
    
    if (!verifiedMasterKey) {
      throw new Error("Master Key unwrap verification returned null key.");
    }
    masterKey = verifiedMasterKey;
    console.log("[CalculatorVault PIN Rotation Diagnostic] Old PIN verified successfully. Master Key recovered independently.");
  } catch (err: any) {
    console.error("[CalculatorVault PIN Rotation Error] Old PIN verification/unwrap phase failed:", err);
    return false;
  }

  // 3. Perform cryptographic key derivation & wrapping for new PIN BEFORE opening the write transaction
  let newSalt: Uint8Array;
  let newPinKey: CryptoKey;
  let encryptedKey: ArrayBuffer;
  let iv: Uint8Array;

  try {
    newSalt = generateSalt();
    console.log("[CalculatorVault PIN Rotation Diagnostic] Secure new salt generated for rotation.");

    newPinKey = await deriveKeyFromPin(newPin, newSalt);
    console.log("[CalculatorVault PIN Rotation Diagnostic] Cryptographic PBKDF2 key derived from new PIN.");

    const wrappingResult = await wrapMasterKey(masterKey, newPinKey);
    encryptedKey = wrappingResult.encryptedKey;
    iv = wrappingResult.iv;
    console.log("[CalculatorVault PIN Rotation Diagnostic] Master Key re-wrapped with new PIN key (AES-GCM).");
  } catch (err: any) {
    console.error("[CalculatorVault PIN Rotation Error] Cryptographic re-wrap phase failed:", err);
    return false;
  }

  // 4. Update the settings store atomically. If any write fails, the IDB transaction aborts automatically.
  try {
    const db = await openVaultDatabase();
    const txWrite = db.transaction("settings", "readwrite");
    const settingsStoreWrite = txWrite.objectStore("settings");

    // Perform all puts synchronously on the same event loop tick to protect transaction lifespan
    settingsStoreWrite.put({ key: "salt", value: arrayBufferToBase64(newSalt.buffer) });
    settingsStoreWrite.put({ key: "wrapped_master_key", value: arrayBufferToBase64(encryptedKey) });
    settingsStoreWrite.put({ key: "wrapped_master_key_iv", value: arrayBufferToBase64(iv.buffer) });

    await new Promise<void>((resolve, reject) => {
      txWrite.oncomplete = () => {
        console.log("[CalculatorVault PIN Rotation Diagnostic] Settings transaction committed safely in IndexedDB.");
        resolve();
      };
      txWrite.onerror = () => {
        console.error("[CalculatorVault PIN Rotation Error] Settings transaction put failed:", txWrite.error);
        reject(txWrite.error || new Error("Atomic transaction put failure"));
      };
      txWrite.onabort = () => {
        console.error("[CalculatorVault PIN Rotation Error] Settings transaction aborted mid-stage.");
        reject(new Error("Settings transaction was explicitly aborted."));
      };
    });

    console.log("[CalculatorVault PIN Rotation Diagnostic] PIN change finalized successfully!");
    setActiveMasterKey(masterKey); // sync active memory key reference
    return true;
  } catch (err: any) {
    console.error("[CalculatorVault PIN Rotation Error] Database transaction phase failed. Rollback fully resolved.", err);
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
