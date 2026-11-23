package dev.pinyinduck.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.Placeable
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.pinyinduck.android.engine.Candidate

/*
 * Sentence candidates on the keyboard (#46, decided on #36, variant B of the prototype).
 *
 * A Sentence candidate is drawn as interlinear word blocks, as on web: each word's tone-marked
 * pinyin over its Hanzi over a one-sense gloss. In the strip it takes a double-width slot and
 * shows as many words as fit, then a "+N" chip for the rest and a faded "+fe" chip for pinyin
 * left over; in the Expanded candidate list it is a full-width card whose blocks wrap.
 */

/** The Sentence candidate's slot in the strip. */
const val SENTENCE_SLOT_TAG = "sentenceSlot"

/** The "+N" chip counting the words the strip slot has no room for. */
const val MORE_WORDS_CHIP_TAG = "moreWordsChip"

/** The faded "+fe" chip for the pinyin a partial sentence leaves to compose next. */
const val LEFTOVER_CHIP_TAG = "leftoverChip"

/** The Sentence candidate's card in the Expanded candidate list. */
const val SENTENCE_CARD_TAG = "sentenceCard"

/** Whether this is a Sentence candidate rather than a word. */
val Candidate.isSentence: Boolean get() = words != null

/** Senses in a short gloss are joined with this (see `formatGloss` in core). */
private const val SENSE_SEPARATOR = " / "

/**
 * The gloss drawn under one word of a Sentence candidate: the first sense of its short gloss,
 * with any leading parenthetical ("(loanword)") dropped, so it fits under the word. A sense
 * that is nothing but a parenthetical is kept whole rather than left empty. A port of the web's
 * `wordGloss` (`packages/web/src/sentence/word-gloss.ts`).
 */
internal fun wordGloss(shortGloss: String): String {
    val first = shortGloss.split(SENSE_SEPARATOR)[0].trim()
    return first.replace(LEADING_PARENTHETICAL, "").ifEmpty { first }
}

private val LEADING_PARENTHETICAL = Regex("^\\([^)]*\\)\\s*")

/** What TalkBack says for one word: its Hanzi, reading and gloss. */
internal fun wordDescription(word: Candidate): String =
    listOf(word.hanzi, word.pinyinMarks, wordGloss(word.shortGloss)).filter { it.isNotEmpty() }.joinToString(", ")

/** What TalkBack says for the whole sentence, including the pinyin it leaves to compose. */
internal fun sentenceDescription(sentence: Candidate): String =
    buildString {
        append("Sentence ")
        append(sentence.hanzi)
        append(", ")
        append(sentence.pinyinMarks)
        if (sentence.remainingPinyin.isNotEmpty()) append(", then ${sentence.remainingPinyin}")
    }

/** How one word block is drawn: smaller in the strip, where it has to fit the strip's height. */
private class BlockStyle(
    val pinyin: TextStyle,
    val hanzi: TextStyle,
    val gloss: TextStyle,
    /** The widest a gloss may make its block; a longer gloss is cut short with an ellipsis. */
    val glossCap: Dp,
)

private val STRIP_BLOCK =
    BlockStyle(
        pinyin = TextStyle(fontSize = 9.sp, lineHeight = 10.sp),
        hanzi = TextStyle(fontSize = 15.sp, lineHeight = 17.sp),
        gloss = TextStyle(fontSize = 8.sp, lineHeight = 10.sp),
        glossCap = 44.dp,
    )

private val CARD_BLOCK =
    BlockStyle(
        pinyin = TextStyle(fontSize = 11.sp, lineHeight = 13.sp),
        hanzi = TextStyle(fontSize = 20.sp, lineHeight = 24.sp),
        gloss = TextStyle(fontSize = 10.sp, lineHeight = 12.sp),
        glossCap = 84.dp,
    )

/** The space between word blocks, and between the last of them and a chip. */
private val BLOCK_SPACING = 3.dp

/**
 * One word: pinyin over Hanzi over its gloss, centred in a column as wide as the wider of the
 * pinyin and the Hanzi, or the gloss up to [BlockStyle.glossCap].
 */
@Composable
private fun WordBlock(
    word: Candidate,
    selected: Boolean,
    style: BlockStyle,
    modifier: Modifier = Modifier,
) {
    Layout(
        modifier = modifier,
        content = {
            Text(text = word.pinyinMarks, color = DuckColors.SecondaryText, style = style.pinyin, maxLines = 1)
            Text(
                text = word.hanzi,
                color = if (selected) DuckColors.Accent else DuckColors.PrimaryText,
                style = style.hanzi,
                maxLines = 1,
            )
            Text(
                text = wordGloss(word.shortGloss),
                color = DuckColors.SecondaryText,
                style = style.gloss,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
            )
        },
    ) { measurables, constraints ->
        val loose = Constraints(maxWidth = constraints.maxWidth)
        val pinyin = measurables[0].measure(loose)
        val hanzi = measurables[1].measure(loose)
        val gloss = measurables[2].measure(Constraints(maxWidth = minOf(style.glossCap.roundToPx(), constraints.maxWidth)))
        val width = maxOf(pinyin.width, hanzi.width, gloss.width)
        val height = pinyin.height + hanzi.height + gloss.height
        layout(width, height) {
            pinyin.place((width - pinyin.width) / 2, 0)
            hanzi.place((width - hanzi.width) / 2, pinyin.height)
            gloss.place((width - gloss.width) / 2, pinyin.height + hanzi.height)
        }
    }
}

/** A small rounded label: the "+N" count, or the faded leftover pinyin. */
@Composable
private fun Chip(
    text: String,
    faded: Boolean,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        color = DuckColors.SecondaryText.copy(alpha = if (faded) 0.6f else 1f),
        fontSize = 10.sp,
        lineHeight = 12.sp,
        fontStyle = if (faded) FontStyle.Italic else FontStyle.Normal,
        maxLines = 1,
        modifier =
            modifier
                .clip(RoundedCornerShape(8.dp))
                .background(DuckColors.SpecialKey)
                .padding(horizontal = 4.dp, vertical = 1.dp),
    )
}

/** How many of [widths], from the first, fit in [available] with [spacing] between them. */
internal fun wordsThatFit(
    widths: List<Int>,
    spacing: Int,
    available: Int,
): Int {
    var used = 0
    widths.forEachIndexed { i, width ->
        used += width + if (i > 0) spacing else 0
        if (used > available) return i
    }
    return widths.size
}

/**
 * The strip slot's content: as many word blocks as fit, then the chips.
 *
 * Room for both chips is taken before any word is fitted, which is what the prototype got
 * wrong: it fitted two words first and the leftover chip was clipped off the slot's end. The
 * leftover chip's width is known up front; the "+N" chip's depends on how many words fit, so
 * the widest it can be, "+<all the words>", is reserved instead. It is only reserved when the
 * words do not all fit beside the leftover chip, since then there is no "+N" to show.
 */
@Composable
private fun FittedWordBlocks(
    sentence: Candidate,
    selected: Boolean,
    modifier: Modifier = Modifier,
) {
    val words = sentence.words.orEmpty()
    val leftover = sentence.remainingPinyin
    SubcomposeLayout(modifier) { constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val spacing = BLOCK_SPACING.roundToPx()
        val leftoverChip =
            if (leftover.isEmpty()) {
                null
            } else {
                subcompose("leftover") {
                    Chip("+$leftover", faded = true, modifier = Modifier.testTag(LEFTOVER_CHIP_TAG))
                }.single().measure(loose)
            }
        val blocks =
            words.mapIndexed { i, word ->
                subcompose("word$i") { WordBlock(word, selected, STRIP_BLOCK) }.single().measure(loose)
            }
        val widths = blocks.map { it.width }
        val forWords = constraints.maxWidth - (leftoverChip?.let { it.width + spacing } ?: 0)

        var shown = wordsThatFit(widths, spacing, forWords)
        var moreChip: Placeable? = null
        if (shown < words.size) {
            val widest = subcompose("moreReserve") { Chip("+${words.size}", faded = false) }.single().measure(loose)
            shown = wordsThatFit(widths, spacing, forWords - widest.width - spacing)
            moreChip =
                subcompose("more") {
                    Chip("+${words.size - shown}", faded = false, modifier = Modifier.testTag(MORE_WORDS_CHIP_TAG))
                }.single().measure(loose)
        }

        val placed = blocks.take(shown) + listOfNotNull(moreChip, leftoverChip)
        val height = if (constraints.hasBoundedHeight) constraints.maxHeight else placed.maxOfOrNull { it.height } ?: 0
        val width = (placed.sumOf { it.width } + spacing * (placed.size - 1).coerceAtLeast(0)).coerceAtMost(constraints.maxWidth)
        layout(width, height) {
            var x = 0
            placed.forEach {
                it.place(x, (height - it.height) / 2)
                x += it.width + spacing
            }
        }
    }
}

/**
 * The Sentence candidate in the paged strip: a double-width slot beside the word candidates.
 *
 * A tap commits what it covers; a long press opens the Expanded candidate list, where nothing
 * is cut short (#36). TalkBack users get the Candidate detail directly as a custom action,
 * since a timed press to reach the list and then a second press is not discoverable.
 */
@Composable
internal fun RowScope.SentenceStripSlot(
    sentence: Candidate,
    index: Int,
    selected: Boolean,
    onClick: () -> Unit,
    onShowAll: () -> Unit,
    onShowDetail: () -> Unit,
) = DetailLongPressTimeout {
    Box(
        modifier =
            Modifier
                .weight(2f)
                .fillMaxHeight()
                .testTag(SENTENCE_SLOT_TAG)
                .clip(RoundedCornerShape(6.dp))
                .background(if (selected) DuckColors.Accent.copy(alpha = 0.18f) else DuckColors.Key)
                .semantics {
                    contentDescription = sentenceDescription(sentence)
                    customActions =
                        listOf(
                            CustomAccessibilityAction("Show details") {
                                onShowDetail()
                                true
                            },
                        )
                }.detailAnchor(index)
                .combinedClickable(onLongClickLabel = "Show all candidates", onLongClick = onShowAll, onClick = onClick)
                .padding(horizontal = 4.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        FittedWordBlocks(sentence, selected)
    }
}

/**
 * The Sentence candidate in the Expanded candidate list: a full-width card, its blocks
 * wrapping onto more rows. A tap anywhere commits it. A long press on one word's block opens
 * the Candidate detail at that word; anywhere else on the card, from the top.
 */
@Composable
internal fun SentenceCard(
    sentence: Candidate,
    index: Int,
    selected: Boolean,
    onClick: () -> Unit,
    onShowDetail: () -> Unit,
    onShowWordDetail: (Int) -> Unit,
) = DetailLongPressTimeout {
    FlowRow(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(3.dp)
                .testTag(SENTENCE_CARD_TAG)
                .clip(RoundedCornerShape(8.dp))
                .background(if (selected) DuckColors.Accent.copy(alpha = 0.16f) else DuckColors.Key)
                .semantics {
                    contentDescription = sentenceDescription(sentence)
                    customActions =
                        listOf(
                            CustomAccessibilityAction("Show details") {
                                onShowDetail()
                                true
                            },
                        )
                }.detailAnchor(index)
                .combinedClickable(onLongClickLabel = "Show details", onLongClick = onShowDetail, onClick = onClick)
                .padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        sentence.words.orEmpty().forEachIndexed { i, word ->
            WordBlock(
                word = word,
                selected = selected,
                style = CARD_BLOCK,
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(5.dp))
                        .semantics { contentDescription = wordDescription(word) }
                        .combinedClickable(
                            onLongClickLabel = "Show details for ${word.hanzi}",
                            onLongClick = { onShowWordDetail(i) },
                            onClick = onClick,
                        ).padding(horizontal = 2.dp, vertical = 1.dp),
            )
        }
        if (sentence.remainingPinyin.isNotEmpty()) LeftoverBlock(sentence.remainingPinyin, Modifier.align(Alignment.CenterVertically))
    }
}

/** The pinyin a partial sentence leaves over, faded and underlined, labelled "next" as on web. */
@Composable
private fun LeftoverBlock(
    leftover: String,
    modifier: Modifier = Modifier,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier.semantics { contentDescription = "then $leftover" },
    ) {
        Text(
            text = leftover,
            color = DuckColors.SecondaryText.copy(alpha = 0.7f),
            fontSize = 16.sp,
            modifier =
                Modifier.drawBehind {
                    drawLine(
                        DuckColors.SecondaryText.copy(alpha = 0.6f),
                        Offset(0f, size.height),
                        Offset(size.width, size.height),
                        strokeWidth = 1.5f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 5f)),
                    )
                },
        )
        Text(text = "next", color = DuckColors.SecondaryText.copy(alpha = 0.6f), fontSize = 9.sp)
    }
}
