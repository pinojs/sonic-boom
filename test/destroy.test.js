'use strict'

const fs = require('fs')
const SonicBoom = require('../')
const { file, runTests } = require('./helper')

runTests(buildTests)

function buildTests (test, sync) {
  // Reset the umask for testing
  process.umask(0o000)

  test('destroy', (t) => {
    t.plan(5)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, sync })

    t.ok(stream.write('hello world\n'))
    stream.destroy()
    t.throws(() => { stream.write('hello world\n') })

    fs.readFile(dest, 'utf8', function (err, data) {
      t.error(err)
      t.equal(data, 'hello world\n')
    })

    stream.on('finish', () => {
      t.fail('finish emitted')
    })

    stream.on('close', () => {
      t.pass('close emitted')
    })
  })

  test('destroy while opening', (t) => {
    t.plan(3)

    const dest = file()
    const stream = new SonicBoom({ dest })
    const events = []

    stream.on('ready', () => {
      events.push('ready')
      t.equal(stream.destroyed, false)
      t.pass('ready emitted')
    })
    stream.on('close', () => {
      events.push('close')
      t.same(events, ['ready', 'close'])
    })
    stream.destroy()
  })
}
