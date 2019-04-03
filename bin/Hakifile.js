const HAKI_HINTS = [
  '`haki` without arguments will run the default generator',
  '`haki --gist` help you to manage your haki-gists',
  '`haki --help` to display all available generators',
  '`haki --quiet` will supress status output from logging',
  '`haki --force` will overwrite any files even if they exists',
  '`haki --debug` print the stack trace whenever an error occurs',
  '`haki --no-add` will skip from writing new files',
  '`haki --no-copy` will skip from copying new files',
  '`haki --no-exec` will skip from executing commands',
  '`haki --no-clone` will skip from cloning repositories',
  '`haki --no-install` will skip from installing dependencies',
  '`haki user/repo` will clone a GitHub repository into any given destination',
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
    },
  });
};
