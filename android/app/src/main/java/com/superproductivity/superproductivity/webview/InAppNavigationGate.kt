package com.superproductivity.superproductivity.webview

import java.net.URI
import java.net.URISyntaxException

/** Navigation policy for the legacy online WebView, which exposes SUPAndroid. */
object InAppNavigationGate {
    fun isInAppUrl(url: String, serviceProtocol: String, serviceHost: String): Boolean {
        val app = httpUri("$serviceProtocol://$serviceHost") ?: return false
        // Build configuration must describe an authority, not credentials or a URL path.
        if (app.rawUserInfo != null || !app.rawPath.isNullOrEmpty() ||
            app.rawQuery != null || app.rawFragment != null
        ) return false
        val target = httpUri(url) ?: return false
        return target.scheme.equals(app.scheme, ignoreCase = true) &&
            target.host.equals(app.host, ignoreCase = true) &&
            effectivePort(target) == effectivePort(app)
    }

    fun isHttpUrl(url: String): Boolean = httpUri(url) != null

    private fun httpUri(url: String): URI? {
        val uri = try {
            URI(url)
        } catch (_: URISyntaxException) {
            return null
        }
        return uri.takeIf {
            (it.scheme.equals("https", ignoreCase = true) ||
                it.scheme.equals("http", ignoreCase = true)) &&
                it.host != null && (it.port == -1 || it.port in 1..65535)
        }
    }

    private fun effectivePort(uri: URI): Int = when {
        uri.port != -1 -> uri.port
        uri.scheme.equals("https", ignoreCase = true) -> 443
        else -> 80
    }
}
