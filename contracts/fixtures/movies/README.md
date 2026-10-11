# Movies fixture

A frozen, deterministic corpus for the search cases: 15 movies with fixed IDs
(`_id` equals `tmdb_id`), loaded into a fresh index with `refresh=true` before
the `search` group runs. Nothing here comes from an external service.

`mapping.json` is the movie-search application's explicit mapping: an English
analyzer (possessive stemmer, lowercase, ASCII folding, stop words, stemmer)
on the text fields, `keyword` genres and IDs, numeric popularity and rating,
and a `completion` sub-field for suggestions. No dynamic mapping is relied on.

## Why each document is here

| `_id` | Title | Purpose |
| --- | --- | --- |
| 557, 559 | Spider-Man, Spider-Man 3 | Phrase `"spider man"` across the hyphen; suggestion `spi`. |
| 634649 | Spider-Man: No Way Home | Phrase in title and overview; punctuation in titles; `adventure` only in `content`. |
| 315635 | Spider-Man: Homecoming | Excluded by `-Homecoming` although it matches the phrase. |
| 907001 | Night Watch | Mentions Spider-Man and Homecoming only in the overview. |
| 2001 | Homecoming Weekend | Matches only the excluded term. |
| 1001 | Spaceballs | `space` only (OR versus AND); `Spaceballs` is not the token `space`. |
| 1002 | The Adventure Begins | `adventure` only. |
| 1003 | Space Adventure | Both terms; the only Science Fiction space movie. |
| 24428 | The Avengers | Fuzzy match `avengrs~2`. |
| 194 | Amélie | Accent folding (`amelie`) and highlighting of the original text. |
| 1006 | Animation Wonders | Prefix `anim*` (title and stemmed overview). |
| 1005 | Spider Horror | `spider-like` must not match the phrase; excluded by `-horror`. |
| 999 | Quiet Harbor | Rating exactly 7.0 (kept by `gte 7`); popularity tie at 65 where the `tmdb_id` keyword sorts `"999"` after `"1002"` and `"2002"`. |
| 2002 | Silent Valley | Rating 6.99 (dropped by `gte 7`); same popularity tie. |

The first twelve documents come from the movie-search prototypes' shared
contract; the last three were added for boundary and ordering cases.

Changing a document changes what the cases verify: update the cases and the
CHANGELOG in the same commit, and re-run both references.
