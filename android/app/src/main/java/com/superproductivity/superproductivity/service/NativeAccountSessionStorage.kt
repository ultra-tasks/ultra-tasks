package com.superproductivity.superproductivity.service

import android.content.SharedPreferences

internal const val BROWSER_LOGIN_SLOT = "pending_browser_login"

/** Session teardown must not erase the independent proof needed to resume browser sign-in. */
internal fun clearNativeAccountSessionStorage(storage: SharedPreferences) {
    val pending = storage.getString(BROWSER_LOGIN_SLOT, null)
    val edit = storage.edit().clear()
    if (pending != null) edit.putString(BROWSER_LOGIN_SLOT, pending)
    check(edit.commit())
}
