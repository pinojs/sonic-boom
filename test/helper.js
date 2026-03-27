'use strict'

const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const files = []
let count = 0

function file () {
  const file = path.join(os.tmpdir(), `sonic-boom-${process.pid}-${process.hrtime().toString()}-${count++}`)
  files.push(file)
  return file
}

test.after(() => {
  const rmSync = fs.rmSync || fs.rmdirSync
  files.forEach((file) => {
    try {
      if (fs.existsSync(file)) {
        fs.statSync(file).isDirectory() ? rmSync(file, { recursive: true, maxRetries: 10 }) : fs.unlinkSync(file)
      }
    } catch (e) {
      console.log(e)
    }
  })
})

module.exports = { file }
