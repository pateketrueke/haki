const HAKI_HINTS = [
  '`haki` without arguments will run the default generator',
  '`haki init` to make a new Hakifile.js here',
  '`haki --help` to display all available generators',
  '`haki --quiet` will supress status output from logging',
  '`haki --force` will overwrite any files even if they exists',
  '`haki --debug` print the stack trace whenever an error occurs',
];

const HAKI_TXT = `
  ██╗  ██╗ █████╗ ██╗  ██╗██╗
  ██║  ██║██╔══██╗██║ ██╔╝██║
  ███████║███████║█████╔╝ ██║
  ██╔══██║██╔══██║██╔═██╗ ██║
  ██║  ██║██║  ██║██║  ██╗██║
  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝

  Try: ${HAKI_HINTS[Math.floor(Math.random() * HAKI_HINTS.length)]}
`;

const HAKIFILE_TXT = `module.exports = haki => {
  haki.setGenerator('default', {
    description: 'Default generator',
    abortOnFail: true,
    actions() {
      throw new Error('Not implemented!');
    },
  });
};
`;

module.exports = haki => {
  haki.setGenerator('default', {
    description: 'Print a huge banner ;-)',
    actions() {
      process.stdout.write(`${HAKI_TXT}\n`);
    }
  });

  haki.setGenerator('init', {
    description: 'Create a new Hakifile.js',
    actions: [{
      type: 'add',
      template: HAKIFILE_TXT,
      destPath: 'Hakifile.js',
    }]
  });
};
