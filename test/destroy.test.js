'use strict'

const fs = require('fs')
const SonicBoom = require('../')
const { file, runTests, once } = require('./helper')

runTests(buildTests)

function buildTests (test, sync) {
  // Reset the umask for testing
  process.umask(0o000)

  test('destroy', async (t) => {
    t.plan(4)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, sync })

    t.assert.ok(stream.write('hello world\n'))
    stream.destroy()
    t.assert.throws(() => { stream.write('hello world\n') })

    const data = fs.readFileSync(dest, 'utf8')
    t.assert.strictEqual(data, 'hello world\n')

    stream.on('finish', () => {
      t.assert.fail('finish emitted')
    })

    await once(stream, 'close', () => {
      t.assert.ok('close emitted')
    })
  })

  test('destroy while opening', async (t) => {
    t.plan(1)

    const dest = file()
    const stream = new SonicBoom({ dest })

    stream.destroy()
    await once(stream, 'close', () => {
      t.assert.ok('close emitted')
    })
  })
}
