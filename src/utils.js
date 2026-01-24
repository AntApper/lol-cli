const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Promise-based delay utility
const delay = ms => new Promise(res => setTimeout(res, ms));

// Atomic file write: write to temp file, then rename to target
// Uses unique temp filename to prevent race conditions between concurrent processes
const atomicWriteFileSync = (filePath, content) => {
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempFile, content);
    fs.renameSync(tempFile, filePath);
  } finally {
    // Clean up temp file if rename failed (file may or may not exist)
    try { fs.unlinkSync(tempFile); } catch (e) { /* ignore - file may have been renamed successfully */ }
  }
};

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
const MAX_CACHED_MATCHES = 100; // Limit matches per account to prevent unbounded growth
const MAX_RANK_SNAPSHOTS = 500; // Limit rank history snapshots per account

let cachedVersion = null;
let versionFetchedAt = 0;
const VERSION_TTL = 3600000; // 1 hour

const getLatestVersion = async () => {
    if (cachedVersion && Date.now() - versionFetchedAt < VERSION_TTL) {
        return cachedVersion;
    }
    const versionsResponse = await axios.get('https://ddragon.leagueoflegends.com/api/versions.json');
    cachedVersion = versionsResponse.data[0];
    versionFetchedAt = Date.now();
    return cachedVersion;
};

const getChampionData = async () => {
  // Check mtime BEFORE parsing JSON to avoid wasted CPU on stale cache
  let cacheExists = false;
  let cacheIsFresh = false;
  if (fs.existsSync(CHAMPION_CACHE_FILE)) {
    cacheExists = true;
    try {
      const stats = fs.statSync(CHAMPION_CACHE_FILE);
      cacheIsFresh = (new Date() - stats.mtime) < CACHE_DURATION;
    } catch (e) {
      // Stat failed, treat as stale
    }
  }

  // If cache is fresh, parse and return
  if (cacheIsFresh) {
    try {
      return JSON.parse(fs.readFileSync(CHAMPION_CACHE_FILE, 'utf-8'));
    } catch (e) {
      // Parse failed, fetch fresh data
    }
  }

  // Try to fetch fresh data
  try {
    const latestVersion = await getLatestVersion();
    const response = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion.json`);
    atomicWriteFileSync(CHAMPION_CACHE_FILE, JSON.stringify(response.data));
    return response.data;
  } catch (error) {
    // If fetch fails but we have cache (stale), parse and return as fallback
    if (cacheExists) {
      try {
        return JSON.parse(fs.readFileSync(CHAMPION_CACHE_FILE, 'utf-8'));
      } catch (e) {
        // Both fetch and cache parse failed
      }
    }
    throw error;
  }
};

const getSummonerSpellData = async () => {
    // Check mtime BEFORE parsing JSON to avoid wasted CPU on stale cache
    let cacheExists = false;
    let cacheIsFresh = false;
    if (fs.existsSync(SPELL_CACHE_FILE)) {
        cacheExists = true;
        try {
            const stats = fs.statSync(SPELL_CACHE_FILE);
            cacheIsFresh = (new Date() - stats.mtime) < CACHE_DURATION;
        } catch (e) {
            // Stat failed, treat as stale
        }
    }

    // If cache is fresh, parse and return
    if (cacheIsFresh) {
        try {
            return JSON.parse(fs.readFileSync(SPELL_CACHE_FILE, 'utf-8'));
        } catch (e) {
            // Parse failed, fetch fresh data
        }
    }

    try {
        const latestVersion = await getLatestVersion();
        const response = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/summoner.json`);
        atomicWriteFileSync(SPELL_CACHE_FILE, JSON.stringify(response.data));
        return response.data;
    } catch (error) {
        // If fetch fails but we have cache (stale), parse and return as fallback
        if (cacheExists) {
            try {
                return JSON.parse(fs.readFileSync(SPELL_CACHE_FILE, 'utf-8'));
            } catch (e) {
                // Both fetch and cache parse failed
            }
        }
        throw error;
    }
};

const getRuneData = async () => {
    // Check mtime BEFORE parsing JSON to avoid wasted CPU on stale cache
    let cacheExists = false;
    let cacheIsFresh = false;
    if (fs.existsSync(RUNE_CACHE_FILE)) {
        cacheExists = true;
        try {
            const stats = fs.statSync(RUNE_CACHE_FILE);
            cacheIsFresh = (new Date() - stats.mtime) < CACHE_DURATION;
        } catch (e) {
            // Stat failed, treat as stale
        }
    }

    // If cache is fresh, parse and return
    if (cacheIsFresh) {
        try {
            return JSON.parse(fs.readFileSync(RUNE_CACHE_FILE, 'utf-8'));
        } catch (e) {
            // Parse failed, fetch fresh data
        }
    }

    try {
        const latestVersion = await getLatestVersion();
        const response = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/runesReforged.json`);
        atomicWriteFileSync(RUNE_CACHE_FILE, JSON.stringify(response.data));
        return response.data;
    } catch (error) {
        // If fetch fails but we have cache (stale), parse and return as fallback
        if (cacheExists) {
            try {
                return JSON.parse(fs.readFileSync(RUNE_CACHE_FILE, 'utf-8'));
            } catch (e) {
                // Both fetch and cache parse failed
            }
        }
        throw error;
    }
};

const getQueueData = async () => {
    // Check mtime BEFORE parsing JSON to avoid wasted CPU on stale cache
    let cacheExists = false;
    let cacheIsFresh = false;
    if (fs.existsSync(QUEUE_CACHE_FILE)) {
        cacheExists = true;
        try {
            const stats = fs.statSync(QUEUE_CACHE_FILE);
            cacheIsFresh = (new Date() - stats.mtime) < CACHE_DURATION;
        } catch (e) {
            // Stat failed, treat as stale
        }
    }

    // If cache is fresh, parse and return
    if (cacheIsFresh) {
        try {
            return JSON.parse(fs.readFileSync(QUEUE_CACHE_FILE, 'utf-8'));
        } catch (e) {
            // Parse failed, fetch fresh data
        }
    }

    try {
        const response = await axios.get('https://static.developer.riotgames.com/docs/lol/queues.json');
        atomicWriteFileSync(QUEUE_CACHE_FILE, JSON.stringify(response.data));
        return response.data;
    } catch (error) {
        // If fetch fails but we have cache (stale), parse and return as fallback
        if (cacheExists) {
            try {
                return JSON.parse(fs.readFileSync(QUEUE_CACHE_FILE, 'utf-8'));
            } catch (e) {
                // Both fetch and cache parse failed
            }
        }
        throw error;
    }
};

const getItemData = async () => {
  // Check mtime BEFORE parsing JSON to avoid wasted CPU on stale cache
  let cacheExists = false;
  let cacheIsFresh = false;
  if (fs.existsSync(CACHE_FILE)) {
    cacheExists = true;
    try {
      const stats = fs.statSync(CACHE_FILE);
      cacheIsFresh = (new Date() - stats.mtime) < CACHE_DURATION;
    } catch (e) {
      // Stat failed, treat as stale
    }
  }

  // If cache is fresh, parse and return
  if (cacheIsFresh) {
    try {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    } catch (e) {
      // Parse failed, fetch fresh data
    }
  }

  try {
    const latestVersion = await getLatestVersion();
    const itemResponse = await axios.get(`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/item.json`);
    const itemData = itemResponse.data;
    atomicWriteFileSync(CACHE_FILE, JSON.stringify(itemData));
    return itemData;
  } catch (error) {
    // If fetch fails but we have cache (stale), parse and return as fallback
    if (cacheExists) {
      try {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      } catch (e) {
        // Both fetch and cache parse failed
      }
    }
    throw error;
  }
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
    atomicWriteFileSync(LAST_SEARCH_FILE, JSON.stringify({ riotId, region }));
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
    (data) => data.version === 1 && data.puuid === puuid && Array.isArray(data.matches)
  );
};

const saveMatchCache = (puuid, data) => {
  try {
    ensureCacheDir(puuid);
    const cacheFile = path.join(ACCOUNTS_DIR, puuid, 'matches.json');
    data.version = 1;
    data.puuid = puuid;
    data.lastUpdated = new Date().toISOString();
    // Limit cache size to prevent unbounded growth
    if (data.matches && data.matches.length > MAX_CACHED_MATCHES) {
      data.matches = data.matches.slice(0, MAX_CACHED_MATCHES);
    }
    atomicWriteFileSync(cacheFile, JSON.stringify(data, null, 2));
  } catch (error) {
    // Silent fail - caching is non-critical
  }
};

const getParticipantRankCache = (puuid) => {
  const cacheFile = path.join(ACCOUNTS_DIR, puuid, 'participant_ranks.json');
  return readCacheFile(
    cacheFile,
    { version: 1, ranks: {} },
    (data) => data.version === 1 && data.ranks && typeof data.ranks === 'object'
  );
};

const saveParticipantRankCache = (puuid, data) => {
  try {
    ensureCacheDir(puuid);
    const cacheFile = path.join(ACCOUNTS_DIR, puuid, 'participant_ranks.json');
    data.version = 1;
    atomicWriteFileSync(cacheFile, JSON.stringify(data, null, 2));
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
    atomicWriteFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
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
  const data = readCacheFile(
    MONITORED_ACCOUNTS_FILE,
    { version: 1, activeIndex: 0, accounts: [] },
    (d) => d.version === 1 && Array.isArray(d.accounts)
  );
  // Clamp activeIndex to valid range (handles manual editing or account removal)
  const originalIndex = data.activeIndex;
  if (data.accounts.length === 0) {
    data.activeIndex = 0;
  } else if (data.activeIndex >= data.accounts.length) {
    data.activeIndex = data.accounts.length - 1;
  } else if (data.activeIndex < 0) {
    data.activeIndex = 0;
  }
  // Persist corrected index to disk if it was clamped
  if (data.activeIndex !== originalIndex) {
    saveMonitoredAccounts(data);
  }
  return data;
};

const saveMonitoredAccounts = (data) => {
  try {
    ensureLolCliDir();
    data.version = 1;
    atomicWriteFileSync(MONITORED_ACCOUNTS_FILE, JSON.stringify(data, null, 2));
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

// Get the rankedOnly preference (global setting)
const getRankedOnlyPreference = () => {
  const data = getMonitoredAccounts();
  return data.rankedOnly || false;
};

// Save the rankedOnly preference
const setRankedOnlyPreference = (value) => {
  const data = getMonitoredAccounts();
  data.rankedOnly = value;
  saveMonitoredAccounts(data);
};

// Time scope filter constants and helpers
const TIME_SCOPES = ['all', 'last10', 'daily', 'weekly'];

const getTimeScopePreference = () => {
  const data = getMonitoredAccounts();
  return TIME_SCOPES.includes(data.timeScope) ? data.timeScope : 'all';
};

const setTimeScopePreference = (value) => {
  const data = getMonitoredAccounts();
  data.timeScope = TIME_SCOPES.includes(value) ? value : 'all';
  saveMonitoredAccounts(data);
};

const cycleTimeScope = (current) => {
  const idx = TIME_SCOPES.indexOf(current);
  return TIME_SCOPES[(idx + 1) % TIME_SCOPES.length];
};

// Load cached account data by riotId (for offline mode)
const loadCachedAccountByRiotId = (riotId, region) => {
  const monitored = getMonitoredAccounts();
  const account = monitored.accounts.find(
    a => a.riotId.toLowerCase() === riotId.toLowerCase() && a.region === region
  );
  if (!account) return null;

  const accountData = getAccountDataCache(account.puuid);
  // Account data is required for offline mode (contains summoner info)
  if (!accountData) {
    return null;
  }

  // Match cache is optional - we can still show account info without matches
  const matchCache = getMatchCache(account.puuid);
  const matches = matchCache?.matches || [];

  return {
    summoner: accountData.summoner,
    matches: matches,
    rankedData: accountData.rankedData,
    topMasteries: accountData.topMasteries,
    isOffline: true
  };
};

// Rank history functions for LP progress tracking
const getRankHistory = (puuid) => {
  const cacheFile = path.join(ACCOUNTS_DIR, puuid, 'rank_history.json');
  return readCacheFile(
    cacheFile,
    { version: 1, puuid, snapshots: [] },
    (data) => data.version === 1 && data.puuid === puuid && Array.isArray(data.snapshots)
  );
};

const saveRankHistory = (puuid, data) => {
  try {
    ensureCacheDir(puuid);
    const cacheFile = path.join(ACCOUNTS_DIR, puuid, 'rank_history.json');
    data.version = 1;
    data.puuid = puuid;
    atomicWriteFileSync(cacheFile, JSON.stringify(data, null, 2));
  } catch (error) {
    // Silent fail - caching is non-critical
  }
};

const addRankSnapshot = (puuid, rankedData) => {
  if (!rankedData || !Array.isArray(rankedData)) return;

  const history = getRankHistory(puuid);
  const now = new Date().toISOString();

  for (const queue of rankedData) {
    if (!queue.queueType || !queue.tier) continue;

    // Find the most recent snapshot for this queue type
    const lastSnapshot = history.snapshots
      .filter(s => s.queueType === queue.queueType)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

    // Only add snapshot if rank changed (tier, rank, or LP)
    // Also prevent duplicate snapshots within 60 seconds (handles concurrent calls)
    const recentThreshold = 60 * 1000; // 60 seconds
    const isRecent = lastSnapshot &&
      (new Date(now).getTime() - new Date(lastSnapshot.timestamp).getTime()) < recentThreshold;

    const hasChanged = !lastSnapshot ||
      lastSnapshot.tier !== queue.tier ||
      lastSnapshot.rank !== queue.rank ||
      lastSnapshot.leaguePoints !== queue.leaguePoints;

    // Skip if identical data was added recently (deduplication for concurrent calls)
    if (isRecent && !hasChanged) {
      continue;
    }

    if (hasChanged) {
      history.snapshots.push({
        timestamp: now,
        queueType: queue.queueType,
        tier: queue.tier,
        rank: queue.rank,
        leaguePoints: queue.leaguePoints,
        wins: queue.wins,
        losses: queue.losses,
      });
    }
  }

  // Limit snapshot history to prevent unbounded growth
  if (history.snapshots.length > MAX_RANK_SNAPSHOTS) {
    // Sort by timestamp (oldest first) and keep only the most recent
    history.snapshots.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    history.snapshots = history.snapshots.slice(-MAX_RANK_SNAPSHOTS);
  }

  saveRankHistory(puuid, history);
};

const getRankAtTime = (puuid, timestamp, queueType = 'RANKED_SOLO_5x5') => {
  const history = getRankHistory(puuid);
  if (!history.snapshots || history.snapshots.length === 0) return null;

  // Filter snapshots for the specified queue type
  const queueSnapshots = history.snapshots
    .filter(s => s.queueType === queueType)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (queueSnapshots.length === 0) return null;

  // Find the closest snapshot at or before the given timestamp
  const targetTime = new Date(timestamp).getTime();
  let closestSnapshot = null;

  for (const snapshot of queueSnapshots) {
    const snapshotTime = new Date(snapshot.timestamp).getTime();
    if (snapshotTime <= targetTime) {
      closestSnapshot = snapshot;
    } else {
      break;
    }
  }

  // If no snapshot before this time, return the earliest snapshot
  // (represents their rank before we started tracking)
  if (!closestSnapshot && queueSnapshots.length > 0) {
    closestSnapshot = queueSnapshots[0];
  }

  return closestSnapshot;
};

// OP.GG historical rank cache functions (no TTL - historical data is permanent)
const getOpggCache = (puuid) => {
  const cacheFile = path.join(ACCOUNTS_DIR, puuid, 'opgg_ranks.json');
  return readCacheFile(
    cacheFile,
    null,
    (data) => data.version === 1  // Only check version, no TTL for historical data
  );
};

const saveOpggCache = (puuid, data) => {
  try {
    ensureCacheDir(puuid);
    const cacheFile = path.join(ACCOUNTS_DIR, puuid, 'opgg_ranks.json');
    const cacheData = {
      version: 1,
      puuid,
      fetchedAt: new Date().toISOString(),
      ...data
    };
    atomicWriteFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
  } catch (error) {
    // Silent fail - caching is non-critical
  }
};

// Launch League of Legends spectator mode
const launchSpectate = (gameId, encryptionKey, region) => {
  // Validate inputs to prevent shell injection
  // gameId should be numeric (can be large, so use string pattern)
  if (!/^\d+$/.test(String(gameId))) {
    throw new Error('Invalid gameId: must be numeric');
  }
  // encryptionKey should be alphanumeric with possible special chars used by Riot
  if (!/^[a-zA-Z0-9/+=]+$/.test(encryptionKey)) {
    throw new Error('Invalid encryptionKey: contains invalid characters');
  }
  // region should match known LoL regions
  const validRegions = ['NA1', 'EUW1', 'EUN1', 'KR', 'JP1', 'BR1', 'LA1', 'LA2', 'OC1', 'RU', 'TR1'];
  if (!validRegions.includes(region.toUpperCase())) {
    throw new Error('Invalid region');
  }

  const server = `spectator.${region.toLowerCase()}.lol.pvp.net:8080`;

  if (process.platform === 'darwin') {
    // macOS - use the OP.GG command structure
    const cmd = `if test -d /Applications/League\\ of\\ Legends.app/Contents/LoL/Game/ ; then ` +
      `cd /Applications/League\\ of\\ Legends.app/Contents/LoL/Game/ && ` +
      `chmod +x ./LeagueofLegends.app/Contents/MacOS/LeagueofLegends ; else ` +
      `cd /Applications/League\\ of\\ Legends.app/Contents/LoL/RADS/solutions/lol_game_client_sln/releases/ && ` +
      `cd $(ls -1vr -d */ | head -1) && cd deploy && ` +
      `chmod +x ./LeagueofLegends.app/Contents/MacOS/LeagueofLegends ; fi && ` +
      `riot_launched=true ./LeagueofLegends.app/Contents/MacOS/LeagueofLegends ` +
      `"spectator ${server} ${encryptionKey} ${gameId} ${region}" "-UseRads" "-GameBaseDir=.."`;

    require('child_process').exec(cmd, (error) => {
      if (error) console.error('Failed to launch spectate:', error.message);
    });
  } else if (process.platform === 'win32') {
    // Windows
    const cmd = `"C:\\Riot Games\\League of Legends\\Game\\League of Legends.exe" ` +
      `"spectator ${server} ${encryptionKey} ${gameId} ${region}"`;
    require('child_process').exec(cmd);
  }
};

module.exports = {
  delay,
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
  getRankedOnlyPreference,
  setRankedOnlyPreference,
  getTimeScopePreference,
  setTimeScopePreference,
  cycleTimeScope,
  loadCachedAccountByRiotId,
  launchSpectate,
  getRankHistory,
  saveRankHistory,
  addRankSnapshot,
  getRankAtTime,
  getOpggCache,
  saveOpggCache,
};
