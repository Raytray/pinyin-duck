package dev.pinyinduck.android.engine

/**
 * Reader for the Candidate detail file (ADR 0002), the sibling of `dictionary.btree`.
 *
 * A port of `packages/core/src/detail/detail-codec.ts`, which documents the layout and is the
 * only writer. Both platforms ship the same bytes; this reader is held to them by
 * `DetailCodecTest`, which reads the bytes the TypeScript suite pins.
 *
 * ```
 * header (16 bytes) | offset table ((entryCount + 1) * u32) | records
 * ```
 *
 * The header is magic "PDDT", a u8 format version, three reserved bytes, a u32 entryCount and
 * the u32 buildId shared with `dictionary.btree`. Entry `i`'s record runs from `offset[i]` to
 * `offset[i + 1]`, absolute offsets into the file, so a record is found by entry id in O(1)
 * and opening the file reads only its header.
 */

const val DETAIL_MAGIC = "PDDT"
const val DETAIL_FORMAT_VERSION = 1
const val DETAIL_HEADER_SIZE = 16

/**
 * A reference to another headword, stored structured so it renders in the active script.
 * A pronunciation alone (`also pr. [pou1]`) has empty Hanzi; a reference with no reading has
 * an empty [pinyinNumbers], which keeps CC-CEDICT's capitalisation.
 */
data class CrossRef(
    val traditional: String,
    val simplified: String,
    val pinyinNumbers: String,
)

/**
 * Text with embedded cross-references: [strings] has one more element than [refs], and the
 * text reads `strings[0] refs[0] strings[1] ... refs[n-1] strings[n]`.
 */
data class RichText(
    val strings: List<String>,
    val refs: List<CrossRef> = emptyList(),
)

/** One sense of an entry. A proper noun sense comes from a capitalised CC-CEDICT line. */
data class DetailSense(
    val proper: Boolean,
    val text: RichText,
)

/** The tags pulled out of CC-CEDICT senses, in code order, with the label a UI shows. */
enum class TagKind(
    val label: String,
) {
    SURNAME("Surname"),
    VARIANT("Variant of"),
    OLD_VARIANT("Old variant of"),
    ERHUA_VARIANT("Erhua variant of"),
    ABBREVIATION("Abbreviation for"),
    ALSO_WRITTEN("Also written"),
    ALSO_PRONOUNCED("Also pronounced"),
    TAIWAN_PRONOUNCED("Taiwan pronunciation"),
}

data class DetailTag(
    val kind: TagKind,
    /** What follows the tag's prefix: `念[nian4]` in `variant of 念[nian4]`. */
    val text: RichText,
    /** For a variant tag, a gloss of the target; null otherwise. */
    val gloss: String? = null,
)

/**
 * The learner labels a part of speech maps to, in code order. New labels go on the end in
 * `detail-codec.ts` and here together, so existing codes keep their meaning.
 */
enum class PartOfSpeech(
    val label: String,
) {
    NOUN("noun"),
    VERB("verb"),
    ADJECTIVE("adjective"),
    ADVERB("adverb"),
    PRONOUN("pronoun"),
    NUMERAL("numeral"),
    MEASURE_WORD("measure word"),
    PREPOSITION("preposition"),
    CONJUNCTION("conjunction"),
    PARTICLE("particle"),
    INTERJECTION("interjection"),
    IDIOM("idiom"),
}

/** Everything the Candidate detail shows about one entry. */
data class DetailRecord(
    /** The entry's traditional form when it heads a group of headwords; empty otherwise. */
    val heading: String,
    /** Common senses first, then proper noun senses, each in file order. */
    val senses: List<DetailSense>,
    val tags: List<DetailTag>,
    /** In first-seen order. */
    val measureWords: List<CrossRef>,
    val partsOfSpeech: List<PartOfSpeech>,
)

/**
 * A detail file built with a different dictionary than the one it was opened against.
 * Entry ids mean nothing across builds, so this is a failed load (ADR 0002).
 */
class DetailBuildMismatchException(
    val detailBuildId: Int,
    val dictionaryBuildId: Int,
) : DictionaryFormatException(
        "The Candidate detail file comes from build ${hex(detailBuildId)}, but the dictionary " +
            "from build ${hex(dictionaryBuildId)}",
    )

private fun hex(id: Int): String = "%08x".format(id)

private const val MALFORMED = "The Candidate detail file is malformed or truncated"

private fun malformed(reason: String) = DictionaryFormatException("$MALFORMED ($reason)")

/**
 * A read-only Candidate detail file over a [PageSource], checked against its dictionary's
 * build id. Records are decoded on demand; nothing but the header is read when opening.
 */
class DetailFile private constructor(
    private val source: PageSource,
    val entryCount: Int,
    val buildId: Int,
) {
    /** The record of entry [id]. */
    fun record(id: Int): DetailRecord {
        require(id in 0 until entryCount) { "The Candidate detail file holds no entry $id" }
        val offsets = ByteReader(source.read(DETAIL_HEADER_SIZE + id * 4, 8))
        val start = offsets.u32()
        val end = offsets.u32()
        if (start > end) throw malformed("entry $id ends before it starts")
        return try {
            readRecord(ByteReader(source.read(start, end - start)))
        } catch (error: DictionaryFormatException) {
            if ("${error.message}".startsWith("The Candidate detail file")) throw error
            throw malformed("${error.message}")
        } catch (error: IndexOutOfBoundsException) {
            // A count that runs past the record's end reads off the end of its buffer.
            throw malformed("entry $id runs past its end")
        }
    }

    companion object {
        /**
         * Opens [source], refusing it unless it was built with the dictionary whose build id
         * is [expectedBuildId].
         *
         * @throws DetailBuildMismatchException when the builds differ.
         * @throws DictionaryFormatException when the file is not a readable detail file.
         */
        fun open(
            source: PageSource,
            expectedBuildId: Int,
        ): DetailFile {
            if (source.size < DETAIL_HEADER_SIZE) throw malformed("the header is truncated")
            val header = ByteReader(source.read(0, DETAIL_HEADER_SIZE))
            val magic = buildString { repeat(DETAIL_MAGIC.length) { append(header.u8().toChar()) } }
            if (magic != DETAIL_MAGIC) throw malformed("the payload is not a PinyinDuck Candidate detail file")
            val version = header.u8()
            if (version != DETAIL_FORMAT_VERSION) {
                throw DictionaryFormatException(
                    "The Candidate detail file was built with format $version, but this reader " +
                        "expects $DETAIL_FORMAT_VERSION",
                )
            }
            header.u8()
            header.u16()
            val entryCount = header.u32()
            val buildId = header.u32()
            if (buildId != expectedBuildId) throw DetailBuildMismatchException(buildId, expectedBuildId)
            val tableEnd = DETAIL_HEADER_SIZE + (entryCount.toLong() and 0xFFFFFFFFL) * 4 + 4
            // Unsigned, so a count past 2^31 is a table larger than any file rather than negative.
            if (tableEnd > source.size) throw malformed("the offset table is truncated")
            // Records are written in id order, so the last offset bounds them all.
            // (Read as a u32, so an offset past 2 GiB comes back negative.)
            val last = ByteReader(source.read(DETAIL_HEADER_SIZE + entryCount * 4, 4)).u32()
            if (last < 0 || last > source.size) throw malformed("the records are truncated")
            return DetailFile(source, entryCount, buildId)
        }
    }
}

/** A count of items that follow, each at least a byte, so one larger than what is left is corrupt. */
private fun ByteReader.count(): Int {
    val count = varint()
    if (count < 0 || count > remaining) throw malformed("a count runs past the end of its record")
    return count
}

private fun ByteReader.crossRef() = CrossRef(zeroTerminatedString(), zeroTerminatedString(), zeroTerminatedString())

private fun ByteReader.richText(): RichText {
    val refCount = count()
    val strings = ArrayList<String>(refCount + 1)
    val refs = ArrayList<CrossRef>(refCount)
    strings.add(zeroTerminatedString())
    repeat(refCount) {
        refs.add(crossRef())
        strings.add(zeroTerminatedString())
    }
    return RichText(strings, refs)
}

private fun readRecord(reader: ByteReader): DetailRecord {
    val heading = reader.zeroTerminatedString()
    val senses =
        List(reader.count()) {
            val kind = reader.u8()
            if (kind > 1) throw malformed("unknown sense kind $kind")
            DetailSense(proper = kind == 1, text = reader.richText())
        }
    val tags =
        List(reader.count()) {
            val code = reader.u8()
            val kind = TagKind.entries.getOrNull(code) ?: throw malformed("unknown tag kind $code")
            val text = reader.richText()
            val gloss = reader.zeroTerminatedString()
            DetailTag(kind, text, gloss.ifEmpty { null })
        }
    val measureWords = List(reader.count()) { reader.crossRef() }
    val partsOfSpeech =
        List(reader.count()) {
            val code = reader.u8()
            PartOfSpeech.entries.getOrNull(code) ?: throw malformed("unknown part of speech $code")
        }
    return DetailRecord(heading, senses, tags, measureWords, partsOfSpeech)
}
