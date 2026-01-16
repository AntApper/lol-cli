const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Generic cache file reader with validation
const readCacheFile = (filePath, defaultValue, validator = () => true) => {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (validator(data)) return data;
    }
  } catch (e) {
    // Corrupted cache, return default
  }
  return typeof defaultValue === 'function' ? defaultValue() : defaultValue;
};

const CACHE_FILE = path.resolve(__dirname, '../.item_cache.json');

// Per-account cache directories
const LOL_CLI_DIR = path.join(os.homedir(), '.lol-cli');
const ACCOUNTS_DIR = path.join(LOL_CLI_DIR, 'accounts');
const MONITORED_ACCOUNTS_FILE = path.join(LOL_CLI_DIR, 'monitored_accounts.json');
const CHAMPION_CACHE_FILE = path.resolve(__dirname, '../.champion_cache.json');
const SPELL_CACHE_FILE = path.resolve(__dirname, '../.spell_cache.json');
const RUNE_CACHE_FILE = path.resolve(__dirname, '../.rune_cache.json');
const QUEUE_CACHE_FILE = path.resolve(__dirname, '../.queue_cache.json');
const LAST_SEARCH_FILE = process.pkg
  ? path.resolve(path.dirname(process.execPath), '.last_search.json')
  : path.resolve(__dirname, '../.last_search.json');
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

const getLatestVersion = async () => {
    const versionsResponse = await axios.get('https://ddragon.leagueoflegends.com/api/versions.json');
    return versionsResponse.data[0];
};

const getChampionData = async () => {
  if (fs.existsSync(CHAMPION_CACHE_FILE)) {
    const stats = fs.statSync(CHAMPION_CACHE_FILE);
    if (new Date() - new Date(stats.mtime) < CACHE_DURATION) {
      return JSON.parse(fs.readFileSync(CHAMPION_CACHE_FILE, 'utf-8'));
    }
  }
  const latestVersion = await getLatestVersion();
  const response = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion.json`);
  fs.writeFileSync(CHAMPION_CACHE_FILE, JSON.stringify(response.data));
  return response.data;
};

const getSummonerSpellData = async () => {
    if (fs.existsSync(SPELL_CACHE_FILE)) {
        const stats = fs.statSync(SPELL_CACHE_FILE);
        if (new Date() - new Date(stats.mtime) < CACHE_DURATION) {
            return JSON.parse(fs.readFileSync(SPELL_CACHE_FILE, 'utf-8'));
        }
    }
    const latestVersion = await getLatestVersion();
    const response = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/summoner.json`);
    fs.writeFileSync(SPELL_CACHE_FILE, JSON.stringify(response.data));
    return response.data;
};

const getRuneData = async () => {
    if (fs.existsSync(RUNE_CACHE_FILE)) {
        const stats = fs.statSync(RUNE_CACHE_FILE);
        if (new Date() - new Date(stats.mtime) < CACHE_DURATION) {
            return JSON.parse(fs.readFileSync(RUNE_CACHE_FILE, 'utf-8'));
        }
    }
    const latestVersion = await getLatestVersion();
    const response = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/runesReforged.json`);
    fs.writeFileSync(RUNE_CACHE_FILE, JSON.stringify(response.data));
    return response.data;
};

const getQueueData = async () => {
    if (fs.existsSync(QUEUE_CACHE_FILE)) {
        const stats = fs.statSync(QUEUE_CACHE_FILE);
        if (new Date() - new Date(stats.mtime) < CACHE_DURATION) {
            return JSON.parse(fs.readFileSync(QUEUE_CACHE_FILE, 'utf-8'));
        }
    }
    const response = await axios.get('https://static.developer.riotgames.com/docs/lol/queues.json');
    fs.writeFileSync(QUEUE_CACHE_FILE, JSON.stringify(response.data));
    return response.data;
};

const getItemData = async () => {
  if (fs.existsSync(CACHE_FILE)) {
    const stats = fs.statSync(CACHE_FILE);
    const lastModified = new Date(stats.mtime);
    if (new Date() - lastModified < CACHE_DURATION) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  }

  const latestVersion = await getLatestVersion();
  const itemResponse = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/item.json`);
  const itemData = itemResponse.data;

  fs.writeFileSync(CACHE_FILE, JSON.stringify(itemData));

  return itemData;
};

const getLastSearch = () => {
  try {
    if (fs.existsSync(LAST_SEARCH_FILE)) {
      return JSON.parse(fs.readFileSync(LAST_SEARCH_FILE, 'utf-8'));
    }
  } catch (error) {
    return null;
  }
  return null;
};

const saveLastSearch = (riotId, region) => {
  try {
    fs.writeFileSync(LAST_SEARCH_FILE, JSON.stringify({ riotId, region }));
  } catch (error) {
    // Intentionally silent: saving search history is non-critical functionality.
    // Failure should not interrupt the user's workflow.
  }
};

const detectRegionFromRiotId = (riotId) => {
  if (!riotId || !riotId.includes('#')) return null;

  const tagline = riotId.split('#')[1]?.toUpperCase();
  if (!tagline) return null;

  const taglineToRegion = {
    'NA': 'NA1', 'NA1': 'NA1',
    'EUW': 'EUW1', 'EUW1': 'EUW1',
    'EUNE': 'EUN1', 'EUN1': 'EUN1',
    'KR': 'KR',
    'JP': 'JP1', 'JP1': 'JP1',
    'BR': 'BR1', 'BR1': 'BR1',
    'LAN': 'LA1', 'LA1': 'LA1',
    'LAS': 'LA2', 'LA2': 'LA2',
    'OCE': 'OC1', 'OC1': 'OC1',
    'RU': 'RU',
    'TR': 'TR1', 'TR1': 'TR1',
  };

  return taglineToRegion[tagline] || null;
};

// Per-account cache functions
const ensureCacheDir = (puuid) => {
  // Validate puuid to prevent directory traversal
  if (!puuid || typeof puuid !== 'string' || /[\/\\]/.test(puuid)) {
    throw new Error('Invalid puuid');
  }
  const accountDir = path.join(ACCOUNTS_DIR, puuid);
  if (!fs.existsSync(accountDir)) {
    fs.mkdirSync(accountDir, { recursive: true });
  }
  return accountDir;
};

const getMatchCache = (puuid) => {
  const cacheFile = path.join(ACCOUNTS_DIR, puuid, 'matches.json');
  return readCacheFile(
    cacheFile,
    () => ({ version: 1, puuid, region: null, lastUpdated: null, matches: [] }),
    (data) => data.version === 1 && data.puuid === puuid
  );
};

const saveMatchCache = (puuid, data) => {
  try {
    ensureCacheDir(puuid);
    const cacheFile = path.join(ACCOUNTS_DIR, puuid, 'matches.json');
    data.version = 1;
    data.puuid = puuid;
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
  } catch (error) {
    // Silent fail - caching is non-critical
  }
};

const getParticipantRankCache = (puuid) => {
  const cacheFile = path.join(ACCOUNTS_DIR, puuid, 'participant_ranks.json');
  return readCacheFile(
    cacheFile,
    { version: 1, ranks: {} },
    (data) => data.version === 1
  );
};

const saveParticipantRankCache = (puuid, data) => {
  try {
    ensureCacheDir(puuid);
    const cacheFile = path.join(ACCOUNTS_DIR, puuid, 'participant_ranks.json');
    data.version = 1;
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
  } catch (error) {
    // Silent fail - caching is non-critical
  }
};

// Account data cache (summoner, ranked, masteries) for instant switching
const getAccountDataCache = (puuid) => {
  const cacheFile = path.join(ACCOUNTS_DIR, puuid, 'account_data.json');
  return readCacheFile(
    cacheFile,
    null,
    (data) => data.version === 1 && data.summoner
  );
};

const saveAccountDataCache = (puuid, data) => {
  try {
    ensureCacheDir(puuid);
    const cacheFile = path.join(ACCOUNTS_DIR, puuid, 'account_data.json');
    const cacheData = {
      version: 1,
      summoner: data.summoner,
      rankedData: data.rankedData,
      topMasteries: data.topMasteries,
      lastFetched: new Date().toISOString(),
    };
    fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
  } catch (error) {
    // Silent fail - caching is non-critical
  }
};

// Monitored accounts functions
const ensureLolCliDir = () => {
  if (!fs.existsSync(LOL_CLI_DIR)) {
    fs.mkdirSync(LOL_CLI_DIR, { recursive: true });
  }
};

const getMonitoredAccounts = () => {
  return readCacheFile(
    MONITORED_ACCOUNTS_FILE,
    { version: 1, activeIndex: 0, accounts: [] },
    (data) => data.version === 1 && Array.isArray(data.accounts)
  );
};

const saveMonitoredAccounts = (data) => {
  try {
    ensureLolCliDir();
    data.version = 1;
    fs.writeFileSync(MONITORED_ACCOUNTS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    // Silent fail - non-critical
  }
};

const addMonitoredAccount = (summoner, region, riotId) => {
  const data = getMonitoredAccounts();
  const existingIndex = data.accounts.findIndex(a => a.puuid === summoner.puuid);

  const accountEntry = {
    puuid: summoner.puuid,
    riotId: riotId,
    region: region,
    summonerLevel: summoner.summonerLevel,
    name: summoner.name,
    addedAt: existingIndex >= 0 ? data.accounts[existingIndex].addedAt : new Date().toISOString(),
    lastViewed: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    // Update existing account
    data.accounts[existingIndex] = accountEntry;
    data.activeIndex = existingIndex;
  } else {
    // Add new account
    data.accounts.push(accountEntry);
    data.activeIndex = data.accounts.length - 1;
  }

  saveMonitoredAccounts(data);
  return data;
};

const removeMonitoredAccount = (puuid) => {
  const data = getMonitoredAccounts();
  const index = data.accounts.findIndex(a => a.puuid === puuid);

  if (index >= 0) {
    data.accounts.splice(index, 1);
    // Adjust activeIndex if needed
    if (data.accounts.length === 0) {
      data.activeIndex = 0;
    } else if (data.activeIndex >= data.accounts.length) {
      data.activeIndex = data.accounts.length - 1;
    } else if (data.activeIndex > index) {
      data.activeIndex--;
    }
    saveMonitoredAccounts(data);

    // Clean up orphaned cache files for this account
    try {
      const accountDir = path.join(ACCOUNTS_DIR, puuid);
      if (fs.existsSync(accountDir)) {
        fs.rmSync(accountDir, { recursive: true });
      }
    } catch (e) {
      // Silent fail - cleanup is non-critical
    }
  }

  return data;
};

const setActiveAccountIndex = (index) => {
  const data = getMonitoredAccounts();
  if (index >= 0 && index < data.accounts.length) {
    data.activeIndex = index;
    data.accounts[index].lastViewed = new Date().toISOString();
    saveMonitoredAccounts(data);
  }
  return data;
};

module.exports = {
  getItemData,
  getChampionData,
  getSummonerSpellData,
  getRuneData,
  getQueueData,
  getLastSearch,
  saveLastSearch,
  detectRegionFromRiotId,
  getMatchCache,
  saveMatchCache,
  getParticipantRankCache,
  saveParticipantRankCache,
  getAccountDataCache,
  saveAccountDataCache,
  getMonitoredAccounts,
  saveMonitoredAccounts,
  addMonitoredAccount,
  removeMonitoredAccount,
  setActiveAccountIndex,
};
