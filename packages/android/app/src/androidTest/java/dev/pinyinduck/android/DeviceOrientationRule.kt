package dev.pinyinduck.android

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.rules.ExternalResource

/**
 * Lets a test rotate the device to landscape and always puts it back to portrait afterwards,
 * pass or fail, so one test's rotation never leaks into the next.
 *
 * Call [landscape] first in a test, before opening the field: rotating re-creates the
 * activity, which would drop a keyboard that is already shown.
 */
class DeviceOrientationRule : ExternalResource() {
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    fun landscape() {
        device.setOrientationLandscape()
        device.waitForIdle()
    }

    override fun after() {
        device.setOrientationPortrait()
        device.unfreezeRotation()
        device.waitForIdle()
    }
}
