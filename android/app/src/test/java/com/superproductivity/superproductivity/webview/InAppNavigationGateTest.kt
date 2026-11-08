package com.superproductivity.superproductivity.webview

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

@RunWith(Parameterized::class)
class InAppNavigationGateTest(
    private val label: String,
    private val url: String,
    private val protocol: String,
    private val host: String,
    private val expected: Boolean,
) {
    @Test
    fun navigationMatchesConfiguredOrigin() {
        assertEquals(label, expected, InAppNavigationGate.isInAppUrl(url, protocol, host))
    }

    companion object {
        private const val APP = "app.example.test"

        private fun case(
            label: String,
            url: String,
            expected: Boolean = false,
            protocol: String = "https",
            host: String = APP,
        ): Array<Any> = arrayOf(label, url, protocol, host, expected)

        @JvmStatic
        @Parameterized.Parameters(name = "{0}")
        fun cases(): List<Array<Any>> = listOf(
            case("configured app", "https://$APP/", true),
            case("path query and hash", "https://$APP/path?q=1#/tag/TODAY/tasks", true),
            case("case insensitive scheme and host", "HTTPS://APP.EXAMPLE.TEST/", true),
            case("case insensitive configuration", "https://$APP/", true, "HTTPS", "APP.EXAMPLE.TEST"),
            case("explicit default HTTPS port", "https://$APP:443/", true),
            case("implicit default HTTPS port", "https://$APP/", true, host = "$APP:443"),
            case("explicit default HTTP port", "http://$APP:80/", true, "http"),
            case("implicit default HTTP port", "http://$APP/", true, "http", "$APP:80"),
            case("configured nondefault port", "https://$APP:8443/", true, host = "$APP:8443"),
            case("other HTTPS port", "https://$APP:8443/"),
            case("missing configured port", "https://$APP/", host = "$APP:8443"),
            case("wrong configured port", "https://$APP:9443/", host = "$APP:8443"),
            case("HTTP downgrade", "http://$APP/"),
            case("HTTPS is not configured HTTP", "https://$APP/", protocol = "http"),
            case("emulator port", "http://10.0.2.2:4200/", true, "http", "10.0.2.2:4200"),
            case("other emulator port", "http://10.0.2.2:4201/", host = "10.0.2.2:4200", protocol = "http"),
            case("implicit emulator port", "http://10.0.2.2/", host = "10.0.2.2:4200", protocol = "http"),
            case("explicitly configured localhost", "http://localhost:4200/", true, "http", "localhost:4200"),
            case("localhost is not implicitly trusted", "http://localhost:4200/"),
            case("upstream website is not implicitly trusted", "https://super-productivity.com/"),
            case("IPv6 configured port", "http://[::1]:4200/", true, "http", "[::1]:4200"),
            case("IPv6 other port", "http://[::1]:4201/", host = "[::1]:4200", protocol = "http"),
            case("userinfo on real app host", "https://name@$APP/", true),
            case("app host is userinfo", "https://$APP@evil.example/"),
            case("userinfo and suffix host", "https://user:pass@$APP.evil.example/"),
            case("app host in query", "https://evil.example/?next=https://$APP"),
            case("app host in path", "https://evil.example/$APP/"),
            case("app host in fragment", "https://evil.example/#$APP"),
            case("old upstream substring", "https://evil.example/?x=super-productivity.com"),
            case("old localhost substring", "https://evil.example/#localhost"),
            case("suffix host", "https://$APP.evil.example/"),
            case("prefix host", "https://evil$APP/"),
            case("unconfigured subdomain", "https://sub.$APP/"),
            case("uppercase foreign URL", "HTTPS://EVIL.EXAMPLE/"),
            case("backslash authority", "https://evil.example\\@$APP/"),
            case("escaped authority", "https://app%2eexample.test/"),
            case("space in host", "https://evil example/$APP"),
            case("line break", "https://$APP/\n"),
            case("tab in authority", "https://app\t.example.test/"),
            case("relative URL", "/path"),
            case("protocol relative URL", "//$APP/"),
            case("opaque HTTPS URL", "https:$APP"),
            case("empty URL", ""),
            case("invalid escape", "https://$APP/%zz"),
            case("port zero", "https://$APP:0/"),
            case("port outside range", "https://$APP:65536/"),
            case("nonnumeric port", "https://$APP:bad/"),
            case("javascript scheme", "javascript:alert(1)"),
            case("data scheme", "data:text/html,<script>SUPAndroid</script>"),
            case("file scheme", "file:///android_asset/index.html"),
            case("content scheme", "content://$APP/item"),
            case("about scheme", "about:blank"),
            case("blob scheme", "blob:https://$APP/id"),
            case("intent scheme", "intent://$APP/#Intent;end"),
            case("invalid configured protocol", "ftp://$APP/", protocol = "ftp"),
            case("configured credentials", "https://$APP/", host = "user@$APP"),
            case("configured path", "https://$APP/", host = "$APP/path"),
            case("configured query", "https://$APP/", host = "$APP?x=1"),
            case("configured fragment", "https://$APP/", host = "$APP#x"),
            case("configured port outside range", "https://$APP/", host = "$APP:65536"),
        )
    }
}
