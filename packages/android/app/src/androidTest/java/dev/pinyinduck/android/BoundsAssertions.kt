package dev.pinyinduck.android

import android.graphics.Rect

/*
 * Assertions on on-screen bounds (`UiObject2.visibleBounds`), in screen pixels. Each failure
 * message prints every rect involved, so a layout regression reads as a diff of positions.
 */

/** A rect on screen with the label the failure message uses for it. */
class LabelledBounds(
    val label: String,
    val rect: Rect,
) {
    override fun toString() = "$label ${rect.toShortString()}"
}

/** Fails unless [inner] lies fully inside [outer]. */
fun assertInside(
    inner: LabelledBounds,
    outer: LabelledBounds,
) {
    if (!outer.rect.contains(inner.rect)) failTest("$inner is not inside $outer")
}

/**
 * Fails unless [rects], taken left to right, don't overlap in x: each one ends at or before
 * the next one starts.
 */
fun assertNoOverlapInX(rects: List<LabelledBounds>) {
    val sorted = rects.sortedBy { it.rect.left }
    sorted.zipWithNext().forEach { (left, right) ->
        if (left.rect.right > right.rect.left) {
            failTest("$left overlaps $right in x. All of them: ${sorted.joinToString()}")
        }
    }
}

/** Fails if any two of [rects] overlap. Rects that only share an edge don't overlap. */
fun assertNoOverlap(rects: List<LabelledBounds>) {
    rects.forEachIndexed { i, a ->
        rects.drop(i + 1).forEach { b ->
            if (Rect.intersects(a.rect, b.rect)) failTest("$a overlaps $b. All of them: ${rects.joinToString()}")
        }
    }
}

/** Fails unless [actual] has the same top edge and height as [expected], to the pixel. */
fun assertSameTopAndHeight(
    expected: LabelledBounds,
    actual: LabelledBounds,
) {
    if (actual.rect.top != expected.rect.top || actual.rect.height() != expected.rect.height()) {
        failTest(
            "Top and height differ: $expected (top ${expected.rect.top}, height " +
                "${expected.rect.height()}) but $actual (top ${actual.rect.top}, height ${actual.rect.height()})",
        )
    }
}

/** [rect] shrunk by [dx] on the left and right. */
fun insetX(
    rect: Rect,
    dx: Int,
): Rect = Rect(rect.left + dx, rect.top, rect.right - dx, rect.bottom)
