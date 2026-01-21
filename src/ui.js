const asciichart = require('asciichart');

// Get display width of a string (CJK chars = 2 columns)
const getDisplayWidth = (str) => {
  let width = 0;
  for (const char of str) {
    const code = char.charCodeAt(0);
    // CJK characters and full-width forms take 2 columns
    if ((code >= 0x4E00 && code <= 0x9FFF) ||   // CJK Unified Ideographs
        (code >= 0xAC00 && code <= 0xD7AF) ||   // Hangul Syllables
        (code >= 0xFF00 && code <= 0xFFEF) ||   // Full-width forms
        (code >= 0x3000 && code <= 0x303F) ||   // CJK Punctuation
        (code >= 0x3040 && code <= 0x309F) ||   // Hiragana
        (code >= 0x30A0 && code <= 0x30FF)) {   // Katakana
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
};

// Truncate string to fit within maxWidth display columns
const truncateToWidth = (str, maxWidth) => {
  let width = 0;
  let result = '';
  for (const char of str) {
    const charWidth = getDisplayWidth(char);
    if (width + charWidth > maxWidth) break;
    result += char;
    width += charWidth;
  }
  return result;
};

// Pad string to targetWidth display columns
const padToWidth = (str, targetWidth) => {
  const currentWidth = getDisplayWidth(str);
  const padding = Math.max(0, targetWidth - currentWidth);
  return str + ' '.repeat(padding);
};

// Calculate KDA ratio for a participant
const calculateKdaRatio = (p) => (p.kills + p.assists) / Math.max(p.deaths, 1);

const formatSummary = (summoner, matches) => {
  if (matches.length === 0) {
    return `{bold}{green-fg}No recent games found.{/green-fg}{/bold}`;
  }

  let totalWins = 0;
  let totalKills = 0;
  let totalDeaths = 0;
  let totalAssists = 0;
  let totalDuration = 0;
  let validGames = 0;
  const championCounts = {};

  matches.forEach(match => {
    const participant = match.details.info.participants.find(p => p.puuid === summoner.puuid);
    if (participant) {
      // Skip remakes - games under 5 minutes where player lost
      const isRemake = !participant.win && match.details.info.gameDuration < 300;
      if (isRemake) return;

      validGames++;
      if (participant.win) totalWins++;
      totalKills += participant.kills;
      totalDeaths += participant.deaths;
      totalAssists += participant.assists;
      totalDuration += match.details.info.gameDuration;
      championCounts[participant.championName] = (championCounts[participant.championName] || 0) + 1;
    }
  });

  const winRate = validGames > 0 ? ((totalWins / validGames) * 100).toFixed(2) : '0.00';
  const overallKda = totalDeaths > 0 ? ((totalKills + totalAssists) / totalDeaths).toFixed(2) : 'Perfect';

  const sortedChampions = Object.entries(championCounts).sort((a, b) => b[1] - a[1]);
  const mostPlayed = sortedChampions.slice(0, 3).map(([name, count]) => `${name} (${count})`).join(', ');

  const avgDuration = validGames > 0 ? Math.floor(totalDuration / validGames) : 0;
  const avgMinutes = Math.floor(avgDuration / 60);
  const avgSeconds = avgDuration % 60;
  const avgGameTime = `${avgMinutes}m ${avgSeconds}s`;

  const labels = ["Win Rate:", "Overall KDA:", "Most Played:", "Avg Game Time:"];
  const longestLabel = Math.max(...labels.map(l => l.length));

  return `${labels[0].padEnd(longestLabel)} {bold}${winRate}%{/bold}\n` +
         `${labels[1].padEnd(longestLabel)} {bold}${overallKda}{/bold}\n` +
         `${labels[2].padEnd(longestLabel)} {bold}${mostPlayed}{/bold}\n` +
         `${labels[3].padEnd(longestLabel)} {bold}${avgGameTime}{/bold}`;
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
    const allParticipants = match.details.info.participants;
    const team1 = allParticipants.slice(0, 5);
    const team2 = allParticipants.slice(5, 10);

    // Absolute thresholds for KDA highlighting
    const greenThreshold = 4.0;
    const redThreshold = 1.5;

    // Calculate the longest name for dynamic padding
    const longestName = Math.max(...allParticipants.map(p => `${p.riotIdGameName}#${p.riotIdTagline}`.length));

    const formatTeam = (team) => {
        return team.map(p => {
            const rank = rankData[p.puuid] || '...';
            const fullRiotId = `${p.riotIdGameName}#${p.riotIdTagline}`.padEnd(longestName + 2);
            const champion = p.championName.padEnd(16);
            const kdaStr = `${p.kills}/${p.deaths}/${p.assists}`;
            const playerKda = calculateKdaRatio(p);
            // Color-code KDA: green for good performance, red for poor performance
            let coloredKda;
            if (playerKda >= greenThreshold) {
              coloredKda = `{green-fg}${kdaStr.padEnd(12)}{/green-fg}`;
            } else if (playerKda <= redThreshold) {
              coloredKda = `{red-fg}${kdaStr.padEnd(12)}{/red-fg}`;
            } else {
              coloredKda = kdaStr.padEnd(12);
            }
            return `${fullRiotId} ${champion} ${coloredKda} ${colorizeRank(rank)}`;
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
      // Skip remakes - games under 5 minutes where player lost
      const isRemake = !participant.win && match.details.info.gameDuration < 300;
      if (isRemake) return;

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

const formatRankPreview = (match, rankData, summoner, historicalRanks = {}) => {
  if (!match) return '';

  const participants = match.details.info.participants;
  const queueId = match.details.info.queueId;
  const team1 = participants.filter(p => p.teamId === 100);
  const team2 = participants.filter(p => p.teamId === 200);

  // Absolute thresholds for KDA highlighting
  const greenThreshold = 4.0;
  const redThreshold = 1.5;

  const roleMap = { TOP: 'TOP', JUNGLE: 'JGL', MIDDLE: 'MID', BOTTOM: 'BOT', UTILITY: 'SUP', ARENA: '---' };
  const formatPlayer = (p) => {
    const isCurrentUser = p.puuid === summoner.puuid;
    // Use historical rank for monitored accounts if available, otherwise use current rank
    const playerHistoricalRank = historicalRanks[p.puuid];
    let rank;
    if (playerHistoricalRank) {
      rank = `${playerHistoricalRank.tier} ${playerHistoricalRank.rank}`;
    } else {
      rank = rankData?.[p.puuid] || '...';
    }
    const rawName = p.riotIdGameName || p.summonerName || '???';
    const name = padToWidth(truncateToWidth(rawName, 10), 11);  // 10 cols max, pad to 11
    const champ = padToWidth(truncateToWidth(p.championName, 8), 9);
    const kdaStr = `${p.kills}/${p.deaths}/${p.assists}`;
    const playerKda = calculateKdaRatio(p);
    // Color-code KDA: green for good performance, red for poor performance
    let coloredKda;
    if (playerKda >= greenThreshold) {
      coloredKda = `{green-fg}${kdaStr.padEnd(7)}{/green-fg}`;
    } else if (playerKda <= redThreshold) {
      coloredKda = `{red-fg}${kdaStr.padEnd(7)}{/red-fg}`;
    } else {
      coloredKda = kdaStr.padEnd(7);
    }
    const rawRole = queueId === 1700 ? 'ARENA' : (p.teamPosition || p.individualPosition || '');
    const role = roleMap[rawRole] || rawRole.substring(0, 3);
    const prefix = isCurrentUser ? '>' : ' ';
    const coloredRank = colorizeRank(rank);
    return `${prefix}${name} ${role.padEnd(4)} ${champ} ${coloredKda} ${coloredRank}`;
  };

  let content = '{cyan-fg}Blue Team{/cyan-fg}\n';
  content += team1.map(formatPlayer).join('\n');
  content += '\n\n{red-fg}Red Team{/red-fg}\n';
  content += team2.map(formatPlayer).join('\n');

  return content;
};

// Convert rank to absolute LP score for graph visualization
// IRON IV 0 LP = 0, SILVER I 50 LP = 1350, GOLD IV 0 LP = 1600
const rankToAbsoluteLP = (tier, rank, lp) => {
  const tiers = { 'IRON': 0, 'BRONZE': 1, 'SILVER': 2, 'GOLD': 3, 'PLATINUM': 4, 'EMERALD': 5, 'DIAMOND': 6, 'MASTER': 7, 'GRANDMASTER': 8, 'CHALLENGER': 9 };
  const divisions = { 'IV': 0, 'III': 1, 'II': 2, 'I': 3 };
  const tierScore = (tiers[tier] || 0) * 400;
  const divisionScore = (divisions[rank] || 0) * 100;
  return tierScore + divisionScore + (lp || 0);
};

// Convert absolute LP back to rank abbreviation (e.g., 1250 -> "G4 50")
const absoluteLPToRankAbbr = (absoluteLP) => {
  const tiers = ['I', 'B', 'S', 'G', 'P', 'E', 'D', 'M', 'GM', 'C'];
  const divisions = ['4', '3', '2', '1'];

  // Clamp to valid range
  absoluteLP = Math.max(0, absoluteLP);

  const tierIndex = Math.min(Math.floor(absoluteLP / 400), 9);
  const tierAbbr = tiers[tierIndex];

  // Master+ tiers have no divisions - show tier + total LP
  if (tierIndex >= 7) {
    const lpInTier = absoluteLP - (tierIndex * 400);
    return `${tierAbbr}${lpInTier}`;
  }

  const lpInTier = absoluteLP % 400;
  const divisionIndex = Math.min(Math.floor(lpInTier / 100), 3);
  const divisionNum = divisions[divisionIndex];
  const lpInDivision = lpInTier % 100;

  return `${tierAbbr}${divisionNum} ${lpInDivision}`;
};

// Format LP progression graph from rank history snapshots
const formatLPGraph = (snapshots, width, height, queueType = 'RANKED_SOLO_5x5') => {
  if (!snapshots || snapshots.length === 0) {
    return 'No LP changes in this period';
  }

  // Filter for the specified queue type and sort by timestamp
  const filtered = snapshots
    .filter(s => s.queueType === queueType)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (filtered.length === 0) {
    return 'No ranked games found';
  }

  if (filtered.length === 1) {
    const s = filtered[0];
    return `Current: ${s.tier} ${s.rank} ${s.leaguePoints} LP\n(Play more ranked games to see progression)`;
  }

  // Convert snapshots to absolute LP values
  const lpValues = filtered.map(s => rankToAbsoluteLP(s.tier, s.rank, s.leaguePoints));

  // Resample data if we have more points than width allows
  const graphWidth = Math.min(width - 10, 40); // Leave room for Y-axis labels
  const data = lpValues.length > graphWidth ? resampleData(lpValues, graphWidth) : lpValues;

  // Generate the chart with empty Y-axis labels
  const chartHeight = Math.min(height - 2, 5); // Leave room for W/L markers
  const chart = asciichart.plot(data, {
    height: chartHeight,
    format: () => '      ' // 6 spaces to maintain alignment
  });

  // Get first and last rank labels
  const firstLP = data[0];
  const lastLP = data[data.length - 1];
  const firstRankLabel = absoluteLPToRankAbbr(firstLP).padStart(6);
  const lastRankLabel = ' ' + absoluteLPToRankAbbr(lastLP);

  // Parse chart lines and add inline rank labels
  const chartLines = chart.split('\n');

  // Find which row has the first data point (leftmost chart character after y-axis)
  // and which row has the last data point (rightmost chart character)
  let firstPointRow = -1;
  let lastPointRow = -1;
  const yAxisWidth = 7; // 6 chars for label + 1 separator space

  // Characters that mark actual data points (exclude │ which is just a connector)
  // asciichart uses: ┐ ┘ ┌ └ ─ │ ╮ ╯ ╭ ╰ but │ only connects points vertically
  const dataPointChars = /[┐┘┌└╮╯╭╰┼┤├─]/;

  // Determine trend direction to know where first data point should be
  const isUpwardTrend = data[0] < data[data.length - 1];

  // Find row with first data point (leftmost column, exclude vertical connectors)
  if (isUpwardTrend) {
    // First point is at bottom, iterate from bottom to top
    for (let i = chartLines.length - 1; i >= 0; i--) {
      const line = chartLines[i];
      if (line.length > yAxisWidth) {
        const firstChar = line[yAxisWidth];
        if (firstChar && dataPointChars.test(firstChar)) {
          firstPointRow = i;
          break;
        }
      }
    }
  } else {
    // First point is at top or same level, iterate from top to bottom
    for (let i = 0; i < chartLines.length; i++) {
      const line = chartLines[i];
      if (line.length > yAxisWidth) {
        const firstChar = line[yAxisWidth];
        if (firstChar && dataPointChars.test(firstChar)) {
          firstPointRow = i;
          break;
        }
      }
    }
  }

  // Find row with last data point (rightmost column, exclude vertical connectors)
  let maxCol = 0;
  for (let i = 0; i < chartLines.length; i++) {
    const line = chartLines[i];
    for (let j = line.length - 1; j >= yAxisWidth; j--) {
      if (dataPointChars.test(line[j])) {
        if (j > maxCol) {
          maxCol = j;
          lastPointRow = i;
        }
        break;
      }
    }
  }

  // Add labels to the appropriate rows
  const modifiedLines = chartLines.map((line, i) => {
    let newLine = line;
    if (i === firstPointRow) {
      // Replace empty y-axis label with first rank
      newLine = firstRankLabel + line.slice(6);
    }
    if (i === lastPointRow) {
      // Append last rank label to the end
      newLine = newLine + lastRankLabel;
    }
    return newLine;
  });

  const modifiedChart = modifiedLines.join('\n');

  // Build win/loss markers line using blessed tags
  // We need to align markers with the data points in the chart
  let markers = '';
  const chartWidth = data.length;

  for (let i = 1; i < filtered.length && i < chartWidth; i++) {
    const prev = filtered[i - 1];
    const curr = filtered[i];
    const prevLP = rankToAbsoluteLP(prev.tier, prev.rank, prev.leaguePoints);
    const currLP = rankToAbsoluteLP(curr.tier, curr.rank, curr.leaguePoints);

    if (currLP > prevLP) {
      markers += '{green-fg}W{/green-fg}';
    } else if (currLP < prevLP) {
      markers += '{red-fg}L{/red-fg}';
    } else {
      markers += '-';
    }
  }

  // Add colored markers below the chart (aligned with data points)
  // The chart has a Y-axis label taking ~8 chars, so we pad accordingly
  const markerPadding = ' '.repeat(8);
  const markerLine = markerPadding + markers;

  return modifiedChart + '\n' + markerLine;
};

module.exports = {
  formatSummary,
  formatMatchDetails,
  formatRankedInfo,
  formatChampionStats,
  formatMasteryDisplay,
  formatRankPreview,
  colorizeRank,
  rankToAbsoluteLP,
  formatLPGraph,
};
