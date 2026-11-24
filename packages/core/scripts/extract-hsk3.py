"""Extracts the HSK 3.0 word levels from the official syllabus PDF.

Writes `packages/core/data/hsk3-levels.tsv`: one (word, reading, level) row per word at a
reading, with the reading exactly as the syllabus prints it, tone sandhi included. Levels are
1-6, and 7 for the 7-9 band. Nothing else from the PDF is kept: no part of speech, row
numbers or layout.

The source is 《中文水平考试 HSK 考试大纲》 (中外语言交流合作中心, 2025-11), whose vocabulary
table is on PDF pages 80-354. The dictionary build never runs this script; it reads only the
committed TSV, pinned by SHA-256 in `sources.ts`. Run it by hand, with PyMuPDF installed
(`pip install pymupdf`):

    curl -L -o syllabus.pdf "<URL below>"
    python packages/core/scripts/extract-hsk3.py syllabus.pdf packages/core/data/hsk3-levels.tsv

It refuses a PDF whose SHA-256 is not the one pinned below, and refuses to write anything
unless the table yields exactly ROWS rows, so a different file or a layout it misreads fails
loudly instead of changing the levels.

To move to a new edition of the syllabus:
  1. Update URL, SHA256, EDITION, FIRST_PAGE/LAST_PAGE and ROWS below. Check COLUMNS against
     the new table's layout, and that every sequence number parses (the script lists any row
     it cannot read).
  2. Run the script, then update the TSV's `sha256` in `sources.ts`.
  3. Rebuild the dictionary and the parity goldens (the steps in `sources.ts`), and update the
     pinned unattached rows in `build-dictionary.test.ts`, the credits (DATA_LICENSES.md, the
     web Credits dialog, the Android settings screen, the Rime dict header) and
     `packages/core/data/README.md`.
"""

import collections
import hashlib
import re
import sys

import pymupdf

URL = "https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf"
SHA256 = "d8b6646599bc9a0c9616a4cb06d4b37461f8792f70a3171016d00fcd8eda09ad"
EDITION = "《中文水平考试 HSK 考试大纲》 (中外语言交流合作中心,\n# 2025-11)"
FIRST_PAGE, LAST_PAGE = 80, 354
# The table's 11,000 numbered rows, after the reduction described in `reduce`.
SEQUENCE_NUMBERS = 11000
ROWS = 10961
# x ranges of the five columns: 序号 | 等级 | 词语 | 拼音 | 词性
COLUMNS = [(0, 120, "seq"), (120, 205, "level"), (215, 310, "word"), (310, 435, "pinyin"), (435, 999, "pos")]
WORD = re.compile(r"[㐀-鿿〇…·]+")


def table_rows(doc):
    """Yields (page number, {column: text}) for each row of the vocabulary table."""
    for page_number in range(FIRST_PAGE, LAST_PAGE + 1):
        cells = collections.defaultdict(lambda: collections.defaultdict(list))
        for block in doc[page_number - 1].get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                if abs(line["dir"][1]) > 0.01:  # the rotated 汉考国际 watermark
                    continue
                for span in line["spans"]:
                    text = span["text"].strip()
                    # Headers, footers and page numbers are set in other sizes.
                    if not text or not 11 <= span["size"] <= 12.5:
                        continue
                    x0, _, x1, _ = span["bbox"]
                    # The narrow left columns are centred; the others are left-aligned.
                    x = (x0 + x1) / 2 if x0 < 215 else x0
                    column = next(name for start, end, name in COLUMNS if start <= x < end)
                    cells[round(span["origin"][1])][column].append((x0, text))
        # A wrapped cell sets its lines on baselines a few points apart: merge baselines
        # within 4pt into one table row.
        groups = []
        for y in sorted(cells):
            if groups and y - groups[-1][0] <= 4:
                for column, spans in cells[y].items():
                    groups[-1][1][column] += spans
            else:
                groups.append([y, collections.defaultdict(list, {c: list(s) for c, s in cells[y].items()})])
        for _, group in groups:
            row = {name: "".join(text for _, text in sorted(group[name])) for _, _, name in COLUMNS}
            # A stray number in the word column on its own is a footnote mark, not a row.
            if not row["seq"] and not row["level"] and row["word"].isdigit() and not row["pinyin"]:
                continue
            yield page_number, row


def reduce(doc):
    """
    Reduces the table to {(word, reading): level}, returning it with the sequence numbers
    seen and the rows that could not be read.

    The level is the first number of 等级 (`2（4）` is 2, `7-9` is 7). Homograph digits are
    stripped (本1, 本2 are both 本), a cell with two readings (谁 shéi/shuí) gives a row
    for each, and a (word, reading) listed more than once keeps its lowest level.
    """
    sequence_numbers, problems, levels = [], [], {}
    for page_number, row in table_rows(doc):
        try:
            sequence_numbers.append(int(row["seq"]))
        except ValueError:
            problems.append((page_number, row))
            continue
        level = re.match(r"(7-9|[1-6])", row["level"])
        word = re.sub(r"\d+$", "", row["word"])
        if not level or not row["pinyin"] or not WORD.fullmatch(word):
            problems.append((page_number, row))
            continue
        level = 7 if level.group(1) == "7-9" else int(level.group(1))
        for reading in row["pinyin"].split("/"):
            key = (word, reading.strip())
            levels[key] = min(level, levels.get(key, level))
    return levels, sequence_numbers, problems


def main(pdf_path, out_path):
    raw = open(pdf_path, "rb").read()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != SHA256:
        sys.exit(f"{pdf_path} has SHA-256 {digest}, not the pinned {SHA256}. See the docstring to move to a new edition.")

    levels, sequence_numbers, problems = reduce(pymupdf.open(stream=raw, filetype="pdf"))
    missing = sorted(set(range(1, SEQUENCE_NUMBERS + 1)) - set(sequence_numbers))
    if problems or missing or len(levels) != ROWS:
        for page_number, row in problems[:20]:
            print(f"  unread row on page {page_number}: {row}", file=sys.stderr)
        sys.exit(
            f"Expected {ROWS} rows from sequence numbers 1-{SEQUENCE_NUMBERS}; got {len(levels)}, "
            f"{len(problems)} unread rows, missing sequence numbers {missing[:10]}."
        )

    with open(out_path, "w", encoding="utf-8", newline="\n") as out:
        out.write(f"# HSK 3.0 word levels, reduced from {EDITION} by packages/core/scripts/extract-hsk3.py.\n")
        out.write("# Do not edit by hand.\n#\n")
        out.write(f"# source {URL}\n# sha256 {digest}\n#\n")
        out.write("# Columns: word, reading (as printed, with tone sandhi), level (1-6; 7 means the 7-9 band).\n")
        out.write("# Homograph digits are stripped and duplicates keep the lowest level; a/b double\n")
        out.write("# readings become two rows. No part of speech, row numbers or layout are kept.\n")
        for (word, reading), level in sorted(levels.items(), key=lambda item: (item[1], item[0])):
            out.write(f"{word}\t{reading}\t{level}\n")
    print(f"wrote {len(levels)} rows to {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: python extract-hsk3.py <syllabus.pdf> <out.tsv>")
    main(sys.argv[1], sys.argv[2])
