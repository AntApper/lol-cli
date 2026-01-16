const asciichart = require('asciichart');

const formatSummary = (summoner, matches) => {
  if (matches.length === 0) {
    return `{bold}{green-fg}No recent games found.{/green-fg}{/bold}`;
  }

  let totalWins = 0;
  let totalKills = 0;
  let totalDeaths = 0;
  let totalAssists = 0;
  let totalDuration = 0;
  const championCounts = {};

  matches.forEach(match => {
    const participant = match.details.info.participants.find(p => p.puuid === summoner.puuid);
    if (participant) {
      if (participant.win) totalWins++;
      totalKills += participant.kills;
      totalDeaths += participant.deaths;
      totalAssists += participant.assists;
      totalDuration += match.details.info.gameDuration;
      championCounts[participant.championName] = (championCounts[participant.championName] || 0) + 1;
    }
  });

  const winRate = ((totalWins / matches.length) * 100).toFixed(2);
  const overallKda = totalDeaths > 0 ? ((totalKills + totalAssists) / totalDeaths).toFixed(2) : 'Perfect';

  const sortedChampions = Object.entries(championCounts).sort((a, b) => b[1] - a[1]);
  const mostPlayed = sortedChampions.slice(0, 3).map(([name, count]) => `${name} (${count})`).join(', ');

  const hours = Math.floor(totalDuration / 3600);
  const minutes = Math.floor((totalDuration % 3600) / 60);
  const timePlayed = `${hours}h ${minutes}m`;

  const labels = ["Win Rate:", "Overall KDA:", "Most Played:", "Time Played:"];
  const longestLabel = Math.max(...labels.map(l => l.length));

  return `${labels[0].padEnd(longestLabel)} {bold}${winRate}%{/bold}\n` +
         `${labels[1].padEnd(longestLabel)} {bold}${overallKda}{/bold}\n` +
         `${labels[2].padEnd(longestLabel)} {bold}${mostPlayed}{/bold}\n` +
         `${labels[3].padEnd(longestLabel)} {bold}${timePlayed}{/bold}`;
};

const colorizeRank = (rank) => {
    if (!rank) return '{white-fg}Unranked{/white-fg}';
    const tier = rank.split(' ')[0];
    const colors = {
        'CHALLENGER': '#f1fa8c',
        'GRANDMASTER': '#ff5555',
        'MASTER': '#ff79c6',
        'DIAMOND': '#8be9fd',
        'EMERALD': '#50fa7b',
        'PLATINUM': '#8be9fd',
        'GOLD': '#f1fa8c',
        'SILVER': '#f8f8f2',
        'BRONZE': '#cd7f32',
        'IRON': '#a9a9a9',
        'Unranked': '#f8f8f2'
    };
    const color = colors[tier] || '#f8f8f2';
    return `{${color}-fg}${rank}{/${color}-fg}`;
};

const padStringWithTags = (str, length) => {
  const visibleLength = str.replace(/{[^{}]*}/g, '').length;
  const padding = ' '.repeat(Math.max(0, length - visibleLength));
  return str + padding;
};

const frame = (title, content) => {
  if (!content) return '';
  const lines = content.split('\n');
  const width = Math.max(...lines.map(l => l.replace(/{[^{}]*}/g, '').length));
  const horizontal = '─'.repeat(width + 2);
  const titlePadding = '─'.repeat(Math.max(0, width - title.length - 1));
  const framedTitle = `┌─ ${title} ${titlePadding}┐`;

  const framedContent = lines.map(line => `│ ${padStringWithTags(line, width)} │`).join('\n');

  return `${framedTitle}\n${framedContent}\n└${horizontal}┘`;
};

const formatMatchDetails = (match, summoner, itemMap, spellMap, runeMap, terminalWidth, rankData) => {
  const participant = match.details.info.participants.find(p => p.puuid === summoner.puuid);
  if (!participant) return 'Participant data not found.';

  const gameDurationSeconds = match.details.info.gameDuration;
  const gameDurationMinutes = Math.floor(gameDurationSeconds / 60);
  const gameDurationRemainingSeconds = gameDurationSeconds % 60;
  const totalCreepScore = participant.totalMinionsKilled + participant.neutralMinionsKilled;

  const detailsSummary =
    `{bold}Champion:{/bold} ${participant.championName}\n` +
    `{bold}KDA:{/bold}      ${participant.kills}/${participant.deaths}/${participant.assists}\n` +
    `{bold}CS:{/bold}       ${totalCreepScore}\n` +
    `{bold}Vision:{/bold}   ${participant.visionScore}\n` +
    `{bold}Length:{/bold}   ${gameDurationMinutes}m ${gameDurationRemainingSeconds}s`;

  // KDA Graph
  const maxBarWidth = Math.floor(terminalWidth * 0.4);
  const maxKDAValue = Math.max(participant.kills, participant.deaths, participant.assists, 1);
  const createBar = (value, color) => {
      const barWidth = Math.round((value / maxKDAValue) * maxBarWidth);
      return `{${color}-fg}${'█'.repeat(barWidth)}{/${color}-fg}` + ` (${value})`;
  };
  const kdaGraph = `{bold}KDA Performance:{/bold}\n` +
                   `Kills:   ${createBar(participant.kills, 'green')}\n` +
                   `Deaths:  ${createBar(participant.deaths, 'red')}\n` +
                   `Assists: ${createBar(participant.assists, 'magenta')}`;

  // Gold Graph
  const participantId = participant.participantId;
  const goldFrames = match.timeline.info.frames.map(frame => frame.participantFrames[String(participantId)].totalGold);
  const graphWidth = Math.floor(terminalWidth * 0.8);
  const resampledGold = resampleData(goldFrames, graphWidth);
  const goldChart = asciichart.plot(resampledGold, { height: 8 });
  const xAxis = createXAxis(Math.floor(match.details.info.gameDuration / 60), graphWidth);
  const goldGraph = `{bold}Gold Generation:{/bold}\n{yellow-fg}${goldChart}{/yellow-fg}\n${xAxis}`;

  // Items
  const items = [
    participant.item0, participant.item1, participant.item2,
    participant.item3, participant.item4, participant.item5, participant.item6
  ].filter(id => id !== 0).map(id => itemMap[id] ? itemMap[id].name : 'Unknown Item');
  const itemsText = items.length > 0 ? `{bold}Items:{/bold}\n${items.join(', ')}` : '';

  // Spells and Runes
  const spell1 = spellMap.get(String(participant.summoner1Id)) || 'N/A';
  const spell2 = spellMap.get(String(participant.summoner2Id)) || 'N/A';
  const spellsText = `{bold}Spells:{/bold}\n${spell1}, ${spell2}`;

  const perks = participant.perks;
  const primaryStyle = perks.styles[0];
  const secondaryStyle = perks.styles[1];

  const primaryTreeName = runeMap.get(primaryStyle.style) || 'N/A';
  const primaryRunes = primaryStyle.selections.map(s => runeMap.get(s.perk) || 'N/A');
  
  const secondaryTreeName = runeMap.get(secondaryStyle.style) || 'N/A';
  const secondaryRunes = secondaryStyle.selections.map(s => runeMap.get(s.perk) || 'N/A');

  const runesText = `{bold}Runes:{/bold}\n` +
                    `{yellow-fg}${primaryTreeName}{/yellow-fg}: ${primaryRunes.join(', ')}\n` +
                    `{cyan-fg}${secondaryTreeName}{/cyan-fg}: ${secondaryRunes.join(', ')}`;

  let rankText = '';
  if (rankData) {
    rankText = `{bold}Players:{/bold}\n`;
    const team1 = match.details.info.participants.slice(0, 5);
    const team2 = match.details.info.participants.slice(5, 10);

    // Calculate the longest name for dynamic padding
    const longestName = Math.max(...match.details.info.participants.map(p => `${p.riotIdGameName}#${p.riotIdTagline}`.length));

    const formatTeam = (team) => {
        return team.map(p => {
            const rank = rankData[p.puuid] || 'Unranked';
            const fullRiotId = `${p.riotIdGameName}#${p.riotIdTagline}`.padEnd(longestName + 2);
            const champion = p.championName.padEnd(16);
            const kda = `${p.kills}/${p.deaths}/${p.assists}`.padEnd(12);
            return `${fullRiotId} ${champion} ${kda} ${colorizeRank(rank)}`;
        }).join('\n');
    };
    rankText += `{cyan-fg}Blue Team:{/cyan-fg}\n${formatTeam(team1)}\n`;
    rankText += `{red-fg}Red Team:{/red-fg}\n${formatTeam(team2)}`;
  }

  return `\n${frame('Details', detailsSummary)}\n\n${frame('KDA', kdaGraph)}\n\n${frame('Gold', goldGraph)}\n\n${frame('Items', itemsText)}\n\n${frame('Spells', spellsText)}\n\n${frame('Runes', runesText)}\n\n${frame('Ranks', rankText)}\n`;
};
// Helper functions for graphs
const resampleData = (data, targetWidth) => {
    if (!data || data.length === 0) return [];
    const resampled = new Array(targetWidth).fill(0);
    const factor = (data.length - 1) / (targetWidth - 1);
    for (let i = 0; i < targetWidth; i++) {
        const index = i * factor;
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        const weight = index - lower;
        resampled[i] = data[lower] * (1 - weight) + data[upper] * weight;
    }
    return resampled;
};

const createXAxis = (durationMinutes, width) => {
    const interval = 5;
    let axis = ' '.repeat(width);
    for (let min = 0; min <= durationMinutes; min += interval) {
        const label = `${min}m`;
        const position = Math.floor((min / durationMinutes) * width);
        if (position + label.length < width) {
            axis = axis.substring(0, position) + label + axis.substring(position + label.length);
        }
    }
    return axis;
};


const formatRankedInfo = (rankedData) => {
  const soloQueue = rankedData?.find(q => q.queueType === 'RANKED_SOLO_5x5');
  const flexQueue = rankedData?.find(q => q.queueType === 'RANKED_FLEX_SR');

  const formatQueue = (queue, name) => {
    if (!queue) {
      return `{bold}${name}:{/bold} Unranked`;
    }
    const division = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(queue.tier) ? '' : ` ${queue.rank}`;
    const colorizedRank = colorizeRank(`${queue.tier}${division}`);
    const lp = `${queue.leaguePoints} LP`;
    const wins = queue.wins;
    const losses = queue.losses;
    const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) : '0';
    return `{bold}${name}:{/bold} ${colorizedRank} - ${lp}\n${wins}W ${losses}L (${winRate}%)`;
  };

  return formatQueue(soloQueue, 'Solo/Duo') + '\n\n' + formatQueue(flexQueue, 'Flex');
};

const formatChampionStats = (matches, puuid) => {
  const champStats = {};

  matches.forEach(match => {
    const participant = match.details.info.participants.find(p => p.puuid === puuid);
    if (participant) {
      const name = participant.championName;
      if (!champStats[name]) {
        champStats[name] = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
      }
      champStats[name].games++;
      if (participant.win) champStats[name].wins++;
      champStats[name].kills += participant.kills;
      champStats[name].deaths += participant.deaths;
      champStats[name].assists += participant.assists;
    }
  });

  const sorted = Object.entries(champStats)
    .sort((a, b) => b[1].games - a[1].games)
    .slice(0, 5);

  if (sorted.length === 0) return 'No champion data available';

  const header = 'Champion'.padEnd(14) + 'Games'.padEnd(7) + 'Win%'.padEnd(7) + 'KDA';
  const lines = sorted.map(([name, stats]) => {
    const games = stats.games || 1; // Defensive check for division by zero
    const winRate = ((stats.wins / games) * 100).toFixed(0) + '%';
    const avgK = (stats.kills / games).toFixed(1);
    const avgD = (stats.deaths / games).toFixed(1);
    const avgA = (stats.assists / games).toFixed(1);
    const winColor = stats.wins / games >= 0.5 ? 'green' : 'red';
    return `${name.padEnd(14)}${String(stats.games).padEnd(7)}{${winColor}-fg}${winRate.padEnd(7)}{/${winColor}-fg}${avgK}/${avgD}/${avgA}`;
  });

  return `{bold}${header}{/bold}\n${lines.join('\n')}`;
};

const formatMasteryDisplay = (masteries, championMap) => {
  if (!masteries || masteries.length === 0) return 'No mastery data available';

  const lines = masteries.map((m, index) => {
    const champName = championMap?.get(String(m.championId)) || `Champion ${m.championId}`;
    const level = `Lvl ${m.championLevel}`;
    const points = m.championPoints.toLocaleString() + ' pts';
    return `${(index + 1)}. ${champName.padEnd(14)} ${level.padEnd(6)} ${points}`;
  });

  return lines.join('\n');
};

module.exports = {
  formatSummary,
  formatMatchDetails,
  formatRankedInfo,
  formatChampionStats,
  formatMasteryDisplay,
  colorizeRank,
};
