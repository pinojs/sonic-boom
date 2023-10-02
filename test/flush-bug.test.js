'use strict'

const { test } = require('tap')
const SonicBoom = require('../')

test('flush with no data fd: 1 sync false', (t) => {
  t.plan(1)

  const stream = new SonicBoom({ fd: 1, sync: false })

  stream.flush()

  stream.on('drain', () => {
    t.pass('drain emitted')
  })
})
