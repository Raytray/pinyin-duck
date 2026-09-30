package dev.pinyinduck.android.ime

import android.content.Context
import android.content.SharedPreferences
import dev.pinyinduck.android.engine.ScriptType

/**
 * The keyboard's preferences.
 *
 * Small enough that `SharedPreferences` is the right size of tool; the dictionary itself is
 * not a setting, it ships in the APK.
 */
class KeyboardSettings(context: Context) {

    private val preferences: SharedPreferences =
        context.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    /** Which script candidates default to. The keyboard can still toggle it per session. */
    var defaultScript: ScriptType
        get() = ScriptType.valueOf(preferences.getString(KEY_SCRIPT, ScriptType.SIMPLIFIED.name)!!)
        set(value) = preferences.edit().putString(KEY_SCRIPT, value.name).apply()

    private companion object {
        const val NAME = "pinyinduck"
        const val KEY_SCRIPT = "default_script"
    }
}
