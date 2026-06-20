/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getStore } from './db.js';
import { wipeKeysFromMemory } from './crypto.js';
import { revokeAllBlobUrls } from './vault.js';
import { getEnvironmentMode } from './utils.js';

/**
 * Execute the Panic Wipe:
 * 1. Instantly delete the wrapped master key and its IV from settings
 * 2. Clear out the encrypted metadata store via O(1) database clear
 * 3. Clear out the real encrypted vault database store via O(1) database clear
 * 4. Wipe keys from state memory and revoke any cached blob URLs
 * 5. Returns true on successful wipe to inform UI of silent fake vault transition
 */
export async function executePanicWipe(): Promise<boolean> {
  const envMode = getEnvironmentMode();

  try {
    // In DEVELOPMENT and HOSTED_PREVIEW modes, we disable actual data-destructive wipe to protect testing content.
    // We simulate the key-reset trigger in memory to demonstrate the transition silently.
    if (envMode === 'DEVELOPMENT' || envMode === 'HOSTED_PREVIEW') {
      console.warn(`[CalculatorVault Security] Non-destructive simulated panic wipe triggered in ${envMode}.`);
      wipeKeysFromMemory();
      revokeAllBlobUrls();
      return true;
    }

    // 1. Clear keys from settings store
    const settingsStore = await getStore("settings", "readwrite");
    settingsStore.delete("wrapped_master_key");
    settingsStore.delete("wrapped_master_key_iv");
    settingsStore.delete("vault_initialized");

    // 2. Erase encrypted_metadata store completely (bulk O(1) operation, not file by file)
    const metadataStore = await getStore("encrypted_metadata", "readwrite");
    metadataStore.clear();

    // 3. Erase real binary vault store completely (bulk O(1) operation)
    const realVaultStore = await getStore("real_vault", "readwrite");
    realVaultStore.clear();

    // 4. Wipe references in active Javascript heap
    wipeKeysFromMemory();
    revokeAllBlobUrls();

    console.log("Panic wipe completed successfully.");
    return true;
  } catch (error) {
    console.error("Panic wipe failed:", error);
    // Even if one step fails, ensure in-memory keys are absolutely cleared
    wipeKeysFromMemory();
    revokeAllBlobUrls();
    return false;
  }
}
