const axios = require('axios');

const RIOT_API_KEY = process.env.RIOT_API_KEY;

if (!RIOT_API_KEY) {
    console.error('Error: RIOT_API_KEY is not set in the environment variables. Please create a .env file and add your Riot API key.');
    process.exit(1);
}

const api = axios.create();

api.interceptors.request.use((config) => {
  config.headers['X-Riot-Token'] = RIOT_API_KEY;
  return config;
});

const retryWithBackoff = async (fn, maxRetries = 5, baseDelay = 1000) => {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // Only retry on rate limit (429)
      if (error.response?.status !== 429) {
        handleApiError(error); // Transform and re-throw non-429 errors
      }
      // Use Retry-After header if present, otherwise exponential backoff
      const retryAfter = error.response?.headers?.['retry-after'];
      const delay = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : baseDelay * Math.pow(2, attempt);
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw lastError || new Error('Max retries exceeded');
};

const handleApiError = (error) => {
  if (error.response) {
    const { status, data } = error.response;
    if (status === 429) {
      throw error; // Re-throw original error for retry logic
    }
    if (status === 403) {
      throw new Error('Forbidden: Invalid API Key or insufficient permissions.');
    }
    if (status === 404) {
      throw new Error('Not Found: The requested resource was not found.');
    }
    throw new Error(data.status ? data.status.message : 'An API error occurred.');
  }
  // Re-throw network errors (no response) to preserve original error info
  throw error;
};

const getRegionalPlatform = (region) => {
  const americas = ['NA1', 'BR1', 'LA1', 'LA2'];
  const asia = ['KR', 'JP1'];
  const europe = ['EUN1', 'EUW1', 'TR1', 'RU'];
  const sea = ['OC1'];

  if (americas.includes(region)) return 'americas';
  if (asia.includes(region)) return 'asia';
  if (europe.includes(region)) return 'europe';
  if (sea.includes(region)) return 'sea';
  return region;
};

const getSummonerByPuuid = async (region, puuid) => {
  return retryWithBackoff(async () => {
    const response = await api.get(
      `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`
    );
    return response.data;
  });
};

const getSummonerDataByRiotId = async (region, riotId) => {
  let gameName, tagLine;
  if (riotId.includes('#')) {
    [gameName, tagLine] = riotId.split('#');
  } else {
    throw new Error("Invalid Riot ID. Please use the format 'gameName#tagLine'.");
  }

  const accountRegion = getRegionalPlatform(region);
  const accountApiUrl = `https://${accountRegion}.api.riotgames.com`;

  const response = await retryWithBackoff(async () => {
    return api.get(
      `${accountApiUrl}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${tagLine}`
    );
  });
  const puuid = response.data.puuid;

  if (!puuid) {
    throw new Error('Could not retrieve PUUID for the given Riot ID.');
  }

  const summonerData = await getSummonerByPuuid(region, puuid);
  return { ...summonerData, name: gameName };
};


const getMatchHistory = async (region, puuid) => {
  return retryWithBackoff(async () => {
    const response = await api.get(
      `https://${getRegionalPlatform(region)}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=10`
    );
    return response.data;
  });
};

const getMatchDetails = async (region, matchId) => {
  return retryWithBackoff(async () => {
    const response = await api.get(
      `https://${getRegionalPlatform(region)}.api.riotgames.com/lol/match/v5/matches/${matchId}`
    );
    return response.data;
  });
};

const getMatchTimeline = async (region, matchId) => {
  return retryWithBackoff(async () => {
    const response = await api.get(
      `https://${getRegionalPlatform(region)}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`
    );
    return response.data;
  });
};

const getRankedData = async (region, puuid) => {
  return retryWithBackoff(async () => {
    const response = await api.get(
      `https://${region}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`
    );
    return response.data;
  });
};

const getChampionMastery = async (region, puuid, championId) => {
  return retryWithBackoff(async () => {
    const response = await api.get(
      `https://${region}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/by-champion/${championId}`
    );
    return response.data;
  });
};

const getTopChampionMasteries = async (region, puuid, count = 5) => {
  return retryWithBackoff(async () => {
    const response = await api.get(
      `https://${region}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${count}`
    );
    return response.data;
  });
};

const getLiveGame = async (region, encryptedPUUID) => {
  return retryWithBackoff(async () => {
    try {
      const response = await api.get(
        `https://${region}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${encryptedPUUID}`
      );
      return response.data;
    } catch (error) {
      // 404 means no active game - return null instead of throwing
      if (error.response?.status === 404) {
        return null;
      }
      throw error; // Let retryWithBackoff handle other errors
    }
  });
};

module.exports = {
  getSummonerDataByRiotId,
  getMatchHistory,
  getMatchDetails,
  getMatchTimeline,
  getRankedData,
  getChampionMastery,
  getTopChampionMasteries,
  getLiveGame,
};
