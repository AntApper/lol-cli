#!/usr/bin/env node
const path = require('path');
const envPath = process.pkg
  ? path.resolve(path.dirname(process.execPath), '.env')
  : path.resolve(__dirname, '..', '.env');
require('dotenv').config({ path: envPath });
const { Command } = require('commander');
const blessed = require('blessed');
const { getSummonerDataByRiotId, getMatchHistory, getMatchDetails, getMatchTimeline, getRankedData, getTopChampionMasteries } = require('./api');
const { createSearchScreen } = require('./tui');
const { getLastSearch, saveLastSearch, getMatchCache, saveMatchCache, getMonitoredAccounts, addMonitoredAccount, removeMonitoredAccount, setActiveAccountIndex, getAccountDataCache, saveAccountDataCache } = require('./utils');
const { createResultsScreen } = require('./resultsTui');
const { createLoadingScreen } = require('./loadingTui');

const program = new Command();

program
  .version('1.0.0')
  .description('A CLI tool to get League of Legends summoner stats')
  .option('-r, --region <region>', 'The region to search in')
  .option('-i, --riot-id <riotId>', "The Riot ID to search for (e.g., 'gameName#tagLine')");

program.parse(process.argv);

const options = program.opts();

if (!program.args.length) {
  // Helper function to load account data from cache (for instant switching)
  const loadAccountDataFromCache = (puuid) => {
    const accountCache = getAccountDataCache(puuid);
    if (!accountCache) return null;

    const matchCache = getMatchCache(puuid);
    const matches = matchCache.matches.map(m => ({
      details: m.details,
      timeline: m.timeline,
    }));

    return {
      summoner: accountCache.summoner,
      matches,
      rankedData: accountCache.rankedData || [],
      topMasteries: accountCache.topMasteries || [],
    };
  };

  // Helper function to load account data (full API fetch)
  const loadAccountData = async (region, riotId, screen, loading) => {
    loading.update(5, 'Fetching summoner data...');
    const summoner = await getSummonerDataByRiotId(region, riotId);

    loading.update(10, 'Fetching player data...');
    const [rankedData, topMasteries, matchHistory] = await Promise.all([
      getRankedData(region, summoner.puuid).catch(() => []),
      getTopChampionMasteries(region, summoner.puuid, 5).catch(() => []),
      getMatchHistory(region, summoner.puuid),
    ]);

    const matchCache = getMatchCache(summoner.puuid);
    const cachedMatchIds = new Set(matchCache.matches.map(m => m.matchId));
    const newMatchIds = matchHistory.filter(id => !cachedMatchIds.has(id));
    const totalNewMatches = newMatchIds.length;

    const newMatches = [];
    if (totalNewMatches === 0) {
      loading.update(100, 'All matches cached, loading from disk...');
    } else {
      loading.update(15, `Found ${totalNewMatches} new match(es) to fetch...`);
      for (let i = 0; i < totalNewMatches; i++) {
        const matchId = newMatchIds[i];
        loading.update(null, `Fetching new match ${i + 1}/${totalNewMatches}...`);

        const [matchDetails, matchTimeline] = await Promise.all([
          getMatchDetails(region, matchId),
          getMatchTimeline(region, matchId),
        ]);
        newMatches.push({
          matchId,
          gameCreation: matchDetails.info.gameCreation,
          details: matchDetails,
          timeline: matchTimeline
        });

        const progress = 15 + (((i + 1) / totalNewMatches) * 85);
        loading.update(progress);
      }
    }

    const allCachedMatches = [...newMatches, ...matchCache.matches];
    allCachedMatches.sort((a, b) => b.gameCreation - a.gameCreation);

    matchCache.matches = allCachedMatches;
    matchCache.region = region;
    saveMatchCache(summoner.puuid, matchCache);

    const matches = allCachedMatches.map(m => ({
      details: m.details,
      timeline: m.timeline,
    }));

    // Save account data to cache for instant switching
    saveAccountDataCache(summoner.puuid, { summoner, rankedData, topMasteries });

    loading.update(100, 'All data loaded.');

    return { summoner, matches, rankedData, topMasteries };
  };

  // Helper to handle results from createResultsScreen
  const handleScreenResult = (result) => {
    if (!result) {
      return { action: 'EXIT' };
    }
    if (result === 'BACK') {
      return { action: 'BACK' };
    }
    if (result.action === 'SWITCH_ACCOUNT') {
      const updatedMonitored = setActiveAccountIndex(result.accountIndex);
      const account = updatedMonitored.accounts[result.accountIndex];
      if (!account) {
        return { action: 'BACK' };
      }
      return {
        action: 'SWITCH',
        accountIndex: result.accountIndex,
        region: account.region,
        riotId: account.riotId,
        puuid: account.puuid,
      };
    }
    if (result.action === 'REMOVE_ACCOUNT') {
      const updatedMonitored = removeMonitoredAccount(result.puuid);
      if (updatedMonitored.accounts.length === 0) {
        return { action: 'BACK' };
      }
      const account = updatedMonitored.accounts[updatedMonitored.activeIndex];
      return {
        action: 'SWITCH',
        accountIndex: updatedMonitored.activeIndex,
        region: account.region,
        riotId: account.riotId,
        puuid: account.puuid,
      };
    }
    return { action: 'EXIT' };
  };

  const main = async () => {
    let region, riotId;
    let cliOptions = { ...options };
    let skipSearch = false;
    let currentAccountIndex = 0;
    let switchToPuuid = null; // Track puuid when switching for cache-first loading

    // Check for monitored accounts on startup (skip search if available and no CLI args)
    const initialMonitored = getMonitoredAccounts();
    if (!cliOptions.region && !cliOptions.riotId && initialMonitored.accounts.length > 0) {
      skipSearch = true;
      currentAccountIndex = initialMonitored.activeIndex;
      const account = initialMonitored.accounts[currentAccountIndex];
      region = account.region;
      riotId = account.riotId;
      switchToPuuid = account.puuid;
    }

    while (true) {
      // Determine if we need to show search screen
      if (!skipSearch && !cliOptions.region && !cliOptions.riotId) {
        const lastSearch = getLastSearch();
        const monitoredAccounts = getMonitoredAccounts();
        const searchData = await createSearchScreen(lastSearch || {}, { accountCount: monitoredAccounts.accounts.length });
        if (!searchData || searchData === 'EXIT' || !searchData.riotId) {
          console.log('Exiting.');
          break;
        }
        region = searchData.region;
        riotId = searchData.riotId;
        saveLastSearch(riotId, region);
      } else if (cliOptions.region && cliOptions.riotId) {
        region = cliOptions.region;
        riotId = cliOptions.riotId;
        cliOptions = {};
      }
      // else: skipSearch is true, region/riotId already set

      skipSearch = false; // Reset for next iteration

      // Try cache-first loading when switching accounts
      if (switchToPuuid) {
        const cachedData = loadAccountDataFromCache(switchToPuuid);
        if (cachedData && cachedData.matches.length > 0) {
          // Use cached data - instant switch, no loading screen
          const monitoredData = getMonitoredAccounts();
          currentAccountIndex = monitoredData.activeIndex;

          const result = await createResultsScreen(cachedData.summoner, cachedData.matches, region, cachedData.rankedData, cachedData.topMasteries, {
            monitoredAccounts: monitoredData,
            currentAccountIndex,
          });

          const handled = handleScreenResult(result);
          if (handled.action === 'EXIT') {
            break;
          } else if (handled.action === 'BACK') {
            switchToPuuid = null;
            continue;
          } else if (handled.action === 'SWITCH') {
            currentAccountIndex = handled.accountIndex;
            region = handled.region;
            riotId = handled.riotId;
            switchToPuuid = handled.puuid;
            skipSearch = true;
            continue;
          }
        }
        // No cache or empty matches - fall through to full load
        switchToPuuid = null;
      }

      const screen = blessed.screen({
        smartCSR: true,
        fullUnicode: true,
      });

      const loading = createLoadingScreen(screen);
      screen.render();

      try {
        const { summoner, matches, rankedData, topMasteries } = await loadAccountData(region, riotId, screen, loading);

        // Auto-save to monitored accounts
        const monitoredData = addMonitoredAccount(summoner, region, riotId);
        currentAccountIndex = monitoredData.activeIndex;

        loading.destroy();
        screen.destroy();

        const result = await createResultsScreen(summoner, matches, region, rankedData, topMasteries, {
          monitoredAccounts: monitoredData,
          currentAccountIndex,
        });

        const handled = handleScreenResult(result);
        if (handled.action === 'EXIT') {
          break;
        } else if (handled.action === 'BACK') {
          continue;
        } else if (handled.action === 'SWITCH') {
          currentAccountIndex = handled.accountIndex;
          region = handled.region;
          riotId = handled.riotId;
          switchToPuuid = handled.puuid;
          skipSearch = true;
          continue;
        }
      } catch (error) {
        screen.destroy();
        console.error('\nError:', error.message);
        break;
      }
    }
  };

  main();
}
