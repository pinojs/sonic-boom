'use strict'

const fs = require('fs')
const path = require('path')
const SonicBoom = require('../')
const { file, runTests, once } = require('./helper')

const isWindows = process.platform === 'win32'

runTests(buildTests)

function buildTests (test, sync) {
  // Reset the umask for testing
  process.umask(0o000)

  test('mode', { skip: isWindows }, async (t) => {
    t.plan(5)

    const dest = file()
    const mode = 0o666
    const stream = new SonicBoom({ dest, sync, mode })

    const endPromise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    stream.end()

    const endPromise2 = once(stream, 'finish', () => {
      const data = fs.readFileSync(dest, 'utf8')
      t.assert.strictEqual(data, 'hello world\nsomething else\n')
      t.assert.strictEqual(fs.statSync(dest).mode & 0o777, stream.mode)
    })

    await Promise.all([endPromise1, endPromise2])
  })

  test('mode default', { skip: isWindows }, async (t) => {
    t.plan(5)

    const dest = file()
    const defaultMode = 0o666
    const stream = new SonicBoom({ dest, sync })

    const endPromise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    stream.end()

    const endPromise2 = once(stream, 'finish', () => {
      const data = fs.readFileSync(dest, 'utf8')
      t.assert.strictEqual(data, 'hello world\nsomething else\n')
      t.assert.strictEqual(fs.statSync(dest).mode & 0o777, defaultMode)
    })

    await Promise.all([endPromise1, endPromise2])
  })

  test('mode on mkdir', { skip: isWindows }, async (t) => {
    t.plan(4)

    const dest = path.join(file(), 'out.log')
    const mode = 0o666
    const stream = new SonicBoom({ dest, mkdir: true, mode, sync })

    const endPromise1 = once(stream, 'ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))

    stream.flush()

    const endPromise2 = once(stream, 'drain', () => {
      const data = fs.readFileSync(dest, 'utf8')
      t.assert.strictEqual(data, 'hello world\n')
      t.assert.strictEqual(fs.statSync(dest).mode & 0o777, stream.mode)
      stream.end()
    })

    await Promise.all([endPromise1, endPromise2])
  })

  test('mode on append', { skip: isWindows }, async (t) => {
    t.plan(4)

    const dest = file()
    fs.writeFileSync(dest, 'hello world\n', 'utf8', 0o422)
    const mode = isWindows ? 0o444 : 0o666
    const stream = new SonicBoom({ dest, append: false, mode, sync })

    const endPromise1 = stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('something else\n'))

    stream.flush()

    const endPromise2 = once(stream, 'drain', () => {
      const data = fs.readFileSync(dest, 'utf8')
      t.assert.strictEqual(data, 'something else\n')
      t.assert.strictEqual(fs.statSync(dest).mode & 0o777, stream.mode)
      stream.end()
    })

    await Promise.all([endPromise1, endPromise2])
  })
}
