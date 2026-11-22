package dev.pinyinduck.android.engine

import java.io.ByteArrayOutputStream

/**
 * A test-only port of `encodeDetailFile` from `detail-codec.ts`, so the reader's tests can
 * build small files and corrupt them. The app never writes a detail file; the dictionary
 * build does. `DetailCodecTest` pins this writer to the bytes the TypeScript suite pins.
 */
object DetailFileWriter {
    fun encode(
        records: List<DetailRecord>,
        buildId: Int,
    ): ByteArray {
        val body = ByteArrayOutputStream()
        val offsets = ArrayList<Int>()
        val recordsStart = DETAIL_HEADER_SIZE + (records.size + 1) * 4
        for (record in records) {
            offsets.add(recordsStart + body.size())
            body.record(record)
        }
        offsets.add(recordsStart + body.size())

        val out = ByteArrayOutputStream()
        DETAIL_MAGIC.forEach { out.write(it.code) }
        out.write(DETAIL_FORMAT_VERSION)
        out.write(0)
        out.u16(0)
        out.u32(records.size)
        out.u32(buildId)
        offsets.forEach { out.u32(it) }
        out.write(body.toByteArray())
        return out.toByteArray()
    }

    private fun ByteArrayOutputStream.u16(value: Int) {
        write(value and 0xff)
        write((value ushr 8) and 0xff)
    }

    private fun ByteArrayOutputStream.u32(value: Int) {
        for (shift in 0 until 32 step 8) write((value ushr shift) and 0xff)
    }

    private fun ByteArrayOutputStream.varint(value: Int) {
        var rest = value
        while (rest >= 0x80) {
            write((rest and 0x7f) or 0x80)
            rest = rest ushr 7
        }
        write(rest)
    }

    private fun ByteArrayOutputStream.text(value: String) {
        write(value.toByteArray(Charsets.UTF_8))
        write(0)
    }

    private fun ByteArrayOutputStream.crossRef(ref: CrossRef) {
        text(ref.traditional)
        text(ref.simplified)
        text(ref.pinyinNumbers)
    }

    private fun ByteArrayOutputStream.richText(rich: RichText) {
        varint(rich.refs.size)
        text(rich.strings[0])
        rich.refs.forEachIndexed { i, ref ->
            crossRef(ref)
            text(rich.strings[i + 1])
        }
    }

    private fun ByteArrayOutputStream.record(record: DetailRecord) {
        text(record.heading)
        varint(record.senses.size)
        for (sense in record.senses) {
            write(if (sense.proper) 1 else 0)
            richText(sense.text)
        }
        varint(record.tags.size)
        for (tag in record.tags) {
            write(tag.kind.ordinal)
            richText(tag.text)
            text(tag.gloss.orEmpty())
        }
        varint(record.measureWords.size)
        record.measureWords.forEach { crossRef(it) }
        varint(record.partsOfSpeech.size)
        record.partsOfSpeech.forEach { write(it.ordinal) }
    }
}
