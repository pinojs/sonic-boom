# sonic-boom

Extremely fast utf8-only stream implementation to write to files and
file descriptors.

This implementation is partial, but support for being piped in is there.

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

### SonicBoom(String|Number)

Creates a new instance of SonicBoom.

The first argument can be:

1. a string that is a path to a file to be written to (mode `'a'`)
2. a file descriptor, something that is returned by `fs.open` or
   `fs.openSync`.

### SonicBoom#write(string)

Writes the string to the file.
It will return false to signal the producer to slow down.

### SonicBoom#end()

Closes the stream, the data will be flushed down asynchronously

### SonicBook#destroy()

Closes the stream immediately, the data is not flushed.

### SonicBoom#flushSync()

Flushes the buffered data synchronously

## License

MIT
