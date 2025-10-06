'use strict'

const { join } = require('path')
const { fork } = require('child_process')
const fs = require('fs')
const SonicBoom = require('../')
const { file, runTests, once } = require('./helper')

runTests(buildTests)

function buildTests (test, sync) {
  // Reset the umask for testing
  process.umask(0o000)

  test('end after reopen', (t, end) => {
    t.plan(4)

    const dest = file()
    const stream = new SonicBoom({ dest, minLength: 4096, sync })

    stream.once('ready', () => {
      t.assert.ok('ready emitted')
      const after = dest + '-moved'
      stream.reopen(after)
      stream.write('after reopen\n')
      stream.on('finish', () => {
        t.assert.ok('finish emitted')
        fs.readFile(after, 'utf8', (err, data) => {
          t.assert.ifError(err)
          t.assert.strictEqual(data, 'after reopen\n')
          end()
        })
      })
      stream.end()
    })
  })

  test('end after 2x reopen', (t, end) => {
    t.plan(4)

    const dest = file()
    const stream = new SonicBoom({ dest, minLength: 4096, sync })

    stream.once('ready', () => {
      t.assert.ok('ready emitted')
      stream.reopen(dest + '-moved')
      const after = dest + '-moved-moved'
      stream.reopen(after)
      stream.write('after reopen\n')
      stream.on('finish', () => {
        t.assert.ok('finish emitted')
        fs.readFile(after, 'utf8', (err, data) => {
          t.assert.ifError(err)
          t.assert.strictEqual(data, 'after reopen\n')
          end()
        })
      })
      stream.end()
    })
  })

  test('end if not ready', (t, end) => {
    t.plan(3)

    const dest = file()
    const stream = new SonicBoom({ dest, minLength: 4096, sync })
    const after = dest + '-moved'
    stream.reopen(after)
    stream.write('after reopen\n')
    stream.on('finish', () => {
      t.assert.ok('finish emitted')
      fs.readFile(after, 'utf8', (err, data) => {
        t.assert.ifError(err)
        t.assert.strictEqual(data, 'after reopen\n')
        end()
      })
    })
    stream.end()
  })

  test('chunk data accordingly', async (t) => {
    t.plan(2)

    const child = fork(join(__dirname, '..', 'fixtures', 'firehose.js'), { silent: true })
    const str = Buffer.alloc(10000).fill('a').toString()

    let data = ''

    child.stdout.on('data', function (chunk) {
      data += chunk.toString()
    })

    const endPromise1 = once(child.stdout, 'end', function () {
      t.assert.strictEqual(data, str)
    })

    const endPromise2 = once(child, 'close', function (code) {
      t.assert.strictEqual(code, 0)
    })

    await Promise.all([endPromise1, endPromise2])
  })
}
