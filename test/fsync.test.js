'use strict'

const { test } = require('node:test')
const fs = require('fs')
const proxyquire = require('proxyquire')
const { file, once } = require('./helper')

test('fsync with sync', (t) => {
  t.plan(5)

  const fakeFs = Object.create(fs)
  fakeFs.fsyncSync = function (fd) {
    t.assert.ok('fake fs.fsyncSync called')
    return fs.fsyncSync(fd)
  }
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, sync: true, fsync: true })

  t.assert.ok(stream.write('hello world\n'))
  t.assert.ok(stream.write('something else\n'))

  stream.end()

  const data = fs.readFileSync(dest, 'utf8')
  t.assert.strictEqual(data, 'hello world\nsomething else\n')
})

test('fsync with async', async (t) => {
  t.plan(6)

  const fakeFs = Object.create(fs)
  fakeFs.fsyncSync = function (fd) {
    t.assert.ok('fake fs.fsyncSync called')
    return fs.fsyncSync(fd)
  }
  const SonicBoom = proxyquire('../', {
    fs: fakeFs
  })

  const dest = file()
  const fd = fs.openSync(dest, 'w')
  const stream = new SonicBoom({ fd, fsync: true })

  t.assert.ok(stream.write('hello world\n'))
  t.assert.ok(stream.write('something else\n'))

  const endPromise1 = once(stream, 'finish', () => {
    const data = fs.readFileSync(dest, 'utf8')
    t.assert.strictEqual(data, 'hello world\nsomething else\n')
  })

  const endPromise2 = once(stream, 'close', () => {
    t.assert.ok('close emitted')
  })

  stream.end()
  await Promise.all([endPromise1, endPromise2])
})
