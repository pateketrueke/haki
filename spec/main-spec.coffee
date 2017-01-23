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

  it 'should perform a quick-test', (done) ->
    # destination directory
    haki = new Haki(fixturesPath, ttys.stdin, ttys.stdout)
    temp = null

    haki.setGenerator 'test',
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
        { type: 'add', destFile: '{{snakeCase value}}.txt' }
        # try to create again (error)
        { type: 'add', destFile: '{{snakeCase value}}.txt' }
        # add some content to it
        {
          type: 'modify'
          pattern: /^/
          destFile: '{{snakeCase value}}.txt'
          template: '<!-- placeholder -->\nValue: {{constantCase value}}'
        }
        # modify the content (again)
        {
          type: 'modify'
          pattern: /(<!-- placeholder -->)/
          destFile: '{{snakeCase value}}.txt'
          template: 'MORE CONTENT GOES HERE\n$1'
        }
        # add from file templates
        {
          type: 'add'
          destFile: '{{snakeCase value}}_copy.txt'
          templateFile: 'templates/sample.txt'
        }
        # copy files
        {
          type: 'copy'
          srcFile: '{{snakeCase value}}_copy.txt'
          destFile: '{{constantCase value}}_REAL.TXT'
        }
      ]

    # retrive the added generator
    test = haki.getGenerator('test')

    # execute and return as promise
    test.run().then (result) ->
      expect(temp).toEqual { value: 'OSOM' }

      # log of changes
      expect(result.changes).toEqual [
        { type: 'add', destFile: 'osom.txt' }
        { type: 'modify', destFile: 'osom.txt' }
        { type: 'modify', destFile: 'osom.txt' }
        { type: 'add', destFile: 'osom_copy.txt' }
        { type: 'copy', srcFile: 'osom_copy.txt', destFile: 'OSOM_REAL.TXT' }
      ]

      # log of failures
      expect(result.failures).toEqual [
        { type: 'add', destFile: 'osom.txt', error: "File 'osom.txt' already exists" }
      ]

      # test copies
      expect(readFile('osom_copy.txt')).toEqual readFile('OSOM_REAL.TXT')

      # final content
      expect(readFile 'osom.txt').toEqual '''
      MORE CONTENT GOES HERE
      <!-- placeholder -->
      Value: OSOM
      '''

      done()

    # start input
    sendLine 'OSOM\n'

  it 'should handle errors', (done) ->
    pass = []

    haki = new Haki(fixturesPath, ttys.stdin, ttys.stdout)
    haki.setGenerator 'test',
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

    test = haki.getGenerator('test')
    test.run().then (result) ->
      expect(pass).toEqual [
        ['4', 'FAIL'] # 4
        ['42', true] # 2
        ['42', true] # \n
      ]

      done()

    sendLine '42\n'

  it 'can load files', ->
    haki = new Haki(fixturesPath)
    haki.load require.resolve('./fixtures/Hakifile')

    test = haki.getGeneratorList()[0]

    expect(test.name).toEqual 'other'
    expect(test.task.basePath).toEqual path.join(__dirname, 'fixtures')
    expect(test.task.description).toEqual 'Another generator test'
