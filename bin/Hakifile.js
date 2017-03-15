const HAKI_HINTS = [
  '`haki` without arguments will run the default generator',
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

module.exports = haki => {
  haki.setGenerator('default', {
    description: 'Print a huge banner ;-)',
    actions() {
      process.stdout.write(`${HAKI_TXT}\n`);
    }
  });
};
