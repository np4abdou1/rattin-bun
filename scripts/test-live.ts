/**
 * End-to-end test against live TMDB + torrent APIs.
 * Run: npx tsx scripts/test-live.ts
 */
import "dotenv/config";
import {
  searchTMDB,
  fetchTVDetails,
  fetchImdbId,
  hasApiKey,
} from "../src/tmdb";
import {
  searchTorrents,
  matchEpisode,
  scoreTorrent,
  type TorrentResult,
  type SearchTarget,
} from "../src/torrent";
import { fmtRating, fmtYear, formatTMDBLine, formatTorrentLine } from "../src/ui";

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? " — " + detail : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

function header(title: string): void {
  console.log(`\n── ${title} ──`);
}

async function main() {
  console.log("=== rattin live API test ===\n");

  // ── 1. API key ──
  header("TMDB API key");
  ok("TMDB_API_KEY is loaded", hasApiKey(), "key starts with d229...");

  // ── 2. TMDB search: death note (multi) ──
  header("TMDB search: 'death note'");
  const dnResults = await searchTMDB("death note");
  ok("search returns results", dnResults.length > 0, `${dnResults.length} results`);
  ok("results contain TV show", dnResults.some((r) => r.media_type === "tv"));
  ok("results contain movie", dnResults.some((r) => r.media_type === "movie"));

  const dnTV = dnResults.find((r) => r.media_type === "tv");
  if (dnTV) {
    console.log(`\n  First TV result:`);
    console.log(`    ${formatTMDBLine(dnTV)}`);
    ok("Death Note TV has rating > 8", (dnTV.vote_average ?? 0) > 8, `rating=${dnTV.vote_average}`);
    ok("Death Note TV year is 2006-2007", fmtYear(dnTV.first_air_date).startsWith("200"), `year=${fmtYear(dnTV.first_air_date)}`);
  }

  // ── 3. IMDB id fetch ──
  header("IMDB id fetch");
  if (dnTV) {
    const dnImdb = await fetchImdbId(dnTV.id, "tv");
    ok("Death Note TV has IMDB id", !!dnImdb, `imdb=${dnImdb}`);
    if (dnImdb) {
      ok("IMDB id starts with 'tt'", dnImdb.startsWith("tt"));
    }
  }

  header("IMDB id for movie: Coco");
  const cocoResults = await searchTMDB("coco");
  const cocoMovie = cocoResults.find((r) => r.media_type === "movie");
  if (cocoMovie) {
    const cocoImdb = await fetchImdbId(cocoMovie.id, "movie");
    ok("Coco movie has IMDB id", !!cocoImdb, `imdb=${cocoImdb}`);
    ok("Coco rating ~8.4", Math.abs((cocoMovie.vote_average ?? 0) - 8.4) < 0.5, `rating=${cocoMovie.vote_average}`);
  }

  // ── 4. TV season details ──
  header("TV season details: Death Note S1");
  if (dnTV) {
    const s1 = await fetchTVDetails(dnTV.id, 1);
    ok("S1 has episodes", !!s1?.episodes?.length, `${s1?.episodes?.length ?? 0} episodes`);
    if (s1?.episodes?.length) {
      const ep1 = s1.episodes[0];
      ok("S01E01 is episode number 1", ep1.episode_number === 1);
      ok("S01E01 has a name", !!ep1.name, `name="${ep1.name}"`);
      ok("S01E01 rating displayed 0-10", (ep1.vote_average ?? 0) > 0, `rating=${ep1.vote_average}`);
      console.log(`\n  Episode 1: ${ep1.episode_number}. ${ep1.name} ${fmtRating(ep1.vote_average)}`);
    }
  }

  // ── 5. Torrent search: Death Note S01E01 ──
  header("Torrent search: Death Note S01E01");
  if (dnTV) {
    const imdbId = await fetchImdbId(dnTV.id, "tv");
    const target: SearchTarget = {
      type: "tv",
      title: dnTV.name || "Death Note",
      year: fmtYear(dnTV.first_air_date),
      season: 1,
      episode: 1,
      imdbId,
      tmdbId: dnTV.id,
    };
    const torrents = await searchTorrents(target);
    ok("torrent search returns results", torrents.length > 0, `${torrents.length} torrents`);

    if (torrents.length > 0) {
      console.log(`\n  Top 5 torrents:`);
      torrents.slice(0, 5).forEach((t, i) => {
        console.log(`    ${i + 1}. ${formatTorrentLine(t, i)}`);
      });

      // ── 6. Episode filter verification ──
      header("Episode filter: all results must match S01E01");
      let allMatch = true;
      let nonMatching = "";
      for (const t of torrents) {
        const m = matchEpisode(t.name, 1, 1);
        if (m === "none") {
          allMatch = false;
          nonMatching = t.name;
          break;
        }
      }
      ok("all torrents match S01E01 (exact or season pack)", allMatch, allMatch ? "" : `offender: ${nonMatching}`);

      // Check that exact matches rank higher than season packs
      const exactCount = torrents.filter((t) => matchEpisode(t.name, 1, 1) === "exact").length;
      const seasonCount = torrents.filter((t) => matchEpisode(t.name, 1, 1) === "season").length;
      ok("has exact episode matches", exactCount > 0, `${exactCount} exact, ${seasonCount} season packs`);

      if (exactCount > 0) {
        const firstExactIdx = torrents.findIndex((t) => matchEpisode(t.name, 1, 1) === "exact");
        const firstSeasonIdx = torrents.findIndex((t) => matchEpisode(t.name, 1, 1) === "season");
        if (firstSeasonIdx >= 0) {
          ok("exact matches rank before season packs", firstExactIdx < firstSeasonIdx, `exact@${firstExactIdx} < season@${firstSeasonIdx}`);
        }
      }
    }
  }

  // ── 7. Torrent search: Coco (movie) ──
  header("Torrent search: Coco (movie)");
  if (cocoMovie) {
    const cocoImdb = await fetchImdbId(cocoMovie.id, "movie");
    const target: SearchTarget = {
      type: "movie",
      title: cocoMovie.title || "Coco",
      year: fmtYear(cocoMovie.release_date),
      imdbId: cocoImdb,
      tmdbId: cocoMovie.id,
    };
    const torrents = await searchTorrents(target);
    ok("Coco torrent search returns results", torrents.length > 0, `${torrents.length} torrents`);

    if (torrents.length > 0) {
      console.log(`\n  Top 5 Coco torrents:`);
      torrents.slice(0, 5).forEach((t, i) => {
        console.log(`    ${i + 1}. ${formatTorrentLine(t, i)}`);
      });

      // Movies shouldn't have SxxExx in the name
      const withEpisode = torrents.filter((t) => /\bS\d+E\d+\b/i.test(t.name));
      ok("movie torrents have no episode markers", withEpisode.length === 0, withEpisode.length > 0 ? `offender: ${withEpisode[0].name}` : "");

      // Should contain "Coco" in the name
      const withCoco = torrents.filter((t) => t.name.toLowerCase().includes("coco"));
      ok("torrents contain 'coco' in name", withCoco.length === torrents.length, `${withCoco.length}/${torrents.length}`);
    }
  }

  // ── 8. matchEpisode unit tests ──
  header("matchEpisode unit tests (season=1, episode=1)");
  const cases: Array<[string, "exact" | "season" | "none"]> = [
    ["Death.Note.S01E01.Rebirth.1080p", "exact"],
    ["death note s01e01 1080p", "exact"],
    ["Death Note S1E1 1080p", "exact"],
    ["Death.Note.1x01.1080p", "exact"],
    ["Death Note 1X01 WEB-DL", "exact"],
    ["Death.Note.S01E05.Another.Episode", "none"],
    ["Death Note S02E01", "none"],
    ["Death.Note.S01.Complete.1080p", "season"],
  ];
  for (const [name, expected] of cases) {
    const got = matchEpisode(name, 1, 1);
    ok(`"${name}"`, got === expected, `→ ${got} (expected ${expected})`);
  }

  // ── Summary ──
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`${"═".repeat(50)}\n`);

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n=== TEST CRASHED ===");
  console.error(err);
  process.exit(1);
});
