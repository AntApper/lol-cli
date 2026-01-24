const blessed = require('blessed');

const createMasteryScreen = (parentScreen, summoner, championName, masteryData) => {
  return new Promise((resolve) => {
    const modal = blessed.box({
      parent: parentScreen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: 'shrink',
      border: 'line',
      label: ` {bold}${summoner.name} - ${championName} Mastery{/bold} `,
      tags: true,
      style: {
        border: { fg: 'cyan' },
      },
      // Capture all key presses
      keys: true,
      mouse: true,
      grabKeys: true,
    });

    const masteryLevel = `  {bold}Mastery Level:{/bold} ${masteryData.championLevel}`;
    const masteryPoints = `  {bold}Mastery Points:{/bold} ${masteryData.championPoints.toLocaleString()}`;
    const lastPlayed = `  {bold}Last Played:{/bold} ${new Date(masteryData.lastPlayTime).toLocaleDateString()}`;
    const chestGranted = `  {bold}Chest Earned:{/bold} ${masteryData.chestGranted ? '{green-fg}Yes{/green-fg}' : '{red-fg}No{/red-fg}'}`;

    blessed.text({
        parent: modal,
        content: `${masteryLevel}\n${masteryPoints}\n${lastPlayed}\n${chestGranted}`,
        tags: true,
        top: 1,
        left: 2,
        height: 4,
    });

    if (masteryData.championLevel < 7) {
        const pointsToNext = masteryData.championPointsSinceLastLevel + masteryData.championPointsUntilNextLevel;
        const progress = Math.round((masteryData.championPointsSinceLastLevel / pointsToNext) * 100);

        let barColor = 'cyan';
        const textColor = 'white'; // Always use white text for maximum brightness
        if (progress <= 25) {
            barColor = 'red';
        } else if (progress <= 50) {
            barColor = 'yellow';
        } else if (progress <= 75) {
            barColor = 'green';
        }

        blessed.text({
            parent: modal,
            content: `  {bold}Progress to Level ${masteryData.championLevel + 1}:{/bold}`,
            tags: true,
            top: 6,
            left: 2,
        });

        const barWidth = Math.floor(modal.width * 0.9) - 4; // Adjust for frame
        const content = `${progress}% (${masteryData.championPointsSinceLastLevel.toLocaleString()}/${pointsToNext.toLocaleString()})`;
        
        const filledWidth = Math.round(barWidth * (progress / 100));
        const unfilledWidth = barWidth - filledWidth;

        // Center the text content within the bar
        const textStart = Math.floor((barWidth - content.length) / 2);
        let barContent;

        if (textStart < 0) {
            barContent = `{center}{${textColor}-fg}${content}{/${textColor}-fg}{/center}`;
        } else {
            const coloredText = `{${textColor}-fg}${content}{/${textColor}-fg}`;

            if (textStart + content.length <= filledWidth) {
                const left = ' '.repeat(textStart);
                const right = ' '.repeat(filledWidth - textStart - content.length);
                const unfilled = ' '.repeat(unfilledWidth);
                barContent = `{${barColor}-bg}${left}${coloredText}${right}{/}` + `{grey-bg}${unfilled}{/}`;
            } else if (textStart >= filledWidth) {
                const left = ' '.repeat(textStart - filledWidth);
                const right = ' '.repeat(unfilledWidth - (textStart - filledWidth) - content.length);
                const filled = ' '.repeat(filledWidth);
                barContent = `{${barColor}-bg}${filled}{/}` + `{grey-bg}${left}${coloredText}${right}{/}`;
            } else {
                const filledPartLen = filledWidth - textStart;
                const unfilledPartLen = content.length - filledPartLen;
                const filledContent = content.substring(0, filledPartLen);
                const unfilledContent = content.substring(filledPartLen);
                const rightUnfilled = ' '.repeat(unfilledWidth - unfilledPartLen);

                barContent = `{${barColor}-bg}${' '.repeat(textStart)}{${textColor}-fg}${filledContent}{/${textColor}-fg}{/}`
                           + `{grey-bg}{${textColor}-fg}${unfilledContent}{/${textColor}-fg}${rightUnfilled}{/}`;
            }
        }

        const framedBar = blessed.box({
            parent: modal,
            width: '90%',
            height: 3,
            top: 7,
            left: 'center',
            content: `╔╡{bold} Mastery Progression {/bold}╞╗\n║ ${barContent} ║\n╚════${'═'.repeat(barWidth)}══╝`,
            tags: true,
        });
    }

    const footer = blessed.text({
        parent: modal,
        width: '90%',
        top: 10,
        left: 'center',
        content: '{center}{bold}b{/bold}/{bold}backspace{/bold}=Back{/center}',
        tags: true,
    });

    modal.focus();
    parentScreen.render();

    modal.on('keypress', (ch, key) => {
      if (['escape', 'q', 'b', 'backspace'].includes(key.name)) {
        modal.destroy();
        parentScreen.render();
        resolve();
      }
    });
  });
};

module.exports = { createMasteryScreen };
