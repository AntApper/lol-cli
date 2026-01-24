const blessed = require('blessed');
const { detectRegionFromRiotId } = require('./utils');

const REGIONS = ['NA1', 'KR', 'EUW1', 'EUN1', 'JP1', 'BR1', 'LA1', 'LA2', 'OC1', 'RU', 'TR1'];

const createSearchScreen = (defaults = {}, options = {}) => {
  const { accountCount = 0 } = options;

  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      title: 'LoL CLI Search',
    });

    // Color scheme
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

    // Main layout
    const layout = blessed.box({
      parent: screen,
      width: '100%',
      height: '100%',
      style: {
        bg: colors.bg,
        fg: colors.fg,
      },
    });

    // Title
    blessed.text({
      parent: layout,
      top: 1,
      left: 'center',
      content: 'League of Legends CLI',
      style: {
        fg: colors.cyan,
        bold: true,
      },
    });

    // Account indicator (if monitored accounts exist)
    if (accountCount > 0) {
      blessed.text({
        parent: layout,
        top: 1,
        right: 1,
        content: `${accountCount} account${accountCount > 1 ? 's' : ''} saved`,
        style: {
          fg: colors.yellow,
        },
      });
    }

    const form = blessed.form({
      parent: layout,
      width: '80%',
      height: 12,
      top: 'center',
      left: 'center',
      border: {
        type: 'line',
        fg: colors.purple,
      },
      keys: false,
      mouse: true,
      label: ' Search Summoner ',
      style: {
        bg: colors.bg,
        border: { fg: colors.purple },
        label: { fg: colors.fg },
      },
    });

    blessed.text({
      parent: form,
      content: 'Riot ID:',
      top: 2,
      left: 5,
      style: {
        fg: colors.fg,
      },
    });

    const riotIdInput = blessed.textbox({
      parent: form,
      name: 'riotId',
      height: 1,
      width: '70%',
      top: 2,
      left: 15,
      inputOnFocus: true,
      mouse: true,
      style: {
        fg: colors.fg,
        bg: '#1e1f29',
        focus: {
          bg: colors.pink,
          fg: colors.bg,
        },
      },
    });

    blessed.text({
      parent: form,
      content: 'Region:',
      top: 4,
      left: 5,
      style: {
        fg: colors.fg,
      },
    });

    const regionList = blessed.list({
      parent: form,
      name: 'region',
      width: '30%',
      height: 3,
      top: 4,
      left: 15,
      items: REGIONS,
      mouse: true,
      keys: true,
      lockKeys: true,
      scrollable: true,
      scrollbar: {
        ch: ' ',
        track: { bg: colors.purple },
        style: { inverse: true },
      },
      label: 'Region',
      style: {
        selected: {
          bg: colors.pink,
          fg: colors.bg,
        },
        item: {
          fg: colors.fg,
        },
      },
    });

    const submitButton = blessed.button({
      parent: form,
      name: 'submit',
      content: 'Search',
      width: 10,
      height: 1,
      bottom: 1,
      right: 1,
      mouse: true,
      keys: true,
      shrink: true,
      style: {
        fg: colors.fg,
        bg: colors.green,
        focus: {
          bg: colors.pink,
        },
        hover: {
          bg: colors.pink,
        },
      },
    });

    const backButton = blessed.button({
      parent: form,
      name: 'back',
      content: 'Exit',
      width: 10,
      height: 1,
      bottom: 1,
      left: 1,
      mouse: true,
      keys: true,
      shrink: true,
      style: {
        fg: colors.fg,
        bg: colors.red,
        focus: {
          bg: colors.pink,
        },
        hover: {
          bg: colors.pink,
        },
      },
    });

    // Auto-detect status message
    const autoDetectStatus = blessed.text({
      parent: form,
      top: 4,
      right: 3,
      content: '',
      tags: true,
      style: {
        fg: colors.green,
      },
    });

    // Footer with key hints
    blessed.text({
      parent: layout,
      bottom: 0,
      left: 'center',
      content: 'Tab: Navigate | Enter: Select/Submit | Esc/q/Ctrl+C: Exit',
      style: {
        fg: colors.orange,
      },
    });

    if (defaults.riotId) {
      riotIdInput.setValue(defaults.riotId);
    }
    if (defaults.region) {
      const regionIndex = REGIONS.indexOf(defaults.region);
      if (regionIndex !== -1) {
        regionList.select(regionIndex);
      }
    }

    riotIdInput.focus();

    riotIdInput.key('enter', () => {
      const riotId = riotIdInput.getValue();
      const detectedRegion = detectRegionFromRiotId(riotId);
      if (detectedRegion) {
        const regionIndex = REGIONS.indexOf(detectedRegion);
        if (regionIndex !== -1) {
          regionList.select(regionIndex);
          autoDetectStatus.setContent(`(Auto: ${detectedRegion})`);
          screen.render();
        }
      } else {
        autoDetectStatus.setContent('');
        screen.render();
      }
      regionList.focus();
    });

    regionList.key('enter', () => {
        form.submit();
    });

    form.on('submit', (data) => {
      const selectedRegion = regionList.getItem(regionList.selected).getContent();
      screen.destroy();
      resolve({ ...data, region: selectedRegion });
    });

    backButton.on('press', () => {
      screen.destroy();
      resolve('EXIT');
    });

    submitButton.on('press', () => form.submit());

    screen.key(['escape', 'q', 'C-c'], () => {
      screen.destroy();
      resolve(null);
    });

    screen.render();
  });
};

module.exports = { createSearchScreen };
