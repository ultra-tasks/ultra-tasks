package com.superproductivity.superproductivity.service

import android.content.SharedPreferences
import java.lang.reflect.Proxy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeAccountSessionStorageTest {
    private fun storage(values: MutableMap<String, String>): SharedPreferences {
        lateinit var editor: SharedPreferences.Editor
        editor = Proxy.newProxyInstance(javaClass.classLoader, arrayOf(SharedPreferences.Editor::class.java)) { _, method, args ->
            when (method.name) {
                "clear" -> { values.clear(); editor }
                "putString" -> { values[args!![0] as String] = args[1] as String; editor }
                "commit" -> true
                else -> throw AssertionError("Unexpected editor operation: ${method.name}")
            }
        } as SharedPreferences.Editor
        return Proxy.newProxyInstance(javaClass.classLoader, arrayOf(SharedPreferences::class.java)) { _, method, args ->
            when (method.name) {
                "getString" -> values[args!![0] as String] ?: args[1]
                "edit" -> editor
                else -> throw AssertionError("Unexpected preferences operation: ${method.name}")
            }
        } as SharedPreferences
    }

    @Test fun pendingProofSurvivesRepeatedSessionTeardownDuringColdLaunch() {
        val values = mutableMapOf("account" to "old-session", "reminder_cache" to "old-cache", BROWSER_LOGIN_SLOT to "device-proof")
        val preferences = storage(values)
        clearNativeAccountSessionStorage(preferences)
        assertEquals(mapOf(BROWSER_LOGIN_SLOT to "device-proof"), values)
        // A second app restart must still be able to resume the same request.
        clearNativeAccountSessionStorage(preferences)
        assertEquals("device-proof", values[BROWSER_LOGIN_SLOT])
    }

    @Test fun ordinarySessionClearRemovesAllSessionState() {
        val values = mutableMapOf("account" to "old-session", "reminder_cache" to "old-cache")
        clearNativeAccountSessionStorage(storage(values))
        assertTrue(values.isEmpty())
    }
}
