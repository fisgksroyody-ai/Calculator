/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const DB_NAME = "CalculatorVaultDB";
const DB_VERSION = 2;

export interface RealVaultItem {
  id?: number;
  encryptedPayload: ArrayBuffer; // AES-GCM encrypted file ArrayBuffer
  iv: string; // Base64 encoding of the file encryption iv
}

export interface EncryptedMetadataItem {
  id?: number; // matches real_vault item id
  encryptedFilename: string; // Base64 ciphertext
  filenameIv: string; // Base64 IV
  encryptedType: string; // Base64 ciphertext representation of mime-type
  typeIv: string; // Base64 IV
  encryptedSize: string; // Base64 ciphertext of file size as string
  sizeIv: string; // Base64 IV
  encryptedTimestamp: string; // Base64 ciphertext of timestamp as string
  timestampIv: string; // Base64 IV
  addedAt: number; // Raw decrypted timestamp maybe (or just a sorting key if needed, or we decrypt sorting)
}

export interface FakeVaultItem {
  id?: number;
  data: string; // Plain raw unencrypted base64/dataURL as the original code did
  type: string; // 'image' or 'video'
  name: string;
  time: number;
}

export interface SettingsItem {
  key: string;
  value: any;
}

let dbInstance: IDBDatabase | null = null;

/**
 * Open the local IndexedDB database and initialize the 4 separate stores.
 */
export function openVaultDatabase(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (e) => {
      console.error("IndexedDB open error:", e);
      reject(new Error("Unable to open IndexedDB"));
    };

    request.onsuccess = (e) => {
      dbInstance = (e.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      // 1. Settings store for master-key wrapper secrets
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }

      // 2. Real Encrypted Vault for binary file payloads
      if (!db.objectStoreNames.contains("real_vault")) {
        db.createObjectStore("real_vault", { keyPath: "id", autoIncrement: true });
      }

      // 3. Fake Vault for normal/unencrypted mock-trap files
      if (!db.objectStoreNames.contains("fake_vault")) {
        db.createObjectStore("fake_vault", { keyPath: "id", autoIncrement: true });
      }

      // 4. Encrypted Metadata store
      if (!db.objectStoreNames.contains("encrypted_metadata")) {
        db.createObjectStore("encrypted_metadata", { keyPath: "id" });
      }
    };
  });
}

/**
 * Helper to perform readwrite transactions on a specific store
 */
export async function getStore(
  storeName: "settings" | "real_vault" | "fake_vault" | "encrypted_metadata",
  mode: IDBTransactionMode = "readonly"
): Promise<IDBObjectStore> {
  const db = await openVaultDatabase();
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

/**
 * Clear the entire database (e.g. for complete developer reset or total wipe)
 */
export async function clearAllDatabases(): Promise<void> {
  const db = await openVaultDatabase();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  stores.forEach((store) => {
    tx.objectStore(store).clear();
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
