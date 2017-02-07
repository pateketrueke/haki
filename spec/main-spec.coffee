rimraf = require('rimraf')
ttys = require('ttys')
path = require('path')
fs = require('fs')

Haki = require('..')

fixturesPath = path.join(__dirname, 'fixtures/generated')

readFile = (file) ->
  fs.readFileSync(path.join(fixturesPath, file)).toString()

sendLine = (line) ->
  setImmediate ->
    ttys.stdin.emit('data', line)

# hide tty-output
ttys.stdout.write = ->

describe 'Haki', ->
  beforeEach ->
    rimraf.sync fixturesPath
    @haki = new Haki(fixturesPath, ttys.stdin, ttys.stdout)

  it 'should perform a quick-test', (done) ->
    # destination directory
    temp = null

    @haki.setGenerator 'test',
      # each generator can have its own sources directory
      basePath: path.join(__dirname, 'fixtures')
      # prompts are from enquirer: input checkbox confirm expand list password radio rawlist
      prompts: [{
        name: 'value'
        message: 'So what?'
      }]
      # actions can add or modify files
      actions: [
        # custom actions
        (x) -> temp = x
        # create a new file
        { type: 'add', destPath: '{{snakeCase value}}.txt' }
        # try to create again (error)
        { type: 'add', destPath: '{{snakeCase value}}.txt' }
        # add some content to it
        {
          type: 'modify'
          pattern: /^/
          destPath: '{{snakeCase value}}.txt'
          template: '<!-- placeholder -->\nValue: {{constantCase value}}'
        }
        # modify the content (again)
        {
          type: 'modify'
          pattern: /(<!-- placeholder -->)/
          destPath: '{{snakeCase value}}.txt'
          template: 'MORE CONTENT GOES HERE\n$1'
        }
        # add from file templates
        {
          type: 'add'
          srcPath: 'templates/sample.txt'
          destPath: '{{snakeCase value}}_copy.txt'
        }
        # copy files
        {
          type: 'copy'
          srcPath: 'templates/test.txt'
          destPath: '{{constantCase value}}_TEST.TXT'
        }
      ]

    # retrive the added generator
    test = @haki.getGenerator('test')

    # execute and return as promise
    test.run().then (result) ->
      expect(temp).toEqual { value: 'OSOM' }

      # log of changes
      expect(result.changes).toEqual [
        { type: 'add', destPath: 'osom.txt' }
        { type: 'modify', destPath: 'osom.txt' }
        { type: 'modify', destPath: 'osom.txt' }
        { type: 'add', destPath: 'osom_copy.txt' }
        { type: 'copy', destPath: 'OSOM_TEST.TXT' }
      ]

      # log of failures
      expect(result.failures).toEqual [
        { type: 'add', destPath: 'osom.txt', error: new Error("File 'osom.txt' already exists") }
      ]

      # final content
      expect(readFile 'osom.txt').toEqual '''
      MORE CONTENT GOES HERE
      <!-- placeholder -->
      Value: OSOM
      '''

      done()
    .catch (error) ->
      console.log 'This should not happen', error
      done()

    # start input
    sendLine 'OSOM\n'

  it 'should handle errors', (done) ->
    pass = []

    @haki.setGenerator 'test',
      prompts: [{
        name: 'value'
        message: 'Anything:'
        validate: (value) ->
          _value = if value is '42'
            true
          else
            'FAIL'

          # capture passed value
          pass.push([value, _value])

          _value
      }]

    @haki.runGenerator('test').then (result) ->
      expect(pass).toEqual [
        ['4', 'FAIL'] # 4
        ['42', true] # 2
        ['42', true] # \n
      ]

      done()

    sendLine '42\n'

  it 'will fail on missing generators', ->
    expect(=> @haki.chooseGeneratorList()).toThrow()

  it 'can display generators', (done) ->
    temp = null

    expect(=> @haki.setGenerator()).toThrow()

    @haki.setGenerator 'test',
      actions: ->
        temp = 42
        []

    @haki.chooseGeneratorList().then ->
      expect(temp).toEqual 42
      done()

    sendLine '\n'

  it 'can prompt manually', (done) ->
    @haki.prompt
      name: 'input'
    .then (value) ->
      expect(value).toEqual 'OK'
      done()

    sendLine 'OK\n'

  it 'can load files', ->
    @haki.load require.resolve('./fixtures/Hakifile')
    @haki.load '../Hakifile.js'

    test = @haki.getGeneratorList()[0]

    expect(test.name).toEqual 'other'
    expect(test.task.basePath).toEqual path.join(__dirname, 'fixtures')
    expect(test.task.description).toEqual 'Another generator test'

  it 'will export getPath()', ->
    expect(@haki.getPath()).toEqual fixturesPath
    expect(@haki.getPath('a/b.c')).toEqual path.join(fixturesPath, 'a/b.c')

  it 'will export addHelper()', ->
    pkg = require('../package.json')

    @haki.addHelper 'pkg', () ->
      (text) ->
        keys = text.split('.')
        obj = pkg
        obj = obj[keys.shift()] while keys.length
        obj

    expect(@haki.getHelperList()).toContain 'pkg'
    expect(@haki.renderString('{{pkg name}}')).toEqual 'haki'
    expect(@haki.renderString('{{pkg dependencies.chalk}}')).toEqual '^1.1.3'

  it 'will export renderString()', ->
    expect(@haki.renderString('{{constantCase a}}', { a: 'b' })).toEqual 'B'
    expect(@haki.renderString('{{singularize x}}', { x: 'posts' })).toEqual 'post'
    expect(@haki.renderString('{{pluralize x}}', { x: 'post' })).toEqual 'posts'

  it 'will pass all values', (done) ->
    data = null

    @haki.setGenerator 'test',
      prompts: [
        { name: 'a' }
        { name: 'm' }
      ]
      actions: -> [(v) -> data = v]

    @haki.runGenerator('test', { x: 'y', m: 'n' }).then (result) ->
      expect(data).toEqual { x: 'y', a: 'b', m: 'n' }
      done()

    sendLine 'b\n'

  it 'will fail when destPath is missing', (done) ->
    @haki.setGenerator 'test',
      actions: [{}]

    @haki.runGenerator('test').catch (error) ->
      expect(error.message).toContain 'Destination file is missing'
      done()

  it 'will fail when srcPath is missing', (done) ->
    @haki.setGenerator 'test',
      actions: [{ type: 'copy', destPath: 'a.txt' }]

    @haki.runGenerator('test').then (result) ->
      expect(result.failures[0].error).toEqual new Error('Source file is missing')
      done()

  it 'will fail when pattern is missing', (done) ->
    @haki.setGenerator 'test',
      actions: [{ type: 'modify', destPath: 'a.txt' }]

    @haki.runGenerator('test').then (result) ->
      expect(result.failures[0].error).toEqual new Error('Modify pattern is missing')
      done()

  it 'will fail on unsupported prompts', (done) ->
    @haki.setGenerator 'test',
      prompts: [{ type: 'x' }]

    @haki.runGenerator('test').catch (error) ->
      expect(error.message).toContain "Unsupported 'x' prompt"
      done()

  it 'will fail on broken actions', (done) ->
    @haki.setGenerator 'test',
      actions: [
        -> throw new Error('FAIL')
      ]

    @haki.runGenerator('test').catch (error) ->
      expect(error.message).toContain 'FAIL'
      done()

  it 'will fail on broken prompts', (done) ->
    @haki.setGenerator 'test',
      prompts: [{
        name: 'x'
        message: 'Say something:'
        validate: -> throw new Error('FAIL')
      }]

    @haki.runGenerator('test').catch (error) ->
      expect(error.message).toContain 'FAIL'
      done()

    sendLine 'y\n'

  it 'will report on copy duplicates', (done) ->
    @haki.setGenerator 'test',
      basePath: path.join(__dirname, 'fixtures')
      actions: [
        { type: 'add', destPath: 'copy.txt', srcPath: 'templates/sample.txt' }
        { type: 'copy', destPath: 'copy.txt', srcPath: 'templates/test.txt' }
      ]

    @haki.runGenerator('test').then (result) ->
      expect(result.failures[0].error).toEqual new Error("File 'copy.txt' already exists")
      done()

  it 'will report missing templates', (done) ->
    @haki.setGenerator 'test',
      actions: [{ type: 'add', destPath: 'a.txt', srcPath: 'b.txt' }]

    @haki.runGenerator('test').then (result) ->
      expect(result.failures[0].error).toEqual new Error("File 'b.txt' does not exists")
      done()

  it 'will report missing sources', (done) ->
    @haki.setGenerator 'test',
      actions: [{ type: 'copy', srcPath: 'a.txt', destPath: 'b.txt' }]

    @haki.runGenerator('test').then (result) ->
      expect(result.failures[0].error).toEqual new Error("File 'a.txt' does not exists")
      done()

  it 'will report unsupported actions', (done) ->
    @haki.setGenerator 'test',
      actions: [{ type: 'dunno', destPath: 'a.txt' }]

    @haki.runGenerator('test').then (result) ->
      expect(result.failures[0].error).toEqual new Error("Unsupported 'dunno' action")
      done()

  it 'will stop when abortOnFail is true', (done) ->
    @haki.setGenerator 'test',
      actions: [{ abortOnFail: true, destPath: 'a.txt' }]

    @haki.runGenerator('test').catch (error) ->
      expect(error).toEqual new Error("Unsupported 'undefined' action")
      done()
