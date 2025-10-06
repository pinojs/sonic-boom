'use strict'

const FakeTimers = require('@sinonjs/fake-timers')
const fs = require('fs')
const SonicBoom = require('../')
const { file, runTests } = require('./helper')

runTests(buildTests)

function buildTests (test, sync) {
  // Reset the umask for testing
  process.umask(0o000)

  test('periodicflush_off', (t, end) => {
    t.plan(4)

    const clock = FakeTimers.install()
    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, sync, minLength: 5000 })

    t.assert.ok(stream.write('hello world\n'))

    setTimeout(function () {
      fs.readFile(dest, 'utf8', function (err, data) {
        t.assert.ifError(err)
        t.assert.strictEqual(data, '')

        stream.destroy()
        t.assert.ok('file empty')
        end()
      })
    }, 2000)

    clock.tick(2000)
    clock.uninstall()
  })

  test('periodicflush_on', (t, end) => {
    t.plan(4)

    const clock = FakeTimers.install()
    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, sync, minLength: 5000, periodicFlush: 1000 })

    t.assert.ok(stream.write('hello world\n'))

    setTimeout(function () {
      fs.readFile(dest, 'utf8', function (err, data) {
        t.assert.ifError(err)
        t.assert.strictEqual(data, 'hello world\n')

        stream.destroy()
        t.assert.ok('file not empty')
        end()
      })
    }, 2000)

    clock.tick(2000)
    clock.uninstall()
  })
}
