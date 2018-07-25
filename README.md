# sonic-boom&nbsp;&nbsp;[![Build Status](https://travis-ci.org/mcollina/sonic-boom.svg?branch=master)](https://travis-ci.org/mcollina/sonic-boom)

Extremely fast utf8-only stream implementation to write to files and
file descriptors.

This implementation is partial, but support backpressure and `.pipe()` in is here.
However, it is 20x faster than Node Core `fs.createWriteStream()`:

```
benchSonic*1000: 476.229ms
benchCore*1000: 8250.532ms
benchSonic*1000: 478.423ms
benchCore*1000: 8096.463ms
```

## Install

```
npm i sonic-boom
```

## Example

```js
'use strict'

const SonicBoom = require('sonic-boom')
const sonic = new SonicBoom(process.stdout.fd) // or '/path/to/destination'

for (var i = 0; i < 10; i++) {
  sonic.write('hello sonic\n')
}
```

## API

### SonicBoom(String|Number, (minLength))

Creates a new instance of SonicBoom.

The first argument can be:

1. a string that is a path to a file to be written to (mode `'a'`)
2. a file descriptor, something that is returned by `fs.open` or
   `fs.openSync`.

The second argument is the minimum length of the internal buffer that is
required before flushing.

It will emit the `'ready'` event when a file descriptor is available.

### SonicBoom#write(string)

Writes the string to the file.
It will return false to signal the producer to slow down.

### SonicBoom#flush()

Writes the current buffer to the file if a write was not in progress.
Do nothing if `minLength` is zero or if it is already writing.

### SonicBoom#reopen([file])

Reopen the file in place, useful for log rotation.

Example:

```js
const stream = new SonicBoom('./my.log')
process.on('SIGUSR2', function () {
  stream.reopen()
})
```

### SonicBoom#flushSync()

Flushes the buffered data synchronously. This is a costly operation.

### SonicBoom#end()

Closes the stream, the data will be flushed down asynchronously

### SonicBook#destroy()

Closes the stream immediately, the data is not flushed.

## License

MIT
