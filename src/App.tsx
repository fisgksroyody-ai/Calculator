/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Lock,
  Unlock,
  ShieldAlert,
  Trash2,
  Download,
  Plus,
  ArrowLeft,
  Video,
  Image as ImageIcon,
  KeyRound,
  Skull,
  RefreshCw,
  LogOut,
  AlertTriangle,
  Info
} from 'lucide-react';

import { openVaultDatabase, getStore } from './db.js';
import { evaluateSafeExpression } from './calculator.js';
import { wipeKeysFromMemory } from './crypto.js';
import {
  setupEncryptVault,
  unlockEncryptVault,
  encryptAndSaveFile,
  getDecryptedMetadataList,
  decryptFilePayload,
  deleteRealVaultFile,
  changeUserPin,
  DecryptedMetadata,
  revokeAllBlobUrls
} from './vault.js';
import {
  saveFileToFakeVault,
  getFakeVaultItems,
  deleteFakeVaultFile
} from './fakeVault.js';
import { executePanicWipe } from './panic.js';
import {
  registerAutoLockCallback,
  initializeInactivityMonitor,
  startDevToolsDetection,
  checkEnvironmentSecurity,
  formatBytes,
  getEnvironmentMode
} from './utils.js';

export default function App() {
  // Navigation Screens: 'setup' | 'calculator' | 'real_vault' | 'fake_vault'
  const [currentScreen, setCurrentScreen] = useState<'setup' | 'calculator' | 'real_vault' | 'fake_vault'>('calculator');
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Setup Step: 1 = Real PIN, 2 = Fake PIN, 3 = Panic PIN
  const [setupStep, setSetupStep] = useState<number>(1);
  const [tempRealPin, setTempRealPin] = useState<string>('');
  const [tempFakePin, setTempFakePin] = useState<string>('');
  const [tempPanicPin, setTempPanicPin] = useState<string>('');
  const [setupInput, setSetupInput] = useState<string>('');
  const [setupError, setSetupError] = useState<string>('');

  // Calculator State
  const [expression, setExpression] = useState<string>('');
  const [displayValue, setDisplayValue] = useState<string>('0');
  const [isErrorState, setIsErrorState] = useState<boolean>(false);

  // Security & Environmental Triggers
  const [tamperError, setTamperError] = useState<string | null>(null);

  // File Lists
  const [realMedia, setRealMedia] = useState<DecryptedMetadata[]>([]);
  const [fakeMedia, setFakeMedia] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Media Viewers
  const [selectedRealItem, setSelectedRealItem] = useState<{ id: number; filename: string; mimeType: string; blobUrl: string } | null>(null);
  const [selectedFakeItem, setSelectedFakeItem] = useState<any | null>(null);

  // Drag and Drop State
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Pin Config Info (Loaded from DB)
  const [fakePinConfig, setFakePinConfig] = useState<string>('');
  const [panicPinConfig, setPanicPinConfig] = useState<string>('');

  // Setup database and check initialization on boot
  useEffect(() => {
    async function bootApp() {
      try {
        await openVaultDatabase();

        // Check environment security
        const security = checkEnvironmentSecurity();
        if (security.tampered) {
          setTamperError(security.reason);
          lockActiveVault();
        }

        // Fetch initialization settings
        const settingsStore = await getStore("settings", "readonly");
        
        await new Promise<void>((resolve) => {
          settingsStore.get("vault_initialized").onsuccess = (e) => {
            const res = (e.target as IDBRequest).result;
            if (res && res.value === true) {
              setIsInitialized(true);
              setCurrentScreen('calculator');
            } else {
              setIsInitialized(false);
              setCurrentScreen('setup');
            }
            resolve();
          };
        });

        // Load fake and panic PIN signatures for trigger detection
        await loadPinConfigurations();

      } catch (err) {
        console.error("Booting failed:", err);
      } finally {
        setLoading(false);
      }
    }

    bootApp();

    // DevTools scanners
    const cancelDevTools = startDevToolsDetection((reason) => {
      setTamperError(reason || "Developer Tools scanning active");
      lockActiveVault();
    });

    // Idle Monitor Setup
    registerAutoLockCallback(() => {
      lockActiveVault();
    });
    const cancelInactivity = initializeInactivityMonitor();

    return () => {
      cancelDevTools();
      cancelInactivity();
    };
  }, []);

  async function loadPinConfigurations() {
    try {
      const settingsStore = await getStore("settings", "readonly");
      settingsStore.get("fake_pin").onsuccess = (e) => {
        const res = (e.target as IDBRequest).result;
        if (res) setFakePinConfig(res.value);
      };
      settingsStore.get("panic_pin").onsuccess = (e) => {
        const res = (e.target as IDBRequest).result;
        if (res) setPanicPinConfig(res.value);
      };
    } catch {
      // ignore
    }
  }

  // Handle active lock cleanups
  function lockActiveVault() {
    setExpression('');
    setDisplayValue('0');
    wipeKeysFromMemory();
    revokeAllBlobUrls();
    setSelectedRealItem(null);
    setSelectedFakeItem(null);
    setCurrentScreen('calculator');
  }

  // Validate standard PIN formats: 6 digits + 1 operator
  function isValidPinFormat(input: string): boolean {
    const regex = /^\d{6}[+\-*/]$/; // Exactly 6 digits followed by exactly 1 operator
    return regex.test(input);
  }

  // Setup Wizards Actions
  async function handleSetupSubmit() {
    setSetupError('');
    const inputVal = setupInput.trim();

    if (!isValidPinFormat(inputVal)) {
      setSetupError("Pin format galat hai! It must be exactly 6 numbers followed by one operator (+, -, *, /) (e.g. 123456+)");
      return;
    }

    if (setupStep === 1) {
      setTempRealPin(inputVal);
      setSetupInput('');
      setSetupStep(2);
    } else if (setupStep === 2) {
      if (inputVal === tempRealPin) {
        setSetupError("Fake PIN aur Real PIN alag hone chahiye!");
        return;
      }
      setTempFakePin(inputVal);
      setSetupInput('');
      setSetupStep(3);
    } else if (setupStep === 3) {
      if (inputVal === tempRealPin || inputVal === tempFakePin) {
        setSetupError("Panic PIN alag hona chahiye!");
        return;
      }
      
      // We have all three PINs. Let's save!
      setLoading(true);
      try {
        // Setup cryptographically secure master key with REAL PIN
        await setupEncryptVault(tempRealPin);

        // Store fake and panic PIN identifiers in settings store
        const settingsStore = await getStore("settings", "readwrite");
        await new Promise<void>((resolve, reject) => {
          settingsStore.put({ key: "fake_pin", value: tempFakePin });
          settingsStore.put({ key: "panic_pin", value: inputVal });
          const req = settingsStore.put({ key: "vault_initialized", value: true });
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });

        // Initialize lists
        setFakePinConfig(tempFakePin);
        setPanicPinConfig(inputVal);
        setIsInitialized(true);

        // Vault is now open! Take them straight to Real Vault
        await refreshRealMediaList();
        setCurrentScreen('real_vault');
      } catch (err) {
        console.error("Setup saving failed:", err);
        setSetupError("Master wrapper setup fail ho gaya. Kripya dubaara koshish karein.");
      } finally {
        setLoading(false);
      }
    }
  }

  // Calculator Engine logic
  function handleCalcKeyPress(key: string) {
    if (tamperError && getEnvironmentMode() === 'PRODUCTION') return; // Freeze app if tampered in production
    setIsErrorState(false);

    if (key === 'C') {
      setExpression('');
      setDisplayValue('0');
    } else if (key === 'back') {
      const updated = expression.slice(0, -1);
      setExpression(updated);
      setDisplayValue(updated || '0');
    } else if (key === '=') {
      evaluateTrigger(expression);
    } else {
      // Add check for decimal point
      if (key === '.') {
        const parts = expression.split(/[+\-*/]/);
        const lastPart = parts[parts.length - 1];
        if (lastPart.includes('.')) return; // prevent multiple decimals
      }

      const updated = expression + key;
      setExpression(updated);
      setDisplayValue(updated);
    }
  }

  // Evaluate Expression or Trigger Secret Vault Doors
  async function evaluateTrigger(expr: string) {
    const trimmed = expr.trim();

    // 1. Check PIN Matches
    // Fetch and check local configurations
    let loadedFake = fakePinConfig;
    let loadedPanic = panicPinConfig;
    if (!loadedFake || !loadedPanic) {
      const settingsStore = await getStore("settings", "readonly");
      await new Promise<void>((r) => {
        settingsStore.get("fake_pin").onsuccess = (e) => {
          if ((e.target as IDBRequest).result) loadedFake = (e.target as IDBRequest).result.value;
          r();
        };
      });
      await new Promise<void>((r) => {
        settingsStore.get("panic_pin").onsuccess = (e) => {
          if ((e.target as IDBRequest).result) loadedPanic = (e.target as IDBRequest).result.value;
          r();
        };
      });
    }

    // Match Real PIN Door (Derive and Decrypt Keys)
    if (isValidPinFormat(trimmed) && !isRealPinCandidate(trimmed, loadedFake, loadedPanic)) {
      setLoading(true);
      const matched = await unlockEncryptVault(trimmed);
      setLoading(false);

      if (matched) {
        await refreshRealMediaList();
        setCurrentScreen('real_vault');
        setExpression('');
        setDisplayValue('0');
        return;
      }
    }

    // Match Fake PIN Trap Door
    if (trimmed === loadedFake) {
      await refreshFakeMediaList();
      setCurrentScreen('fake_vault');
      setExpression('');
      setDisplayValue('0');
      return;
    }

    // Match Panic PIN Emergency Wrecker Door
    if (trimmed === loadedPanic) {
      setLoading(true);
      const isWiped = await executePanicWipe();
      setLoading(false);
      // Change configuration state silently to FAKE trap and boot it
      setFakePinConfig('');
      setPanicPinConfig('');
      setIsInitialized(false);
      await refreshFakeMediaList();
      setCurrentScreen('fake_vault');
      setExpression('');
      setDisplayValue('0');
      return;
    }

    // Standard Math Calculation (Fallback)
    try {
      const mathResult = evaluateSafeExpression(trimmed);
      setDisplayValue(mathResult);
      setExpression(mathResult);
    } catch {
      setDisplayValue('Error');
      setIsErrorState(true);
      setExpression('');
    }
  }

  function isRealPinCandidate(pin: string, fake: string, panic: string): boolean {
    return pin === fake || pin === panic;
  }

  // Reload files lists
  async function refreshRealMediaList() {
    try {
      const list = await getDecryptedMetadataList();
      setRealMedia(list);
    } catch (e) {
      console.error("Could not fetch real media index:", e);
    }
  }

  async function refreshFakeMediaList() {
    try {
      const list = await getFakeVaultItems();
      setFakeMedia(list);
    } catch (e) {
      console.error("Could not fetch fake decoy index:", e);
    }
  }

  // Media items viewer controls
  async function openRealViewer(id: number) {
    setLoading(true);
    try {
      const payload = await decryptFilePayload(id);
      setSelectedRealItem({ id, ...payload });
    } catch (e) {
      alert("Encryption Master Key invalid or un-authenticated.");
    } finally {
      setLoading(false);
    }
  }

  function closeRealViewer() {
    setSelectedRealItem(null);
    // Cleanup temporary URL to nullify sensitive object allocations
    revokeAllBlobUrls();
  }

  // Media Delete Handlers
  async function handleRealDelete(id: number) {
    if (confirm("Kya aap sach me ye file hamesha ke liye delete karna chahte hain?")) {
      setLoading(true);
      await deleteRealVaultFile(id);
      await refreshRealMediaList();
      closeRealViewer();
      setLoading(false);
    }
  }

  async function handleFakeDelete(id: number) {
    if (confirm("Delete file?")) {
      setLoading(true);
      await deleteFakeVaultFile(id);
      await refreshFakeMediaList();
      setSelectedFakeItem(null);
      setLoading(false);
    }
  }

  // Media uploads
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>, isDecoy: boolean) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (isDecoy) {
          await saveFileToFakeVault(file);
        } else {
          await encryptAndSaveFile(file);
        }
      }

      if (isDecoy) {
        await refreshFakeMediaList();
      } else {
        await refreshRealMediaList();
      }
    } catch (err: any) {
      alert("Error setting byte payload streams: " + err.message);
    } finally {
      setIsUploading(false);
    }
  }

  // Drag-and-drop Events
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  async function handleDrop(e: React.DragEvent, isDecoy: boolean) {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Ensure standard file checks
        if (isDecoy) {
          await saveFileToFakeVault(file);
        } else {
          await encryptAndSaveFile(file);
        }
      }

      if (isDecoy) {
        await refreshFakeMediaList();
      } else {
        await refreshRealMediaList();
      }
    } catch (err: any) {
      alert("Upload failed: " + err.message);
    } finally {
      setIsUploading(false);
    }
  }

  // Settings Change PIN Wizard
  async function triggerPinChange() {
    const oldPin = prompt("Purana REAL PIN daalein (e.g. 123456+):");
    if (!oldPin) return;
    
    // Check old pin match
    const isOldCorrect = await unlockEncryptVault(oldPin);
    if (!isOldCorrect) {
      alert("Ghalat PIN!");
      return;
    }

    const newPin = prompt("Naya REAL PIN daalein (6 digits followed by 1 operator, e.g. 654321-):");
    if (!newPin || !isValidPinFormat(newPin)) {
      alert("Format galat hai! Real PIN must be 6 numbers and 1 operator (+, -, *, /)");
      return;
    }

    const confirmSuccess = await changeUserPin(oldPin, newPin);
    if (confirmSuccess) {
      alert("Real Encryption PIN safalta purvak badla gaya!");
    } else {
      alert("PIN badalne me ghalti hui. Kripya punah prayas karein.");
    }
  }

  return (
    <div className="min-h-screen w-full bg-black text-white font-sans flex flex-col justify-center items-center overflow-hidden select-none relative">
      
      {/* Background Ambience Layer */}
      <div className="absolute inset-0 bg-cover bg-center opacity-30 z-0 pointer-events-none"
           style={{ backgroundImage: "url('https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&q=80&w=1200')" }} />

      {/* Global Spin Loader Overlays */}
      {loading && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex flex-col justify-center items-center">
          <RefreshCw className="animate-spin text-blue-500 w-12 h-12 mb-4" />
          <p className="text-gray-400 font-medium">Securing local operations...</p>
        </div>
      )}

      {/* Uploading Progress Overlay */}
      {isUploading && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex flex-col justify-center items-center">
          <RefreshCw className="animate-spin text-blue-500 w-12 h-12 mb-4" />
          <p className="text-emerald-400 font-medium tracking-wide">Processing & Encrypting Local Bytes...</p>
          <p className="text-gray-500 text-xs mt-2">Zero cloud data transmission active.</p>
        </div>
      )}

      {/* Anti-Tampering Shield Alert Block */}
      {tamperError && getEnvironmentMode() === 'PRODUCTION' && (
        <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col justify-center items-center p-6 text-center">
          <div className="w-16 h-16 bg-red-950/50 rounded-full flex items-center justify-center border border-red-500/30 mb-6 glow-glow">
            <ShieldAlert className="text-red-500 w-9 h-9" />
          </div>
          <h2 className="text-2xl font-bold font-display text-red-500 mb-2">SYSTEM INTEGRITY ALERT</h2>
          <p className="text-gray-400 max-w-sm text-sm mb-4">
            A security scanning trigger was fired ({tamperError}). All active mathematical keys have been immediately purged from state memory.
          </p>
          <button 
            onClick={() => window.location.reload()} 
            className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-md font-semibold text-sm transition-colors cursor-pointer"
          >
            RECHECK SYSTEM INTEGRITY
          </button>
        </div>
      )}

      {/* Real-time Content Container */}
      <main className="w-full max-w-md h-[100dvh] flex flex-col bg-zinc-950/90 border border-zinc-900/60 shadow-2xl relative rounded-none md:rounded-3xl overflow-hidden z-10">
        
        {/* Dynamic Passive Security Telemetry / Diagnostics Non-blocking Notification */}
        {tamperError && getEnvironmentMode() !== 'PRODUCTION' && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between gap-3 z-40 text-xs animate-fadeIn shrink-0">
            <div className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500 animate-pulse" />
              <div>
                <p className="font-bold">Passive Monitor Bypassed ({getEnvironmentMode()})</p>
                <p className="text-[10px] text-gray-400">{tamperError}</p>
              </div>
            </div>
            <button 
              onClick={() => setTamperError(null)}
              className="text-amber-500 hover:text-amber-300 font-bold px-1.5 py-0.5 rounded transition-transform active:scale-95 text-sm cursor-pointer"
              title="Acknowledge Telemetry Alert"
            >
              ×
            </button>
          </div>
        )}

        {/* ==================== SCREEN 1: DETAILED PIN SETUP ==================== */}
        {currentScreen === 'setup' && (
          <div className="flex-1 flex flex-col justify-between p-6">
            <div className="flex-1 flex flex-col justify-center items-center text-center">
              <div className="w-14 h-14 bg-blue-950/60 border border-blue-500/20 rounded-full flex items-center justify-center mb-6">
                <KeyRound className="text-blue-500 w-7 h-7" />
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={setupStep}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col items-center"
                >
                  {setupStep === 1 && (
                    <>
                      <h1 className="text-xl font-bold font-display tracking-tight text-white mb-2">Real PIN set karein</h1>
                      <p className="text-xs text-gray-400 max-w-xs mb-6">
                        Ye PIN aapka main real vault kholega. Iska format 6 digits aur ek mathematical symbol (e.g. <strong>483920+</strong>) hona chahiye.
                      </p>
                    </>
                  )}
                  {setupStep === 2 && (
                    <>
                      <h1 className="text-xl font-bold font-display tracking-tight text-amber-500 mb-2">Fake PIN set karein</h1>
                      <p className="text-xs text-gray-400 max-w-xs mb-6">
                        Yadi koi dabav banaye, to ye PIN daalein. Ek poora fake clean vault chalega bina real data expose kiye. (e.g. <strong>728411÷</strong>)
                      </p>
                    </>
                  )}
                  {setupStep === 3 && (
                    <>
                      <h1 className="text-xl font-bold font-display tracking-tight text-red-500 mb-2">Panic PIN set karein</h1>
                      <p className="text-xs text-gray-400 max-w-xs mb-6">
                        Emergency me ye PIN daalkar '=' dabayein. Ye real keys ko instantly self-destruct karke silent tarike se fake vault khol dega. (e.g. <strong>991742×</strong>)
                      </p>
                    </>
                  )}

                  <input
                    type="password"
                    value={setupInput}
                    onChange={(e) => setSetupInput(e.target.value)}
                    placeholder="e.g. 123456+"
                    maxLength={10}
                    className="w-64 bg-zinc-900 border border-zinc-800 rounded-lg py-3 px-4 text-center text-xl font-mono tracking-widest focus:outline-none focus:border-blue-500/60 mb-2 transition-colors"
                  />
                  
                  {setupError && (
                    <p className="text-red-500 text-[11px] leading-relaxed max-w-xs mt-2 px-3">{setupError}</p>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex flex-col items-center gap-4 mt-4">
              <button
                onClick={handleSetupSubmit}
                className="w-full bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all text-white font-medium text-sm tracking-wide uppercase py-3.5 rounded-lg border border-blue-500/30 cursor-pointer"
              >
                {setupStep === 3 ? "SAVE KAREIN & SHURU KAREIN" : "PIN SAVE KAREIN"}
              </button>

              <div className="flex items-center gap-1.5 text-zinc-500 text-[10px]">
                <Info className="w-3.5 h-3.5" />
                <span>Local IndexedDB hardware encryption block active.</span>
              </div>
            </div>
          </div>
        )}

        {/* ==================== SCREEN 2: THE STEALTH CALCULATOR ==================== */}
        {currentScreen === 'calculator' && (
          <div className="flex-1 flex flex-col justify-end">
            
            {/* Top Branding Strip */}
            <div className="p-4 flex justify-between items-center bg-black/20 text-zinc-500 border-b border-zinc-950">
              <div className="flex items-center gap-1">
                <span className="text-[10px] uppercase font-mono tracking-widest text-zinc-600 font-bold">Standard Calculator</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                <span className="text-[9px] font-mono font-bold tracking-wider text-emerald-400">OFFLINE SECURE - {getEnvironmentMode()} MODE</span>
              </div>
            </div>

            {/* Display Readout */}
            <div className="flex-1 flex flex-col justify-end items-end p-6 bg-zinc-950/40">
              <div className="text-zinc-600 font-mono text-sm tracking-normal break-all w-full text-right max-h-16 overflow-hidden">
                {expression || ' '}
              </div>
              <div className={`mt-2 font-display font-light break-all w-full text-right ${displayValue.length > 10 ? 'text-4xl' : 'text-5xl'} ${isErrorState ? 'text-red-400' : 'text-white'}`}>
                {displayValue}
              </div>
            </div>

            {/* Keypad Grid */}
            <div className="grid grid-cols-4 gap-2.5 p-5 bg-zinc-955/90 border-t border-zinc-900/60 rounded-t-3xl">
              {/* Row 1 */}
              <button onClick={() => handleCalcKeyPress('C')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-display text-lg text-rose-400 bg-zinc-900 hover:bg-zinc-850 active:scale-90 transition-transform cursor-pointer">C</button>
              <button onClick={() => handleCalcKeyPress('%')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-display text-lg text-blue-400 bg-zinc-900 hover:bg-zinc-850 active:scale-90 transition-transform cursor-pointer">%</button>
              <button onClick={() => handleCalcKeyPress('back')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-display text-lg text-blue-400 bg-zinc-900 hover:bg-zinc-850 active:scale-90 transition-transform cursor-pointer">⌫</button>
              <button onClick={() => handleCalcKeyPress('/')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-display text-lg text-blue-400 bg-zinc-900 hover:bg-zinc-850 active:scale-90 transition-transform cursor-pointer">÷</button>

              {/* Row 2 */}
              <button onClick={() => handleCalcKeyPress('7')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-sans text-xl text-zinc-300 bg-zinc-900/30 hover:bg-zinc-900/60 active:scale-90 transition-transform cursor-pointer">7</button>
              <button onClick={() => handleCalcKeyPress('8')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-sans text-xl text-zinc-300 bg-zinc-900/30 hover:bg-zinc-900/60 active:scale-90 transition-transform cursor-pointer">8</button>
              <button onClick={() => handleCalcKeyPress('9')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-sans text-xl text-zinc-300 bg-zinc-900/30 hover:bg-zinc-900/60 active:scale-90 transition-transform cursor-pointer">9</button>
              <button onClick={() => handleCalcKeyPress('*')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-display text-lg text-blue-400 bg-zinc-900 hover:bg-zinc-850 active:scale-90 transition-transform cursor-pointer">×</button>

              {/* Row 3 */}
              <button onClick={() => handleCalcKeyPress('4')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-sans text-xl text-zinc-300 bg-zinc-900/30 hover:bg-zinc-900/60 active:scale-90 transition-transform cursor-pointer">4</button>
              <button onClick={() => handleCalcKeyPress('5')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-sans text-xl text-zinc-300 bg-zinc-900/30 hover:bg-zinc-900/60 active:scale-90 transition-transform cursor-pointer">5</button>
              <button onClick={() => handleCalcKeyPress('6')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-sans text-xl text-zinc-300 bg-zinc-900/30 hover:bg-zinc-900/60 active:scale-90 transition-transform cursor-pointer">6</button>
              <button onClick={() => handleCalcKeyPress('-')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-display text-lg text-blue-400 bg-zinc-900 hover:bg-zinc-850 active:scale-90 transition-transform cursor-pointer">−</button>

              {/* Row 4 */}
              <button onClick={() => handleCalcKeyPress('1')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-sans text-xl text-zinc-300 bg-zinc-900/30 hover:bg-zinc-900/60 active:scale-90 transition-transform cursor-pointer">1</button>
              <button onClick={() => handleCalcKeyPress('2')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-sans text-xl text-zinc-300 bg-zinc-900/30 hover:bg-zinc-900/60 active:scale-90 transition-transform cursor-pointer">2</button>
              <button onClick={() => handleCalcKeyPress('3')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-sans text-xl text-zinc-300 bg-zinc-900/30 hover:bg-zinc-900/60 active:scale-90 transition-transform cursor-pointer">3</button>
              <button onClick={() => handleCalcKeyPress('+')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-display text-lg text-blue-400 bg-zinc-900 hover:bg-zinc-850 active:scale-90 transition-transform cursor-pointer">+</button>

              {/* Row 5 */}
              <div className="calc-btn invisible aspect-square"></div>
              <button onClick={() => handleCalcKeyPress('0')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-sans text-xl text-zinc-300 bg-zinc-900/30 hover:bg-zinc-900/60 active:scale-90 transition-transform cursor-pointer">0</button>
              <button onClick={() => handleCalcKeyPress('.')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-sans text-xl text-zinc-300 bg-zinc-900/30 hover:bg-zinc-900/60 active:scale-90 transition-transform cursor-pointer">.</button>
              <button onClick={() => handleCalcKeyPress('=')} className="calc-btn aspect-square rounded-full flex items-center justify-center font-display text-xl text-white bg-blue-600 hover:bg-blue-500 active:scale-90 shadow-md shadow-blue-500/10 transition-transform cursor-pointer">=</button>
            </div>
          </div>
        )}

        {/* ==================== SCREEN 3: REAL SECURED VAULT ==================== */}
        {currentScreen === 'real_vault' && (
          <div className="flex-1 flex flex-col h-full bg-zinc-950 select-text overflow-hidden"
               onDragOver={handleDragOver}
               onDragLeave={handleDragLeave}
               onDrop={(e) => handleDrop(e, false)}>
            
            {/* Real Header */}
            <div className="p-4 flex justify-between items-center border-b border-zinc-900 bg-zinc-950/70 backdrop-blur-md sticky top-0 z-30">
              <div className="flex items-center gap-2">
                <button 
                  onClick={lockActiveVault} 
                  className="p-1.5 hover:bg-zinc-900 rounded-lg text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex flex-col">
                  <h2 className="text-sm font-bold font-display tracking-wide uppercase text-white">Encrypted Vault</h2>
                  <span className="text-[9px] text-emerald-400 font-mono tracking-wider">SECURE IN-MEMORY BLOCK</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={triggerPinChange} 
                  className="flex items-center p-1.5 hover:bg-zinc-900 rounded-lg text-blue-400 hover:text-blue-300 text-xs font-semibold tracking-wide transition-colors cursor-pointer"
                >
                  PIN BADLEIN
                </button>
                <button 
                  onClick={lockActiveVault} 
                  className="p-1.5 bg-zinc-900 hover:bg-zinc-850 text-rose-500 rounded-lg text-xs leading-none transition-colors border border-rose-950/20 flex items-center gap-1 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Lock</span>
                </button>
              </div>
            </div>

            {/* Drag & Drop Overlay Alert */}
            {isDragging && (
              <div className="absolute inset-x-0 bottom-0 top-[60px] bg-blue-950/90 backdrop-blur-sm border-2 border-dashed border-blue-500 z-40 flex flex-col justify-center items-center pointer-events-none">
                <Plus className="w-12 h-12 text-blue-400 animate-bounce" />
                <p className="text-blue-300 font-medium text-sm">Drop here to encrypt local files!</p>
              </div>
            )}

            {/* Media Content Grid */}
            <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
              {realMedia.length === 0 ? (
                <div className="h-full flex flex-col justify-center items-center text-center p-6 bg-zinc-900/10 border border-zinc-900/30 rounded-2xl select-none">
                  <Unlock className="w-10 h-10 text-zinc-700 mb-4" />
                  <h3 className="text-zinc-400 font-bold font-display text-sm">Vault is Empty</h3>
                  <p className="text-zinc-600 text-xs max-w-xs mt-1.5 leading-relaxed">
                    Yahan koi bhi file encrypted nahi hai. Niche diye gaye blue icon '+' par click karke ya drag-drop karke safe local storage me add karein.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2.5">
                  {realMedia.map((item) => {
                    const isVideo = item.type.startsWith('video/');
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="aspect-square bg-zinc-900/40 border border-zinc-800/60 rounded-xl overflow-hidden relative cursor-pointer group shadow-inner flex flex-col items-center justify-center text-center"
                        onClick={() => openRealViewer(item.id)}
                      >
                        {isVideo ? (
                          <div className="flex flex-col items-center justify-center p-2.5">
                            <Video className="w-8 h-8 text-indigo-400 mb-1" />
                            <span className="text-[9px] text-zinc-500 font-mono tracking-wide truncate max-w-full">
                              {item.filename.length > 10 ? item.filename.slice(0, 7) + '...' : item.filename}
                            </span>
                            <span className="text-[8px] text-indigo-500 font-mono scale-[0.9] origin-center mt-0.5 uppercase tracking-widest font-bold">Video</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center p-2.5">
                            <ImageIcon className="w-8 h-8 text-teal-400 mb-1" />
                            <span className="text-[9px] text-zinc-500 font-mono tracking-wide truncate max-w-full">
                              {item.filename.length > 10 ? item.filename.slice(0, 7) + '...' : item.filename}
                            </span>
                            <span className="text-[8px] text-teal-500 font-mono scale-[0.9] origin-center mt-0.5 uppercase tracking-widest font-bold">Image</span>
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 py-1 bg-black/60 text-[8px] text-zinc-500 font-mono tracking-tighter">
                          {formatBytes(item.size, 1)}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Floating Import Action Trigger */}
            <label className="absolute bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-500 rounded-full flex items-center justify-center text-white shadow-xl hover:shadow-blue-600/10 cursor-pointer active:scale-95 transition-all border border-blue-500/30 group z-30">
              <Plus className="w-7 h-7 group-hover:rotate-90 transition-transform" />
              <input 
                type="file" 
                multiple 
                accept="image/*,video/*" 
                className="hidden" 
                onChange={(e) => handleFileUpload(e, false)} 
              />
            </label>
          </div>
        )}

        {/* ==================== SCREEN 4: DECOY/FAKE TRAP VAULT ==================== */}
        {currentScreen === 'fake_vault' && (
          <div className="flex-1 flex flex-col h-full bg-zinc-950 select-text overflow-hidden"
               onDragOver={handleDragOver}
               onDragLeave={handleDragLeave}
               onDrop={(e) => handleDrop(e, true)}>
            
            {/* Fake Header */}
            <div className="p-4 flex justify-between items-center border-b border-zinc-900 bg-zinc-950/70 backdrop-blur-md sticky top-0 z-30">
              <div className="flex items-center gap-2">
                <button 
                  onClick={lockActiveVault} 
                  className="p-1.5 hover:bg-zinc-900 rounded-lg text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex flex-col">
                  <h2 className="text-sm font-bold font-display tracking-wide uppercase text-white">Media Locker</h2>
                  <span className="text-[9px] text-zinc-500 font-mono tracking-wider">Unencrypted Shared Block</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={lockActiveVault} 
                  className="p-1.5 bg-zinc-900 hover:bg-zinc-850 text-zinc-400 rounded-lg text-xs leading-none transition-colors border border-zinc-850/60 flex items-center gap-1 cursor-pointer"
                >
                  Lock
                </button>
              </div>
            </div>

            {/* Drag & Drop Alert */}
            {isDragging && (
              <div className="absolute inset-x-0 bottom-0 top-[60px] bg-zinc-900/90 backdrop-blur-sm border-2 border-dashed border-zinc-800 z-40 flex flex-col justify-center items-center pointer-events-none">
                <Plus className="w-12 h-12 text-zinc-500 animate-pulse" />
                <p className="text-zinc-400 font-medium text-sm">Drop files here to upload decoy storage</p>
              </div>
            )}

            {/* Fake Media Content */}
            <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
              {fakeMedia.length === 0 ? (
                <div className="h-full flex flex-col justify-center items-center text-center p-6 bg-zinc-900/5 border border-zinc-900/30 rounded-2xl select-none">
                  <ImageIcon className="w-10 h-10 text-zinc-800 mb-4" />
                  <h3 className="text-zinc-500 font-bold font-display text-sm">Locker Empty</h3>
                  <p className="text-zinc-600 text-xs mt-1.5 leading-relaxed">
                    Yahan koi bhi image/video saved nahi hai. Niche right side me '+' par click karke unencrypted mock storage me save karein.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2.5">
                  {fakeMedia.map((item) => {
                    const isVideo = item.type === 'video';
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="aspect-square bg-zinc-900/50 rounded-xl overflow-hidden relative cursor-pointer group shadow border border-zinc-850"
                        onClick={() => setSelectedFakeItem(item)}
                      >
                        {isVideo ? (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900/80 p-2.5">
                            <Video className="w-7 h-7 text-indigo-400 mb-1" />
                            <span className="text-[9px] text-zinc-500 font-mono tracking-wide truncate max-w-full">
                              {item.name.length > 10 ? item.name.slice(0, 7) + '...' : item.name}
                            </span>
                            <span className="text-[7px] text-zinc-500 font-mono tracking-wider font-bold">VIDEO</span>
                          </div>
                        ) : (
                          <img src={item.data} className="w-full h-full object-cover screenshot-blocked" alt="Decoy thumbnail" referrerPolicy="no-referrer" />
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Floating Decoy Import Button */}
            <label className="absolute bottom-6 right-6 w-14 h-14 bg-blue-700 hover:bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg cursor-pointer active:scale-95 transition-all group z-30">
              <Plus className="w-7 h-7" />
              <input 
                type="file" 
                multiple 
                accept="image/*,video/*" 
                className="hidden" 
                onChange={(e) => handleFileUpload(e, true)} 
              />
            </label>
          </div>
        )}

      </main>

      {/* ==================== OVERLAY PORTAL: DETAILED REAL MEDIA VIEWER ==================== */}
      <AnimatePresence>
        {selectedRealItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/98 z-50 flex flex-col justify-between align-middle text-white select-text h-[100dvh]"
          >
            {/* Real Viewer Header Options */}
            <div className="p-4 flex justify-between items-center bg-zinc-950/70 border-b border-zinc-900">
              <div className="flex flex-col max-w-[60%]">
                <span className="text-xs font-semibold font-mono tracking-wider text-zinc-300 truncate">
                  {selectedRealItem.filename}
                </span>
                <span className="text-[8px] text-rose-500 font-mono font-bold tracking-widest uppercase">Decrypted session sandbox</span>
              </div>
              <div className="flex items-center gap-4">
                <a
                  href={selectedRealItem.blobUrl}
                  download={selectedRealItem.filename}
                  className="flex items-center gap-1 bg-zinc-900 hover:bg-zinc-850 px-3 py-1.5 rounded-lg border border-zinc-800 text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Save to Device</span>
                </a>
                <button
                  onClick={() => handleRealDelete(selectedRealItem.id)}
                  className="p-1.5 bg-rose-950/30 text-rose-500 hover:text-rose-400 rounded-lg max-h-9 flex items-center justify-center border border-rose-900/30 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={closeRealViewer} 
                  className="p-1.5 text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-850 rounded-lg font-mono font-bold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Decrypted Payload Render Spot */}
            <div className="flex-1 flex items-center justify-center p-6 bg-black/40 overflow-hidden">
              {selectedRealItem.mimeType.startsWith('video/') ? (
                <video 
                  src={selectedRealItem.blobUrl} 
                  controls 
                  autoPlay 
                  className="max-w-full max-h-[70vh] rounded-lg shadow-2xl border border-zinc-900 screenshot-blocked" 
                />
              ) : (
                <img 
                  src={selectedRealItem.blobUrl} 
                  className="max-w-full max-h-[70vh] rounded-lg object-contain shadow-2xl border border-zinc-900 screenshot-blocked" 
                  alt="Decrypted display" 
                  referrerPolicy="no-referrer"
                />
              )}
            </div>

            <div className="p-4 bg-zinc-950/70 border-t border-zinc-900 text-center flex items-center justify-center">
              <p className="text-[9px] text-zinc-500 leading-relaxed max-w-sm">
                Security warning: This decrypted file resides only in highly temporary, transient browser volatile RAM. Rest assured, closure or inactivity will completely wipe its bytes out.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==================== OVERLAY PORTAL: DECOY/FAKE MEDIA VIEWER ==================== */}
      <AnimatePresence>
        {selectedFakeItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/98 z-50 flex flex-col justify-between align-middle text-white h-[100dvh]"
          >
            {/* Decoy Viewer Header */}
            <div className="p-4 flex justify-between items-center bg-zinc-950/70 border-b border-zinc-900">
              <span className="text-xs font-semibold font-mono tracking-wider truncate max-w-[50%]">
                {selectedFakeItem.name}
              </span>
              <div className="flex items-center gap-4">
                <a
                  href={selectedFakeItem.data}
                  download={selectedFakeItem.name}
                  className="flex items-center gap-1 bg-zinc-900 hover:bg-zinc-850 px-3 py-1.5 rounded-lg border border-zinc-800 text-xs text-blue-400 font-bold transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Save</span>
                </a>
                <button
                  onClick={() => handleFakeDelete(selectedFakeItem.id)}
                  className="p-1.5 bg-rose-950/30 text-rose-500 hover:text-rose-400 rounded-lg border border-rose-900/30 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setSelectedFakeItem(null)} 
                  className="p-1.5 text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-850 rounded-lg cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Payload Panel */}
            <div className="flex-1 flex items-center justify-center p-6 bg-black/40 overflow-hidden">
              {selectedFakeItem.type === 'video' ? (
                <video src={selectedFakeItem.data} controls autoPlay className="max-w-full max-h-[70vh] rounded-lg screenshot-blocked" />
              ) : (
                <img src={selectedFakeItem.data} className="max-w-full max-h-[70vh] rounded-lg object-contain screenshot-blocked" alt="Decoy preview" referrerPolicy="no-referrer" />
              )}
            </div>

            <div className="p-4 bg-zinc-950/70 border-t border-zinc-900 text-center">
              <span className="text-[9px] text-zinc-600 font-mono uppercase tracking-widest">Decoy Locker Workspace</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
