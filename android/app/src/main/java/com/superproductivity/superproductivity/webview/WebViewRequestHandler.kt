package com.superproductivity.superproductivity.webview

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayInputStream

/**
 * Strip the original WebViewClient logic to ensure that both types share the same logic
 */
class WebViewRequestHandler(
    private val activity: Activity,
    private val serviceProtocol: String,
    private val serviceHost: String,
) {
    private val CORS_SKIP_HEADER = "sp_cors_skip"

    fun createClient(): WebViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            handleUrlLoading(view, request.url.toString())

        @Deprecated("Deprecated in Java")
        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
            handleUrlLoading(view, url)

        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? =
            interceptWebRequest(request)
    }

    @Deprecated("Deprecated in Java")
    fun handleUrlLoading(view: WebView, url: String): Boolean {
        if (InAppNavigationGate.isInAppUrl(url, serviceProtocol, serviceHost)) {
            return false
        }
        // Malformed and non-HTTP(S) URLs must not fall through into the bridge WebView.
        if (InAppNavigationGate.isHttpUrl(url)) {
            try {
                activity.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
                )
            } catch (_: ActivityNotFoundException) {
                Log.w("TW", "No browser available for external navigation")
            } catch (_: SecurityException) {
                Log.w("TW", "External navigation was denied")
            }
        }
        return true
    }


    fun interceptWebRequest(request: WebResourceRequest?): WebResourceResponse? {

        try {
            if (request == null || request.isForMainFrame) {
                return null
            }

            if (!request.requestHeaders.containsKey(CORS_SKIP_HEADER)) {
                Log.v("TW", "_______________________________________")
                return null
            }

            if (request.url?.path?.contains("assets/icons/favicon") == true) {
                try {
                    return WebResourceResponse("image/png", null, null)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }

            if (request.url.toString().contains(serviceHost)) {
                return null
            }

            Log.v(
                "TW",
                "interceptRequest mf:${request?.isForMainFrame.toString()} ${request.method} ${request?.url}"
            )

            // since we currently don't have a way to also post the body, we only handle GET, HEAD and OPTIONS requests
            // see https://github.com/KonstantinSchubert/request_data_webviewclient for a possible solution
            if (request.method.uppercase() != "GET" && request.method.uppercase() != "OPTIONS" && request.method.uppercase() != "HEAD") {
                return null
            }


            val client = OkHttpClient()
            val newRequestBuilder = Request.Builder()
                .url(request.url.toString())
                .method(request.method, null)

            for ((key, value) in request.requestHeaders) {
                Log.v("TW", "interceptRequest header:${key} – ${value}")
                if (key == CORS_SKIP_HEADER || key == "User-Agent" || key == "Origin" || key == "Referer" || key == "Sec-Fetch-Mode") {
                    continue
                }
                newRequestBuilder.addHeader(key, value)
            }

            newRequestBuilder.header("User-Agent", "curl/7.64.1")
            val newRequest = newRequestBuilder.build()

            if (request.method.uppercase() == "OPTIONS") {
                Log.v("TW", "OPTIONS request triggered")
                return OptionsAllowResponse.build()
                // to execute actual OPTIONS request uncomment the following lines
//                client.newCall(newRequest).execute().use { response ->
//                    Log.v(
//                        "TW",
//                        "OPTIONS original response: ${response.code} ${response.message} ${response.body?.string()}"
//                    )
//                    if (response.code != 200) {
//                        Log.v("TW", "OPTIONS overwrite")
//                        return OptionsAllowResponse.build()
//                    }
//                }
            }
            //-------------


            Log.v("TW", "exec request ${request.url}")
            client.newCall(newRequest).execute().use { response ->
                Log.v("TW", "response ${response.code} ${response.message}")
                val responseHeaders = response.headers.names()
                    .associateWith { response.headers(it)?.joinToString() }
                    .toMutableMap()

                upsertKeyValue(responseHeaders, "Access-Control-Allow-Origin", "*")
                upsertKeyValue(
                    responseHeaders,
                    "Access-Control-Allow-Methods",
                    "GET, POST, OPTIONS"
                )

                val contentType = response.header("Content-Type", "text/plain")
                val contentEncoding = response.header("Content-Encoding", "utf-8")

                val inputStream = ByteArrayInputStream(response.body?.bytes())
                val reasonPhrase =
                    response.message.ifEmpty { "OK" } // provide a default value if the message is null or empty

                return WebResourceResponse(
                    contentType,
                    contentEncoding,
                    response.code,
                    reasonPhrase,
                    responseHeaders,
                    inputStream
                )
            }
        } catch (e: Exception) {
            Log.e("WebViewRequestHandler", "Error in interceptWebRequest => Not intercepting", e)
            return null
        }
    }

    fun upsertKeyValue(
        responseHeaders: MutableMap<String, String?>,
        keyToChange: String,
        value: String
    ): MutableMap<String, String?> {
        val keyToChangeLower = keyToChange.lowercase()
        for (key in responseHeaders.keys) {
            if (key.lowercase() == keyToChangeLower) {
                // Reassign old key
                responseHeaders[key] = value
                // Done
                return responseHeaders
            }
        }
        responseHeaders[keyToChange] = value
        return responseHeaders
    }
}
