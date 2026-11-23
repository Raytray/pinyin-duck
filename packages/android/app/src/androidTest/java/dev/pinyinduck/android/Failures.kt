package dev.pinyinduck.android

/**
 * Fails the test with [message]. Like `org.junit.Assert.fail`, but typed as [Nothing] so it
 * can end an elvis chain, and named apart from it so neither shadows the other.
 */
fun failTest(message: String): Nothing = throw AssertionError(message)
