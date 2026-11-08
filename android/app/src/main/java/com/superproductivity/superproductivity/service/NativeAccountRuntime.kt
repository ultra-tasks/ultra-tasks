package com.superproductivity.superproductivity.service

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** One refresh owner for WebView and worker; no password, master key or signing private key. */
object NativeAccountRuntime {
    val executor = Executors.newSingleThreadExecutor()
    private var preferences: SharedPreferences? = null
    private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).callTimeout(25, TimeUnit.SECONDS).build()
    private const val PROFILE = "account"
    private const val CACHE = "reminder_cache"
    private const val MANAGED = "managed_reminders"
    private const val PROTECTED = "local_reminder_edits"
    private const val REMINDER_VERSION = "local_reminder_version"
    private val foregroundCalls = AtomicInteger(0)
    class SessionRevoked : Exception("Sign in again")
    class ScopeUnavailable : Exception("Project access unavailable")

    private fun createPreferences(context: Context): SharedPreferences {
        val master = MasterKey.Builder(context.applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        // Deliberately no plaintext fallback. Broken/migrated keystores require sign-in.
        return EncryptedSharedPreferences.create(context.applicationContext, "UltraNativeAccountV2", master,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    }
    private fun prefs(context: Context): SharedPreferences = preferences ?: try {
        createPreferences(context).also { preferences = it }
    } catch (_: Exception) {
        // Unreadable device-bound ciphertext after OS migration contains no
        // recoverable session. Recreate encrypted storage; never fall back.
        context.applicationContext.deleteSharedPreferences("UltraNativeAccountV2")
        createPreferences(context).also { preferences = it }
    }
    private fun read(context: Context): JSONObject = JSONObject(prefs(context).getString(PROFILE, null) ?: throw SessionRevoked())
    private fun save(context: Context, profile: JSONObject) { check(prefs(context).edit().putString(PROFILE, profile.toString()).commit()) }
    private fun same(profile: JSONObject, value: JSONObject): Boolean = profile.getString("serverId") == value.getString("serverId") && profile.getString("accountId") == value.getString("accountId")
    private fun requireIdentity(profile: JSONObject, value: JSONObject) { require(same(profile, value)) { "Account changed" } }
    private fun validateScopes(input: JSONArray): JSONArray {
        require(input.length() <= 101)
        val scopes = JSONArray(); val ids = mutableSetOf<String>()
        for (i in 0 until input.length()) {
            val source = input.getJSONObject(i); val out = JSONObject()
            for (field in listOf("id", "kind", "ownerId", "ownerKey", "key", "epoch", "generation", "controlVersion", "sequence")) out.put(field, source.get(field))
            require(ids.add(out.getString("id")) && out.getString("kind") in setOf("personal", "project") && !out.getJSONObject("ownerKey").has("d"))
            scopes.put(out)
        }
        return scopes
    }
    private fun removeMissingReminders(context: Context, scopes: JSONArray) {
        val valid = (0 until scopes.length()).map { scopes.getJSONObject(it).getString("id") }.toSet()
        val managed = managed(context)
        for (key in managed.keys().asSequence().toList()) if (managed.getJSONObject(key).getString("scopeId") !in valid) {
            cancelRemindersForTask(context, key); managed.remove(key)
        }
        saveManaged(context, managed)
    }
    @Synchronized fun available(context: Context): Boolean = try { prefs(context).contains(PROFILE) } catch (_: Exception) { false }
    private fun <T> foreground(run: () -> T): T {
        foregroundCalls.incrementAndGet()
        try { return synchronized(this) { run() } } finally { foregroundCalls.decrementAndGet() }
    }
    fun foregroundWaiting(): Boolean = foregroundCalls.get() > 0
    fun call(context: Context, method: String, input: JSONObject): JSONObject = foreground { command(context, method, input) }
    private fun command(context: Context, method: String, input: JSONObject): JSONObject {
        if (method == "login-save") {
            val value = input.getString("value")
            require(value.length <= 16384)
            val expiry = JSONObject(value).getJSONObject("request").getLong("expiresAt")
            require(expiry > System.currentTimeMillis() && expiry <= System.currentTimeMillis() + 300000)
            check(prefs(context).edit().putString(BROWSER_LOGIN_SLOT, value).commit())
            return JSONObject().put("saved", true)
        }
        if (method == "login-clear") {
            check(prefs(context).edit().remove(BROWSER_LOGIN_SLOT).commit())
            return JSONObject().put("cleared", true)
        }
        if (method == "login-load") {
            val value = prefs(context).getString(BROWSER_LOGIN_SLOT, null)
            if (value != null && JSONObject(value).getJSONObject("request").getLong("expiresAt") > System.currentTimeMillis())
                return JSONObject().put("value", value)
            check(prefs(context).edit().remove(BROWSER_LOGIN_SLOT).commit())
            return JSONObject().put("value", JSONObject.NULL)
        }
        when (method) {
            "configure", "bootstrap" -> {
                val base = input.getString("baseUrl").trimEnd('/')
                val uri = URI(base)
                require(uri.userInfo == null && uri.query == null && uri.fragment == null && (uri.scheme == "https" || uri.scheme == "http" && uri.host in setOf("localhost", "127.0.0.1", "[::1]")))
                val old = try { read(context) } catch (_: SessionRevoked) { null }
                if (old != null && !same(old, input)) clear(context)
                val prior = if (method == "bootstrap" && old != null && same(old, input)) old else null
                val tokens = prior?.getJSONObject("tokens") ?: if (method == "configure") tokensOnly(input.getJSONObject("tokens")) else
                    JSONObject().put("accessToken", "").put("refreshToken", input.getString("refreshToken")).put("expiresIn", 0)
                val expiry = prior?.getLong("expiresAt") ?: if (method == "configure") System.currentTimeMillis() + 600000 else 0L
                val profile = JSONObject().put("serverId", input.getString("serverId")).put("accountId", input.getString("accountId"))
                    .put("baseUrl", base).put("tokens", tokens).put("expiresAt", expiry).put("scopes", validateScopes(input.getJSONArray("scopes")))
                save(context, profile)
                removeMissingReminders(context, profile.getJSONArray("scopes"))
                NativeAccountScheduler.ensureScheduled(context)
                return JSONObject().put("configured", true)
            }
            "clear" -> { clear(context); return JSONObject().put("cleared", true) }
            "detach" -> {
                val profile = read(context); requireIdentity(profile, input)
                val latest = tokensOnly(profile.getJSONObject("tokens")).put("expiresIn", maxOf(0L, (profile.getLong("expiresAt") - System.currentTimeMillis()) / 1000))
                clear(context); return latest
            }
            "current", "refresh" -> {
                val profile = read(context); requireIdentity(profile, input)
                return credentials(context, profile, method == "refresh")
            }
            "scopes" -> {
                val profile = read(context); requireIdentity(profile, input)
                val scopes = validateScopes(input.getJSONArray("scopes")); profile.put("scopes", scopes)
                save(context, profile)
                removeMissingReminders(context, scopes)
                return JSONObject().put("updated", true)
            }
            "local-reminders" -> {
                val profile = read(context); requireIdentity(profile, input)
                val desired = input.getJSONObject("reminders")
                // Foreground shared reminders only. Ordinary task reminders keep
                // the existing platform path and IDs used by SuperSync.
                val merged = managed(context)
                for (id in merged.keys().asSequence().toList()) if (id.startsWith("native:")) merged.remove(id)
                for (id in desired.keys()) { require(id.startsWith("native:")); merged.put(id, desired.getJSONObject(id)) }
                val prior = managed(context)
                val changed = (prior.keys().asSequence().toList() + merged.keys().asSequence().toList()).toSet().filter { it.startsWith("native:") && prior.optJSONObject(it)?.toString() != merged.optJSONObject(it)?.toString() }
                applyNativeReminders(context, merged, true)
                for (id in changed) protectNotification(context, SuperSyncBackgroundProvider.generateNotificationId(id))
                return JSONObject().put("updated", true)
            }
            "reminder-barrier" -> { requireIdentity(read(context), input); return JSONObject().put("version", prefs(context).getLong(REMINDER_VERSION, 0L)) }
            "personal-synced" -> {
                requireIdentity(read(context), input)
                val version = input.getLong("version"); require(version >= 0)
                val protected = JSONObject(prefs(context).getString(PROTECTED, "{}")!!)
                for (id in protected.keys().asSequence().toList()) if (protected.getLong(id) <= version) protected.remove(id)
                check(prefs(context).edit().putString(PROTECTED, protected.toString()).commit())
                return JSONObject().put("updated", true)
            }
            else -> throw IllegalArgumentException("Unknown native account command")
        }
    }
    private fun tokensOnly(value: JSONObject): JSONObject = JSONObject().put("accessToken", value.getString("accessToken")).put("refreshToken", value.getString("refreshToken")).put("expiresIn", value.getLong("expiresIn"))
    private fun fetch(profile: JSONObject, path: String, body: JSONObject? = null, authenticated: Boolean = true): Pair<Int, JSONObject> {
        val builder = Request.Builder().url(profile.getString("baseUrl") + "/api/v2/accounts" + path).header("Cache-Control", "no-store")
        if (authenticated) builder.header("Authorization", "Bearer " + profile.getJSONObject("tokens").getString("accessToken"))
        if (body != null) builder.post(body.toString().toRequestBody("application/json".toMediaType()))
        return http.newCall(builder.build()).execute().use { response ->
            val bytes = ByteArrayOutputStream()
            response.body?.byteStream()?.use { stream ->
                val buffer = ByteArray(8192)
                while (true) { val count = stream.read(buffer); if (count == -1) break; require(bytes.size() + count <= 32 * 1024 * 1024) { "Background snapshot too large" }; bytes.write(buffer, 0, count) }
            }
            Pair(response.code, JSONObject(bytes.toString("UTF-8")))
        }
    }
    private fun credentials(context: Context, profile: JSONObject, force: Boolean = false): JSONObject {
        if (force || System.currentTimeMillis() >= profile.getLong("expiresAt") - 60000) {
            val (status, result) = fetch(profile, "/sessions/refresh", JSONObject().put("refreshToken", profile.getJSONObject("tokens").getString("refreshToken")), false)
            if (status == 401 || status == 403) { clear(context); throw SessionRevoked() }
            check(status in 200..299) { "Session refresh unavailable" }
            profile.put("tokens", tokensOnly(result)).put("expiresAt", System.currentTimeMillis() + result.getLong("expiresIn") * 1000)
            try { save(context, profile) } catch (error: Exception) { clear(context); throw error }
        }
        return tokensOnly(profile.getJSONObject("tokens")).put("expiresIn", maxOf(1L, (profile.getLong("expiresAt") - System.currentTimeMillis()) / 1000))
    }
    fun request(context: Context, profile: JSONObject, path: String): JSONObject {
        credentials(context, profile)
        var result = fetch(profile, path)
        if (result.first == 401) { credentials(context, profile, true); result = fetch(profile, path) }
        if (result.first == 401) { clear(context); throw SessionRevoked() }
        if (result.first == 403 || result.first == 404) throw ScopeUnavailable()
        check(result.first in 200..299) { "Encrypted sync unavailable" }
        return result.second
    }
    @Synchronized fun background(context: Context, run: (JSONObject) -> Unit) { run(read(context)) }
    fun cache(context: Context): JSONObject = JSONObject(prefs(context).getString(CACHE, "{}")!!)
    fun saveCache(context: Context, cache: JSONObject) { check(prefs(context).edit().putString(CACHE, cache.toString()).commit()) }
    fun managed(context: Context): JSONObject = JSONObject(prefs(context).getString(MANAGED, "{}")!!)
    fun saveManaged(context: Context, managed: JSONObject) { check(prefs(context).edit().putString(MANAGED, managed.toString()).commit()) }
    fun protectNotification(context: Context, notificationId: Int) = foreground {
        if (available(context)) {
            val protected = JSONObject(prefs(context).getString(PROTECTED, "{}")!!)
            val version = prefs(context).getLong(REMINDER_VERSION, 0L) + 1
            protected.put(notificationId.toString(), version)
            check(prefs(context).edit().putString(PROTECTED, protected.toString()).putLong(REMINDER_VERSION, version).commit())
        }
    }
    fun protectedNotifications(context: Context): Set<Int> = JSONObject(prefs(context).getString(PROTECTED, "{}")!!).keys().asSequence().map { it.toInt() }.toSet()
    @Synchronized fun clear(context: Context) {
        val stored = managed(context)
        for (taskId in stored.keys()) cancelRemindersForTask(context, taskId)
        clearNativeAccountSessionStorage(prefs(context))
        NativeAccountScheduler.cancel(context)
    }
}
