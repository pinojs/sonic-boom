'use strict'

const fs = require('node:fs')
const EventEmitter = require('node:events')
const inherits = require('node:util').inherits
const path = require('node:path')
const assert = require('node:assert')
const sleep = require('atomic-sleep')

const BUSY_WRITE_TIMEOUT = 100
const kEmptyBuffer = Buffer.allocUnsafe(0)

// 16 KB. Don't write more than docker buffer size.
// https://github.com/moby/moby/blob/513ec73831269947d38a644c278ce3cac36783b2/daemon/logger/copier.go#L13
const MAX_WRITE = 16 * 1024

const kContentModeBuffer = 'buffer'
const kContentModeUtf8 = 'utf8'
const kFlush = Symbol('kFlush')

// States returned by beginFlushSync().
// No write is in flight.
const kFlushSyncIdle = 0
// An EAGAIN/EBUSY retry timer was pending and has been cancelled. Nothing is
// in flight, so the remainder of _writingBuf can be written synchronously.
const kFlushSyncRetry = 1
// Called from a 'write' listener. The completed write has been released and
// nothing is in flight, so the remainder of _writingBuf can be written
// synchronously.
const kFlushSyncInWriteEvent = 2
// An asynchronous fs.write() of _writingBuf is in flight. Only the queued
// buffers can be written; ordering relative to the in-flight chunk is not
// guaranteed.
const kFlushSyncInFlight = 3

// fsync() error codes meaning the file descriptor cannot be synchronized
// (e.g. it is a pipe, socket, or TTY) or has already been closed. These are
// not treated as flush failures.
function isIgnorableFsyncError (err) {
  switch (err?.code) {
    case 'EBADF':
    case 'EINVAL':
    case 'ENOTSUP':
    case 'EOPNOTSUPP':
    case 'EROFS':
      return true
    default:
      return false
  }
}

const [major, minor] = (process.versions.node || '0.0').split('.').map(Number)
const kCopyBuffer = major >= 22 && minor >= 7

function openFile (file, sonic) {
  sonic._opening = true
  sonic._writing = true
  sonic._asyncDrainScheduled = false

  // NOTE: 'error' and 'ready' events emitted below only relevant when sonic.sync===false
  // for sync mode, there is no way to add a listener that will receive these

  function fileOpened (err, fd) {
    if (err) {
      sonic._reopening = false
      sonic._writing = false
      sonic._opening = false

      if (sonic.sync) {
        process.nextTick(() => {
          if (sonic.listenerCount('error') > 0) {
            sonic.emit('error', err)
          }
        })
      } else {
        sonic.emit('error', err)
      }
      return
    }

    const reopening = sonic._reopening

    sonic.fd = fd
    sonic.file = file
    sonic._reopening = false
    sonic._opening = false
    sonic._writing = false

    if (sonic.sync) {
      process.nextTick(() => sonic.emit('ready'))
    } else {
      sonic.emit('ready')
    }

    if (sonic.destroyed) {
      return
    }

    // start
    if (!sonic._writing && (sonic._len > sonic.minLength || sonic._flushPending)) {
      sonic._actualWrite()
    } else if (reopening && !sonic._writing) {
      // Do not emit 'drain' if a 'ready' listener started a write:
      // release() will emit the real 'drain' when that write completes.
      process.nextTick(emitDrain, sonic)
    }
  }

  const flags = sonic.append ? 'a' : 'w'
  const mode = sonic.mode

  if (sonic.sync) {
    try {
      if (sonic.mkdir) fs.mkdirSync(path.dirname(file), { recursive: true })
      const fd = fs.openSync(file, flags, mode)
      fileOpened(null, fd)
    } catch (err) {
      fileOpened(err)
      throw err
    }
  } else if (sonic.mkdir) {
    fs.mkdir(path.dirname(file), { recursive: true }, (err) => {
      if (err) return fileOpened(err)
      fs.open(file, flags, mode, fileOpened)
    })
  } else {
    fs.open(file, flags, mode, fileOpened)
  }
}

function SonicBoom (opts) {
  if (!(this instanceof SonicBoom)) {
    return new SonicBoom(opts)
  }

  let { fd, dest, minLength, maxLength, maxWrite, periodicFlush, sync, append = true, mkdir, retryEAGAIN, maxWriteRetries, fsync, contentMode, mode } = opts || {}

  fd = fd || dest

  this._len = 0
  this.fd = -1
  this._bufs = []
  this._lens = []
  this._writing = false
  this._ending = false
  this._reopening = false
  this._asyncDrainScheduled = false
  this._flushPending = 0
  this._flushInProgress = 0
  this._emittingFlush = false
  this._emittingWrite = false
  this._retryTimer = null
  this._hwm = Math.max(minLength || 0, 16387)
  this.file = null
  this.destroyed = false
  this.minLength = minLength || 0
  this.maxLength = maxLength || 0
  this.maxWrite = maxWrite || MAX_WRITE
  this._periodicFlush = periodicFlush || 0
  this._periodicFlushTimer = undefined
  this.sync = sync || false
  this.writable = true
  this._fsync = fsync || false
  this.append = append || false
  this.mode = mode
  this.retryEAGAIN = retryEAGAIN || (() => true)
  // Bounds how many *consecutive* EAGAIN/EBUSY retries (across write,
  // writeSync and flushSync) are attempted before giving up and surfacing
  // the error, instead of retrying forever while _bufs keeps growing from
  // unrelated concurrent write() calls. 0 (default) preserves the existing
  // unbounded-retry behavior for backward compatibility.
  // See: https://github.com/pinojs/sonic-boom/issues/65
  this.maxWriteRetries = maxWriteRetries || 0
  this._writeRetries = 0
  this.mkdir = mkdir || false

  let fsWriteSync
  let fsWrite
  if (contentMode === kContentModeBuffer) {
    this._writingBuf = kEmptyBuffer
    this.write = writeBuffer
    this.flush = flushBuffer
    this.flushSync = flushBufferSync
    this._actualWrite = actualWriteBuffer
    fsWriteSync = () => fs.writeSync(this.fd, this._writingBuf)
    fsWrite = () => fs.write(this.fd, this._writingBuf, this.release)
  } else if (contentMode === undefined || contentMode === kContentModeUtf8) {
    this._writingBuf = ''
    this.write = write
    this.flush = flush
    this.flushSync = flushSync
    this._actualWrite = actualWrite
    fsWriteSync = () => {
      if (Buffer.isBuffer(this._writingBuf)) {
        return fs.writeSync(this.fd, this._writingBuf)
      }
      return fs.writeSync(this.fd, this._writingBuf, 'utf8')
    }
    fsWrite = () => {
      if (Buffer.isBuffer(this._writingBuf)) {
        return fs.write(this.fd, this._writingBuf, this.release)
      }
      return fs.write(this.fd, this._writingBuf, 'utf8', this.release)
    }
  } else {
    throw new Error(`SonicBoom supports "${kContentModeUtf8}" and "${kContentModeBuffer}", but passed ${contentMode}`)
  }

  if (typeof fd === 'number') {
    this.fd = fd
    process.nextTick(() => this.emit('ready'))
  } else if (typeof fd === 'string') {
    openFile(fd, this)
  } else {
    throw new Error('SonicBoom supports only file descriptors and files')
  }
  if (this.minLength >= this.maxWrite) {
    throw new Error(`minLength should be smaller than maxWrite (${this.maxWrite})`)
  }

  this.release = (err, n) => {
    if (err) {
      const isRetryableErr = (err.code === 'EAGAIN' || err.code === 'EBUSY')
      if (isRetryableErr) {
        this._writeRetries++
      }
      const retriesExhausted = this.maxWriteRetries > 0 && this._writeRetries > this.maxWriteRetries

      if (isRetryableErr && !retriesExhausted && this.retryEAGAIN(err, this._writingBuf.length, this._len - this._writingBuf.length)) {
        if (this.sync) {
          // This error code should not happen in sync mode, because it is
          // not using the underlining operating system asynchronous functions.
          // However it happens, and so we handle it.
          // Ref: https://github.com/pinojs/pino/issues/783
          try {
            sleep(BUSY_WRITE_TIMEOUT)
            this.release(undefined, 0)
          } catch (err) {
            this.release(err)
          }
        } else {
          // Let's give the destination some time to process the chunk.
          this._retryTimer = setTimeout(() => {
            this._retryTimer = null
            fsWrite()
          }, BUSY_WRITE_TIMEOUT)
        }
      } else {
        this._writing = false

        this.emit('error', err)
      }
      return
    }

    // In sync mode, `release(undefined, 0)` is also used internally as a
    // "resume after EAGAIN backoff" continuation (see the retry branch
    // above) rather than always signaling a genuine successful write -
    // only reset the retry counter once real forward progress (n > 0) is
    // confirmed, otherwise a stuck destination would never accumulate past
    // 1 retry and maxWriteRetries could never trigger.
    if (n > 0) {
      this._writeRetries = 0
    }
    const releasedBufObj = releaseWritingBuf(this._writingBuf, this._len, n)
    this._len = releasedBufObj.len
    this._writingBuf = releasedBufObj.writingBuf

    // Emit 'write' after the written bytes have been released so that a
    // listener calling flushSync() sees a consistent state with no I/O in
    // flight. flushSync() may consume the remainder of _writingBuf.
    this._emittingWrite = true
    try {
      this.emit('write', n)
    } finally {
      this._emittingWrite = false
    }

    if (this.destroyed) {
      this._writing = false
      if (this._flushPending > 0) {
        if (this._len === 0) {
          // Everything was written before the fd was closed.
          scheduleDrain(this)
        } else {
          this.emit(kFlush, new Error('SonicBoom destroyed'))
        }
      }
      return
    }

    if (this._writingBuf.length) {
      if (!this.sync) {
        fsWrite()
        return
      }

      try {
        do {
          const n = fsWriteSync()
          const releasedBufObj = releaseWritingBuf(this._writingBuf, this._len, n)
          this._len = releasedBufObj.len
          this._writingBuf = releasedBufObj.writingBuf
        } while (this._writingBuf.length)
      } catch (err) {
        this.release(err)
        return
      }
    }

    if (this._fsync) {
      fs.fsyncSync(this.fd)
    }

    const len = this._len
    if (this._reopening) {
      this._writing = false
      this._reopening = false
      this.reopen()
    } else if (len > 0 && (len > this.minLength || this._flushPending)) {
      this._actualWrite()
    } else if (this._ending) {
      if (len > 0) {
        this._actualWrite()
      } else {
        this._writing = false
        finishEnding(this)
      }
    } else {
      this._writing = false
      scheduleDrain(this)
    }
  }

  this.on('newListener', function (name) {
    if (name === 'drain' || name === kFlush) {
      this._asyncDrainScheduled = false
    }
  })

  if (this._periodicFlush !== 0) {
    this._periodicFlushTimer = setInterval(() => {
      if (this._flushPending === 0 && this._flushInProgress === 0) {
        this.flush(null)
      }
    }, this._periodicFlush)
    this._periodicFlushTimer.unref()
  }
}

/**
 * Release the writingBuf after fs.write n bytes data
 * @param {string | Buffer} writingBuf - currently writing buffer, usually be instance._writingBuf.
 * @param {number} len - currently buffer length, usually be instance._len.
 * @param {number} n - number of bytes fs already written
 * @returns {{writingBuf: string | Buffer, len: number}} released writingBuf and length
 */
function releaseWritingBuf (writingBuf, len, n) {
  if (typeof writingBuf === 'string') {
    writingBuf = Buffer.from(writingBuf)
  }

  len = Math.max(len - n, 0)
  writingBuf = writingBuf.subarray(n)
  return { writingBuf, len }
}

function scheduleDrain (sonic) {
  if (sonic.sync) {
    if (!sonic._asyncDrainScheduled) {
      sonic._asyncDrainScheduled = true
      process.nextTick(emitDrain, sonic)
    }
  } else {
    emitDrain(sonic)
  }
}

function emitDrain (sonic) {
  const hasListeners = sonic.listenerCount('drain') > 0 || sonic.listenerCount(kFlush) > 0
  if (!hasListeners) return
  sonic._asyncDrainScheduled = false
  if (sonic._writing) return
  emitFlush(sonic)
  if (sonic._writing || sonic.destroyed) return
  if (sonic.listenerCount('drain') > 0) {
    sonic.emit('drain')
  }
}

function emitFlush (sonic) {
  if (sonic._emittingFlush) return
  sonic._emittingFlush = true
  try {
    sonic.emit(kFlush)
  } finally {
    sonic._emittingFlush = false
  }
}

function finishEnding (sonic) {
  if (!sonic._ending || sonic._writing || sonic.destroyed) return
  if (sonic._len > 0) {
    sonic._actualWrite()
    return
  }
  if (sonic._flushPending > 0) emitFlush(sonic)
  if (sonic._flushPending === 0 && sonic._flushInProgress === 0 &&
      !sonic._writing && sonic._len === 0) {
    actualClose(sonic)
  }
}

inherits(SonicBoom, EventEmitter)

function mergeBuf (bufs, len) {
  if (bufs.length === 0) {
    return kEmptyBuffer
  }

  if (bufs.length === 1) {
    return bufs[0]
  }

  return Buffer.concat(bufs, len)
}

function write (data) {
  if (this.destroyed) {
    throw new Error('SonicBoom destroyed')
  }

  data = '' + data
  const dataLen = Buffer.byteLength(data)
  const len = this._len + dataLen
  const bufs = this._bufs

  if (this.maxLength && len > this.maxLength) {
    this.emit('drop', data)
    return this._len < this._hwm
  }

  if (
    bufs.length === 0 ||
    Buffer.byteLength(bufs[bufs.length - 1]) + dataLen > this.maxWrite
  ) {
    bufs.push(data)
  } else {
    bufs[bufs.length - 1] += data
  }

  this._len = len

  if (!this._writing && this._len >= this.minLength) {
    this._actualWrite()
  }

  return this._len < this._hwm
}

function writeBuffer (data) {
  if (this.destroyed) {
    throw new Error('SonicBoom destroyed')
  }

  const len = this._len + data.length
  const bufs = this._bufs
  const lens = this._lens

  if (this.maxLength && len > this.maxLength) {
    this.emit('drop', data)
    return this._len < this._hwm
  }

  if (
    bufs.length === 0 ||
    lens[lens.length - 1] + data.length > this.maxWrite
  ) {
    bufs.push([data])
    lens.push(data.length)
  } else {
    bufs[bufs.length - 1].push(data)
    lens[lens.length - 1] += data.length
  }

  this._len = len

  if (!this._writing && this._len >= this.minLength) {
    this._actualWrite()
  }

  return this._len < this._hwm
}

function callFlushCallbackOnDrain (cb) {
  this._flushPending++
  let waiting = true
  let completed = false
  let flushing = false
  const stopWaiting = () => {
    if (!waiting) return false
    waiting = false
    this.off(kFlush, onDrain)
    this.off('error', onError)
    return true
  }
  const complete = (err, finish = true) => {
    if (completed) return
    completed = true
    if (flushing) this._flushInProgress--
    try {
      cb(err)
    } finally {
      if (finish) finishEnding(this)
    }
  }
  const onDrain = (err) => {
    if (!stopWaiting()) return
    this._flushPending--
    if (err) {
      complete(err, false)
      return
    }
    this._flushInProgress++
    flushing = true
    // only if _fsync is false to avoid double fsync
    if (!this._fsync && !this.destroyed) {
      try {
        fs.fsync(this.fd, (err) => {
          // Ignore errors meaning the fd is closed or cannot be synced
          // (e.g. stdout/stderr attached to a pipe or TTY). A regular
          // file, including a redirected stdout/stderr, is still synced.
          if (isIgnorableFsyncError(err)) {
            complete()
            return
          }
          complete(err)
        })
      } catch (err) {
        complete(err)
      }
    } else {
      complete()
    }
  }
  const onError = (err) => {
    if (!stopWaiting()) return
    this._flushPending--
    complete(err, false)
  }

  this.once(kFlush, onDrain)
  this.once('error', onError)
}

function flush (cb) {
  if (cb != null && typeof cb !== 'function') {
    throw new Error('flush cb must be a function')
  }

  if (this.destroyed) {
    const error = new Error('SonicBoom destroyed')
    if (cb) {
      cb(error)
      return
    }

    throw error
  }

  if (this.minLength <= 0 && !this._writing && this._len === 0) {
    cb?.()
    return
  }

  if (cb) {
    callFlushCallbackOnDrain.call(this, cb)
  }

  if (this._writing) {
    return
  }

  if (this._bufs.length === 0) {
    this._bufs.push('')
  }

  this._actualWrite()
}

function flushBuffer (cb) {
  if (cb != null && typeof cb !== 'function') {
    throw new Error('flush cb must be a function')
  }

  if (this.destroyed) {
    const error = new Error('SonicBoom destroyed')
    if (cb) {
      cb(error)
      return
    }

    throw error
  }

  if (this.minLength <= 0 && !this._writing && this._len === 0) {
    cb?.()
    return
  }

  if (cb) {
    callFlushCallbackOnDrain.call(this, cb)
  }

  if (this._writing) {
    return
  }

  if (this._bufs.length === 0) {
    this._bufs.push([])
    this._lens.push(0)
  }

  this._actualWrite()
}

SonicBoom.prototype.reopen = function (file) {
  if (this.destroyed) {
    throw new Error('SonicBoom destroyed')
  }

  if (this._opening) {
    this.once('ready', () => {
      if (!this.destroyed) this.reopen(file)
    })
    return
  }

  if (this._ending) {
    return
  }

  if (!this.file) {
    throw new Error('Unable to reopen a file descriptor, you must pass a file to SonicBoom')
  }

  if (file) {
    this.file = file
  }
  this._reopening = true

  if (this._writing) {
    return
  }

  const fd = this.fd
  this.once('ready', () => {
    if (fd !== this.fd) {
      fs.close(fd, (err) => {
        if (err) {
          return this.emit('error', err)
        }
      })
    }
  })

  openFile(this.file, this)
}

SonicBoom.prototype.end = function () {
  if (this.destroyed) {
    throw new Error('SonicBoom destroyed')
  }

  if (this._opening) {
    this.once('ready', () => {
      if (!this.destroyed) this.end()
    })
    return
  }

  if (this._ending) {
    return
  }

  this._ending = true

  if (this._writing) {
    return
  }

  if (this._len > 0 && this.fd >= 0) {
    this._actualWrite()
  } else {
    finishEnding(this)
  }
}

/**
 * Validates that flushSync() can run and determines how it must interact
 * with any write already in progress.
 * @returns {number} One of the kFlushSync* states.
 */
function beginFlushSync (sonic) {
  if (sonic.destroyed) {
    throw new Error('SonicBoom destroyed')
  }

  if (sonic.fd < 0) {
    throw new Error('sonic boom is not ready yet')
  }

  // While reopening, _writing is set but no write is in flight and fd still
  // refers to the previous file, which is only closed once the new file is
  // ready. Flush the buffered data to it.
  if (!sonic._writing || sonic._opening) {
    return kFlushSyncIdle
  }

  if (sonic._retryTimer !== null) {
    clearTimeout(sonic._retryTimer)
    sonic._retryTimer = null
    return kFlushSyncRetry
  }

  if (sonic._emittingWrite) {
    return kFlushSyncInWriteEvent
  }

  return kFlushSyncInFlight
}

/**
 * Called after flushSync() has taken over a write whose retry timer it
 * cancelled. Resumes whatever release() would have done once that write
 * completed.
 */
function endFlushSyncRetry (sonic) {
  sonic._writing = false
  process.nextTick(() => {
    if (sonic.destroyed || sonic._writing) return
    if (sonic._reopening) {
      sonic._reopening = false
      sonic.reopen()
    } else if (sonic._ending) {
      finishEnding(sonic)
    } else if (sonic._len > 0 && (sonic._len > sonic.minLength || sonic._flushPending)) {
      sonic._actualWrite()
    } else {
      emitDrain(sonic)
    }
  })
}

function flushSync () {
  const state = beginFlushSync(this)

  try {
    // Unless an fs.write() of _writingBuf is in flight, its unwritten
    // remainder must be written first to preserve ordering.
    if (state !== kFlushSyncInFlight && this._writingBuf.length > 0) {
      this._bufs.unshift(this._writingBuf)
      this._writingBuf = ''
    }

    let buf = ''
    while (this._bufs.length || buf.length) {
      if (buf.length <= 0) {
        buf = this._bufs[0]
      }
      try {
        const n = Buffer.isBuffer(buf)
          ? fs.writeSync(this.fd, buf)
          : fs.writeSync(this.fd, buf, 'utf8')
        this._writeRetries = 0
        const releasedBufObj = releaseWritingBuf(buf, this._len, n)
        buf = releasedBufObj.writingBuf
        this._len = releasedBufObj.len
        if (buf.length <= 0) {
          this._bufs.shift()
        }
      } catch (err) {
        const shouldRetry = err.code === 'EAGAIN' || err.code === 'EBUSY'
        if (shouldRetry) {
          this._writeRetries++
        }
        const retriesExhausted = this.maxWriteRetries > 0 && this._writeRetries > this.maxWriteRetries
        if (!shouldRetry || retriesExhausted || !this.retryEAGAIN(err, buf.length, this._len - buf.length)) {
          throw err
        }

        sleep(BUSY_WRITE_TIMEOUT)
      }
    }
  } finally {
    if (state === kFlushSyncRetry) endFlushSyncRetry(this)
  }

  try {
    fs.fsyncSync(this.fd)
  } catch {
    // Skip the error. The fd might not support fsync.
  }
}

function flushBufferSync () {
  const state = beginFlushSync(this)

  try {
    // Unless an fs.write() of _writingBuf is in flight, its unwritten
    // remainder must be written first to preserve ordering.
    if (state !== kFlushSyncInFlight && this._writingBuf.length > 0) {
      this._bufs.unshift([this._writingBuf])
      this._lens.unshift(this._writingBuf.length)
      this._writingBuf = kEmptyBuffer
    }

    let buf = kEmptyBuffer
    while (this._bufs.length || buf.length) {
      if (buf.length <= 0) {
        buf = mergeBuf(this._bufs[0], this._lens[0])
      }
      try {
        const n = fs.writeSync(this.fd, buf)
        this._writeRetries = 0
        buf = buf.subarray(n)
        this._len = Math.max(this._len - n, 0)
        if (buf.length <= 0) {
          this._bufs.shift()
          this._lens.shift()
        }
      } catch (err) {
        const shouldRetry = err.code === 'EAGAIN' || err.code === 'EBUSY'
        if (shouldRetry) {
          this._writeRetries++
        }
        const retriesExhausted = this.maxWriteRetries > 0 && this._writeRetries > this.maxWriteRetries
        if (!shouldRetry || retriesExhausted || !this.retryEAGAIN(err, buf.length, this._len - buf.length)) {
          throw err
        }

        sleep(BUSY_WRITE_TIMEOUT)
      }
    }
  } finally {
    if (state === kFlushSyncRetry) endFlushSyncRetry(this)
  }
}

SonicBoom.prototype.destroy = function () {
  if (this.destroyed) {
    return
  }
  const opening = this._opening
  actualClose(this)
  if (opening && this._flushPending > 0) {
    this.emit('error', new Error('SonicBoom destroyed'))
  }
}

function actualWrite () {
  const release = this.release
  this._writing = true
  this._writingBuf = this._writingBuf.length ? this._writingBuf : this._bufs.shift() || ''

  if (this.sync) {
    try {
      const written = Buffer.isBuffer(this._writingBuf)
        ? fs.writeSync(this.fd, this._writingBuf)
        : fs.writeSync(this.fd, this._writingBuf, 'utf8')
      release(null, written)
    } catch (err) {
      release(err)
    }
  } else {
    fs.write(this.fd, this._writingBuf, release)
  }
}

function actualWriteBuffer () {
  const release = this.release
  this._writing = true
  this._writingBuf = this._writingBuf.length ? this._writingBuf : mergeBuf(this._bufs.shift(), this._lens.shift())

  if (this.sync) {
    try {
      const written = fs.writeSync(this.fd, this._writingBuf)
      release(null, written)
    } catch (err) {
      release(err)
    }
  } else {
    // fs.write will need to copy string to buffer anyway so
    // we do it here to avoid the overhead of calculating the buffer size
    // in releaseWritingBuf.
    if (kCopyBuffer) {
      this._writingBuf = Buffer.from(this._writingBuf)
    }
    fs.write(this.fd, this._writingBuf, release)
  }
}

function actualClose (sonic) {
  if (sonic.destroyed) {
    return
  }

  if (sonic.fd === -1) {
    // Mark the stream as destroyed right away, so that it rejects further
    // writes, and close it once the file is open.
    sonic.destroyed = true
    sonic.once('ready', () => {
      sonic.destroyed = false
      actualClose(sonic)
    })
    return
  }

  if (sonic._periodicFlushTimer !== undefined) {
    clearInterval(sonic._periodicFlushTimer)
  }

  sonic.destroyed = true
  sonic._bufs = []
  sonic._lens = []

  if (sonic._retryTimer !== null) {
    clearTimeout(sonic._retryTimer)
    sonic._retryTimer = null
    sonic._writing = false
  }

  // If a write is in flight, release() settles the pending flushes once it
  // completes, depending on whether all the data was written.
  if (sonic._flushPending > 0 && !sonic._writing) {
    sonic.emit(kFlush, new Error('SonicBoom destroyed'))
  }

  assert(typeof sonic.fd === 'number', `sonic.fd must be a number, got ${typeof sonic.fd}`)
  try {
    fs.fsync(sonic.fd, closeWrapped)
  } catch {
  }

  function closeWrapped () {
    // We skip errors in fsync

    if (sonic.fd !== 1 && sonic.fd !== 2) {
      fs.close(sonic.fd, done)
    } else {
      done()
    }
  }

  function done (err) {
    if (err) {
      sonic.emit('error', err)
      return
    }

    if (sonic._ending && !sonic._writing) {
      sonic.emit('finish')
    }
    sonic.emit('close')
  }
}

/**
 * These export configurations enable JS and TS developers
 * to consumer SonicBoom in whatever way best suits their needs.
 * Some examples of supported import syntax includes:
 * - `const SonicBoom = require('sonic-boom')`
 * - `const { SonicBoom } = require('sonic-boom')`
 * - `import * as SonicBoom from 'sonic-boom'`
 * - `import { SonicBoom } from 'sonic-boom'`
 * - `import SonicBoom from 'sonic-boom'`
 */
SonicBoom.SonicBoom = SonicBoom
SonicBoom.default = SonicBoom
module.exports = SonicBoom
