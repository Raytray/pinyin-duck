package dev.pinyinduck.android.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Asserts the Kotlin Candidate detail view reproduces the TypeScript one exactly.
 *
 * `detail-parity.tsv` is written by `packages/core/scripts/generate-android-parity.ts` from
 * the real dictionary and detail file, through `candidateDetail` in `detail-view.ts`. Each
 * record names a B+ tree row; this test finds that row in the real dictionary, renders its
 * detail from the real detail file, and compares the lines. See `detail-parity.ts` for the
 * line format.
 */
class DetailViewParityTest {
    private data class GoldenView(
        val simplified: String,
        val traditional: String,
        val pinyinNumbers: String,
        val script: ScriptType,
        val entryCount: Int,
        val lines: List<String>,
    )

    @Test
    fun matchesTheTypeScriptDetailViewExactly() {
        val views = parseGolden()

        assertTrue("The golden file pinned no views", views.size > 500)
        assertTrue("The golden pins no grouped candidate", views.any { it.entryCount > 1 })
        assertTrue("The golden pins no traditional view", views.any { it.script == ScriptType.TRADITIONAL })
        for (view in views) {
            val label = "${view.simplified} ${view.traditional} ${view.pinyinNumbers} (${view.script})"
            val row = rowFor(view)
            val actual = viewLines(candidateDetail(DetailSubject.of(row), view.script, TestDictionary.detail))
            assertEquals("detail of $label", view.lines, actual)
        }
    }

    /** The one B+ tree row the golden record names. */
    private fun rowFor(view: GoldenView): StoredEntry {
        val rows =
            TestDictionary.dictionary.lookupExact(cleanPinyin(view.pinyinNumbers)).filter {
                it.simplified == view.simplified &&
                    it.traditional == view.traditional &&
                    it.pinyinNumbers == view.pinyinNumbers &&
                    it.entryIds.size == view.entryCount
            }
        assertEquals("rows named by ${view.simplified} ${view.traditional} ${view.pinyinNumbers}", 1, rows.size)
        return rows.single()
    }

    /** The lines `detail-parity.ts` writes for a view, after the ">" header. */
    private fun viewLines(view: DetailView): List<String> =
        buildList {
            view.counterpart?.let { add("counterpart\t$it") }
            for (group in view.groups) {
                add(group.heading?.let { "group\t$it" } ?: "group")
                group.partOfSpeech?.let { add("pos\t$it") }
                group.tags.forEach { add("tag\t$it") }
                group.senses.forEach { add("${if (it.proper) "proper" else "sense"}\t${it.number}\t${it.text}") }
                group.measureWords.forEach { add("mw\t$it") }
            }
        }

    private fun parseGolden(): List<GoldenView> {
        val loader = checkNotNull(javaClass.classLoader) { "The test class loader is unavailable" }
        val stream =
            checkNotNull(loader.getResourceAsStream(GOLDEN_RESOURCE)) {
                "$GOLDEN_RESOURCE is missing. Run \"npm run build:parity\"."
            }
        val views = mutableListOf<GoldenView>()
        var header: List<String>? = null
        val lines = mutableListOf<String>()

        fun flush() {
            val fields = header ?: return
            views.add(
                GoldenView(
                    simplified = fields[0],
                    traditional = fields[1],
                    pinyinNumbers = fields[2],
                    script = ScriptType.valueOf(fields[3].uppercase()),
                    entryCount = fields[4].toInt(),
                    lines = lines.toList(),
                ),
            )
            header = null
            lines.clear()
        }

        stream.bufferedReader().use { reader ->
            reader.forEachLine { line ->
                when {
                    line.startsWith("#") -> Unit
                    line.isEmpty() -> flush()
                    line.startsWith(">") -> {
                        flush()
                        header = line.removePrefix(">").split("\t")
                    }
                    else -> lines.add(line)
                }
            }
        }
        flush()
        return views
    }

    private companion object {
        const val GOLDEN_RESOURCE = "detail-parity.tsv"
    }
}
