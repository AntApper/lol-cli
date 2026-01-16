const blessed = require('blessed');
const { getRankedData, getChampionMastery, getLiveGame } = require('./api');
const { formatSummary, formatMatchDetails, formatRankedInfo, formatChampionStats, formatMasteryDisplay, colorizeRank } = require('./ui');
const { getItemData, getChampionData, getSummonerSpellData, getRuneData, getQueueData, getParticipantRankCache, saveParticipantRankCache } = require('./utils');
const { createMasteryScreen } = require('./masteryTui');
const { createTimelineScreen } = require('./timelineTui');

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
  const { monitoredAccounts = null, currentAccountIndex = 0 } = options;
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

  // Load participant rank cache from disk
  const diskRankCache = getParticipantRankCache(summoner.puuid);
  const RANK_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

  const playerRankCache = {}; // Cache by PUUID (persists across matches)
  const matchRankCache = {};  // Cache computed match averages

  // Pre-populate playerRankCache from disk cache
  Object.entries(diskRankCache.ranks).forEach(([puuid, data]) => {
    playerRankCache[puuid] = data.rank;
  });

  // Helper to compute match average from cached ranks
  const computeMatchAverage = (matchIndex) => {
    const participants = matches[matchIndex].details.info.participants;
    const ranks = {};
    let totalScore = 0;
    let rankedCount = 0;
    let allCached = true;

    for (const p of participants) {
      if (playerRankCache[p.puuid] !== undefined) {
        ranks[p.puuid] = playerRankCache[p.puuid];
        if (ranks[p.puuid] !== 'N/A') {
          totalScore += rankToScore(ranks[p.puuid]);
          rankedCount++;
        }
      } else {
        allCached = false;
      }
    }

    if (allCached) {
      matchRankCache[matchIndex] = {
        players: ranks,
        average: rankedCount > 0 ? scoreToRank(totalScore / rankedCount) : 'N/A',
      };
      return true;
    }
    return false;
  };

  // Pre-compute match averages from cached data
  for (let i = 0; i < matches.length; i++) {
    computeMatchAverage(i);
  }

  const fetchMatchRanks = async (matchIndex, skipDelay = false) => {
    if (matchRankCache[matchIndex]) return; // Already fully cached

    const ranks = {};
    let totalScore = 0;
    let rankedCount = 0;
    const participants = matches[matchIndex].details.info.participants;
    const delay = ms => new Promise(res => setTimeout(res, ms));

    for (const p of participants) {
      // Check PUUID cache first
      if (playerRankCache[p.puuid] !== undefined) {
        ranks[p.puuid] = playerRankCache[p.puuid];
        if (ranks[p.puuid] !== 'N/A') {
          totalScore += rankToScore(ranks[p.puuid]);
          rankedCount++;
        }
        continue;
      }

      try {
        const rankData = await getRankedData(region, p.puuid);
        const soloQueue = rankData.find(q => q.queueType === 'RANKED_SOLO_5x5');
        const rankString = soloQueue ? `${soloQueue.tier} ${soloQueue.rank}` : 'Unranked';
        ranks[p.puuid] = rankString;
        playerRankCache[p.puuid] = rankString; // Cache by PUUID
        // Update disk cache
        diskRankCache.ranks[p.puuid] = { rank: rankString, fetchedAt: new Date().toISOString() };
        totalScore += rankToScore(rankString);
        rankedCount++;
      } catch (error) {
        ranks[p.puuid] = 'N/A';
        playerRankCache[p.puuid] = 'N/A'; // Cache failures too
        diskRankCache.ranks[p.puuid] = { rank: 'N/A', fetchedAt: new Date().toISOString() };
      }
      if (!skipDelay) await delay(100);
    }

    matchRankCache[matchIndex] = {
      players: ranks,
      average: rankedCount > 0 ? scoreToRank(totalScore / rankedCount) : 'N/A',
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

    const screen = blessed.screen({
      smartCSR: true,
      title: `Stats for ${summoner.name} [${region}]`,
      fullUnicode: true,
    });

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
        // Truncate name to 12 chars
        let name = acc.riotId.split('#')[0];
        if (name.length > 12) name = name.substring(0, 11) + '~';
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

    // Row 1: Ranked Info (left) | Live Game (right)
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

    const liveGameBox = blessed.box({
        parent: layout,
        width: '50%',
        height: 9,
        top: 2,
        right: 0,
        label: ' Live Game ',
        tags: true,
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
        height: 9,
        top: 11,
        left: 0,
        label: ` Last ${matches.length} Games `,
        content: formatSummary(summoner, matches),
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
        height: 9,
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
        height: 9,
        top: 20,
        left: 0,
        label: ' Champion Stats (Recent Games) ',
        content: formatChampionStats(matches, summoner.puuid),
        tags: true,
        border: {
            type: 'line',
            fg: colors.purple,
        },
        style: {
            border: { fg: colors.purple }
        }
    });

    const checkLiveGame = async () => {
        const liveGameData = await getLiveGame(region, summoner.puuid);
        if (liveGameData) {
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
                    const startTime = new Date(liveGameData.gameStartTime);
                    const now = new Date();
                    const diff = now - startTime;
                    const minutes = Math.floor(diff / 60000);
                    const seconds = Math.floor((diff % 60000) / 1000);
                    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                    
                    const content = ` Queue: ${queueName}\n` +
                                  ` Champion: ${championName}\n` +
                                  ` Role: ${role}\n` +
                                  ` Time: ${formattedTime}\n` +
                                  ` Spells: ${spell1}, ${spell2}\n` +
                                  ` Keystone: ${keystone}\n` +
                                  ` Secondary: ${secondaryTree}`;

                    liveGameBox.setContent(content);
                    screen.render();
                };

                updateGameTime();
                const timer = setInterval(updateGameTime, 1000);

                screen.on('destroy', () => {
                    clearInterval(timer);
                });
            }
        }
        screen.render();
    };

    checkLiveGame();

    const matchList = blessed.list({
      parent: layout,
      width: '100%',
      top: 29,
      bottom: 1,
      items: [],
      border: {
        type: 'line',
        fg: colors.purple,
      },
      label: ` Match History - ${matches.length} Games (Select to expand) `,
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

    const getFooterContent = (isExpanded) => {
        let content = '';
        if (hasMultipleAccounts) {
            content += 'Tab: Switch | ';
        }
        content += 'd: Remove | Backspace: Back | m: Mastery';
        if (isExpanded) {
            content += ' | t: Timeline';
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

    const setPanelVisibility = (visible) => {
      rankedBox.hidden = !visible;
      liveGameBox.hidden = !visible;
      summaryBox.hidden = !visible;
      masteryBox.hidden = !visible;
      championStatsBox.hidden = !visible;
      matchList.top = visible ? 29 : 2;
      matchList.height = visible ? 12 : '90%';
    };

    const updateList = () => {
        const items = [];
        listIndexMap = [];
        let isAnyExpanded = false;
        matches.forEach((match, index) => {
            const participant = match.details.info.participants.find(p => p.puuid === summoner.puuid);
            const queueId = match.details.info.queueId;
            const queueDesc = queueMap.get(queueId) || '';
            const queueLabel = getShortQueueName(queueDesc, queueId).padEnd(10);
            const role = (queueId === 1700
                ? 'Arena'
                : (participant.teamPosition || participant.individualPosition || '')).padEnd(10);
            const avgRank = matchRankCache[index] ? `Avg Rank: ${colorizeRank(matchRankCache[index].average)}`.padEnd(40) : ''.padEnd(40);
            const gameDate = new Date(match.details.info.gameCreation).toLocaleDateString().padEnd(12);
            let resultText;
            if (!participant.win && match.details.info.gameDuration < 300) {
                resultText = 'Remake';
            } else {
                resultText = participant.win ? 'Win' : 'Loss';
            }
            const paddedResult = resultText.padEnd(7);
            const championName = participant.championName.padEnd(16);
            const kda = `KDA: ${participant.kills}/${participant.deaths}/${participant.assists}`;
            let coloredResult;
            if (resultText === 'Win') {
                coloredResult = `{green-fg}${paddedResult}{/green-fg}`;
            } else if (resultText === 'Loss') {
                coloredResult = `{red-fg}${paddedResult}{/red-fg}`;
            } else {
                coloredResult = `{grey-fg}${paddedResult}{/grey-fg}`;
            }
            const summary = `${gameDate}${coloredResult} - ${championName}${queueLabel}${role}${kda} ${avgRank}`;
            items.push(summary);
            listIndexMap.push(index);

            if (expanded[index]) {
                isAnyExpanded = true;
                const details = formatMatchDetails(match, summoner, itemMap, spellMap, runeMap, screen.width, matchRankCache[index]?.players);
                details.split('\n').forEach(line => {
                    items.push(line);
                    listIndexMap.push(null);
                });
            }
        });
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

            if (expanded[matchIndex] && !matchRankCache[matchIndex]) {
                // Only show loading if not already preloaded
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

                try {
                    await fetchMatchRanks(matchIndex);
                } finally {
                    loading.destroy();
                }
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
            const match = matches[matchIndex];
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
            const match = matches[matchIndex];
            modalOpen = true;
            await createTimelineScreen(screen, match);
            modalOpen = false;
            screen.render();
            matchList.focus();
        }
    });



    // Save rank cache before exit
    const saveCacheAndExit = (result) => {
      isScreenDestroyed = true;
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
            // Collapse all expanded matches first
            Object.keys(expanded).forEach(key => {
                expanded[key] = false;
            });
            updateList();
            screen.render();
        } else {
            // No match expanded, go back to Search screen
            saveCacheAndExit('BACK');
        }
    });

    // Tab: Switch to next account
    screen.key('tab', () => {
        if (modalOpen || !hasMultipleAccounts) return;
        const nextIndex = (currentAccountIndex + 1) % totalAccounts;
        saveCacheAndExit({ action: 'SWITCH_ACCOUNT', accountIndex: nextIndex });
    });

    // Shift+Tab: Switch to previous account
    screen.key('S-tab', () => {
        if (modalOpen || !hasMultipleAccounts) return;
        const prevIndex = (currentAccountIndex - 1 + totalAccounts) % totalAccounts;
        saveCacheAndExit({ action: 'SWITCH_ACCOUNT', accountIndex: prevIndex });
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

    updateList();
    matchList.focus();
    screen.render();

    // Background rank refresh for stale data
    const refreshStaleRanks = async () => {
      const stalePuuids = getStalePlayerPuuids();
      if (stalePuuids.length === 0) return;

      const delay = ms => new Promise(res => setTimeout(res, ms));

      for (const puuid of stalePuuids) {
        if (isScreenDestroyed) return;

        try {
          const rankData = await getRankedData(region, puuid);
          const soloQueue = rankData.find(q => q.queueType === 'RANKED_SOLO_5x5');
          const rankString = soloQueue ? `${soloQueue.tier} ${soloQueue.rank}` : 'Unranked';
          playerRankCache[puuid] = rankString;
          diskRankCache.ranks[puuid] = { rank: rankString, fetchedAt: new Date().toISOString() };
        } catch (error) {
          // On rate limit (429), stop background refresh entirely
          if (error.response?.status === 429) {
            break;
          }
          // For other errors, mark as N/A and continue
          playerRankCache[puuid] = 'N/A';
          diskRankCache.ranks[puuid] = { rank: 'N/A', fetchedAt: new Date().toISOString() };
        }

        if (isScreenDestroyed) return;

        // After each fetch, try to compute any newly-completable match averages
        let anyNewComputed = false;
        for (let i = 0; i < matches.length; i++) {
          if (!matchRankCache[i] && computeMatchAverage(i)) {
            anyNewComputed = true;
          }
        }
        if (anyNewComputed) {
          updateList();
          screen.render();
        }

        await delay(200); // 200ms between requests (less aggressive than 100ms)
      }
    };

    // Start background refresh after initial render (fire and forget)
    refreshStaleRanks().catch(() => {});
  });
};

module.exports = { createResultsScreen };
