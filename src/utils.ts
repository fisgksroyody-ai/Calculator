/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { wipeKeysFromMemory } from './crypto.js';
import { revokeAllBlobUrls } from './vault.js';

// Configuration
const INACTIVITY_TIMEOUT_MS = 120000; // 2 minutes auto-lock on idle

let idleTimer: any = null;
let onLockCallback: (() => void) | null = null;

/**
 * Configure the lock callback to execute upon inactivation or security triggers
 */
export function registerAutoLockCallback(callback: () => void) {
  onLockCallback = callback;
}

/**
 * Trigger secure vault locking instantly
 */
export function lockVaultSecurely() {
  wipeKeysFromMemory();
  revokeAllBlobUrls();
  if (onLockCallback) {
    onLockCallback();
  }
}

/**
 * Reset the inactivity idle timer
 */
export function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log("Inactivity timeout reached. Locking vault.");
    lockVaultSecurely();
  }, INACTIVITY_TIMEOUT_MS);
}

/**
 * Start the idle activity listener
 */
export function initializeInactivityMonitor() {
  const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  
  // Set initial timer
  resetIdleTimer();

  events.forEach((evt) => {
    window.addEventListener(evt, resetIdleTimer, { passive: true });
  });

  // App minimize & Screen-Off monitor via visibilitychange
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      console.log("App minimized or screen off. Locking vault.");
      lockVaultSecurely();
    }
  });

  return () => {
    if (idleTimer) clearTimeout(idleTimer);
    events.forEach((evt) => {
      window.removeEventListener(evt, resetIdleTimer);
    });
  };
}

/**
 * Lightweight DevTools Open Sensor
 */
export function startDevToolsDetection(onDetected: () => void) {
  // Method A: Check dimensions difference (works when docked)
  const threshold = 160;
  const checkDimensions = () => {
    const widthDiff = window.outerWidth - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;
    
    if (widthDiff > threshold || heightDiff > threshold) {
      onDetected();
    }
  };

  // Method B: Trigger timing debugger ticks
  const checkDebugger = () => {
    const start = performance.now();
    // debugger statement triggers pauses only if DevTools is open
    // eslint-disable-next-line no-debugger
    debugger; 
    const end = performance.now();
    if (end - start > 100) {
      onDetected();
    }
  };

  // Method C: Custom printable console getter
  const devtoolsObj = /./;
  Object.defineProperty(devtoolsObj, 'toString', {
    get: function() {
      onDetected();
      return 'detector';
    }
  });

  const interval = setInterval(() => {
    checkDimensions();
    checkDebugger();
    // Trigger console evaluation to fire getter if DevTools panel parses logs
    try {
      console.log(devtoolsObj);
      console.clear();
    } catch {
      // ignore errors
    }
  }, 2000);

  return () => clearInterval(interval);
}

/**
 * Scan for root signatures, emulator signatures, and JS Bundle tampering
 * Returns true if environmental signatures look suspicious (tampered/emulator/rooted)
 */
export function checkEnvironmentSecurity(): { tampered: boolean; reason: string } {
  const ua = navigator.userAgent.toLowerCase();

  // 1. Emulator Checks
  const isEmulator = 
    /sdk/i.test(ua) || 
    /google_sdk/i.test(ua) || 
    /emulator/i.test(ua) || 
    /android_mobile/i.test(ua) && ua.includes('linux') && !ua.includes('arm');

  if (isEmulator) {
    return { tampered: true, reason: "Emulator detected" };
  }

  // 2. WebDriver verification (often true in automated/testing environments)
  if (navigator.webdriver) {
    return { tampered: true, reason: "Webdriver automation active" };
  }

  // 3. Simple Integrity / Modified Bundle Check
  // Check if standard browser primitives are modified
  if (
    Function.prototype.toString.toString() !== 'function toString() { [native code] }' ||
    Object.defineProperty.toString() !== 'function defineProperty() { [native code] }'
  ) {
    return { tampered: true, reason: "Core JS objects modified" };
  }

  return { tampered: false, reason: "" };
}

/**
 * Clean human formatting for file sizes
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
