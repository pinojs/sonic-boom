'use strict'

const test = require('node:test')
const fs = require('node:fs')
const proxyquire = require('proxyquire')
const SonicBoom = require('../')
const { file, runTests } = require('./helper')

runTests(buildTests)

function buildTests (test, sync) {
  // Reset the umask for testing
  process.umask(0o000)

  test('write things to a file descriptor', (t, end) => {
    t.plan(6)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, sync })

    stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    stream.end()

    stream.on('finish', () => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.assert.ifError(err)
        t.assert.equal(data, 'hello world\nsomething else\n')
        end()
      })
    })
    stream.on('close', () => {
      t.assert.ok('close emitted')
    })
  })

  test('write things in a streaming fashion', (t, end) => {
    t.plan(8)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, sync })

    stream.once('drain', () => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.assert.ifError(err)
        t.assert.equal(data, 'hello world\n')
        t.assert.ok(stream.write('something else\n'))
      })

      stream.once('drain', () => {
        fs.readFile(dest, 'utf8', (err, data) => {
          t.assert.ifError(err)
          t.assert.equal(data, 'hello world\nsomething else\n')
          stream.end()
        })
      })
    })

    t.assert.ok(stream.write('hello world\n'))

    stream.on('finish', () => {
      t.assert.ok('finish emitted')
    })
    stream.on('close', () => {
      t.assert.ok('close emitted')
      end()
    })
  })

  test('can be piped into', (t, end) => {
    t.plan(4)

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, sync })
    const source = fs.createReadStream(__filename, { encoding: 'utf8' })

    source.pipe(stream)

    stream.on('finish', () => {
      fs.readFile(__filename, 'utf8', (err, expected) => {
        t.assert.ifError(err)
        fs.readFile(dest, 'utf8', (err, data) => {
          t.assert.ifError(err)
          t.assert.equal(data, expected)
          end()
        })
      })
    })
    stream.on('close', () => {
      t.assert.ok('close emitted')
    })
  })

  test('write things to a file', (t, end) => {
    t.plan(6)

    const dest = file()
    const stream = new SonicBoom({ dest, sync })

    stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    stream.end()

    stream.on('finish', () => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.assert.ifError(err)
        t.assert.equal(data, 'hello world\nsomething else\n')
        end()
      })
    })
    stream.on('close', () => {
      t.assert.ok('close emitted')
    })
  })

  test('minLength', (t, end) => {
    t.plan(8)

    const dest = file()
    const stream = new SonicBoom({ dest, minLength: 4096, sync })

    stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    const fail = t.assert.fail
    stream.on('drain', fail)

    // bad use of timer
    // TODO refactor
    setTimeout(function () {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.assert.ifError(err)
        t.assert.equal(data, '')

        stream.end()

        stream.on('finish', () => {
          fs.readFile(dest, 'utf8', (err, data) => {
            t.assert.ifError(err)
            t.assert.equal(data, 'hello world\nsomething else\n')
            end()
          })
        })
      })
    }, 100)

    stream.on('close', () => {
      t.assert.ok('close emitted')
    })
  })

  test('write later on recoverable error', (t, end) => {
    t.plan(8)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 0, sync })

    stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })
    stream.on('error', () => {
      t.assert.ok('error emitted')
    })

    if (sync) {
      fakeFs.writeSync = function (fd, buf, enc) {
        t.assert.ok('fake fs.writeSync called')
        throw new Error('recoverable error')
      }
    } else {
      fakeFs.write = function (fd, buf, ...args) {
        t.assert.ok('fake fs.write called')
        setTimeout(() => args.pop()(new Error('recoverable error')), 0)
      }
    }

    t.assert.ok(stream.write('hello world\n'))

    setTimeout(() => {
      if (sync) {
        fakeFs.writeSync = fs.writeSync
      } else {
        fakeFs.write = fs.write
      }

      t.assert.ok(stream.write('something else\n'))

      stream.end()
      stream.on('finish', () => {
        fs.readFile(dest, 'utf8', (err, data) => {
          t.assert.ifError(err)
          t.assert.equal(data, 'hello world\nsomething else\n')
          end()
        })
      })
      stream.on('close', () => {
        t.assert.ok('close emitted')
      })
    }, 0)
  })

  test('emit write events', (t, end) => {
    t.plan(7)

    const dest = file()
    const stream = new SonicBoom({ dest, sync })

    stream.on('ready', () => {
      t.assert.ok('ready emitted')
    })

    let length = 0
    stream.on('write', (bytes) => {
      length += bytes
    })

    t.assert.ok(stream.write('hello world\n'))
    t.assert.ok(stream.write('something else\n'))

    stream.end()

    stream.on('finish', () => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.assert.ifError(err)
        t.assert.equal(data, 'hello world\nsomething else\n')
        t.assert.equal(length, 27)
        end()
      })
    })
    stream.on('close', () => {
      t.assert.ok('close emitted')
    })
  })

  test('write multi-byte characters string over than maxWrite', (t, end) => {
    const fakeFs = Object.create(fs)
    const MAX_WRITE = 65535
    fakeFs.write = function (fd, buf, ...args) {
      // only write byteLength === MAX_WRITE
      const _buf = Buffer.from(buf).subarray(0, MAX_WRITE)
      fs.writeSync(fd, _buf)
      setImmediate(args[args.length - 1], null, MAX_WRITE)
      fakeFs.write = function (fd, buf, ...args) {
        fs.write(fd, buf, ...args)
      }
    }
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })
    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 0, sync, maxWrite: MAX_WRITE })
    let buf = Buffer.alloc(MAX_WRITE).fill('x')
    buf = '🌲' + buf.toString()
    stream.write(buf)
    stream.end()

    stream.on('finish', () => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.assert.ifError(err)
        t.assert.equal(data, buf)
        end()
      })
    })
    stream.on('close', () => {
      t.assert.ok('close emitted')
    })
    stream.on('error', () => {
      t.assert.ok('error emitted')
    })
  })

  test('partial writes must preserve split utf8 characters', (t, end) => {
    t.plan(4)

    const fakeFs = Object.create(fs)
    const SonicBoom = proxyquire('../', {
      fs: fakeFs
    })

    const dest = file()
    const fd = fs.openSync(dest, 'w')
    const stream = new SonicBoom({ fd, minLength: 0, sync })

    const input = 'hello🌍world'
    let calls = 0

    if (sync) {
      fakeFs.writeSync = function (fd, buf, enc) {
        calls++
        if (calls === 1) {
          const first = Buffer.from(buf).subarray(0, 7)
          fs.writeSync(fd, first)
          return 7
        }
        return fs.writeSync(fd, buf)
      }
    } else {
      fakeFs.write = function (fd, buf, ...args) {
        calls++
        const cb = args[args.length - 1]
        if (calls === 1) {
          const first = Buffer.from(buf).subarray(0, 7)
          fs.write(fd, first, (err, n) => cb(err, n))
          return
        }
        fs.write(fd, buf, cb)
      }
    }

    stream.write(input)
    stream.end()

    stream.on('close', () => {
      const data = fs.readFileSync(dest, 'utf8')
      t.assert.equal(calls, 2)
      t.assert.equal(data, input)
      t.assert.equal(data.includes('�'), false)
      t.assert.equal(data.includes('🌍'), true)
      end()
    })
  })
}

test('write buffers that are not totally written', (t, end) => {
  t.plan(9)

  const fakeFs = Object.create(fs)
  fakeFs.write = function (fd, buf, ...args) {
    t.assert.ok('fake fs.write called')
    fakeFs.write = function (fd, buf, ...args) {
      t.assert.ok('calling real fs.write, ' + buf)
      fs.write(fd, buf, ...args)
    }
    process.nextTick(args[args.length - 1], null, 0)
  }
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: false })

  stream.on('ready', () => {
    t.assert.ok('ready emitted')
  })

  t.assert.ok(stream.write('hello world\n'))
  t.assert.ok(stream.write('something else\n'))

  stream.end()

  stream.on('finish', () => {
    fs.readFile(dest, 'utf8', (err, data) => {
      t.assert.ifError(err)
      t.assert.equal(data, 'hello world\nsomething else\n')
      end()
    })
  })
  stream.on('close', () => {
    t.assert.ok('close emitted')
  })
})

test('write enormously large buffers async', (t, end) => {
  t.plan(3)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: false })

  const buf = Buffer.alloc(1024).fill('x').toString() // 1 MB
  let length = 0

  for (let i = 0; i < 1024 * 512; i++) {
    length += buf.length
    stream.write(buf)
  }

  stream.end()

  stream.on('finish', () => {
    fs.stat(dest, (err, stat) => {
      t.assert.ifError(err)
      t.assert.equal(stat.size, length)
      end()
    })
  })
  stream.on('close', () => {
    t.assert.ok('close emitted')
  })
})

test('make sure `maxWrite` is passed', (t) => {
  t.plan(1)
  const dest = file()
  const stream = new SonicBoom({ dest, maxLength: 65536 })
  t.assert.equal(stream.maxLength, 65536)
})

test('write enormously large buffers async atomicly', (t, end) => {
  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: false })

  const buf = Buffer.alloc(1023).fill('x').toString()

  fakeFs.write = function (fd, _buf, ...args) {
    if (_buf.length % buf.length !== 0) {
      t.assert.fail('write called with wrong buffer size')
    }

    setImmediate(args[args.length - 1], null, _buf.length)
  }

  for (let i = 0; i < 1024 * 512; i++) {
    stream.write(buf)
  }

  setImmediate(() => {
    for (let i = 0; i < 1024 * 512; i++) {
      stream.write(buf)
    }

    stream.end()
  })

  stream.on('close', () => {
    t.assert.ok('close emitted')
    end()
  })
})

test('write should not drop new data if buffer is not full', (t, end) => {
  t.plan(2)
  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 101, maxLength: 102, sync: false })

  const buf = Buffer.alloc(100).fill('x').toString()

  fakeFs.write = function (fd, _buf, ...args) {
    t.assert.equal(_buf.length, buf.length + 2)
    setImmediate(args[args.length - 1], null, _buf.length)
    fakeFs.write = () => t.assert.ifError('shouldnt call write again')
    stream.end()
  }

  stream.on('drop', (data) => {
    t.assert.ifError('should not drop')
  })

  stream.write(buf)
  stream.write('aa')

  stream.on('close', () => {
    t.assert.ok('close emitted')
    end()
  })
})

test('write should drop new data if buffer is full', (t, end) => {
  t.plan(3)
  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 101, maxLength: 102, sync: false })

  const buf = Buffer.alloc(100).fill('x').toString()

  fakeFs.write = function (fd, _buf, ...args) {
    t.assert.equal(_buf.length, buf.length)
    setImmediate(args[args.length - 1], null, _buf.length)
    fakeFs.write = () => t.assert.ifError('shouldnt call write more than once')
  }

  stream.on('drop', (data) => {
    t.assert.equal(data.length, 3)
    stream.end()
  })

  stream.write(buf)
  stream.write('aaa')

  stream.on('close', () => {
    t.assert.ok('close emitted')
    end()
  })
})
