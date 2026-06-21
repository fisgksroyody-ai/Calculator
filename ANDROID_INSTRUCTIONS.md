# Android Hybrid Container & Secure APK Compilation Guide

This document provides instructions on how to compile, test, sign, and build the **Calculator Vault** secure application as a native Android hybrid app.

---

## 🛡️ Android Security Features Implemented

1. **Anti-Screen/Screenshot Blocking (`FLAG_SECURE`)**:
   * Blocks system screenshots and restricts system task preview overlays (prevents exposing the unlocked vault state in the app switcher).
   * Prevents screencasting or recording of the application interface.

2. **Automated Memory lock & Zero-Exposure State**:
   * Evaluates javascript `window.lockVault()` instantly inside the WebView upon transition to `onPause()` / `onStop()` / `onResume()`.
   * Automatically clears active cryptographic key state and resets screen navigation to the inactive calculator mode immediately when the user minimizes the application.

3. **Secure Offline origin (`WebViewAssetLoader`)**:
   * Maps internal compiled files onto a pseudo-HTTPS scheme (`https://appassets.android.com/`).
   * Eliminates default `file:///` path traversal security risks.
   * Enables secure and modern origin sandboxing for local IndexedDB and Cryptographic storage offline.

4. **Production Debugger Shielding**:
   * Web contents element inspection is restricted to Android debug builds only (`WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)`).

5. **Network Hardening**:
   * Cleartext HTTP configurations are completely disabled globally, blocking Man-In-The-Middle (MITM) attacks.

---

## 📂 Project Structure Created

* **`/android/`**: Android Project Root
  * **`build.gradle`**: Root compile configuration (Gradle plugins).
  * **`settings.gradle`**: Declares subproject modules (`:app`).
  * **`gradle.properties`**: Declares compiler attributes and AndroidX enablement.
  * **`/app/`**: Active Android module
    * **`build.gradle`**: Module compile variables, target SDK 34 (Android 14), dependencies, and custom asset pipeline.
    * **`proguard-rules.pro`**: Shrinking/minify configurations protecting our Javascript interfaces.
    * **`src/main/AndroidManifest.xml`**: Declarative manifest, portrait-only locking, and security configs.
    * **`src/main/res/values/strings.xml`, `colors.xml`, `styles.xml`**: Branding resources.
    * **`src/main/res/xml/network_security_config.xml`**: Encryption only security controls.
    * **`src/main/java/com/calculatorvault/app/MainActivity.kt`**: Hardened main Kotlin runner.

---

## 🏗️ How to Compile and Generate the APK

### Step 1: Compile the React Frontend Assets
First, compile your production React static assets so that they are ready to be synced into your native asset pipeline:
```bash
npm run build
```
This compile script writes relative paths into `/dist/`.

### Step 2: Open and Compile with Android Studio
1. Launch **Android Studio**.
2. Select **Open an Existing Project** and navigate to select the `/android/` directory in this workspace.
3. Allow Android Studio to complete project synchronization and Gradle asset downloads automatically.
4. From the top bar, click **Build > Make Project** or select **Build > Build Bundle(s) / APK(s) > Build APK(s)** to generate a development Android APK.
5. The generated APK will be placed in:
   `android/app/build/outputs/apk/debug/app-debug.apk`

---

## 🛠️ Command-Line Build Instructions (Gradle)

If using terminal or CI pipelines, execute these scripts in the `/android` directory:

#### Build a Debug APK
```bash
cd android
./gradlew assembleDebug
```
*Creates: `app/build/outputs/apk/debug/app-debug.apk` with standard development debugging bridges active.*

#### Build a Signed Release APK
To compile a signed production-ready APK, you must generate a Keystore file and bind it to your build configuration. 

1. Generate a secure Keystore if you do not have one:
   ```bash
   keytool -genkey -v -keystore release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias my-key-alias
   ```

2. Add your keystore properties securely. (Create reference values in `/android/local.properties` or inside `/android/app/build.gradle`):
   ```groovy
   signingConfigs {
       release {
           storeFile file("release-key.jks")
           storePassword "YOUR_KEYSTORE_PASSWORD"
           keyAlias "my-key-alias"
           keyPassword "YOUR_KEY_PASSWORD"
       }
   }
   buildTypes {
       release {
           signingConfig signingConfigs.release
           minifyEnabled true
           shrinkResources true
           proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
       }
   }
   ```

3. Run the production release build task:
   ```bash
   ./gradlew assembleRelease
   ```
*Creates: `app/build/outputs/apk/release/app-release.apk` compiled with full optimization (Minified, Shrinked, Debugging disabled, Secured state fully enforced).*

---

## 🔄 Automatic Assets Sync Mechanism
Whenever you compile your Android app, the built-in Gradle task `copyViteAssets` executes:
* It reads the compiled frontend folder (`../../dist/`) and copies its contents directly into `/android/app/src/main/assets/`.
* You do **not** need to manually move assets when making edits or iterative changes to the React frontend! Just rerun `npm run build` followed by your Android compilation script!
