const blessed = require('blessed');
const { getChampionData } = require('./utils');

const formatTimestamp = (timestamp) => {
  const minutes = Math.floor(timestamp / 60000);
  const seconds = Math.floor((timestamp % 60000) / 1000);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const createTimelineScreen = async (parentScreen, match) => {
  // Guard against missing timeline data (can occur when API fetch fails)
  if (!match.timeline?.info?.frames) {
    return new Promise((resolve) => {
      const modal = blessed.box({
        parent: parentScreen,
        top: 'center',
        left: 'center',
        width: 40,
        height: 7,
        border: 'line',
        label: ' {bold}Timeline{/bold} ',
        tags: true,
        grabKeys: true,
        keys: true,
        content: '\n  Timeline data unavailable.\n  Press any key to close.',
      });
      modal.key(['escape', 'q', 'b', 'backspace', 'enter', 'space'], () => {
        modal.destroy();
        parentScreen.render();
        resolve();
      });
      modal.focus();
      parentScreen.render();
    });
  }

  const championData = await getChampionData();
  const championMap = new Map(Object.values(championData.data).map(c => [c.id, c.name]));
  const participantMap = new Map(match.details.info.participants.map(p => [p.participantId, { name: p.summonerName, champion: championMap.get(p.championName), teamId: p.teamId }]));

  return new Promise((resolve) => {
    const modal = blessed.box({
      parent: parentScreen,
      top: 'center',
      left: 'center',
      width: '90%',
      height: '90%',
      border: 'line',
      label: ' {bold}Match Timeline{/bold} ',
      tags: true,
      grabKeys: true,
      keys: true,
    });

    const eventLog = blessed.log({
      parent: modal,
      top: 0,
      left: 0,
      right: 0,
      bottom: 2,
      scrollable: true,
      mouse: true,
      keys: true,
      tags: true,
      border: {
        type: 'line',
      },
      scrollbar: {
        ch: ' ',
        track: { bg: 'cyan' },
        style: { inverse: true }
      }
    });

    const footer = blessed.box({
      parent: modal,
      bottom: 0,
      left: 'center',
      width: '100%-2',
      height: 1,
      content: '{center}{bold}b{/bold}/{bold}backspace{/bold}=Back | {bold}q{/bold}=Quit{/center}',
      tags: true,
    });

    const multiKillMap = {
        2: 'Double Kill',
        3: 'Triple Kill',
        4: 'Quadra Kill',
        5: 'Penta Kill',
    };

    const formatMonsterType = (monsterType) => {
        return `the ${monsterType.replace('_', ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}`;
    };

    match.timeline.info.frames.forEach(frame => {
        frame.events.forEach(event => {
            const timestamp = `[${formatTimestamp(event.timestamp)}]`;
            let logMessage = '';

            switch (event.type) {
                case 'CHAMPION_KILL':
                    const killer = participantMap.get(event.killerId);
                    const victim = participantMap.get(event.victimId);
                    if (killer && victim) {
                        const killerColor = killer.teamId === 100 ? 'blue-fg' : 'red-fg';
                        const victimColor = victim.teamId === 100 ? 'blue-fg' : 'red-fg';
                        logMessage = `${timestamp}  {${killerColor}}${killer.name} ${killer.champion}{/} killed {${victimColor}}${victim.name} ${victim.champion}{/}`;
                    }
                    break;
                case 'CHAMPION_SPECIAL_KILL':
                    const specialKiller = participantMap.get(event.killerId);
                    if (specialKiller) {
                        if (event.killType === 'KILL_FIRST_BLOOD') {
                            logMessage = `${timestamp}  {yellow-fg}${specialKiller.name} ${specialKiller.champion} scored First Blood!{/yellow-fg}`;
                        } else if (event.killType === 'KILL_MULTI') {
                            const multiKill = multiKillMap[event.multiKillLength] || 'Multi Kill';
                            logMessage = `${timestamp}  {yellow-fg}${specialKiller.name} ${specialKiller.champion} scored a ${multiKill}!{/yellow-fg}`;
                        }
                    }
                    break;
                case 'ELITE_MONSTER_KILL':
                    const killerMonster = participantMap.get(event.killerId);
                    if (killerMonster) {
                        const teamColor = killerMonster.teamId === 100 ? 'blue-fg' : 'red-fg';
                        const teamName = killerMonster.teamId === 100 ? 'The Blue Team' : 'The Red Team';
                        logMessage = `${timestamp}   {${teamColor}}${teamName}{/} killed ${formatMonsterType(event.monsterType)}`;
                    }
                    break;
                case 'BUILDING_KILL':
                    const killerBuilding = participantMap.get(event.killerId);
                    let buildingType;
                    if (event.buildingType === 'TOWER_BUILDING') {
                        buildingType = event.towerType.toLowerCase().replace('_', ' ');
                    } else {
                        buildingType = event.buildingType.toLowerCase().replace('_', ' ').replace(' building', '');
                    }
                    
                    if (killerBuilding && killerBuilding.name) {
                        const killerColor = killerBuilding.teamId === 100 ? 'blue-fg' : 'red-fg';
                        logMessage = `${timestamp}   {${killerColor}}${killerBuilding.name}{/} destroyed a ${buildingType}`;
                    } else { // Minion or unknown killer
                        const teamId = event.teamId === 100 ? 200 : 100;
                        const teamColor = teamId === 100 ? 'blue-fg' : 'red-fg';
                        const teamName = teamId === 100 ? 'The Blue Team' : 'The Red Team';
                        logMessage = `${timestamp}   {${teamColor}}${teamName}{/} destroyed a ${buildingType}`;
                    }
                    break;
            }
            if (logMessage) {
                eventLog.add(logMessage);
            }
        });
    });

    setTimeout(() => {
        eventLog.scrollTo(0);
    }, 0);

    eventLog.key(['escape', 'q', 'b', 'backspace'], () => {
      modal.destroy();
      parentScreen.render();
      resolve();
    });

    eventLog.focus();
    parentScreen.render();
  });
};

module.exports = { createTimelineScreen };
