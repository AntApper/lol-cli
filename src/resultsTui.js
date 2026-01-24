const blessed = require('blessed');
const stringWidth = require('string-width');
const { getRankedData, getChampionMastery, getLiveGame, getApiStats, getMatchTimeline } = require('./api');
const { formatSummary, formatMatchDetails, formatRankedInfo, formatChampionStats, formatMasteryDisplay, formatRankPreview, colorizeRank, formatLPGraph, formatCompactHistoricalRanks } = require('./ui');
const { delay, getItemData, getChampionData, getSummonerSpellData, getRuneData, getQueueData, getParticipantRankCache, saveParticipantRankCache, getRankedOnlyPreference, setRankedOnlyPreference, getTimeScopePreference, setTimeScopePreference, cycleTimeScope, launchSpectate, getMonitoredAccounts, setActiveAccountIndex, getRankAtTime, getRankHistory, getOpggCache, saveOpggCache } = require('./utils');
const { createMasteryScreen } = require('./masteryTui');
const { createTimelineScreen } = require('./timelineTui');
const opgg = require('./opgg');

// Pad string to target display width (handles full-width characters correctly)
const padEndByWidth = (str, targetWidth) => {
    const currentWidth = stringWidth(str);
    if (currentWidth >= targetWidth) return str;
    return str + ' '.repeat(targetWidth - currentWidth);
};

// Truncate string by display width (handles CJK characters correctly)
const truncateByWidth = (str, maxWidth) => {
    let width = 0;
    let i = 0;
    for (; i < str.length; i++) {
        const charWidth = stringWidth(str[i]);
        if (width + charWidth > maxWidth) break;
        width += charWidth;
    }
    return i < str.length ? str.substring(0, i) + '~' : str;
};

// Color scheme for consistency
const colors = {
  bg: '#282a36',
  fg: '#f8f8f2',
  cyan: '#8be9fd',
  green: '#50fa7b',
  orange: '#ffb86c',
  pink: '#ff79c6',
  purple: '#bd93f9',
  red: '#ff5555',
  yellow: '#f1fa8c',
};

// Track live game state for all monitored accounts (puuid -> { inGame: boolean })
// Module-level to persist across account switches
const accountLiveGameState = new Map();

const rankToScore = (rank) => {
    const tiers = { 'IRON': 0, 'BRONZE': 1, 'SILVER': 2, 'GOLD': 3, 'PLATINUM': 4, 'EMERALD': 5, 'DIAMOND': 6, 'MASTER': 7, 'GRANDMASTER': 8, 'CHALLENGER': 9 };
    const divisions = { 'IV': 0, 'III': 1, 'II': 2, 'I': 3 };
    if (!rank || rank === 'Unranked') return 8; // Treat Unranked as Silver IV
    const [tier, division] = rank.split(' ');
    return (tiers[tier] || 0) * 4 + (divisions[division] || 0);
};

const scoreToRank = (score) => {
    if (score <= 0) return 'Unranked';
    const tiers = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
    const divisions = ['IV', 'III', 'II', 'I'];
    const tierIndex = Math.floor(score / 4);
    const divisionIndex = Math.floor(score % 4);
    const tier = tiers[tierIndex] || 'Unknown';
    if (tierIndex >= 7) return tier; // Master+ has no division
    const division = divisions[divisionIndex] || '';
    return `${tier} ${division}`;
};

const createResultsScreen = async (summoner, matches, region, rankedData, topMasteries, options = {}) => {
  const { monitoredAccounts = null, currentAccountIndex = 0, refreshCallback = null, refreshAccountCallback = null, isOffline: initialOffline = false } = options;

  // Track offline state - can change when connectivity recovers
  let isOffline = initialOffline;

  // Make these mutable so background refresh can update them
  let currentRankedData = rankedData;
  let currentTopMasteries = topMasteries;
  let currentMatches = matches;
  const totalAccounts = monitoredAccounts?.accounts?.length || 1;
  const hasMultipleAccounts = totalAccounts > 1;
  const itemData = await getItemData();
  const spellData = await getSummonerSpellData();
  const runeData = await getRuneData();
  const queueData = await getQueueData();
  const championData = await getChampionData();
  const itemMap = itemData.data;
  const spellMap = new Map(Object.values(spellData.data).map(s => [s.key, s.name]));
  const championMap = new Map(Object.values(championData.data).map(c => [c.key, c.name]));
  const runeMap = new Map();
  runeData.forEach(tree => {
      runeMap.set(tree.id, tree.name);
      tree.slots.forEach(slot => {
          slot.runes.forEach(rune => {
              runeMap.set(rune.id, rune.name);
          });
      });
  });
  const queueMap = new Map(queueData.map(q => [q.queueId, q.description]));

  const getShortQueueName = (desc, queueId) => {
    if (queueId === 1700) return 'Arena';
    if (desc.includes('Ranked Solo')) return 'Ranked';
    if (desc.includes('Ranked Flex')) return 'Flex';
    if (desc.includes('ARAM')) return 'ARAM';
    if (desc.includes('Draft')) return 'Normal';
    if (desc.includes('Blind')) return 'Blind';
    return 'Other';
  };

  // Ranked filter constants and helpers
  const RANKED_QUEUE_IDS = [420, 440];  // Solo/Duo, Flex

  const isMatchRanked = (match) => {
    return RANKED_QUEUE_IDS.includes(match.details.info.queueId);
  };

  // Time scope filter helpers
  const isMatchInTimeScope = (match, scope) => {
    if (scope === 'all' || scope === 'last10') return true;
    const now = Date.now();
    const gameTime = match.details.info.gameCreation;
    if (scope === 'daily') {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return gameTime >= startOfToday.getTime();
  }
    if (scope === 'weekly') return (now - gameTime) <= 7 * 24 * 60 * 60 * 1000;
    return true;
  };

  // Filter LP snapshots by time scope (mirrors match filtering logic)
  const filterSnapshotsByTimeScope = (snapshots, scope, matches) => {
    if (!snapshots || snapshots.length === 0) return snapshots;
    if (scope === 'all') return snapshots;

    if (scope === 'daily') {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startMs = startOfToday.getTime();
      return snapshots.filter(s => new Date(s.timestamp).getTime() >= startMs);
    }

    if (scope === 'weekly') {
      const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      return snapshots.filter(s => new Date(s.timestamp).getTime() >= weekAgo);
    }

    if (scope === 'last10') {
      // Get oldest timestamp from last 10 ranked games
      const rankedMatches = matches
        .filter(m => [420, 440].includes(m.details?.info?.queueId))
        .slice(0, 10);
      if (rankedMatches.length === 0) return [];
      const oldestMatchTime = rankedMatches[rankedMatches.length - 1].details.info.gameCreation;
      return snapshots.filter(s => new Date(s.timestamp).getTime() >= oldestMatchTime);
    }

    return snapshots;
  };

  const getLPGraphLabel = (scope) => {
    if (scope === 'daily') return ' LP Progression (Today) ';
    if (scope === 'weekly') return ' LP Progression (7 Days) ';
    if (scope === 'last10') return ' LP Progression (Last 10) ';
    return ' LP Progression (Solo/Duo) ';
  };

  const getTimeScopeLabel = (scope, count) => {
    if (scope === 'last10') return `Last ${Math.min(count, 10)} Games`;
    if (scope === 'daily') return `Today - ${count} Games`;
    if (scope === 'weekly') return `Last 7 Days - ${count} Games`;
    return `${count} Games`;
  };

  // Load participant rank cache from disk
  const diskRankCache = getParticipantRankCache(summoner.puuid);
  // Ensure ranks object exists for later mutations
  if (!diskRankCache.ranks) {
    diskRankCache.ranks = {};
  }
  const RANK_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

  const playerRankCache = {}; // Cache by PUUID (persists across matches)
  const matchRankCache = {};  // Cache computed match averages

  // Pre-populate playerRankCache from disk cache
  const ranks = diskRankCache.ranks || {};
  Object.entries(ranks).forEach(([puuid, data]) => {
    playerRankCache[puuid] = data.rank;
  });

  // Pre-populate current user's rank from rankedData (used by Ranked box)
  // This ensures Match Ranks panel shows same rank as Ranked box
  if (rankedData && rankedData.length > 0) {
    const soloQueue = rankedData.find(q => q.queueType === 'RANKED_SOLO_5x5');
    const rankString = soloQueue ? `${soloQueue.tier} ${soloQueue.rank}` : 'Unranked';
    playerRankCache[summoner.puuid] = rankString;
    diskRankCache.ranks[summoner.puuid] = { rank: rankString, fetchedAt: new Date().toISOString() };
  }

  // Helper to fetch and cache a player's rank (reduces duplication across fetch functions)
  const fetchAndCacheRank = async (puuid) => {
    const rankData = await getRankedData(region, puuid);
    const soloQueue = rankData.find(q => q.queueType === 'RANKED_SOLO_5x5');
    const rankString = soloQueue ? `${soloQueue.tier} ${soloQueue.rank}` : 'Unranked';
    playerRankCache[puuid] = rankString;
    diskRankCache.ranks[puuid] = { rank: rankString, fetchedAt: new Date().toISOString() };
    return rankString;
  };

  // Helper to fetch OP.GG history for multiple players in parallel (disk cache only)
  const fetchMultipleOpggHistory = async (participants) => {
    const results = new Map();
    const playersToFetch = [];

    for (const p of participants) {
      // Check disk cache first (no TTL - historical data is permanent)
      const diskCached = getOpggCache(p.puuid);
      if (diskCached) {
        results.set(p.puuid, diskCached);
      } else {
        const gameName = p.riotIdGameName || p.riotId?.split('#')[0];
        const tagLine = p.riotIdTagline || p.riotId?.split('#')[1];
        if (gameName && tagLine) {
          playersToFetch.push({ puuid: p.puuid, gameName, tagLine });
        }
      }
    }

    // Fetch uncached players in parallel
    if (playersToFetch.length > 0) {
      const promises = playersToFetch.map(async ({ puuid, gameName, tagLine }) => {
        try {
          const data = await opgg.getSummonerProfile(region, gameName, tagLine, 2);
          if (data) {
            saveOpggCache(puuid, data);  // Save to disk
            results.set(puuid, data);
          }
        } catch (error) {
          // Silent fail for individual players
        }
      });
      await Promise.all(promises);
    }

    return results;
  };

  // Helper to compute match average from cached ranks
  const computeMatchAverage = (matchIndex) => {
    const participants = currentMatches[matchIndex].details.info.participants;
    const ranks = {};
    let totalScore = 0;
    let rankedCount = 0;
    let allCached = true;

    for (const p of participants) {
      if (playerRankCache[p.puuid] !== undefined) {
        ranks[p.puuid] = playerRankCache[p.puuid];
        if (ranks[p.puuid] !== 'N/A' && ranks[p.puuid] !== 'Unranked') {
          totalScore += rankToScore(ranks[p.puuid]);
          rankedCount++;
        }
      } else {
        allCached = false;
      }
    }

    // Always store the computed average, even if partial
    // This ensures UI shows something while waiting for fresh fetches
    if (Object.keys(ranks).length > 0) {
      matchRankCache[matchIndex] = {
        players: ranks,
        average: rankedCount > 0 ? scoreToRank(totalScore / rankedCount) : '...',
        complete: allCached,  // Track if all ranks are fetched
      };
    }
    return allCached;
  };

  // Pre-compute match averages from cached data
  for (let i = 0; i < currentMatches.length; i++) {
    computeMatchAverage(i);
  }

  const fetchMatchRanks = async (matchIndex, skipDelay = false) => {
    // Only skip if we have a complete cache
    if (matchRankCache[matchIndex]?.complete) return;

    const ranks = {};
    let totalScore = 0;
    let rankedCount = 0;
    let hasFailures = false;
    const participants = currentMatches[matchIndex].details.info.participants;

    for (const p of participants) {
      // Check PUUID cache first
      if (playerRankCache[p.puuid] !== undefined) {
        ranks[p.puuid] = playerRankCache[p.puuid];
        if (ranks[p.puuid] !== 'N/A' && ranks[p.puuid] !== 'Unranked') {
          totalScore += rankToScore(ranks[p.puuid]);
          rankedCount++;
        }
        continue;
      }

      try {
        const rankString = await fetchAndCacheRank(p.puuid);
        ranks[p.puuid] = rankString;
        if (rankString !== 'Unranked') {
          totalScore += rankToScore(rankString);
          rankedCount++;
        }
      } catch (error) {
        if (process.env.DEBUG) {
          console.error(`[FetchMatch] Failed to fetch rank for ${p.riotIdGameName || p.puuid.substring(0, 20)}:`, error.message || error);
        }
        ranks[p.puuid] = '...';
        hasFailures = true;
      }
      if (!skipDelay) await delay(50);
    }

    matchRankCache[matchIndex] = {
      players: ranks,
      average: rankedCount > 0 ? scoreToRank(totalScore / rankedCount) : '...',
      complete: !hasFailures,
    };
  };

  // Find stale ranks (older than TTL) that need refresh
  const getStalePlayerPuuids = () => {
    const now = Date.now();
    const stalePuuids = new Set();

    for (const match of matches) {
      for (const p of match.details.info.participants) {
        const cached = diskRankCache.ranks[p.puuid];
        const fetchTime = cached ? new Date(cached.fetchedAt).getTime() : NaN;
        if (!cached || isNaN(fetchTime) || (now - fetchTime > RANK_TTL)) {
          stalePuuids.add(p.puuid);
        }
      }
    }
    return Array.from(stalePuuids);
  };

  return new Promise((resolve) => {
    let isScreenDestroyed = false;
    let isRefreshing = false;
    let refreshPromise = null;  // Promise-based lock for background refresh
    let liveGameTimer = null;  // Timer for live game time updates
    let currentLiveGameData = null;  // Store for spectate functionality

    const screen = blessed.screen({
      smartCSR: true,
      title: `Stats for ${summoner.name} [${region}]`,
      fullUnicode: true,
    });

    // Warn if terminal is too small for optimal display
    const MIN_HEIGHT = 45;
    const isTerminalSmall = screen.height < MIN_HEIGHT;

    const layout = blessed.box({
        parent: screen,
        width: '100%',
        height: '100%',
        style: {
            bg: colors.bg,
            fg: colors.fg,
        },
    });

    blessed.text({
        parent: layout,
        top: 0,
        left: 'center',
        content: `Summoner: {bold}${summoner.name}{/bold} [Lvl ${summoner.summonerLevel}] | Region: {bold}${region}{/bold}`,
        tags: true,
        style: {
            fg: colors.cyan,
        },
    });

    // Account list indicator (row 1, right-aligned)
    // Format: Accounts: > Name1 (R1) | Name2 (R2) | Name3 (R3)
    const formatAccountList = () => {
      if (!hasMultipleAccounts) return '';
      const accounts = monitoredAccounts.accounts;
      const parts = accounts.map((acc, idx) => {
        // Truncate name to 12 display columns (handles CJK characters)
        let name = acc.riotId.split('#')[0];
        if (stringWidth(name) > 12) name = truncateByWidth(name, 11);
        // Shorten region display
        const regionShort = acc.region.replace(/1$/, '');
        const display = `${name} (${regionShort})`;
        if (idx === currentAccountIndex) {
          return `{cyan-fg}>${display}{/cyan-fg}`;  // Selected: cyan with >
        }
        return ` ${display}`;  // Unselected: default yellow, space padding
      });
      return `Accounts: ${parts.join(' | ')}`;
    };

    const accountIndicator = blessed.text({
        parent: layout,
        top: 1,
        right: 1,
        content: formatAccountList(),
        tags: true,
        style: {
            fg: colors.yellow,
        },
    });

    // Refresh status indicator (left side, below header)
    // Also shows terminal size warning if too small
    const getInitialStatusContent = () => {
        if (isTerminalSmall) return `{yellow-fg}Terminal too small (${screen.height} rows, need ${MIN_HEIGHT}){/yellow-fg}`;
        if (isOffline) return '{yellow-fg}Offline Mode{/yellow-fg}';
        return '';
    };
    const refreshIndicator = blessed.text({
        parent: layout,
        top: 1,
        left: 1,
        content: getInitialStatusContent(),
        tags: true,
        style: {
            fg: colors.yellow,
        },
    });

    // API stats indicator (shows request count and rate limits)
    const apiStatsIndicator = blessed.text({
        parent: layout,
        top: 1,
        left: 20,
        content: '',
        tags: true,
        style: {
            fg: colors.fg,
        },
    });

    // Update API stats display
    const updateApiStatsDisplay = () => {
        if (isScreenDestroyed) return;
        const stats = getApiStats();
        let content = stats.pending > 0 ? `${stats.pending} pending` : '';
        apiStatsIndicator.setContent(content);
    };

    // Initial update and periodic refresh of API stats (every 2 seconds)
    updateApiStatsDisplay();
    const apiStatsTimer = setInterval(() => {
        if (!isScreenDestroyed) {
            updateApiStatsDisplay();
            screen.render();
        }
    }, 2000);

    // Row 1: Ranked Info (left) | LP Graph (right, when not in live game)
    const rankedBox = blessed.box({
        parent: layout,
        width: '50%',
        height: 9,
        top: 2,
        left: 0,
        label: ' Ranked ',
        content: formatRankedInfo(rankedData),
        tags: true,
        border: {
            type: 'line',
            fg: colors.purple,
        },
        style: {
            border: { fg: colors.purple }
        }
    });

    // Load filter preferences early (needed for LP graph initial render)
    let rankedOnly = getRankedOnlyPreference();
    let timeScope = getTimeScopePreference();

    // LP Progression Graph (top right, visible when NOT in live game)
    const rankHistory = getRankHistory(summoner.puuid);
    const filteredSnapshots = filterSnapshotsByTimeScope(
      rankHistory.snapshots, timeScope, currentMatches
    );
    const lpGraphBox = blessed.box({
        parent: layout,
        width: '50%',
        height: 9,
        top: 2,
        right: 0,
        label: getLPGraphLabel(timeScope),
        content: formatLPGraph(filteredSnapshots, 50, 7),
        tags: true,
        border: {
            type: 'line',
            fg: colors.purple,
        },
        style: {
            border: { fg: colors.purple }
        }
    });

    // Live Game and Live Ranks panels - positioned at bottom, side by side
    const liveGameBox = blessed.box({
        parent: layout,
        width: '50%',
        height: 15,
        bottom: 1,  // Above footer
        left: 0,
        label: ' Live Game ',
        tags: true,
        hidden: true,  // Start hidden, show only when in game
        border: {
            type: 'line',
            fg: colors.purple,
        },
        style: {
            border: { fg: colors.purple }
        }
    });

    const liveRanksBox = blessed.box({
        parent: layout,
        width: '50%',
        height: 15,  // 13 lines content + 2 for borders
        bottom: 1,   // Above footer
        right: 0,
        label: ' Live Ranks ',
        tags: true,
        hidden: true,  // Start hidden, show only when in game
        scrollable: true,
        keys: true,
        vi: true,
        border: {
            type: 'line',
            fg: colors.purple,
        },
        style: {
            border: { fg: colors.purple }
        }
    });

    // Row 2: Summary (left) | Top Masteries (right)
    const summaryBox = blessed.box({
        parent: layout,
        width: '50%',
        height: 7,
        top: 11,
        left: 0,
        label: ` Last ${currentMatches.length} Games `,
        content: formatSummary(summoner, currentMatches),
        tags: true,
        border: {
            type: 'line',
            fg: colors.purple,
        },
        style: {
            border: { fg: colors.purple }
        }
    });

    const masteryBox = blessed.box({
        parent: layout,
        width: '50%',
        height: 7,
        top: 11,
        right: 0,
        label: ' Top Champion Masteries ',
        content: formatMasteryDisplay(topMasteries, championMap),
        tags: true,
        border: {
            type: 'line',
            fg: colors.purple,
        },
        style: {
            border: { fg: colors.purple }
        }
    });

    // Row 3: Champion Stats (full width)
    const championStatsBox = blessed.box({
        parent: layout,
        width: '100%',
        height: 7,
        top: 18,
        left: 0,
        label: ' Champion Stats (Recent Games) ',
        content: formatChampionStats(currentMatches, summoner.puuid),
        tags: true,
        border: {
            type: 'line',
            fg: colors.purple,
        },
        style: {
            border: { fg: colors.purple }
        }
    });

    // Fetch ranks for all live game participants (uses cache when available)
    const fetchLiveGameRanks = async (participants) => {
        const ranks = {};
        for (const p of participants) {
            // Check cache first
            if (playerRankCache[p.puuid] !== undefined) {
                ranks[p.puuid] = playerRankCache[p.puuid];
                continue;
            }
            try {
                const rankString = await fetchAndCacheRank(p.puuid);
                ranks[p.puuid] = rankString;
            } catch (error) {
                ranks[p.puuid] = '...';
            }
            await delay(100); // Rate limit: 100ms between requests
        }
        return ranks;
    };

    // Format live game ranks display with team separation
    const formatLiveRanks = (participants, ranks, currentPuuid, queueId, opggData = {}) => {
        const formatPlayer = (p) => {
            // Get player name from riotId (format: "name#tag")
            const rawName = p.riotId?.split('#')[0] || '???';
            const name = padEndByWidth(truncateByWidth(rawName, 10), 11);

            // Get champion name
            const champName = padEndByWidth(truncateByWidth(championMap.get(String(p.championId)) || 'Unknown', 8), 9);

            // Get current rank
            const rank = ranks[p.puuid] || '...';

            // Get historical ranks from OP.GG (compact format)
            const playerOpgg = opggData.get?.(p.puuid);
            const history = playerOpgg ? formatCompactHistoricalRanks(playerOpgg, 2) : '';

            // Highlight current user
            const prefix = p.puuid === currentPuuid ? '{cyan-fg}>{/cyan-fg}' : ' ';

            // Format: Name Champion Rank | History
            const rankDisplay = colorizeRank(rank);
            if (history) {
                return `${prefix}${name} ${champName} ${rankDisplay} ${history}`;
            }
            return `${prefix}${name} ${champName} ${rankDisplay}`;
        };

        // Handle Arena mode (8 solo players with teamId 1-8)
        if (queueId === 1700) {
            let content = '{purple-fg}Arena Players{/purple-fg}\n';
            content += participants.map(formatPlayer).join('\n');
            return content;
        }

        // Standard 5v5 mode
        const blueTeam = participants.filter(p => p.teamId === 100);
        const redTeam = participants.filter(p => p.teamId === 200);

        // Header row matching column widths
        const headerRow = `{bold} ${'NAME'.padEnd(11)} ${'CHAMP'.padEnd(10)}RANK{/bold}`;
        const separatorLine = '{gray-fg}' + '─'.repeat(40) + '{/gray-fg}';

        let content = '{cyan-fg}Blue Team{/cyan-fg}\n';
        content += headerRow + '\n';
        content += separatorLine + '\n';
        content += blueTeam.map(formatPlayer).join('\n');
        content += '\n\n{red-fg}Red Team{/red-fg}\n';
        content += headerRow + '\n';
        content += separatorLine + '\n';
        content += redTeam.map(formatPlayer).join('\n');
        return content;
    };

    // Track if we've already fetched ranks for the current live game
    let liveGameRanksFetched = false;
    let currentLiveGameId = null;
    let liveGameAvgRank = null;  // Store computed average rank for live game

    const checkLiveGame = async () => {
        // Guard: Don't run if screen is destroyed
        if (isScreenDestroyed) return;

        // Clear any existing live game timer before potentially creating a new one
        if (liveGameTimer) {
            clearInterval(liveGameTimer);
            liveGameTimer = null;
        }

        let liveGameData = null;
        try {
            liveGameData = await getLiveGame(region, summoner.puuid);
        } catch (error) {
            // API failed - hide live game panels gracefully
            liveGameBox.hidden = true;
            liveRanksBox.hidden = true;
            // Restore match list height (15 is the correct height when no live game)
            matchList.height = 19;
            rankPreviewBox.height = 19;
            // Show appropriate error message based on error type
            if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
                refreshIndicator.setContent('{yellow-fg}Network error{/}');
            } else if (error.response?.status === 502 || error.response?.status === 503) {
                refreshIndicator.setContent('{yellow-fg}API unavailable{/}');
            } else if (error.message?.toLowerCase().includes('apikey') ||
                error.message?.toLowerCase().includes('api key') ||
                error.response?.status === 403) {
                refreshIndicator.setContent('{red-fg}API key invalid{/}');
            }
            screen.render();
            return; // Exit gracefully
        }

        // Guard: Check again after async operation
        if (isScreenDestroyed) return;

        // Store for spectate functionality
        currentLiveGameData = liveGameData;

        if (liveGameData) {
            liveGameBox.hidden = false;
            liveRanksBox.hidden = false;
            // Reduce match list height to make room for live panels at bottom
            matchList.height = Math.max(6, screen.height - 25 - 16);
            rankPreviewBox.height = Math.max(6, screen.height - 25 - 16);

            const participant = liveGameData.participants.find(p => p.puuid === summoner.puuid);
            if (participant) {
                const championName = championMap.get(String(participant.championId)) || 'Unknown';

                const spell1 = spellMap.get(String(participant.spell1Id)) || 'N/A';
                const spell2 = spellMap.get(String(participant.spell2Id)) || 'N/A';

                const keystone = runeMap.get(participant.perks.perkIds[0]) || 'N/A';
                const secondaryTree = runeMap.get(participant.perks.perkSubStyle) || 'N/A';

                const queueName = queueMap.get(liveGameData.gameQueueConfigId) || 'Unknown Queue';

                const role = liveGameData.gameQueueConfigId === 1700
                    ? 'Arena'
                    : participant.teamPosition || participant.individualPosition || 'N/A';

                const updateGameTime = () => {
                    // Guard: Don't update if screen is destroyed
                    if (isScreenDestroyed) return;

                    const startTime = new Date(liveGameData.gameStartTime);
                    const now = new Date();
                    const diff = now - startTime;
                    const minutes = Math.floor(diff / 60000);
                    const seconds = Math.floor((diff % 60000) / 1000);
                    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

                    const avgRankDisplay = liveGameAvgRank ? colorizeRank(liveGameAvgRank) : '...';
                    const content = ` Queue: ${queueName}\n` +
                                  ` Champion: ${championName}\n` +
                                  ` Role: ${role}\n` +
                                  ` Time: ${formattedTime}\n` +
                                  ` Spells: ${spell1}, ${spell2}\n` +
                                  ` Keystone: ${keystone}\n` +
                                  ` Secondary: ${secondaryTree}\n` +
                                  ` Avg Rank: ${avgRankDisplay}`;

                    liveGameBox.setContent(content);
                    screen.render();
                };

                updateGameTime();
                // Store timer reference for cleanup - no screen.on('destroy') here
                liveGameTimer = setInterval(updateGameTime, 1000);
            }

            // Fetch and display ranks for live game participants (only once per game)
            if (currentLiveGameId !== liveGameData.gameId) {
                currentLiveGameId = liveGameData.gameId;
                liveGameRanksFetched = false;
                liveGameAvgRank = null;  // Reset average for new game
                liveRanksBox.setContent(' Loading ranks...');
                screen.render();
            }

            if (!liveGameRanksFetched) {
                liveGameRanksFetched = true;
                const gameIdAtFetch = liveGameData.gameId;
                const queueIdAtFetch = liveGameData.gameQueueConfigId;
                const participantsAtFetch = liveGameData.participants;

                // Fetch ranks and OP.GG history in parallel (non-blocking)
                Promise.all([
                    fetchLiveGameRanks(participantsAtFetch),
                    fetchMultipleOpggHistory(participantsAtFetch)
                ]).then(([ranks, opggData]) => {
                    // Guard against stale data: only update if still viewing same game
                    if (isScreenDestroyed || currentLiveGameId !== gameIdAtFetch) return;

                    // Compute average rank (excluding Unranked and N/A)
                    let totalScore = 0;
                    let rankedCount = 0;
                    Object.values(ranks).forEach(rank => {
                        if (rank !== 'N/A' && rank !== 'Unranked') {
                            totalScore += rankToScore(rank);
                            rankedCount++;
                        }
                    });
                    liveGameAvgRank = rankedCount > 0 ? scoreToRank(totalScore / rankedCount) : null;

                    const content = formatLiveRanks(participantsAtFetch, ranks, summoner.puuid, queueIdAtFetch, opggData);
                    liveRanksBox.setContent(content);
                    screen.render();
                }).catch(() => {
                    if (isScreenDestroyed || currentLiveGameId !== gameIdAtFetch) return;
                    liveRanksBox.setContent(' Failed to load ranks');
                    screen.render();
                });
            }
        } else {
            liveGameBox.hidden = true;
            liveGameBox.setContent('');
            liveRanksBox.hidden = true;
            liveRanksBox.setContent('');
            // Restore match list height when no live game
            matchList.height = 19;
            rankPreviewBox.height = 19;
            // Reset live game tracking
            currentLiveGameId = null;
            liveGameRanksFetched = false;
            liveGameAvgRank = null;
        }

        // Track state for current account's game-end detection
        const wasInGame = accountLiveGameState.get(summoner.puuid)?.inGame || false;
        const isInGame = !!liveGameData;
        accountLiveGameState.set(summoner.puuid, { inGame: isInGame });

        // Current account's game just ended - trigger UI refresh
        if (wasInGame && !isInGame && !modalOpen && !isRefreshing) {
            // Don't await - let it run in background
            runBackgroundRefresh().catch(() => {});
        }

        if (!isScreenDestroyed) {
            // Update footer to show/hide spectate option
            const isAnyExpanded = Object.values(expanded).some(v => v);
            footer.setContent(getFooterContent(isAnyExpanded));
            screen.render();
        }
    };

    // Only check live game if not in offline mode
    if (!isOffline) {
        checkLiveGame();
    }

    // Check live game status for OTHER monitored accounts (not current)
    // Detects when any OTHER account finishes a game and refreshes their cache
    // Current account is handled by checkLiveGame() with state tracking
    const checkAllAccountsLiveGame = async () => {
        if (isScreenDestroyed || !refreshAccountCallback) return;

        const monitoredData = getMonitoredAccounts();
        const otherAccounts = monitoredData.accounts.filter(a => a.puuid !== summoner.puuid);

        // Check all accounts in parallel for faster response
        const results = await Promise.allSettled(
            otherAccounts.map(async (account) => {
                const liveGame = await getLiveGame(account.region, account.puuid);
                return { account, liveGame };
            })
        );

        if (isScreenDestroyed) return;

        // Process results and trigger refreshes for accounts whose games ended
        for (const result of results) {
            if (result.status !== 'fulfilled') continue;

            const { account, liveGame } = result.value;
            const wasInGame = accountLiveGameState.get(account.puuid)?.inGame || false;
            const isInGame = !!liveGame;

            // Update state
            accountLiveGameState.set(account.puuid, { inGame: isInGame });

            // Game just ended for this OTHER account - refresh its cache silently
            if (wasInGame && !isInGame) {
                // Fire and forget - don't await to avoid blocking
                refreshAccountCallback(account.region, account.puuid).catch(() => {});
            }
        }
    };

    // Periodic live game check every 30 seconds (with guard)
    // Checks ALL monitored accounts and detects game endings
    // Skip in offline mode
    const liveGameCheckInterval = isOffline ? null : setInterval(async () => {
        if (!isScreenDestroyed) {
            try {
                // Check current account's live game for UI display
                await checkLiveGame();
                // Check all accounts for game end detection
                await checkAllAccountsLiveGame();
            } catch (error) {
                // Rate limit or API error - hide panels to avoid stale data
                currentLiveGameData = null;
                liveGameBox.hidden = true;
                liveGameBox.setContent('');
                liveRanksBox.hidden = true;
                liveRanksBox.setContent('');
                // Show error hint to user
                if (error.message?.includes('apikey') || error.message?.includes('API key')) {
                    refreshIndicator.setContent('{red-fg}API key invalid{/red-fg}');
                }
                screen.render();
            }
        }
    }, 30000);

    const matchList = blessed.list({
      parent: layout,
      width: '50%',
      top: 25,
      height: 19,
      left: 0,
      items: [],
      border: {
        type: 'line',
        fg: colors.purple,
      },
      label: ` Match History - ${currentMatches.length} Games (Select to expand) `,
      mouse: true,
      keys: true,
      vi: true,
      scrollable: true,
      tags: true,
      style: {
        border: { fg: colors.purple },
        selected: { bg: colors.pink, fg: colors.bg },
      },
    });

    // Rank preview panel (right side, 50% width)
    const rankPreviewBox = blessed.box({
      parent: layout,
      width: '50%',
      top: 25,
      height: 19,
      right: 0,
      label: ' Match Ranks ',
      tags: true,
      border: {
        type: 'line',
        fg: colors.purple,
      },
      style: {
        border: { fg: colors.purple },
      },
    });

    // Preview panel update function
    let updatePreviewPanel = null; // Will be defined after listIndexMap is created

    const getFooterContent = (isExpanded) => {
        let content = '';
        if (hasMultipleAccounts) {
            content += 'Tab: Switch | ';
        }
        // Ranked filter indicator - show current state
        content += rankedOnly
            ? '{yellow-fg}r: Ranked{/yellow-fg}'
            : 'r: All';
        // Time scope indicator - show current state
        if (!isExpanded) {
            const currentLabels = { 'all': 'All', 'last10': 'Last 10', 'daily': 'Today', 'weekly': 'Week' };
            const isActive = timeScope !== 'all';
            content += isActive
                ? ` | {yellow-fg}t: ${currentLabels[timeScope]}{/yellow-fg}`
                : ` | t: ${currentLabels[timeScope]}`;
        }
        content += ' | d: Remove | c: Connect | m: Mastery';
        if (currentLiveGameData && !isOffline) {
            content += ' | {green-fg}s: Spectate{/green-fg}';
        }
        if (isExpanded) {
            content += ' | b/backspace: Back | t: Timeline';
        }
        content += ' | q: Quit';
        return content;
    };

    const footer = blessed.box({
        parent: layout,
        width: '100%',
        height: 1,
        bottom: 0,
        left: 'center',
        content: getFooterContent(false),
        tags: true,
        style: {
            fg: colors.orange,
        },
    });

    const expanded = {};
    let listIndexMap = [];

    // Track OP.GG data fetch state per match to avoid duplicate fetches
    const opggFetchedForMatch = {};

    // Define updatePreviewPanel now that listIndexMap exists
    updatePreviewPanel = () => {
      const listIndex = matchList.selected;
      let matchIndex = null;

      // Find actual match index (handle detail lines)
      for (let i = listIndex; i >= 0; i--) {
        if (listIndexMap[i] !== null && listIndexMap[i] !== undefined) {
          matchIndex = listIndexMap[i];
          break;
        }
      }

      if (matchIndex === null) {
        rankPreviewBox.setContent('');
        return;
      }

      const match = currentMatches[matchIndex];
      const rankData = matchRankCache[matchIndex]?.players;
      // Build map of historical ranks for all monitored accounts in this match
      const historicalRanks = {};
      const monitoredPuuids = new Set(monitoredAccounts?.accounts?.map(a => a.puuid) || []);
      if (match?.details?.info?.participants) {
        for (const p of match.details.info.participants) {
          if (monitoredPuuids.has(p.puuid)) {
            const snapshot = getRankAtTime(p.puuid, match.details.info.gameCreation);
            if (snapshot) {
              historicalRanks[p.puuid] = snapshot;
            }
          }
        }
      }

      // Build OP.GG history map from disk cache
      const opggHistoryMap = new Map();
      if (match?.details?.info?.participants) {
        for (const p of match.details.info.participants) {
          const diskCached = getOpggCache(p.puuid);
          if (diskCached) {
            opggHistoryMap.set(p.puuid, diskCached);
          }
        }
      }

      rankPreviewBox.setContent(formatRankPreview(match, rankData, summoner, historicalRanks, opggHistoryMap));
      screen.render();

      // Fetch OP.GG history in background if not already fetched for this match
      if (!opggFetchedForMatch[matchIndex] && match?.details?.info?.participants) {
        opggFetchedForMatch[matchIndex] = true;
        fetchMultipleOpggHistory(match.details.info.participants).then(() => {
          if (isScreenDestroyed) return;
          // Re-render preview panel with updated OP.GG data
          const currentListIndex = matchList.selected;
          let currentMatchIndex = null;
          for (let i = currentListIndex; i >= 0; i--) {
            if (listIndexMap[i] !== null && listIndexMap[i] !== undefined) {
              currentMatchIndex = listIndexMap[i];
              break;
            }
          }
          // Only update if user is still viewing the same match
          if (currentMatchIndex === matchIndex) {
            const updatedOpggMap = new Map();
            for (const p of match.details.info.participants) {
              const diskCached = getOpggCache(p.puuid);
              if (diskCached) {
                updatedOpggMap.set(p.puuid, diskCached);
              }
            }
            rankPreviewBox.setContent(formatRankPreview(match, rankData, summoner, historicalRanks, updatedOpggMap));
            screen.render();
          }
        }).catch(() => {
          // Silent fail - OP.GG data is supplementary
        });
      }
    };

    // Hook navigation events for preview updates
    matchList.key(['up', 'down', 'j', 'k', 'pageup', 'pagedown', 'home', 'end'], () => {
      process.nextTick(updatePreviewPanel);
    });

    matchList.on('element click', () => {
      process.nextTick(updatePreviewPanel);
    });

    const getFilteredMatches = () => {
      let matches = currentMatches;
      if (rankedOnly) matches = matches.filter(isMatchRanked);
      if (timeScope === 'last10') {
        matches = matches.slice(0, 10);
      } else if (timeScope !== 'all') {
        matches = matches.filter(m => isMatchInTimeScope(m, timeScope));
      }
      return matches;
    };

    const setPanelVisibility = (visible) => {
      rankedBox.hidden = !visible;
      summaryBox.hidden = !visible;
      masteryBox.hidden = !visible;  // Mastery always follows panel visibility
      championStatsBox.hidden = !visible;
      rankPreviewBox.hidden = !visible;
      matchList.top = visible ? 25 : 2;
      matchList.width = visible ? '50%' : '100%';  // Full width when expanded

      // Handle live game panels, LP graph, and match list height
      const isLiveGame = !!currentLiveGameData;
      if (!visible) {
        // When expanded, hide all top-right panels and use full height
        liveGameBox.hidden = true;
        liveRanksBox.hidden = true;
        lpGraphBox.hidden = true;
        matchList.height = '90%';
      } else {
        // When collapsed, show LP graph always (top-right) and live panels when in game (bottom)
        liveGameBox.hidden = !isLiveGame;
        liveRanksBox.hidden = !isLiveGame;
        lpGraphBox.hidden = false;  // LP graph always visible (no layout conflict with live panels)
        matchList.height = isLiveGame ? Math.max(6, screen.height - 25 - 16) : 19;
        rankPreviewBox.height = isLiveGame ? Math.max(6, screen.height - 25 - 16) : 19;
      }
    };

    const updatePanels = (filteredMatches) => {
      summaryBox.setContent(formatSummary(summoner, filteredMatches));
      championStatsBox.setContent(formatChampionStats(filteredMatches, summoner.puuid));

      // Build filter label: combine ranked and time scope indicators
      const count = filteredMatches.length;
      let summaryLabel, statsLabel;

      if (rankedOnly && timeScope !== 'all') {
        // Both filters active
        const timePart = timeScope === 'last10' ? `Last ${Math.min(count, 10)}` :
                        timeScope === 'daily' ? 'Today' : 'Week';
        summaryLabel = ` Ranked + ${timePart} - ${count} Games `;
        statsLabel = ` Ranked + ${timePart} Stats (${count} Games) `;
      } else if (rankedOnly) {
        summaryLabel = ` Ranked Only - ${count} Games `;
        statsLabel = ` Ranked Stats (${count} Games) `;
      } else if (timeScope !== 'all') {
        summaryLabel = ` ${getTimeScopeLabel(timeScope, count)} `;
        statsLabel = ` ${getTimeScopeLabel(timeScope, count)} Stats `;
      } else {
        summaryLabel = ` Last ${count} Games `;
        statsLabel = ' Champion Stats (Recent Games) ';
      }

      summaryBox.setLabel(summaryLabel);
      championStatsBox.setLabel(statsLabel);
    };

    // Centralized border color update for filter states (ranked or time scope)
    const updateAllBorderColors = () => {
      if (isScreenDestroyed) return;
      // Yellow border indicates ranked-only filter is active
      const borderColor = rankedOnly ? colors.yellow : colors.purple;

      // Update all panel borders
      rankedBox.style.border.fg = borderColor;
      lpGraphBox.style.border.fg = borderColor;
      liveGameBox.style.border.fg = borderColor;
      liveRanksBox.style.border.fg = borderColor;
      summaryBox.style.border.fg = borderColor;
      masteryBox.style.border.fg = borderColor;
      championStatsBox.style.border.fg = borderColor;
      rankPreviewBox.style.border.fg = borderColor;
      matchList.style.border.fg = borderColor;

      // Force full screen redraw - use alloc() to batch the redraw
      // instead of calling clearPos() 9 times which causes flicker
      screen.alloc();
      screen.render();
    };

    const updateList = () => {
        const items = [];
        listIndexMap = [];
        let isAnyExpanded = false;

        const displayMatches = getFilteredMatches();

        // Handle empty state
        if (displayMatches.length === 0) {
            items.push('{gray-fg}No ranked games in last 10 matches{/gray-fg}');
            listIndexMap.push(null);
        } else {
            displayMatches.forEach((match) => {
                const realIndex = currentMatches.indexOf(match);  // Map back to current index
                const participant = match.details.info.participants.find(p => p.puuid === summoner.puuid);
                if (!participant) return;  // Skip malformed match data
                const queueId = match.details.info.queueId;
                const queueDesc = queueMap.get(queueId) || '';
                const queueLabel = getShortQueueName(queueDesc, queueId).padEnd(10);
                const roleMap = { TOP: 'TOP', JUNGLE: 'JGL', MIDDLE: 'MID', BOTTOM: 'BOT', UTILITY: 'SUP' };
                const rawRole = queueId === 1700 ? 'Arena' : (participant.teamPosition || participant.individualPosition || '');
                const role = (rawRole === 'Invalid' || rawRole === '' || queueId === 450) ? '      ' : (roleMap[rawRole] || rawRole).padEnd(6);
                const avgRank = matchRankCache[realIndex]
                  ? `Avg: ${colorizeRank(matchRankCache[realIndex].average.padEnd(12))}`
                  : '';
                const gameDate = new Date(match.details.info.gameCreation).toLocaleDateString().padEnd(12);
                let resultText;
                if (!participant.win && match.details.info.gameDuration < 300) {
                    resultText = 'Remake';
                } else {
                    resultText = participant.win ? 'Win' : 'Loss';
                }
                const paddedResult = resultText.padEnd(7);
                const championName = participant.championName.padEnd(16);
                const kdaValue = `${participant.kills}/${participant.deaths}/${participant.assists}`.padEnd(8);
                const kdaRatio = (participant.kills + participant.assists) / Math.max(participant.deaths, 1);
                let coloredKda;
                if (kdaRatio >= 4.0) {
                    coloredKda = `{green-fg}${kdaValue}{/green-fg}`;
                } else if (kdaRatio <= 1.5) {
                    coloredKda = `{red-fg}${kdaValue}{/red-fg}`;
                } else {
                    coloredKda = kdaValue;
                }
                const kda = `KDA: ${coloredKda}`;
                let coloredResult;
                if (resultText === 'Win') {
                    coloredResult = `{green-fg}${paddedResult}{/green-fg}`;
                } else if (resultText === 'Loss') {
                    coloredResult = `{red-fg}${paddedResult}{/red-fg}`;
                } else {
                    coloredResult = `{grey-fg}${paddedResult}{/grey-fg}`;
                }
                const rankDisplay = avgRank;
                const summary = `${gameDate}${coloredResult} - ${championName}${queueLabel}${role}${kda} ${rankDisplay}`;
                items.push(summary);
                listIndexMap.push(realIndex);

                if (expanded[realIndex]) {
                    isAnyExpanded = true;
                    const details = formatMatchDetails(match, summoner, itemMap, spellMap, runeMap, screen.width, matchRankCache[realIndex]?.players);
                    details.split('\n').forEach(line => {
                        items.push(line);
                        listIndexMap.push(null);
                    });
                }
            });
        }

        // Update label to show filter status
        const count = displayMatches.length;
        const total = currentMatches.length;
        let label;
        if (rankedOnly && timeScope !== 'all') {
            const timePart = timeScope === 'last10' ? `Last ${Math.min(count, 10)}` :
                            timeScope === 'daily' ? 'Today' : 'Week';
            label = ` Ranked + ${timePart} - ${count}/${total} Games `;
        } else if (rankedOnly) {
            label = ` Ranked Only - ${count}/${total} Games `;
        } else if (timeScope !== 'all') {
            label = ` ${getTimeScopeLabel(timeScope, count)} (${count}/${total}) `;
        } else {
            label = ` Match History - ${total} Games `;
        }
        matchList.setLabel(label);

        matchList.setItems(items);

        // Hide/show panels based on expansion state
        setPanelVisibility(!isAnyExpanded);

        footer.setContent(getFooterContent(isAnyExpanded));
        screen.render();
    };

    matchList.on('select', async (item, index) => {
        const matchIndex = listIndexMap[index];
        if (matchIndex !== null) {
            const currentlySelected = matchList.selected;
            expanded[matchIndex] = !expanded[matchIndex];

            if (expanded[matchIndex] && !matchRankCache[matchIndex]?.complete) {
                // Show ephemeral loading label
                const loading = blessed.box({
                    parent: screen,
                    top: 'center',
                    left: 'center',
                    height: 1,
                    width: 20,
                    content: 'Loading ranks...',
                    style: {
                        bg: colors.bg,
                        fg: colors.yellow,
                    },
                });
                screen.render();

                // Helper to destroy loading box safely
                const destroyLoading = () => {
                    if (!isScreenDestroyed && !loading.destroyed) {
                        loading.destroy();
                        screen.render();
                    }
                };

                // Fallback timeout (2 seconds) in case fetch hangs
                const loadingTimeout = setTimeout(destroyLoading, 2000);

                // Fetch ranks in background (don't await - non-blocking)
                fetchMatchRanks(matchIndex).then(() => {
                    clearTimeout(loadingTimeout);
                    destroyLoading();
                    if (isScreenDestroyed) return;
                    updateList();
                    updatePreviewPanel();
                    screen.render();
                }).catch(() => {
                    clearTimeout(loadingTimeout);
                    destroyLoading();
                });
            }

            updateList();
            matchList.select(currentlySelected);
        }
    });
    
    let modalOpen = false;
    
    screen.key('m', async () => {
        if (modalOpen) return;
        let matchIndex = null;
        for (let i = matchList.selected; i >= 0; i--) {
            if (listIndexMap[i] !== null) {
                matchIndex = listIndexMap[i];
                break;
            }
        }

        if (matchIndex !== null) {
            const match = currentMatches[matchIndex];
            const participant = match.details.info.participants.find(p => p.puuid === summoner.puuid);
            
            const loading = blessed.box({ 
                parent: screen, 
                top: 'center', 
                left: 'center', 
                height: 1, 
                width: 20, 
                content: 'Loading mastery...',
                style: {
                    bg: colors.bg,
                    fg: colors.yellow,
                },
            });
            screen.render();

            const masteryData = await getChampionMastery(region, summoner.puuid, participant.championId);
            
            loading.destroy();
            
            modalOpen = true;
            await createMasteryScreen(screen, summoner, participant.championName, masteryData);
            modalOpen = false;
            matchList.focus();
        }
    });

    screen.key('t', async () => {
        if (modalOpen) return;
        let matchIndex = null;
        for (let i = matchList.selected; i >= 0; i--) {
            if (listIndexMap[i] !== null) {
                matchIndex = listIndexMap[i];
                break;
            }
        }

        if (matchIndex !== null && expanded[matchIndex]) {
            // Match is expanded - show timeline
            const match = currentMatches[matchIndex];
            modalOpen = true;
            await createTimelineScreen(screen, match);
            modalOpen = false;
            screen.render();
            matchList.focus();
        } else {
            // No match expanded - toggle time scope filter
            timeScope = cycleTimeScope(timeScope);
            setTimeScopePreference(timeScope);

            // Collapse any expanded matches (clean state)
            Object.keys(expanded).forEach(key => {
                expanded[key] = false;
            });

            // Update LP graph with filtered snapshots
            const updatedHistory = getRankHistory(summoner.puuid);
            const filteredSnapshots = filterSnapshotsByTimeScope(
              updatedHistory.snapshots, timeScope, currentMatches
            );
            lpGraphBox.setLabel(getLPGraphLabel(timeScope));
            lpGraphBox.setContent(formatLPGraph(filteredSnapshots, 50, 7));

            // Update all UI components with filtered data
            const filteredMatches = getFilteredMatches();
            updatePanels(filteredMatches);
            updateList();
            updateAllBorderColors();

            // Reset selection to top
            matchList.select(0);
            matchList.focus();
        }
    });

    // r: Toggle ranked filter
    screen.key('r', () => {
        if (modalOpen) return;

        // Toggle filter and persist to disk
        rankedOnly = !rankedOnly;
        setRankedOnlyPreference(rankedOnly);

        // Collapse any expanded matches (clean state)
        Object.keys(expanded).forEach(key => {
            expanded[key] = false;
        });

        // Update all UI components with filtered data
        const filteredMatches = getFilteredMatches();
        updatePanels(filteredMatches);
        updateList();
        updateAllBorderColors();

        // Reset selection to top
        matchList.select(0);
        matchList.focus();
    });

    // s: Launch spectate mode
    screen.key('s', () => {
        if (modalOpen) return;
        if (!currentLiveGameData) return;  // No live game to spectate

        const { gameId, observers } = currentLiveGameData;
        if (!observers?.encryptionKey) return;

        launchSpectate(gameId, observers.encryptionKey, region);
    });

    // Save rank cache before exit
    const saveCacheAndExit = (result) => {
      isScreenDestroyed = true;

      // Clear all timers to prevent race conditions
      if (liveGameTimer) {
        clearInterval(liveGameTimer);
        liveGameTimer = null;
      }
      if (liveGameCheckInterval) {
        clearInterval(liveGameCheckInterval);
      }
      if (apiStatsTimer) {
        clearInterval(apiStatsTimer);
      }

      saveParticipantRankCache(summoner.puuid, diskRankCache);
      screen.destroy();
      resolve(result);
    };

    screen.key(['escape', 'q', 'C-c'], () => {
      saveCacheAndExit();
    });

    screen.key(['b', 'backspace', 'delete'], () => {
        if (modalOpen) return;

        // Check if any match is expanded
        const isAnyExpanded = Object.values(expanded).some(v => v);

        if (isAnyExpanded) {
            // Collapse all expanded matches
            Object.keys(expanded).forEach(key => {
                expanded[key] = false;
            });
            updateList();
            screen.render();
        }
        // No-op when nothing is expanded
    });

    // Tab: Switch to next account
    screen.key('tab', () => {
        if (modalOpen || !hasMultipleAccounts) return;
        const nextIndex = (currentAccountIndex + 1) % totalAccounts;
        // Use try-finally to ensure screen is destroyed even if setActiveAccountIndex fails
        try {
            setActiveAccountIndex(nextIndex);
        } finally {
            saveCacheAndExit({ action: 'SWITCH_ACCOUNT', accountIndex: nextIndex });
        }
    });

    // Shift+Tab: Switch to previous account
    screen.key('S-tab', () => {
        if (modalOpen || !hasMultipleAccounts) return;
        const prevIndex = (currentAccountIndex - 1 + totalAccounts) % totalAccounts;
        // Use try-finally to ensure screen is destroyed even if setActiveAccountIndex fails
        try {
            setActiveAccountIndex(prevIndex);
        } finally {
            saveCacheAndExit({ action: 'SWITCH_ACCOUNT', accountIndex: prevIndex });
        }
    });

    // c: Connect/add another account (go to search screen)
    screen.key('c', () => {
        if (modalOpen) return;
        saveCacheAndExit('BACK');
    });

    // d: Remove current account from monitored list
    screen.key('d', () => {
        if (modalOpen) return;

        // Show confirmation dialog
        const confirmBox = blessed.box({
            parent: screen,
            top: 'center',
            left: 'center',
            width: 50,
            height: 7,
            border: { type: 'line', fg: colors.red },
            style: { bg: colors.bg, fg: colors.fg },
            label: ' Remove Account ',
            tags: true,
        });

        blessed.text({
            parent: confirmBox,
            top: 1,
            left: 'center',
            content: `Remove {bold}${summoner.name}{/bold} from monitored accounts?`,
            tags: true,
            style: { fg: colors.fg },
        });

        blessed.text({
            parent: confirmBox,
            top: 3,
            left: 'center',
            content: '{green-fg}y{/green-fg}: Yes | {red-fg}n{/red-fg}: No',
            tags: true,
            style: { fg: colors.fg },
        });

        screen.render();

        const confirmHandler = (ch, key) => {
            if (key.name === 'y') {
                screen.unkey(['y', 'n', 'escape'], confirmHandler);
                confirmBox.destroy();
                screen.render();
                matchList.focus();
                accountLiveGameState.delete(summoner.puuid);  // Clean up Map entry
                saveCacheAndExit({ action: 'REMOVE_ACCOUNT', puuid: summoner.puuid });
            } else if (key.name === 'n' || key.name === 'escape') {
                screen.unkey(['y', 'n', 'escape'], confirmHandler);
                confirmBox.destroy();
                screen.render();
                matchList.focus();
            }
        };

        screen.key(['y', 'n', 'escape'], confirmHandler);
    });

    // Background account data refresh function with async lock
    const runBackgroundRefresh = async () => {
      // Return existing promise if refresh already in progress (async lock)
      if (refreshPromise) return refreshPromise;
      if (!refreshCallback || isScreenDestroyed) return;

      isRefreshing = true;
      refreshPromise = (async () => {
        refreshIndicator.setContent('{yellow-fg}Refreshing...{/yellow-fg}');
        screen.render();

        try {
          const freshData = await refreshCallback();
          if (isScreenDestroyed) return;

          if (freshData.hasUpdates) {
            // Update ranked box with fresh data
            if (freshData.rankedData) {
              currentRankedData = freshData.rankedData;
              rankedBox.setContent(formatRankedInfo(currentRankedData));
              // Refresh LP graph with updated rank history (respecting current timeScope)
              const updatedHistory = getRankHistory(summoner.puuid);
              const filteredSnapshots = filterSnapshotsByTimeScope(
                updatedHistory.snapshots, timeScope, currentMatches
              );
              lpGraphBox.setLabel(getLPGraphLabel(timeScope));
              lpGraphBox.setContent(formatLPGraph(filteredSnapshots, 50, 7));
            }

            // Update masteries with fresh data
            if (freshData.topMasteries) {
              currentTopMasteries = freshData.topMasteries;
              masteryBox.setContent(formatMasteryDisplay(currentTopMasteries, championMap));
            }

            // Add new matches to display (prepend to existing)
            if (freshData.newMatches?.length > 0) {
              const newMatchObjects = freshData.newMatches.map(m => ({
                details: m.details,
                timeline: m.timeline,
              }));

              // Shift indices in matchRankCache and expanded to account for prepended matches
              const shiftAmount = newMatchObjects.length;

              // Shift matchRankCache indices
              const shiftedRankCache = {};
              for (const [key, value] of Object.entries(matchRankCache)) {
                shiftedRankCache[parseInt(key) + shiftAmount] = value;
              }
              for (const key of Object.keys(matchRankCache)) {
                delete matchRankCache[key];
              }
              Object.assign(matchRankCache, shiftedRankCache);

              // Shift expanded indices
              const shiftedExpanded = {};
              for (const [key, value] of Object.entries(expanded)) {
                shiftedExpanded[parseInt(key) + shiftAmount] = value;
              }
              for (const key of Object.keys(expanded)) {
                delete expanded[key];
              }
              Object.assign(expanded, shiftedExpanded);

              // Remember current selection to adjust after prepending
              const currentSelection = matchList.selected;

              currentMatches = [...newMatchObjects, ...currentMatches];

              // Recompute summary and champion stats with new matches
              const filteredMatches = getFilteredMatches();
              updatePanels(filteredMatches);
              updateList();

              // Adjust selection to maintain user's view of the same match
              // Account for new entries being prepended to the list
              // Clamp to valid range to prevent out-of-bounds selection
              if (currentSelection >= 0 && matchList.items.length > 0) {
                const newIndex = Math.min(currentSelection + shiftAmount, matchList.items.length - 1);
                matchList.select(Math.max(0, newIndex));
              }

              // Fetch ranks for new matches (indices 0 to shiftAmount-1)
              let anyComputed = false;
              for (let i = 0; i < shiftAmount; i++) {
                // First try to compute from existing cache
                if (computeMatchAverage(i)) {
                  anyComputed = true;
                } else {
                  // If not all players cached, fetch ranks asynchronously
                  fetchMatchRanks(i, true).then(() => {
                    if (isScreenDestroyed) return;
                    updateList();
                    updatePreviewPanel();
                    screen.render();
                  }).catch(() => {});
                }
              }
              // Refresh UI if any averages were computed from cache
              if (anyComputed) {
                updateList();
                updatePreviewPanel();
                screen.render();
              }
            }

            // Also refresh live game state during background refresh
            await checkLiveGame();

            // Handle offline recovery - show special message when coming back online
            if (isOffline) {
              isOffline = false;
              refreshIndicator.setContent('{green-fg}Back online!{/green-fg}');
            } else {
              refreshIndicator.setContent('{green-fg}Updated!{/green-fg}');
            }
            setTimeout(() => {
              if (!isScreenDestroyed) {
                refreshIndicator.setContent('');
                screen.render();
              }
            }, 2000);
          } else {
            // Even without content updates, recover from offline mode if refresh succeeded
            if (isOffline) {
              isOffline = false;
              refreshIndicator.setContent('{green-fg}Back online!{/green-fg}');
              setTimeout(() => {
                if (!isScreenDestroyed) {
                  refreshIndicator.setContent('');
                  screen.render();
                }
              }, 2000);
            } else {
              refreshIndicator.setContent('');
            }
          }
          screen.render();
        } catch (error) {
          // Clear live game state on refresh failure to avoid stale data
          currentLiveGameData = null;
          liveGameBox.hidden = true;
          liveGameBox.setContent('');

          if (!isScreenDestroyed) {
            refreshIndicator.setContent('{red-fg}Refresh failed{/red-fg}');
            setTimeout(() => {
              if (!isScreenDestroyed) {
                refreshIndicator.setContent('');
                screen.render();
              }
            }, 2000);
          }
        } finally {
          isRefreshing = false;
          refreshPromise = null;
        }
      })();

      return refreshPromise;
    };

    updateList();

    // Apply filter states on initial load (ranked or time scope)
    if (rankedOnly || timeScope !== 'all') {
      const filteredMatches = getFilteredMatches();
      updatePanels(filteredMatches);
      updateAllBorderColors();
    }

    matchList.focus();
    process.nextTick(updatePreviewPanel);
    screen.render();

    // Auto-trigger account data refresh if callback provided (for cached account loading)
    if (refreshCallback) {
      setTimeout(runBackgroundRefresh, 300);
    }

    // Background rank refresh for stale data
    const refreshStaleRanks = async () => {
      const stalePuuids = getStalePlayerPuuids();
      if (stalePuuids.length === 0) return;

      for (let idx = 0; idx < stalePuuids.length; idx++) {
        const puuid = stalePuuids[idx];
        if (isScreenDestroyed) return;

        try {
          await fetchAndCacheRank(puuid);
        } catch (error) {
          if (process.env.DEBUG) {
            console.error(`[BG Refresh] Failed to fetch rank for ${puuid.substring(0, 20)}:`, error.message || error);
          }
          // On rate limit (429), wait for reset and retry this puuid
          if (error.response?.status === 429) {
            const retryAfter = error.response?.headers?.['retry-after'];
            const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 30000;
            await delay(Math.min(waitTime, 60000)); // Cap at 60s
            idx--; // Retry this puuid
            continue;
          }
        }

        if (isScreenDestroyed) return;

        // After each fetch, try to compute any newly-completable match averages
        let anyNewComputed = false;
        for (let i = 0; i < currentMatches.length; i++) {
          if (!matchRankCache[i] || !matchRankCache[i].complete) {
            computeMatchAverage(i);
            anyNewComputed = true;
          }
        }
        if (anyNewComputed) {
          updateList();
          updatePreviewPanel();
          screen.render();
        }

        await delay(100); // 100ms between requests (10/second, safe margin for other API calls)
      }
    };

    // Start background refresh after initial render (fire and forget)
    refreshStaleRanks().catch(() => {});

    // Pre-fetch OP.GG historical data for all match participants in background
    const preloadOpggHistory = async () => {
      // Collect unique participants across all matches
      const seenPuuids = new Set();
      const participantsToFetch = [];

      for (const match of currentMatches) {
        for (const p of match.details.info.participants) {
          if (seenPuuids.has(p.puuid)) continue;
          seenPuuids.add(p.puuid);

          // Skip if already cached on disk
          if (getOpggCache(p.puuid)) continue;

          const gameName = p.riotIdGameName;
          const tagLine = p.riotIdTagline;
          if (gameName && tagLine) {
            participantsToFetch.push({ puuid: p.puuid, gameName, tagLine });
          }
        }
      }

      // Fetch in batches to avoid overwhelming the API
      const BATCH_SIZE = 5;
      for (let i = 0; i < participantsToFetch.length; i += BATCH_SIZE) {
        if (isScreenDestroyed) return;
        const batch = participantsToFetch.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async ({ puuid, gameName, tagLine }) => {
          try {
            const data = await opgg.getSummonerProfile(region, gameName, tagLine, 2);
            if (data) saveOpggCache(puuid, data);
          } catch (error) {
            // Silent fail
          }
        }));
      }
    };

    // Start OP.GG pre-fetch in background (fire and forget)
    preloadOpggHistory().catch(() => {});
  });
};

module.exports = { createResultsScreen };
