# Haki

![Ryou Haki](https://cdn.lanetaneta.com/wp-content/uploads/2020/08/1597113488_One-Piece-revela-un-nuevo-nombre-para-Haki-780x470.webp)

[![NPM version](https://badge.fury.io/js/haki.svg)](http://badge.fury.io/js/haki)
[![travis-ci](https://api.travis-ci.org/pateketrueke/haki.svg)](https://travis-ci.org/pateketrueke/haki)
[![codecov](https://codecov.io/gh/pateketrueke/haki/branch/master/graph/badge.svg)](https://codecov.io/gh/pateketrueke/haki)

Small generator with will powers.

```bash
$ npx haki [-e FILE] [COMMAND] [...]
# or `npm i -g haki`
# or `yarn global add haki`
```

> Run `haki` without arguments to get usage hints.

## Example

Create a file named `Hakifile.js` in your project with this:

```js
module.exports = haki => {
  haki.setGenerator('the:truth', {
    description: "Display if it's true, or not",
    arguments: ['verb', 'value'],
    abortOnFail: true,
    actions(input) {
      const { verb, value } = input;

      if (verb === 'is' && parseInt(value, 10) === 42) {
        console.log('Gotcha!');
        return;
      }

      throw new Error('Is not true');
    },
  });
}
```

Now you can execute this task through the CLI:

- `haki the:truth`
- `haki the:truth is 42`

## API

Available methods:

- `load(filepath: String)` &mdash; Load a Hakifile from given filepath
- `prompt(options: Object)` &mdash; Generic prompting helper, see options below
- `getPrompts()` &mdash; Returns [Prompts](https://github.com/terkelg/prompts) instance
- `getLogger()` &mdash; Returns [LogPose](https://github.com/pateketrueke/log-pose) instance
- `getPath(destName: String)` &mdash; Returns a filepath for output
- `addHelper(name: String, callback: Function)` &mdash; Register a [Mustache](https://github.com/janl/mustache.js/) helper for calling on templates
- `getHelperList()` &mdash; Retrieve all registered helpers
- `renderString(value: String, data: Object)` &mdash; Render template values
- `setGenerator(name: String[, options: Object])` &mdash; Register a generator definition, see options below
- `getGenerator(name: String)` &mdash; Retrieve a registered generator
- `runGenerator(name: String|Object[, defaults: Object])` &mdash; Execute any given generator; given `name` can be an object, see options below
- `hasGenerator(name: String)` &mdash; Returns `true` if given generator is defined
- `getGeneratorList([hints: Boolean])` &mdash; Retrieve all registered generators, if `hints` is given then descriptions are prefixed with their names
- `chooseGeneratorList([defaults: Object])` &mdash; Prompt to execute from registered generators, `defaults` are given as for `runGenerator()`

### Generators

Those can be registered or executed directly.

Valid options are:

- `description: String` &mdash; Displayed on `--help`
- `validate: Object|Function` &mdash; To validate input
- `arguments: Array` &mdash; Map extra `argv` as input
- `actions: Array|Function` &mdash; [See below](#actions)
- `prompts: Array|Function` &mdash; [See below](#prompts)
- `defaults: Object` &mdash; Initial values
- `quiet: Boolean` &mdash; Hide output from logs
- `basePath: String` &mdash; Resolve sources from here
- `abortOnFail: Boolean` &mdash; Abort whole process on failure

> Both `prompts` and `arrays` can be functions, once executed they should return an array to be used or nothing.

#### Actions

Enumerated actions can perform several tasks based on its definition:

- `modify` &mdash; Allow to rewrite a file performing regexp replacements.
- `copy` &mdash; Allow to between files and directories
- `add` &mdash; Allow to write new files
- `exec` &mdash; Invokes a shell instruction
- `clean` &mdash; Removes a file or directory
- `clone` &mdash; Downloads github repository
- `render` &mdash; Rewrite dynamic files or directories
- `extend` &mdash; Rewrite JSON file through extending it
- `install` &mdash; Get your dependencies through NPM or Yarn

Definitions can contain:

- `src: String` &mdash; Relative to generator's `basePath`
- `type: String` &mdash; Action type: add, copy, clean, etc.
- `dest: String` &mdash; Relative to `process.cwd()` for output
- `template: String` &mdash; Used when creating files
- `templateFile: String` &mdash; Source file used when creating files
- `defaultContent: String` &mdash; On `modify`, used if file does not exists yet
- `deleteContent: Boolean` &mdash; On `modify`, remove matched code instead of replacing it
- `after: String|RegExp` &mdash; As below, used to replace before the match
- `before: String|RegExp` &mdash; As below, used to replace after the match (alias of `pattern`)
- `pattern: String|RegExp` &mdash; On `modify`, used to match-and-replace
- `unless: String|RegExp` &mdash; On `modify`, used to skip matching code
- `content: String` &mdash; Like `template` but without Mustache support
- `gitUrl: String` &mdash; Used on `clone` actions, relative to github
- `callback: Function` &mdash; Used on `extend` actions to merge input
- `command: String` &mdash; Used on `exec` actions, as shell command
- `quiet: Boolean` &mdash; Override generator's `quiet` value
- `abortOnFail: Boolean` &mdash; Override generator's `abortOnFail` value

> Rendering means templates are evaluated from all matching files, including its contents if they're plain text.

Example:

```js
haki.runGenerator({
  abortOnFail: true,
  actions: [{ clone: 'pateketrueke/empty', dest: '/tmp' }],
});
```

> Notice `{ type:  'clone', src: 'foo/bar' }` and `{ clone: 'foo/bar' }` are equivalents
> &mdash; the used value for the given type is taken as its `src` option instead.

#### Prompts

User input is being done by **Prompts**, so any syntax supported is valid, e.g.

- `type: String` &mdash; Generator type <sup>1</sup>
- `name: String` &mdash; Input name
- `message: String` &mdash; Optional label

Example:

```js
haki.prompt({
  type: 'toggle',
  name: 'user_confirmation',
  message: 'Enable this feature',
});
```

> <sup>1</sup> Check which [types](https://github.com/terkelg/prompts#-types) are supported by default.

## Global usage

By design `haki` will scan for immediately available Hakifiles from the current working and other special directories.

Say, we are at `$HOME/path/to/project/name` so paths below are used:

- `/etc/.config/haki`
- `/etc/.hakirc`
- `/etc/Hakifile.js`
- `$HOME/.config/haki`
- `$HOME/.hakirc`
- `$HOME/Hakifile.js`
- `$HOME/path/to/project/name/.config/haki`
- `$HOME/path/to/project/name/.hakirc`
- `$HOME/path/to/project/name/Hakifile.js`
- `$HOME/path/to/project/.config/haki`
- `$HOME/path/to/project/.hakirc`
- `$HOME/path/to/project/Hakifile.js`
- `$HOME/path/to/.config/haki`
- `$HOME/path/to/.hakirc`
- `$HOME/path/to/Hakifile.js`
- etc. &mdash; scanning stops when `/` or `$HOME` path is reached.

## Gist usage

You can download and run remote gists too:

```bash
$ haki -g [SHA1]
```

List available gists with `haki -g` only.

## GitHub usage

Download github repositories with:

```bash
$ haki <USER/REPO> <DEST>
```

> After downloading, haki performs a `render` action on the destination folder so all templates will be rendered as needed.
