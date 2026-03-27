'use strict'

const test = require('node:test')
const fs = require('node:fs')
const proxyquire = require('proxyquire')
const SonicBoom = require('../')
const { file } = require('./helper')

for (const sync in [true, false]) {
  // Reset the umask for testing
  process.umask(0o000)

  test('reopen', (t, end) => {
    t.plan(9)

    const dest = file()
    const stream = new SonicBoom({ dest, sync })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    const after = dest + '-moved'

    stream.once('drain', () => {
      t.assert.ok('drain emitted')

      fs.renameSync(dest, after)
      stream.reopen()

      stream.once('ready', () => {
        t.assert.ok('ready emitted')
        t.assert.ok(stream.write('after reopen\n'))

        stream.once('drain', () => {
          fs.readFile(after, 'utf8', (err, data) => {
            t.assert.ifError(err)
            t.assert.equal(data, 'hello world\nsomething else\n')
            fs.readFile(dest, 'utf8', (err, data) => {
              t.assert.ifError(err)
              t.assert.equal(data, 'after reopen\n')
              stream.end()
              end()
            })
          })
        })
      })
    })
  })

  test('reopen with buffer', (t, end) => {
    t.plan(9)

    const dest = file()
    const stream = new SonicBoom({ dest, minLength: 4096, sync })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    const after = dest + '-moved'

    stream.once('ready', () => {
      t.assert.ok('drain emitted')

      stream.flush()
      fs.renameSync(dest, after)
      stream.reopen()

      stream.once('ready', () => {
        t.assert.ok('ready emitted')
        t.assert.ok(stream.write('after reopen\n'))
        stream.flush()

        stream.once('drain', () => {
          fs.readFile(after, 'utf8', (err, data) => {
            t.assert.ifError(err)
            t.assert.equal(data, 'hello world\nsomething else\n')
            fs.readFile(dest, 'utf8', (err, data) => {
              t.assert.ifError(err)
              t.assert.equal(data, 'after reopen\n')
              stream.end()
              end()
            })
          })
        })
      })
    })
  })

  test('reopen if not open', (t, end) => {
    t.plan(3)

    const dest = file()
    const stream = new SonicBoom({ dest, sync })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    stream.reopen()

    stream.end()
    stream.on('close', function () {
      t.assert.ok('ended')
      end()
    })
  })

  test('reopen with file', (t, end) => {
    t.plan(10)

    const dest = file()
    const stream = new SonicBoom({ dest, minLength: 0, sync })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    const after = dest + '-new'

    stream.once('drain', () => {
      t.assert.ok('drain emitted')

      stream.reopen(after)
      t.assert.equal(stream.file, after)

      stream.once('ready', () => {
        t.assert.ok('ready emitted')
        t.assert.ok(stream.write('after reopen\n'))

        stream.once('drain', () => {
          fs.readFile(dest, 'utf8', (err, data) => {
            t.assert.ifError(err)
            t.assert.equal(data, 'hello world\nsomething else\n')
            fs.readFile(after, 'utf8', (err, data) => {
              t.assert.ifError(err)
              t.assert.equal(data, 'after reopen\n')
              stream.end()
              end()
            })
          })
        })
      })
    })
  })

  test('reopen throws an error', (t, end) => {
    t.plan(sync ? 10 : 9)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      'node:fs': fakeFs
    })

    const dest = file()
    const stream = new SonicBoom({ dest, sync })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    const after = dest + '-moved'

    stream.on('error', () => {
      t.assert.ok('error emitted')
    })

    stream.once('drain', () => {
      t.assert.ok('drain emitted')

      fs.renameSync(dest, after)
      if (sync) {
        fakeFs.openSync = function (file, flags) {
          t.assert.ok('fake fs.openSync called')
          throw new Error('open error')
        }
      } else {
        fakeFs.open = function (file, flags, mode, cb) {
          t.assert.ok('fake fs.open called')
          setTimeout(() => cb(new Error('open error')), 0)
        }
      }

      if (sync) {
        try {
          stream.reopen()
        } catch (err) {
          t.assert.ok('reopen throwed')
        }
      } else {
        stream.reopen()
      }

      setTimeout(() => {
        t.assert.ok(stream.write('after reopen\n'))

        stream.end()
        stream.on('finish', () => {
          fs.readFile(after, 'utf8', (err, data) => {
            t.assert.ifError(err)
            t.assert.equal(data, 'hello world\nsomething else\nafter reopen\n')
            end()
          })
        })
        stream.on('close', () => {
          t.assert.ok('close emitted')
        })
      }, 0)
    })
  })

  test('reopen emits drain', (t, end) => {
    t.plan(9)

    const dest = file()
    const stream = new SonicBoom({ dest, sync })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    const after = dest + '-moved'

    stream.once('drain', () => {
      t.assert.ok('drain emitted')

      fs.renameSync(dest, after)
      stream.reopen()

      stream.once('drain', () => {
        t.assert.ok('drain emitted')
        t.assert.ok(stream.write('after reopen\n'))

        stream.once('drain', () => {
          fs.readFile(after, 'utf8', (err, data) => {
            t.assert.ifError(err)
            t.assert.equal(data, 'hello world\nsomething else\n')
            fs.readFile(dest, 'utf8', (err, data) => {
              t.assert.ifError(err)
              t.assert.equal(data, 'after reopen\n')
              stream.end()
              end()
            })
          })
        })
      })
    })
  })
}
