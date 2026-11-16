'use strict'

const test = require('node:test')
const fs = require('node:fs')
const proxyquire = require('proxyquire')
const SonicBoom = require('../')
const { once } = require('node:events')
const { file } = require('./helper')

for (const sync of [true, false]) {
  for (const contentMode of ['utf8', 'buffer']) {
    test(`reopen after an open failure (sync: ${sync}, ${contentMode})`, { timeout: 5000 }, async (t) => {
      const dest = file()
      const after = file()
      const stream = new SonicBoom({ dest, sync, contentMode })
      const errors = []
      stream.on('error', err => errors.push(err.code))
      t.after(() => {
        if (!stream.destroyed) stream.destroy()
      })
      const data = value => contentMode === 'buffer' ? Buffer.from(value) : value

      await once(stream, 'ready')
      const oldFd = stream.fd
      const failed = once(stream, 'error')
      const missing = file() + '/missing.log'
      if (sync) {
        t.assert.throws(() => stream.reopen(missing), { code: 'ENOENT' })
      } else {
        stream.reopen(missing)
      }
      const [err] = await failed
      t.assert.equal(err.code, 'ENOENT')
      t.assert.equal(stream.fd, oldFd)
      t.assert.ok(fs.fstatSync(oldFd).isFile())

      // The old file remains writable until a replacement opens successfully.
      const drained = once(stream, 'drain')
      stream.write(data('after failed reopen\n'))
      await drained
      t.assert.equal(fs.readFileSync(dest, 'utf8'), 'after failed reopen\n')

      const ready = once(stream, 'ready')
      stream.reopen(after)
      await ready
      t.assert.notEqual(stream.fd, oldFd)
      const closed = once(stream, 'close')
      stream.write(data('after successful reopen\n'))
      stream.end()
      await closed

      t.assert.equal(fs.readFileSync(dest, 'utf8'), 'after failed reopen\n')
      t.assert.equal(fs.readFileSync(after, 'utf8'), 'after successful reopen\n')
      t.assert.deepEqual(errors, ['ENOENT'])
      t.assert.throws(() => fs.fstatSync(oldFd), { code: 'EBADF' })
    })
  }
}

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

// A write started by a 'ready' listener after reopen() must complete before
// 'drain' is emitted. Deferring the reopened file's write by one setImmediate
// makes the write land after the nextTick on which reopen() used to emit a
// premature 'drain'. Async mode only: sync mode writes before 'ready'.
test('reopen does not emit drain while a write is in flight', (t, end) => {
  t.plan(5)

  const dest = file()
  const after = dest + '-new'

  const fakeFs = Object.create(fs)
  fakeFs.write = function (fd, ...args) {
    if (stream.file === after) {
      setImmediate(() => fs.write(fd, ...args))
      return
    }
    return fs.write(fd, ...args)
  }
  const SonicBoom = proxyquire('../', {
    'node:fs': fakeFs
  })

  const stream = new SonicBoom({ dest, minLength: 0, sync: false })

  t.assert.ok(stream.write('hello world\n'))

  stream.once('drain', () => {
    stream.reopen(after)

    stream.once('ready', () => {
      t.assert.ok(stream.write('after reopen\n'))

      stream.once('drain', () => {
        t.assert.equal(stream._writing, false)
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
