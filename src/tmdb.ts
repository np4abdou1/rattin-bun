/**
 * TMDB API client — search movies/TV, fetch seasons, fetch imdb id.
 */
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";

let API_KEY = process.env.TMDB_API_KEY || null;

export function setTmdbKey(key: string): void {
  API_KEY = key;
}

export function hasApiKey(): boolean {
  return !!API_KEY;
}

async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!API_KEY) {
    throw new Error(
      "TMDB API key not set. Set TMDB_API_KEY env variable.\n" +
        "  Get a free key at: https://www.themoviedb.org/settings/api"
    );
  }

  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "rattin-cli/1.0" },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`TMDB API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export interface TMDBItem {
  id: number;
  media_type: "movie" | "tv" | string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  number_of_seasons?: number;
  poster_path?: string | null;
}

export interface TmdbEpisode {
  episode_number: number;
  name: string;
  vote_average: number;
}

export interface SeasonData {
  episodes?: TmdbEpisode[];
}

export async function searchTMDB(query: string): Promise<TMDBItem[]> {
  const data = await tmdbFetch<{ results: TMDBItem[] }>("/search/multi", {
    query,
    include_adult: "false",
    page: "1",
  });

  return (data.results || [])
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 15);
}

export async function fetchTVDetails(
  tvId: number,
  season: number
): Promise<SeasonData | null> {
  try {
    return await tmdbFetch<SeasonData>(`/tv/${tvId}/season/${season}`);
  } catch {
    return null;
  }
}

export async function fetchMovieDetails(
  movieId: number
): Promise<{ imdb_id?: string } | null> {
  try {
    return await tmdbFetch(`/movie/${movieId}`);
  } catch {
    return null;
  }
}

export async function fetchTVShowDetails(
  tvId: number
): Promise<{ external_ids?: { imdb_id?: string } } | null> {
  try {
    return await tmdbFetch(`/tv/${tvId}/external_ids`);
  } catch {
    return null;
  }
}

/**
 * Fetch imdb id for a movie or TV show (needed for Torrentio).
 */
export async function fetchImdbId(
  id: number,
  type: "movie" | "tv"
): Promise<string | null> {
  try {
    if (type === "movie") {
      const data = await fetchMovieDetails(id);
      return data?.imdb_id || null;
    } else {
      const data = await fetchTVShowDetails(id);
      return data?.external_ids?.imdb_id || null;
    }
  } catch {
    return null;
  }
}

export function posterUrl(path: string | null | undefined, size = "w342"): string | null {
  if (!path) return null;
  return `${TMDB_IMG}/${size}${path}`;
}
