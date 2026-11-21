---
status: proposed
---

# Candidate detail data ships as a separate file, linked by entry id

Every CC-CEDICT sense, measure word and tag for all 124k entries comes to about 5.4 MB raw
(2.3 MB gzipped). Putting that into `dictionary.btree` would take the initial web download
from about 4.4 MB to 6.5 MB gzipped, but the initial download must stay at roughly 4.5 MB. We
decided the detail lives in a **sibling file**, byte-identical on web and Android: a header, a
u32 offset table indexed by **entry id**, and records that were parsed at build time. Each B+
tree row carries the list of entry ids it stands for. Web fetches the file in full the first
time someone expands a candidate. Android bundles it uncompressed and mmaps it.

## Considered options

- Extra B+ tree fields that web skips: web downloads the whole tree, so it can't skip fields.
- Sharding the detail file by key range: each first fetch would be faster, but it means more
  files, an index, and more test surface for a first-expand wait of about a second. Revisit
  only if that wait feels bad in practice.
- Keying the detail file by entry key string with its own sorted index: works, but the B+ tree
  format was changing anyway, and an id gives O(1) lookups.

## Consequences

- Entry ids only mean something within one build. Both files carry the same build id, and a
  mismatch counts as a failed load. Never pair a dictionary with a detail file from another
  build.
- Part of speech goes in the detail file, as one more field on each entry record (about
  +128 KB gzipped). An earlier draft planned a third optional file for part of speech and
  example sentences. Examples were deferred to a later effort, and part of speech alone was
  too small to justify its own file, build id check and loader. If examples are added later,
  they can still get that third file.
- Don't "simplify" by merging the detail back into the B+ tree: it breaks the web download
  limit.
