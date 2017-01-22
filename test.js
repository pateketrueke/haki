'use strict';

const Haki = require('./lib');
const haki = new Haki(process.cwd());

haki.setGenerator('test', {
  description: 'this is a test',
  prompts: [{
    type: 'prompt',
    name: 'name',
    message: 'What is your name?',
    validate: (value) => {
      if (!value.length) {
        throw new Error('Please provide a name');
      }
    },
  }],
  actions: [{
    type: 'add',
    destPath: 'folder/{{name}}.txt',
    templateFile: 'templates/temp.txt',
  }],
});

console.log(haki.getHelperList());
console.log(haki.renderString('{{foo}}', { foo: 'bar' }));
console.log(haki.renderString('{{snakeCase foo}}', { foo: 'baz buzz' }));

const t = haki.getGenerator('test');

t.run().then((result) => {
  result.changes.forEach((info) => {
    console.log(info.type, info.destFile);
  });

  result.failures.forEach((info) => {
    console.error(info.type, info.destFile, info.error);
  });
});
