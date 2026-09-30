package dev.pinyinduck.android.ime

import dev.pinyinduck.android.engine.DictionaryFormatException
import java.io.FileNotFoundException

/**
 * Turns a dictionary failure into something a user can act on.
 *
 * A keyboard cannot show a stack trace, so the failure a learner sees has to name the thing
 * that is actually wrong and the command that fixes it. Separating this from the service
 * also keeps it testable: these strings are the app's only user-facing error reporting.
 */
object DictionaryErrors {

    /** What to show when the asset could not be opened or decoded. */
    fun describe(error: Throwable): String = when {
        // `openFd` reports a compressed asset this way. It is a build-configuration mistake
        // rather than a missing file, so it names the setting that caused it.
        error is FileNotFoundException && error.message?.contains("compressed") == true ->
            "The dictionary asset is compressed. It must ship uncompressed to be mmapped; " +
                "check the noCompress setting in app/build.gradle.kts."

        error is FileNotFoundException ->
            "dictionary.btree is missing from the app. Run \"npm run build:dict\" at the " +
                "repository root and rebuild."

        error is DictionaryFormatException ->
            "The dictionary is unreadable (${error.message}). " +
                "Run \"npm run build:dict\" to regenerate it."

        // An unrecognised failure still gets a next step, because on a phone the reader has
        // no way to work out which of the above causes applied.
        else ->
            "The dictionary could not be opened: " +
                "${error.message ?: error.javaClass.simpleName}. " +
                "Reinstall the app, or run \"npm run build:dict\" at the repository root."
    }

    /** The message shown for a failure with no detail of its own. */
    fun forUnreadableAsset(): String =
        "The dictionary is unreadable. Run \"npm run build:dict\" to regenerate it."
}
