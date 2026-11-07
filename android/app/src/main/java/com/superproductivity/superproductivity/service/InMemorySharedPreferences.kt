package com.superproductivity.superproductivity.service

import android.content.SharedPreferences

/**
 * SharedPreferences that never touch disk.
 *
 * Used when the Android Keystore is unusable, so that credentials and the E2EE
 * password are kept for the lifetime of the process only instead of being written to
 * a plaintext file. The WebView re-supplies them on the next foreground sync.
 */
internal class InMemorySharedPreferences : SharedPreferences {
    private val values = HashMap<String, Any>()

    private fun raw(key: String?): Any? = if (key == null) null else values[key]

    @Synchronized
    override fun getAll(): MutableMap<String, *> = HashMap(values)

    @Synchronized
    override fun getString(key: String?, defValue: String?): String? = (raw(key) as? String) ?: defValue

    @Suppress("UNCHECKED_CAST")
    @Synchronized
    override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? =
        (raw(key) as? Set<String>)?.toMutableSet() ?: defValues

    @Synchronized
    override fun getInt(key: String?, defValue: Int): Int = (raw(key) as? Int) ?: defValue

    @Synchronized
    override fun getLong(key: String?, defValue: Long): Long = (raw(key) as? Long) ?: defValue

    @Synchronized
    override fun getFloat(key: String?, defValue: Float): Float = (raw(key) as? Float) ?: defValue

    @Synchronized
    override fun getBoolean(key: String?, defValue: Boolean): Boolean = (raw(key) as? Boolean) ?: defValue

    @Synchronized
    override fun contains(key: String?): Boolean = key != null && values.containsKey(key)

    override fun edit(): SharedPreferences.Editor = InMemoryEditor()

    // Nothing changes behind the caller's back, so there is nothing to notify.
    override fun registerOnSharedPreferenceChangeListener(
        listener: SharedPreferences.OnSharedPreferenceChangeListener?
    ) = Unit

    override fun unregisterOnSharedPreferenceChangeListener(
        listener: SharedPreferences.OnSharedPreferenceChangeListener?
    ) = Unit

    private inner class InMemoryEditor : SharedPreferences.Editor {
        private val pending = HashMap<String, Any?>()
        private var clearFirst = false

        override fun putString(key: String?, value: String?): SharedPreferences.Editor {
            if (key != null) pending[key] = value
            return this
        }

        override fun putStringSet(key: String?, values: MutableSet<String>?): SharedPreferences.Editor {
            if (key != null) pending[key] = values?.toSet()
            return this
        }

        override fun putInt(key: String?, value: Int): SharedPreferences.Editor {
            if (key != null) pending[key] = value
            return this
        }

        override fun putLong(key: String?, value: Long): SharedPreferences.Editor {
            if (key != null) pending[key] = value
            return this
        }

        override fun putFloat(key: String?, value: Float): SharedPreferences.Editor {
            if (key != null) pending[key] = value
            return this
        }

        override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor {
            if (key != null) pending[key] = value
            return this
        }

        // A null value means "remove", matching the platform implementation.
        override fun remove(key: String?): SharedPreferences.Editor {
            if (key != null) pending[key] = null
            return this
        }

        override fun clear(): SharedPreferences.Editor {
            clearFirst = true
            return this
        }

        override fun commit(): Boolean {
            synchronized(this@InMemorySharedPreferences) {
                if (clearFirst) values.clear()
                for ((key, value) in pending) {
                    if (value == null) values.remove(key) else values[key] = value
                }
            }
            return true
        }

        override fun apply() {
            commit()
        }
    }
}
