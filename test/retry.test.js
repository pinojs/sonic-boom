'use strict'

const test = require('node:test')
const fs = require('node:fs')
const proxyquire = require('proxyquire')
const { file } = require('./helper')

const MAX_WRITE = 16 * 1024

// Reset the umask for testing
process.umask(0o000)

test('retry on EAGAIN', (t, end) => {
  t.plan(7)

  const fakeFs = Object.create(fs)
  fakeFs.write = function (fd, buf, ...args) {
    t.assert.ok('fake fs.write called')
    fakeFs.write = fs.write
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    process.nextTick(args.pop(), err)
  }
  fakeFs.writeSync = fakeFs.write
  const SonicBoom = proxyquire('../', {
    'node:fs': fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, sync: false, minLength: 0 })

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

test('emit error on async EAGAIN', (t, end) => {
  t.plan(11)

  const fakeFs = Object.create(fs)
  fakeFs.write = function (fd, buf, ...args) {
    t.assert.ok('fake fs.write called')
    fakeFs.write = fs.write
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    process.nextTick(args[args.length - 1], err)
  }
  const SonicBoom = proxyquire('../', {
    'node:fs': fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({
    fd,
    sync: false,
    minLength: 12,
    retryEAGAIN: (err, writeBufferLen, remainingBufferLen) => {
      t.assert.equal(err.code, 'EAGAIN')
      t.assert.equal(writeBufferLen, 12)
      t.assert.equal(remainingBufferLen, 0)
      return false
    }
  })

  stream.on('ready', () => {
    t.assert.ok('ready emitted')
  })

  stream.once('error', err => {
    t.assert.equal(err.code, 'EAGAIN')
    t.assert.ok(stream.write('something else\n'))
  })

  t.assert.ok(stream.write('hello world\n'))

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

test('retry on EAGAIN (sync)', (t, end) => {
  t.plan(7)

  const fakeFs = Object.create(fs)
  fakeFs.writeSync = function (fd, buf, enc) {
    t.assert.ok('fake fs.writeSync called')
    fakeFs.writeSync = fs.writeSync
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    throw err
  }
  const SonicBoom = proxyquire('../', {
    'node:fs': fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, minLength: 0, sync: true })

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

test('emit error on EAGAIN (sync)', (t, end) => {
  t.plan(11)

  const fakeFs = Object.create(fs)
  fakeFs.writeSync = function (fd, buf, enc) {
    t.assert.ok('fake fs.writeSync called')
    fakeFs.writeSync = fs.writeSync
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    throw err
  }
  const SonicBoom = proxyquire('../', {
    'node:fs': fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({
    fd,
    minLength: 0,
    sync: true,
    retryEAGAIN: (err, writeBufferLen, remainingBufferLen) => {
      t.assert.equal(err.code, 'EAGAIN')
      t.assert.equal(writeBufferLen, 12)
      t.assert.equal(remainingBufferLen, 0)
      return false
    }
  })

  stream.on('ready', () => {
    t.assert.ok('ready emitted')
  })

  stream.once('error', err => {
    t.assert.equal(err.code, 'EAGAIN')
    t.assert.ok(stream.write('something else\n'))
  })

  t.assert.ok(stream.write('hello world\n'))

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

test('retryEAGAIN receives remaining buffer on async if write fails', (t, end) => {
  t.plan(12)

  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    'node:fs': fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({
    fd,
    sync: false,
    minLength: 12,
    retryEAGAIN: (err, writeBufferLen, remainingBufferLen) => {
      t.assert.equal(err.code, 'EAGAIN')
      t.assert.equal(writeBufferLen, 12)
      t.assert.equal(remainingBufferLen, 11)
      return false
    }
  })

  stream.on('ready', () => {
    t.assert.ok('ready emitted')
  })

  stream.once('error', err => {
    t.assert.equal(err.code, 'EAGAIN')
    t.assert.ok(stream.write('done'))
  })

  fakeFs.write = function (fd, buf, ...args) {
    t.assert.ok('fake fs.write called')
    fakeFs.write = fs.write
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    t.assert.ok(stream.write('sonic boom\n'))
    process.nextTick(args[args.length - 1], err)
  }

  t.assert.ok(stream.write('hello world\n'))

  stream.end()

  stream.on('finish', () => {
    fs.readFile(dest, 'utf8', (err, data) => {
      t.assert.ifError(err)
      t.assert.equal(data, 'hello world\nsonic boom\ndone')
      end()
    })
  })
  stream.on('close', () => {
    t.assert.ok('close emitted')
  })
})

test('retryEAGAIN receives remaining buffer if exceeds maxWrite', (t, end) => {
  t.plan(17)

  const fakeFs = Object.create(fs)
  const SonicBoom = proxyquire('../', {
    'node:fs': fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const buf = Buffer.alloc(MAX_WRITE - 2).fill('x').toString() // 1 MB
  const stream = new SonicBoom({
    fd,
    sync: false,
    minLength: MAX_WRITE - 1,
    retryEAGAIN: (err, writeBufferLen, remainingBufferLen) => {
      t.assert.equal(err.code, 'EAGAIN', 'retryEAGAIN received EAGAIN error')
      t.assert.equal(writeBufferLen, buf.length, 'writeBufferLen === buf.length')
      t.assert.equal(remainingBufferLen, 23, 'remainingBufferLen === 23')
      return false
    }
  })

  stream.on('ready', () => {
    t.assert.ok('ready emitted')
  })

  fakeFs.write = function (fd, buf, ...args) {
    t.assert.ok('fake fs.write called')
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    process.nextTick(args.pop(), err)
  }

  fakeFs.writeSync = function (fd, buf, enc) {
    t.assert.ok('fake fs.write called')
    const err = new Error('EAGAIN')
    err.code = 'EAGAIN'
    throw err
  }

  t.assert.ok(stream.write(buf), 'write buf')
  t.assert.equal(stream.write('hello world\nsonic boom\n'), false, 'write hello world sonic boom')

  stream.once('error', err => {
    t.assert.equal(err.code, 'EAGAIN', 'bubbled error should be EAGAIN')

    try {
      stream.flushSync()
    } catch (err) {
      t.assert.equal(err.code, 'EAGAIN', 'thrown error should be EAGAIN')
      fakeFs.write = fs.write
      fakeFs.writeSync = fs.writeSync
      stream.end()
    }
  })

  stream.on('finish', () => {
    t.assert.ok('finish emitted')
    fs.readFile(dest, 'utf8', (err, data) => {
      t.assert.ifError(err)
      t.assert.equal(data, `${buf}hello world\nsonic boom\n`, 'data on file should match written')
      end()
    })
  })
  stream.on('close', () => {
    t.assert.ok('close emitted')
  })
})

test('retry on EBUSY', (t, end) => {
  t.plan(7)

  const fakeFs = Object.create(fs)
  fakeFs.write = function (fd, buf, ...args) {
    t.assert.ok('fake fs.write called')
    fakeFs.write = fs.write
    const err = new Error('EBUSY')
    err.code = 'EBUSY'
    process.nextTick(args.pop(), err)
  }
  const SonicBoom = proxyquire('..', {
    'node:fs': fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, sync: false, minLength: 0 })

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

test('emit error on async EBUSY', (t, end) => {
  t.plan(11)

  const fakeFs = Object.create(fs)
  fakeFs.write = function (fd, buf, ...args) {
    t.assert.ok('fake fs.write called')
    fakeFs.write = fs.write
    const err = new Error('EBUSY')
    err.code = 'EBUSY'
    process.nextTick(args.pop(), err)
  }
  const SonicBoom = proxyquire('..', {
    'node:fs': fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({
    fd,
    sync: false,
    minLength: 12,
    retryEAGAIN: (err, writeBufferLen, remainingBufferLen) => {
      t.assert.equal(err.code, 'EBUSY')
      t.assert.equal(writeBufferLen, 12)
      t.assert.equal(remainingBufferLen, 0)
      return false
    }
  })

  stream.on('ready', () => {
    t.assert.ok('ready emitted')
  })

  stream.once('error', err => {
    t.assert.equal(err.code, 'EBUSY')
    t.assert.ok(stream.write('something else\n'))
  })

  t.assert.ok(stream.write('hello world\n'))

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
