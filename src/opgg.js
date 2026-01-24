// src/opgg.js
// OP.GG MCP API client for historical rank data
const axios = require('axios');

const OPGG_MCP_ENDPOINT = 'https://mcp-api.op.gg/mcp';
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_YEARS_HISTORY = 2;

// Region mapping: Riot region codes → OP.GG region codes
const REGION_MAP = {
  'EUW1': 'EUW',
  'EUN1': 'EUNE',
  'NA1': 'NA',
  'KR': 'KR',
  'BR1': 'BR',
  'JP1': 'JP',
  'LA1': 'LAN',
  'LA2': 'LAS',
  'OC1': 'OCE',
  'RU': 'RU',
  'TR1': 'TR',
  'PH2': 'PH',
  'SG2': 'SG',
  'TH2': 'TH',
  'TW2': 'TW',
  'VN2': 'VN',
  'ME1': 'ME'
};

// Season ID → Year mapping (based on OP.GG data)
// Season IDs are internal OP.GG identifiers
const SEASON_YEARS = {
  33: 2026,  // S16
  32: 2025,  // S15 Split 3
  31: 2025,  // S15 Split 2
  30: 2025,  // S15 Split 1
  29: 2024,  // S14 Split 3
  28: 2024,  // S14 Split 2
  27: 2024,  // S14 Split 1
  26: 2023,  // S13 Split 3
  25: 2023,  // S13 Split 2
  24: 2023,  // S13 Split 1
  23: 2022,  // S12
  22: 2022,
  21: 2022,
  19: 2022,
  18: 2021,
  17: 2021,
  16: 2020,
  15: 2020,
  14: 2019,
  13: 2019
};

/**
 * Call OP.GG MCP tool via JSON-RPC 2.0
 * @param {string} toolName - MCP tool name
 * @param {Object} args - Tool arguments
 * @returns {Object} MCP response result
 */
async function callMcpTool(toolName, args) {
  const request = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name: toolName, arguments: args }
  };

  const response = await axios.post(OPGG_MCP_ENDPOINT, request, {
    headers: { 'Content-Type': 'application/json' },
    timeout: DEFAULT_TIMEOUT
  });

  if (response.data.error) {
    const error = new Error(response.data.error.message);
    error.code = response.data.error.code;
    throw error;
  }

  return response.data.result;
}

/**
 * Get summoner profile with historical ranks from OP.GG
 * @param {string} region - Riot region code (EUW1, NA1, etc.)
 * @param {string} gameName - Riot ID game name
 * @param {string} tagLine - Riot ID tag line
 * @param {number} yearsBack - How many years of history to retrieve
 * @returns {Object|null} Parsed summoner data or null if not found
 */
async function getSummonerProfile(region, gameName, tagLine, yearsBack = DEFAULT_YEARS_HISTORY) {
  try {
    const result = await callMcpTool('lol_get_summoner_profile', {
      game_name: gameName,
      tag_line: tagLine,
      region: REGION_MAP[region] || region,
      lang: 'en_US'
    });

    if (!result?.content?.[0]?.text) return null;
    return parseOpggResponse(result.content[0].text, yearsBack);
  } catch (error) {
    // Player not found is expected, return null
    if (error.message?.toLowerCase().includes('not found')) {
      return null;
    }
    // For other errors, log and return null (graceful degradation)
    console.error(`OP.GG API error for ${gameName}#${tagLine}:`, error.message);
    return null;
  }
}

/**
 * Extract historical ranks from OP.GG response text
 * @param {string} text - Raw OP.GG response text
 * @param {number} yearsBack - How many years of history to retrieve
 * @returns {Object} Structured rank data
 */
function parseOpggResponse(text, yearsBack = DEFAULT_YEARS_HISTORY) {
  const currentYear = new Date().getFullYear();
  const minYear = currentYear - yearsBack;

  const result = {
    current: { solo: null, flex: null },
    peak: { solo: null, flex: null },
    history: []  // Array of { year, seasonId, solo, flex }
  };

  // Parse current ranks from LeagueStat entries
  const currentSoloMatch = text.match(/LeagueStat\("SOLORANKED",TierInfo\("(\w+)",(\d+),(\d+)/);
  const currentFlexMatch = text.match(/LeagueStat\("FLEXRANKED",TierInfo\("(\w+)",(\d+),(\d+)/);

  if (currentSoloMatch) {
    result.current.solo = formatRankObject(currentSoloMatch[1], currentSoloMatch[2], currentSoloMatch[3]);
  }
  if (currentFlexMatch) {
    result.current.flex = formatRankObject(currentFlexMatch[1], currentFlexMatch[2], currentFlexMatch[3]);
  }

  // Parse current season peak ranks from RankEntrie1 (high_rank_info)
  const peakSoloMatch = text.match(/RankEntrie1\("SOLORANKED",RankInfo\("(\w+)",(\d+),(\d+)/);
  const peakFlexMatch = text.match(/RankEntrie1\("FLEXRANKED",RankInfo\("(\w+)",(\d+),(\d+)/);

  if (peakSoloMatch) {
    result.peak.solo = formatRankObject(peakSoloMatch[1], peakSoloMatch[2], peakSoloMatch[3]);
  }
  if (peakFlexMatch) {
    result.peak.flex = formatRankObject(peakFlexMatch[1], peakFlexMatch[2], peakFlexMatch[3]);
  }

  // Parse previous season tiers
  // Format: PreviousSeasonTier(seasonId,[RankEntrie("SOLORANKED",RankInfo(...),...),...])
  const seasonPattern = /PreviousSeasonTier\((\d+),\[([^\]]+)\]/g;
  let match;

  while ((match = seasonPattern.exec(text)) !== null) {
    const seasonId = parseInt(match[1]);
    const year = SEASON_YEARS[seasonId];

    // Skip if year is unknown or too old
    if (!year || year < minYear) continue;

    const seasonData = match[2];
    const entry = { year, seasonId, solo: null, flex: null };

    // Extract SOLORANKED end-of-season rank
    const soloRankMatch = seasonData.match(/RankEntrie\("SOLORANKED",RankInfo\("(\w+)",(\d+),(\d+)/);
    if (soloRankMatch) {
      entry.solo = formatRankObject(soloRankMatch[1], soloRankMatch[2]);
    }

    // Extract FLEXRANKED end-of-season rank
    const flexRankMatch = seasonData.match(/RankEntrie\("FLEXRANKED",RankInfo\("(\w+)",(\d+),(\d+)/);
    if (flexRankMatch) {
      entry.flex = formatRankObject(flexRankMatch[1], flexRankMatch[2]);
    }

    // Only add if we have at least one rank
    if (entry.solo || entry.flex) {
      result.history.push(entry);
    }
  }

  // Sort history by year descending (most recent first)
  result.history.sort((a, b) => b.year - a.year || b.seasonId - a.seasonId);

  return result;
}

/**
 * Format rank data from tier/division/lp into a structured object
 * @param {string} tier - Rank tier (IRON, BRONZE, SILVER, GOLD, PLATINUM, EMERALD, DIAMOND, MASTER, GRANDMASTER, CHALLENGER)
 * @param {string|number} division - Division number (1-4)
 * @param {string|number|null} lp - League points (optional)
 * @returns {Object} Formatted rank object { rank, tier, division, lp }
 */
function formatRankObject(tier, division, lp = null) {
  const divisions = ['I', 'II', 'III', 'IV'];
  const divIndex = parseInt(division) - 1;
  const divStr = divisions[divIndex] || '';

  // Master+ tiers don't have divisions
  const isMasterPlus = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier);
  const rankStr = isMasterPlus ? tier : `${tier} ${divStr}`.trim();

  return {
    rank: rankStr,
    tier: tier,
    division: isMasterPlus ? null : divStr,
    lp: lp !== null ? parseInt(lp) : null
  };
}

/**
 * Get historical ranks for multiple players in parallel
 * @param {Array} players - Array of { region, gameName, tagLine }
 * @param {number} yearsBack - How many years of history
 * @returns {Map} Map of "gameName#tagLine" → rank data
 */
async function getMultiplePlayersRanks(players, yearsBack = DEFAULT_YEARS_HISTORY) {
  const results = new Map();

  const promises = players.map(async (player) => {
    try {
      const data = await getSummonerProfile(player.region, player.gameName, player.tagLine, yearsBack);
      if (data) {
        const key = `${player.gameName}#${player.tagLine}`;
        results.set(key, data);
      }
    } catch (error) {
      // Silent fail for individual players - don't break the batch
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Convert OP.GG region code to Riot region code
 * @param {string} opggRegion - OP.GG region code
 * @returns {string} Riot region code
 */
function opggToRiotRegion(opggRegion) {
  const reverseMap = Object.entries(REGION_MAP).reduce((acc, [riot, opgg]) => {
    acc[opgg] = riot;
    return acc;
  }, {});
  return reverseMap[opggRegion] || opggRegion;
}

module.exports = {
  getSummonerProfile,
  getMultiplePlayersRanks,
  parseOpggResponse,
  formatRankObject,
  REGION_MAP,
  SEASON_YEARS,
  DEFAULT_YEARS_HISTORY,
  DEFAULT_TIMEOUT,
  opggToRiotRegion
};
