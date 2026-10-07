import { expect, test } from 'tstyche'

import SonicBoom, { type SonicBoomOpts, type RetryCallback } from '../../index.js'

declare const options: SonicBoomOpts

test('default export', () => {
  expect(new SonicBoom(options)).type.toBe<SonicBoom>()
})

test('instance', () => {
  const sonic = new SonicBoom({ fd: 1 })

  expect(sonic.write('hello sonic\n')).type.toBe<boolean>()

  expect(sonic.flush()).type.toBe<void>()
  expect(sonic.flush(() => {})).type.toBe<void>()
  expect(sonic.flush((err) => {
    expect(err).type.toBe<Error | undefined>()
  })).type.toBe<void>()

  expect(sonic.flushSync()).type.toBe<void>()

  expect(sonic.reopen()).type.toBe<void>()
  expect(sonic.reopen(1)).type.toBe<void>()
  expect(sonic.reopen('path/to/destination')).type.toBe<void>()

  expect(sonic.end()).type.toBe<void>()

  expect(sonic.destroy()).type.toBe<void>()
})

test('SonicBoomOpts', () => {
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1 })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 'path/to/destination' })

  expect<SonicBoomOpts>().type.toBeAssignableFrom({ dest: '/dev/null' })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ dest: 1 })

  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, minLength: 0 })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, maxLength: 5000 })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, maxWrite: 65535 })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, periodicFlush: 15000 })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, sync: true })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, fsync: true })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, append: false })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, mode: 0o666 })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, mode: '0o666' })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, mode: 765 })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, contentMode: 'utf8' as const })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, contentMode: 'buffer' as const })
  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, mkdir: true })

  const retryEAGAIN: RetryCallback = (err, writeBufferLen, remainingBufferLen) => {
    expect(err).type.toBe<Error>()
    expect(writeBufferLen).type.toBe<number>()
    expect(remainingBufferLen).type.toBe<number>()

    return false
  }

  expect<SonicBoomOpts>().type.toBeAssignableFrom({ fd: 1, retryEAGAIN })
})
