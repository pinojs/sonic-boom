'use strict'

const { test } = require('node:test')
const fs = require('fs')
const SonicBoom = require('../')
const { file, once } = require('./helper')

const MAX_WRITE = 16 * 1024

test('drain deadlock', async (t) => {
  t.plan(4)

  const dest = file()
  const stream = new SonicBoom({ dest, sync: false, minLength: 9999 })

  t.assert.ok(stream.write(Buffer.alloc(1500).fill('x').toString()))
  t.assert.ok(stream.write(Buffer.alloc(1500).fill('x').toString()))
  t.assert.ok(!stream.write(Buffer.alloc(MAX_WRITE).fill('x').toString()))
  await once(stream, 'drain', () => {
    t.assert.ok('drain')
  })
})

test('should throw if minLength >= maxWrite', (t) => {
  t.plan(1)
  t.assert.throws(() => {
    const dest = file()
    const fd = fs.openSync(dest, 'w')

    SonicBoom({
      fd,
      minLength: MAX_WRITE
    })
  })
})
