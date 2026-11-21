---
status: proposed
---

# An entry is keyed by headword (traditional + simplified) plus reading, ignoring case

The dictionary build used to key entries by simplified form plus lowercased pinyin. That
silently merged different headwords that share a simplified form, keeping whichever came first
in CC-CEDICT: 後 hòu "behind" was dropped entirely in favour of 后 hòu "empress". It also let a
proper-noun line win over the common one (书 shū was glossed "abbr. for 书经"). We decided an
**entry** is (traditional, simplified, reading ignoring case). Different headwords stay apart,
and capitalised proper-noun lines merge into the common entry as proper noun senses. This came
out of the Candidate detail work, which needs every sense of an entry in one place.

## Consequences

- In simplified script, one candidate (后 hòu) can stand for several entries (後, 后). Its
  short gloss joins the first sense of each headword, and its Candidate detail groups senses by
  headword, ordered by number of senses because frequency data is keyed by simplified form.
- The traditional-script dictionaries gain headwords they were missing, such as 後 hòu.
- Keying by simplified form only would look simpler, but it reintroduces the dropped-headword
  bug. Don't "simplify" the key back.
