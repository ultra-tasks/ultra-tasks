package com.superproductivity.superproductivity.webview

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.AndroidJUnit4
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Real WebView + production client; the probe exposes no user data or credentials. */
@RunWith(AndroidJUnit4::class)
@Suppress("DEPRECATION")
class OnlineNavigationInstrumentedTest {
    class Probe(private val loads: LinkedBlockingQueue<String>) {
        @JavascriptInterface
        fun loaded(url: String) { loads.offer(url) }
    }

    class BrowserRecorder : Activity() {
        val launches = LinkedBlockingQueue<Intent>()
        var failure: RuntimeException? = null

        override fun startActivity(intent: Intent) {
            failure?.let { throw it }
            launches.offer(intent)
        }
    }

    private class Fixture : AutoCloseable {
        private val instrumentation = InstrumentationRegistry.getInstrumentation()
        val server = MockWebServer()
        lateinit var browser: BrowserRecorder
        val loads = LinkedBlockingQueue<String>()
        lateinit var view: WebView
        lateinit var handler: WebViewRequestHandler
        val origin: String

        init {
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse =
                    MockResponse().setHeader("Content-Type", "text/html; charset=utf-8")
                        .setBody("<html><body><script>SUPAndroid.loaded(location.href)</script></body></html>")
            }
            server.start()
            // MockWebServer can perform reverse DNS while producing its URL.
            // Resolve it on the instrumentation thread, before entering the UI.
            origin = server.url("/").toString()
            val configuredHost = java.net.URI(origin).rawAuthority
            instrumentation.runOnMainSync {
                browser = BrowserRecorder()
                view = WebHelper().instanceView(instrumentation.targetContext)
                handler = WebViewRequestHandler(browser, "http", configuredHost)
                view.addJavascriptInterface(Probe(loads), "SUPAndroid")
                view.webViewClient = handler.createClient()
                view.webChromeClient = WebChromeClient()
                view.loadUrl(origin)
            }
        }

        fun awaitApp() {
            assertEquals("The configured page must retain the native bridge", origin, loads.poll(15, TimeUnit.SECONDS))
        }

        fun follow(url: String, newWindow: Boolean = false) {
            instrumentation.runOnMainSync {
                val target = if (newWindow) "link.target = '_blank';" else ""
                view.evaluateJavascript(
                    "var link = document.createElement('a'); link.href = ${JSONObject.quote(url)}; " +
                        target + "document.body.appendChild(link); link.click();",
                    null,
                )
            }
        }

        fun assertStillOnApp() {
            instrumentation.runOnMainSync { assertEquals(origin, view.url) }
            assertTrue("No foreign page may call the bridge", loads.isEmpty())
        }

        fun assertCallbackBlocked(url: String) {
            instrumentation.runOnMainSync { assertTrue(handler.handleUrlLoading(view, url)) }
        }

        override fun close() {
            instrumentation.runOnMainSync {
                view.stopLoading()
                view.removeJavascriptInterface("SUPAndroid")
                view.destroy()
            }
            server.shutdown()
        }
    }

    @Test
    fun configuredOriginAndPortKeepTheBridge() {
        Fixture().use { fixture ->
            fixture.awaitApp()
            val next = fixture.server.url("/next?check=1").toString()
            fixture.follow(next)
            assertEquals(next, fixture.loads.poll(15, TimeUnit.SECONDS))
            assertTrue(fixture.browser.launches.isEmpty())
        }
    }

    @Test
    fun foreignLinksAndOtherPortsOpenOutsideTheBridgeWebView() {
        Fixture().use { fixture ->
            fixture.awaitApp()
            val other = MockWebServer()
            other.start()
            try {
                val targets = listOf(
                    "http://evil.example/?x=super-productivity.com",
                    "http://evil.example/#localhost",
                    "http://${fixture.server.hostName}.evil.example/",
                    "http://${fixture.server.hostName}@evil.example/",
                    other.url("/?x=localhost").toString(),
                )
                for (newWindow in listOf(false, true)) {
                    for (url in targets) {
                        fixture.follow(url, newWindow)
                        val intent = fixture.browser.launches.poll(15, TimeUnit.SECONDS)
                        assertNotNull("Expected external navigation for $url (newWindow=$newWindow)", intent)
                        assertEquals(Intent.ACTION_VIEW, intent!!.action)
                        assertTrue(intent.hasCategory(Intent.CATEGORY_BROWSABLE))
                        fixture.assertStillOnApp()
                    }
                }
                assertEquals("The different-port page must not load", 0, other.requestCount)
            } finally {
                other.shutdown()
            }
        }
    }

    @Test
    fun malformedAndNonHttpCallbacksAndMissingBrowserFailClosed() {
        Fixture().use { fixture ->
            fixture.awaitApp()
            for (url in listOf(
                "javascript:SUPAndroid.loaded('foreign')", "data:text/html,foreign",
                "file:///android_asset/index.html", "content://example/item", "about:blank",
                "blob:${fixture.origin}id", "intent://example/#Intent;end", "http://bad host/",
            )) fixture.assertCallbackBlocked(url)
            assertTrue(fixture.browser.launches.isEmpty())
            for (failure in listOf(ActivityNotFoundException("No test browser"), SecurityException("Denied"))) {
                fixture.browser.failure = failure
                fixture.assertCallbackBlocked("https://outside.example/")
                fixture.assertStillOnApp()
            }
        }
    }
}
