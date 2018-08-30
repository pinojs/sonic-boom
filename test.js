'use strict'

const tap = require('tap')
const test = tap.test
const tearDown = tap.tearDown
const fs = require('fs')
const os = require('os')
const path = require('path')
const proxyquire = require('proxyquire')
const SonicBoom = require('.')

const files = []
var count = 0

function file () {
  const file = path.join(os.tmpdir(), `sonic-boom-${process.pid}-${process.hrtime().toString()}-${count++}`)
  files.push(file)
  return file
}

tearDown(() => {
  files.forEach((file) => {
    try {
      fs.unlinkSync(file)
    } catch (e) {
      console.log(e)
    }
  })
})

test('write things to a file descriptor', (t) => {
  t.plan(6)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom(fd)

  stream.on('ready', () => {
    t.pass('ready emitted')
  })

  t.ok(stream.write('hello world\n'))
  t.ok(stream.write('something else\n'))

  stream.end()

  stream.on('finish', () => {
    fs.readFile(dest, 'utf8', (err, data) => {
      t.error(err)
      t.equal(data, 'hello world\nsomething else\n')
    })
  })
  stream.on('close', () => {
    t.pass('close emitted')
  })
})

test('write things in a streaming fashion', (t) => {
  t.plan(8)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom(fd)

  t.ok(stream.write('hello world\n'))

  stream.once('drain', () => {
    fs.readFile(dest, 'utf8', (err, data) => {
      t.error(err)
      t.equal(data, 'hello world\n')
      t.ok(stream.write('something else\n'))
    })

    stream.once('drain', () => {
      fs.readFile(dest, 'utf8', (err, data) => {
        t.error(err)
        t.equal(data, 'hello world\nsomething else\n')
        stream.end()
      })
    })
  })

  stream.on('finish', () => {
    t.pass('finish emitted')
  })
  stream.on('close', () => {
    t.pass('close emitted')
  })
})

test('can be piped into', (t) => {
  t.plan(4)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom(fd)
  const source = fs.createReadStream(__filename)

  source.pipe(stream)

  stream.on('finish', () => {
    fs.readFile(__filename, 'utf8', (err, expected) => {
      t.error(err)
      fs.readFile(dest, 'utf8', (err, data) => {
        t.error(err)
        t.equal(data, expected)
      })
    })
  })
  stream.on('close', () => {
    t.pass('close emitted')
  })
})

test('write things to a file', (t) => {
  t.plan(6)

  const dest = file()
  const stream = new SonicBoom(dest)

  stream.on('ready', () => {
    t.pass('ready emitted')
  })

  t.ok(stream.write('hello world\n'))
  t.ok(stream.write('something else\n'))

  stream.end()

  stream.on('finish', () => {
    fs.readFile(dest, 'utf8', (err, data) => {
      t.error(err)
      t.equal(data, 'hello world\nsomething else\n')
    })
  })
  stream.on('close', () => {
    t.pass('close emitted')
  })
})

test('flushSync', (t) => {
  t.plan(4)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom(fd, 4096)

  t.ok(stream.write('hello world\n'))
  t.ok(stream.write('something else\n'))

  stream.flushSync()

  // let the file system settle down things
  setImmediate(function () {
    stream.end()
    const data = fs.readFileSync(dest, 'utf8')
    t.equal(data, 'hello world\nsomething else\n')

    stream.on('close', () => {
      t.pass('close emitted')
    })
  })
})

test('destroy', (t) => {
  t.plan(5)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom(fd)

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
  t.plan(1)

  const dest = file()
  const stream = new SonicBoom(dest)

  stream.destroy()
  stream.on('close', () => {
    t.pass('close emitted')
  })
})

test('minLength', (t) => {
  t.plan(8)

  const dest = file()
  const stream = new SonicBoom(dest, 4096)

  stream.on('ready', () => {
    t.pass('ready emitted')
  })

  t.ok(stream.write('hello world\n'))
  t.ok(stream.write('something else\n'))

  var fail = t.fail
  stream.on('drain', fail)

  // bad use of timer
  // TODO refactor
  setTimeout(function () {
    fs.readFile(dest, 'utf8', (err, data) => {
      t.error(err)
      t.equal(data, '')

      stream.end()

      stream.on('finish', () => {
        fs.readFile(dest, 'utf8', (err, data) => {
          t.error(err)
          t.equal(data, 'hello world\nsomething else\n')
        })
      })
    })
  }, 100)

  stream.on('close', () => {
    t.pass('close emitted')
  })
})

test('flush', (t) => {
  t.plan(5)

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom(fd, 4096)

  stream.on('ready', () => {
    t.pass('ready emitted')
  })

  t.ok(stream.write('hello world\n'))
  t.ok(stream.write('something else\n'))

  stream.flush()

  stream.on('drain', () => {
    fs.readFile(dest, 'utf8', (err, data) => {
      t.error(err)
      t.equal(data, 'hello world\nsomething else\n')
      stream.end()
    })
  })
})

test('reopen', (t) => {
  t.plan(9)

  const dest = file()
  const stream = new SonicBoom(dest)

  t.ok(stream.write('hello world\n'))
  t.ok(stream.write('something else\n'))

  const after = dest + '-moved'

  stream.once('drain', () => {
    t.pass('drain emitted')

    fs.renameSync(dest, after)
    stream.reopen()

    stream.once('ready', () => {
      t.pass('ready emitted')
      t.ok(stream.write('after reopen\n'))

      stream.on('drain', () => {
        fs.readFile(after, 'utf8', (err, data) => {
          t.error(err)
          t.equal(data, 'hello world\nsomething else\n')
          fs.readFile(dest, 'utf8', (err, data) => {
            t.error(err)
            t.equal(data, 'after reopen\n')
            stream.end()
          })
        })
      })
    })
  })
})

test('reopen with buffer', (t) => {
  t.plan(9)

  const dest = file()
  const stream = new SonicBoom(dest, 4096)

  t.ok(stream.write('hello world\n'))
  t.ok(stream.write('something else\n'))

  const after = dest + '-moved'

  stream.once('ready', () => {
    t.pass('drain emitted')

    stream.flush()
    fs.renameSync(dest, after)
    stream.reopen()

    stream.once('ready', () => {
      t.pass('ready emitted')
      t.ok(stream.write('after reopen\n'))
      stream.flush()

      stream.on('drain', () => {
        fs.readFile(after, 'utf8', (err, data) => {
          t.error(err)
          t.equal(data, 'hello world\nsomething else\n')
          fs.readFile(dest, 'utf8', (err, data) => {
            t.error(err)
            t.equal(data, 'after reopen\n')
            stream.end()
          })
        })
      })
    })
  })
})

test('reopen with file', (t) => {
  t.plan(9)

  const dest = file()
  const stream = new SonicBoom(dest)

  t.ok(stream.write('hello world\n'))
  t.ok(stream.write('something else\n'))

  const after = dest + '-new'

  stream.once('drain', () => {
    t.pass('drain emitted')

    stream.reopen(after)

    stream.once('ready', () => {
      t.pass('ready emitted')
      t.ok(stream.write('after reopen\n'))

      stream.on('drain', () => {
        fs.readFile(dest, 'utf8', (err, data) => {
          t.error(err)
          t.equal(data, 'hello world\nsomething else\n')
          fs.readFile(after, 'utf8', (err, data) => {
            t.error(err)
            t.equal(data, 'after reopen\n')
            stream.end()
          })
        })
      })
    })
  })
})

test('retry on EAGAIN', (t) => {
  t.plan(7)

  const fakeFs = Object.create(fs)
  fakeFs.write = function (fd, buf, enc, cb) {
    t.pass('fake fs.write called')
    fakeFs.write = fs.write
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    process.nextTick(cb, err)
  }
  const SonicBoom = proxyquire('.', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom(fd)

  stream.on('ready', () => {
    t.pass('ready emitted')
  })

  t.ok(stream.write('hello world\n'))
  t.ok(stream.write('something else\n'))

  stream.end()

  stream.on('finish', () => {
    fs.readFile(dest, 'utf8', (err, data) => {
      t.error(err)
      t.equal(data, 'hello world\nsomething else\n')
    })
  })
  stream.on('close', () => {
    t.pass('close emitted')
  })
})
