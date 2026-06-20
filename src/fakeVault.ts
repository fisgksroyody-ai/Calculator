/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getStore, FakeVaultItem } from './db.js';

/**
 * Save a file to the unencrypted fake vault (used as a decoy/trap)
 */
export async function saveFileToFakeVault(file: File): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        if (!event.target?.result) {
          throw new Error("File reader output was empty.");
        }

        const dataUrlStr = event.target.result as string;
        const fakeStore = await getStore("fake_vault", "readwrite");

        const item: FakeVaultItem = {
          data: dataUrlStr,
          type: file.type.startsWith('video/') ? 'video' : 'image',
          name: file.name,
          time: Date.now()
        };

        const req = fakeStore.add(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Retrieve all items in the unencrypted fake vault
 */
export async function getFakeVaultItems(): Promise<FakeVaultItem[]> {
  const fakeStore = await getStore("fake_vault", "readonly");

  return new Promise<FakeVaultItem[]>((resolve, reject) => {
    const req = fakeStore.getAll();
    req.onsuccess = (e) => {
      const items = (e.target as IDBRequest).result as FakeVaultItem[];
      // Sort newest first
      items.sort((a, b) => b.time - a.time);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete a file from the fake vault
 */
export async function deleteFakeVaultFile(id: number): Promise<void> {
  const fakeStore = await getStore("fake_vault", "readwrite");

  return new Promise<void>((resolve, reject) => {
    const req = fakeStore.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
