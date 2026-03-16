'use strict'

const fs = require('node:fs')
const SonicBoom = require('../')
const { file, runTests } = require('./helper')

runTests(buildTests)

function buildTests (test, sync) {
  // Reset the umask for testing
  process.umask(0o000)

  test('destroy', (t, end) => {
    t.plan(5)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, sync })

    t.assert.ok(stream.write('hello world\n'))
    stream.destroy()
    t.assert.throws(() => { stream.write('hello world\n') })

    fs.readFile(dest, 'utf8', function (err, data) {
      t.assert.ifError(err)
      t.assert.equal(data, 'hello world\n')
    })

    stream.on('finish', () => {
      t.assert.fail('finish emitted')
    })

    stream.on('close', () => {
      t.assert.ok('close emitted')
      end()
    })
  })

  test('destroy while opening', (t, end) => {
    t.plan(1)

    const dest = file()
    const stream = new SonicBoom({ dest })

    stream.destroy()
    stream.on('close', () => {
      t.assert.ok('close emitted')
      end()
    })
  })
}
