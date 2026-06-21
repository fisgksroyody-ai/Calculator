# Keeps JavaScript interfaces secure and operational
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# General Keep rules for Android structures
-keep class com.calculatorvault.app.MainActivity { *; }
-keepattributes JavascriptInterface, Annotation
-dontwarn androidx.webkit.**
