/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { wipeKeysFromMemory } from './crypto.js';
import { revokeAllBlobUrls } from './vault.js';

export type EnvironmentMode = 'DEVELOPMENT' | 'HOSTED_PREVIEW' | 'PRODUCTION';

export interface SecurityConfig {
  envMode: EnvironmentMode;
  antiDebugEnabled: boolean;
  integrityCheckingEnabled: boolean;
  panicTriggersEnabled: boolean;
}

let activeSecurityConfig: SecurityConfig | null = null;

/**
 * Detect the current execution context dynamically based on domain and browser factors.
 */
export function getEnvironmentMode(): EnvironmentMode {
  if (typeof window === 'undefined') return 'PRODUCTION';
  
  const hostname = window.location.hostname;
  const href = window.location.href;

  // 1. Explicit override via URL parameters for testing
  if (href.includes('env=production')) return 'PRODUCTION';
  if (href.includes('env=preview')) return 'HOSTED_PREVIEW';
  if (href.includes('env=development')) return 'DEVELOPMENT';

  // 2. Local development & AI Studio previews
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';
  const isAISStudio = hostname.includes('run.app') || hostname.includes('googleusercontent.com') || hostname.includes('google.com') || hostname.includes('aistudio');
  const isStackBlitz = hostname.includes('stackblitz') || hostname.includes('webcontainer') || hostname.includes('stackblitz.io');

  if (isLocalhost || isAISStudio || isStackBlitz) {
    return 'DEVELOPMENT';
  }

  // 3. Public browser hosted previews
  const isNetlify = hostname.includes('netlify.app');
  const isGitHubPages = hostname.includes('github.io');
  const isVercel = hostname.includes('vercel.app');
  const isSurge = hostname.includes('surge.sh');

  if (isNetlify || isGitHubPages || isVercel || isSurge) {
    return 'HOSTED_PREVIEW';
  }

  // 4. Default for standalone Android webviews & generic production servers
  return 'PRODUCTION';
}

/**
 * Detect environment and initialize the security configuration FIRST.
 */
export function initializeSecurityConfig(): SecurityConfig {
  if (activeSecurityConfig) {
    return activeSecurityConfig;
  }

  // 1. Detect environment
  const envMode = getEnvironmentMode();

  // 2. Initialize safe configuration based on environment mode
  const config: SecurityConfig = {
    envMode,
    antiDebugEnabled: envMode === 'PRODUCTION',
    integrityCheckingEnabled: envMode === 'PRODUCTION',
    panicTriggersEnabled: envMode === 'PRODUCTION',
  };

  activeSecurityConfig = config;

  // 3. Log startup diagnostics before React render / during early initialization
  console.log("%c[CalculatorVault Diagnostic Boot]", "color: #10b981; font-weight: bold; font-size: 14px;");
  console.log(`- Detected Environment Mode: %c${envMode}`, "font-weight: bold; color: #3b82f6;");
  console.log(`- Anti-Debugging Controls: ${config.antiDebugEnabled ? '🟢 ENABLED' : '🟡 BYPASSED'}`);
  console.log(`- Integrity Scanning Shield: ${config.integrityCheckingEnabled ? '🟢 ENABLED' : '🟡 BYPASSED'}`);
  console.log(`- Emergency Panic Wipe: ${config.panicTriggersEnabled ? '🟢 DESTRUCTIVE' : '🟡 SIMULATED/NON-DESTRUCTIVE (Safe)'}`);

  return config;
}

/**
 * Access the active security configuration dynamically, with lazy backup initialization
 */
export function getSecurityConfig(): SecurityConfig {
  if (!activeSecurityConfig) {
    return initializeSecurityConfig();
  }
  return activeSecurityConfig;
}

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

let isDevToolsSubsystemFailed = false;

/**
 * Lightweight DevTools Open Sensor
 */
export function startDevToolsDetection(onDetected: (reason?: string) => void) {
  if (isDevToolsSubsystemFailed) {
    console.warn("[CalculatorVault Security] DevTools detection subsystem is flagged as FAILED and completely disabled.");
    return () => {};
  }

  const config = getSecurityConfig();

  if (!config.antiDebugEnabled) {
    console.log(`[CalculatorVault Security] Anti-debugging bypassed in ${config.envMode} mode. Passive monitor active.`);
    
    // Completely non-blocking and safe passive diagnostics monitoring in DEVELOPMENT/PREVIEW modes:
    const interval = setInterval(() => {
      try {
        const threshold = 160;
        const widthDiff = window.outerWidth - window.innerWidth;
        const heightDiff = window.outerHeight - window.innerHeight;
        
        if (widthDiff > threshold || heightDiff > threshold) {
          console.warn("[CalculatorVault Passive Monitor] DevTools dimension offset mismatch detected (Non-blocking).");
        }
      } catch (err) {
        console.error("[CalculatorVault Security Failsafe] Passive monitor encountered error, disabling:", err);
        isDevToolsSubsystemFailed = true;
        clearInterval(interval);
      }
    }, 10000); // safe, slow checking
    
    return () => clearInterval(interval);
  }

  // Active production-only detection with strict try-catch block
  const threshold = 160;
  
  const checkDimensions = () => {
    try {
      const widthDiff = window.outerWidth - window.innerWidth;
      const heightDiff = window.outerHeight - window.innerHeight;
      
      if (widthDiff > threshold || heightDiff > threshold) {
        onDetected("DevTools dimension shift is detected");
      }
    } catch (err) {
      console.error("[CalculatorVault Failsafe] checkDimensions threw error, disabling subsystem:", err);
      isDevToolsSubsystemFailed = true;
      throw err; // will trigger global interval fallback
    }
  };

  const checkDebugger = () => {
    try {
      const start = performance.now();
      // eslint-disable-next-line no-debugger
      debugger; 
      const end = performance.now();
      if (end - start > 100) {
        onDetected("Timing mismatch (debugger pause)");
      }
    } catch (err) {
      console.error("[CalculatorVault Failsafe] checkDebugger threw error, disabling subsystem:", err);
      isDevToolsSubsystemFailed = true;
      throw err;
    }
  };

  const devtoolsObj = /./;
  try {
    Object.defineProperty(devtoolsObj, 'toString', {
      get: function() {
        try {
          onDetected("DevTools console evaluation triggered");
        } catch (err) {
          console.error("[CalculatorVault Failsafe] toString detector onDetected failed:", err);
        }
        return 'detector';
      }
    });
  } catch (err) {
    console.error("[CalculatorVault Failsafe] Failed to define custom toString scanner property:", err);
    isDevToolsSubsystemFailed = true;
  }

  const interval = setInterval(() => {
    if (isDevToolsSubsystemFailed) {
      clearInterval(interval);
      return;
    }

    try {
      checkDimensions();
      checkDebugger();
      try {
        console.log(devtoolsObj);
        console.clear();
      } catch {
        // ignore log error
      }
    } catch (err) {
      console.error("[CalculatorVault Security Failsafe] Anti-debug system threw exception. Disabling subsystem override to prevent crash loop.", err);
      isDevToolsSubsystemFailed = true;
      clearInterval(interval);
    }
  }, 3000);

  return () => clearInterval(interval);
}

/**
 * Scan for root signatures, emulator signatures, and JS Bundle tampering
 * Returns true if environmental signatures look suspicious (tampered/emulator/rooted)
 */
export function checkEnvironmentSecurity(): { tampered: boolean; reason: string } {
  try {
    const config = getSecurityConfig();

    if (!config.integrityCheckingEnabled) {
      console.log(`[CalculatorVault Passive Shield] Integrity scanning of ecosystem bypassed in ${config.envMode}.`);
      return { tampered: false, reason: "" };
    }

    const ua = navigator.userAgent.toLowerCase();

    // 1. Emulator Checks
    const isEmulator = 
      /sdk/i.test(ua) || 
      /google_sdk/i.test(ua) || 
      /emulator/i.test(ua) || 
      (/android_mobile/i.test(ua) && ua.includes('linux') && !ua.includes('arm'));

    if (isEmulator) {
      return { tampered: true, reason: "Emulator environment detected" };
    }

    // 2. WebDriver verification
    if (navigator.webdriver) {
      return { tampered: true, reason: "Webdriver automation active" };
    }

    // 3. Simple Integrity / Modified Bundle Check
    if (
      Function.prototype.toString.toString() !== 'function toString() { [native code] }' ||
      Object.defineProperty.toString() !== 'function defineProperty() { [native code] }'
    ) {
      return { tampered: true, reason: "Core JS objects modified" };
    }

    return { tampered: false, reason: "" };
  } catch (err) {
    console.error("[CalculatorVault Security] Integrity scanning fault bypassed gracefully.", err);
    return { tampered: false, reason: "Integrity scanner error bypassed" };
  }
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
