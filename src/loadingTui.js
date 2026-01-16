const blessed = require('blessed');

const createLoadingScreen = (screen) => {
  const colors = {
    bg: '#010a13',
    fg: '#c4b998',
    cyan: '#0ac8b9',
    blue: '#0d6786',
    gold: '#c89b3f',
  };

  const loadingBox = blessed.box({
    parent: screen,
    width: '100%',
    height: '100%',
    style: {
      bg: colors.bg,
      fg: colors.fg,
    },
  });

  const logo = `
    _                                _
   | |                              | |
   | |    _   _  _ __    ___   _ __  | |
   | |   | | | | | '_ \\  / _ \\ | '_ \\ | |
   | |___| |_| | | | | || (_) || | | || |
   \\_____/\\__,_(_)|_| |_| \\___/ |_| |_|(_)
  `;

  blessed.text({
    parent: loadingBox,
    top: '20%',
    left: 'center',
    content: logo,
    style: {
      fg: colors.gold,
    },
  });

  const border = blessed.box({
    parent: loadingBox,
    width: '80%',
    height: 5,
    top: 'center',
    left: 'center',
    border: {
      type: 'line',
      fg: colors.gold,
    },
  });

  const message = blessed.text({
    parent: border,
    top: 1,
    left: 'center',
    content: 'Forging Match History...',
    style: {
      fg: colors.cyan,
      bold: true,
    },
  });

  const progressBar = blessed.progressbar({
    parent: border,
    width: '90%',
    height: 1,
    top: 3,
    left: 'center',
    pch: '█',
    style: {
      bg: colors.blue,
      bar: {
        bg: colors.cyan,
      },
      border: {
        fg: colors.gold,
      },
    },
  });

  return {
    // Update progress bar and/or message.
    // - progress: number (0-100) to set progress, or null/undefined to skip progress update
    // - msg: optional string to update the loading message
    update: (progress, msg) => {
      if (progress !== null && progress !== undefined) {
        progressBar.setProgress(progress);
      }
      if (msg) {
        message.setContent(msg);
      }
      screen.render();
    },
    destroy: () => {
      loadingBox.destroy();
      screen.render();
    },
  };
};

module.exports = { createLoadingScreen };
