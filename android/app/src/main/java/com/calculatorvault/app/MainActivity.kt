package com.calculatorvault.app

import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewAssetLoader.AssetsPathHandler

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // ANDROID SECURITY HARDENING: Enforce FLAG_SECURE to prevent screenshots, screen recording, and system task previews
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )

        // Programmatic lightweight content layout creation
        webView = WebView(this)
        setContentView(webView)

        // Initialize WebViewAssetLoader to securely load local offline assets under a pseudo-HTTPS scheme.
        // This avoids cross-origin errors (CORS), secures IndexDB storage under a proper secure HTTPS origin,
        // and completely blocks dynamic absolute file:/// path traversals.
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.android.com")
            .addPathHandler("/assets/", AssetsPathHandler(this))
            .build()

        configureWebViewSettings()
        setupWebViewClient()

        // Load the React offline application main entry point
        webView.loadUrl("https://appassets.android.com/assets/index.html")
    }

    private fun configureWebViewSettings() {
        val settings = webView.settings

        // 1. JavaScript execution is strictly required for the React single-page interface
        settings.javaScriptEnabled = true

        // 2. DOM Storage/IndexedDB are required for the local encrypted database
        settings.domStorageEnabled = true
        settings.databaseEnabled = true

        // 3. ANDROID SECURITY HARDENING: Prevent external protocol / traversal attacks
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false

        // 4. Secure Caching
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        // 5. Hardened WebView: Disable remote loading capabilities and block potential vectors
        settings.geolocationEnabled = false
        settings.mediaPlaybackRequiresUserGesture = true

        // 6. ANDROID SECURITY HARDENING: Dynamic production debugger suppression.
        // WebView content debugging is strictly limited to development builds.
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    }

    private fun setupWebViewClient() {
        webView.webViewClient = object : WebViewClient() {
            
            // Intercept internal path requests and route them to internal resources securely via WebViewAssetLoader
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }

            // SECURE WEBVIEW CONFIGURATION: Anti-phishing/Redirect block.
            // Strict check: Block all remote URL transitions to protect user data from phishing leaks.
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                // Allow only our secure, pseudo-HTTPS internal domain
                return if (url.host == "appassets.android.com") {
                    false // Permit internal navigation / action
                } else {
                    true // Intercept & block all outer domain attempts
                }
            }
        }
    }

    // ANDROID SECURITY HARDENING: Automatic vault locking on app minimize
    override fun onPause() {
        super.onPause()
        lockVaultMemory()
    }

    override fun onStop() {
        super.onStop()
        lockVaultMemory()
    }

    // Secure resume handling – trigger memory scrub check and reinforce FLAG_SECURE
    override fun onResume() {
        super.onResume()
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        lockVaultMemory()
    }

    // ANDROID SECURITY HARDENING: Immediate app-switcher / task privacy protection
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Ensure FLAG_SECURE is active during focus transitions
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        if (!hasFocus) {
            // Instantly clear memory keys if workspace loses focus
            lockVaultMemory()
        }
    }

    private fun lockVaultMemory() {
        // Evaluate javascript inside the local frame to purge active decryption keys and reverse the UI back to calculator instantly
        webView.post {
            webView.evaluateJavascript(
                "if (window.lockVault) { window.lockVault(); }",
                null
            )
        }
    }

    // Clean up WebView resources upon destruction to mitigate memory leakage
    override fun onDestroy() {
        webView.clearCache(true)
        webView.clearHistory()
        super.onDestroy()
    }

    // Android back navigation override
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
