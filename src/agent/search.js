// ---------------------------------------------------------------------------
// src/agent/search.js
//
// Stage 3C: Web search via SearXNG.
// Queries a local SearXNG instance and returns formatted results for Ollama.
// ---------------------------------------------------------------------------

const https = require('https');
const http  = require('http');

/**
 * Search SearXNG and return top results as a formatted context string.
 *
 * @param {string} query       - Search query
 * @param {string} searxngUrl  - SearXNG base URL e.g. http://192.168.50.6:8118
 * @param {number} maxResults  - Max results to return (default 5)
 * @returns {Promise<{results: Array, formatted: string}>}
 */
async function search(query, searxngUrl, maxResults = 5) {
  const url = new URL('/search', searxngUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', 'en-US');
  url.searchParams.set('safesearch', '0');

  const raw = await new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'HavenBot/1.0',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse SearXNG response: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('SearXNG request timed out')));
  });

  const results = (raw.results || []).slice(0, maxResults).map(r => ({
    title:   r.title   || '',
    url:     r.url     || '',
    content: r.content || r.snippet || '',
  }));

  if (results.length === 0) {
    return { results: [], formatted: 'No search results found.' };
  }

  const formatted = results.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}`
  ).join('\n\n');

  return { results, formatted };
}

/**
 * Check if SearXNG is reachable.
 */
async function healthCheck(searxngUrl) {
  try {
    const url = new URL('/search', searxngUrl);
    url.searchParams.set('q', 'test');
    url.searchParams.set('format', 'json');

    await new Promise((resolve, reject) => {
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.get(url.toString(), { headers: { 'Accept': 'application/json' } }, resolve);
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Cannot reach SearXNG at ${searxngUrl}: ${err.message}` };
  }
}

/**
 * Detect if a message likely needs a web search.
 * Used as a pre-filter before asking Ollama to decide.
 */
function likelyNeedsSearch(message) {
  // Skip search for queries that should be handled by tools instead
  const toolQueries = [
    /\b(leaderboard|top users?|who.s (at the top|winning)|most xp|rankings?)\b/i,
    /\b(upcoming events?|what.s (on|scheduled)|calendar|events? (in|for) this channel)\b/i,
    /\b(what time is it|current time|what.s the date|today.s date)\b/i,
    /\b(rss feeds?|news feeds?|what feeds?)\b/i,
    /\b(play (a )?sound|soundboard)\b/i,
    /\b(add|create|schedule) .*(event|calendar|reminder)\b/i,
  ];

  if (toolQueries.some(p => p.test(message))) return false;

  const searchIndicators = [
    /\b(latest|recent|current|today|yesterday|this week|last week|this season|last season)\b/i,
    /\b(news|results?|score|winner|standings?)\b/i,
    /\b(who won|what happened|when is|where is|how many)\b/i,
    /\b(patch notes?|update|release|announce|launch)\b/i,
    /\b(weather|price|stock|trending)\b/i,
    /\b(race results?|grand prix|qualifying|championship)\b/i,
  ];

  return searchIndicators.some(pattern => pattern.test(message));
}

module.exports = { search, healthCheck, likelyNeedsSearch };
