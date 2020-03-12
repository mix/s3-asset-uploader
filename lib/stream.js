// Node imports
const fs = require('fs')
const stream = require('stream')
const zlib = require('zlib')
// Lib imports
const fileLib = require('./file')

/**
 * @param {string} filePath
 * @returns {Promise.<string>}
 * @private
 */
async function fileToString(filePath) {
  const fileStream = fs.createReadStream(filePath)
  const readerStream = fileLib.isGzipped(filePath)
  ? fileStream.pipe(zlib.createGunzip())
  : fileStream
  return streamToString(readerStream)
}

/**
 * @param {NodeJS.ReadableStream} readerStream
 * @param {BufferEncoding} [encoding]
 * @returns {Promise.<string>}
 */
async function streamToString(readerStream, encoding = 'utf8') {
  return new Promise((resolve, reject) => {
    /** @type {Array.<Uint8Array>} */
    const chunks = []
    readerStream.on('data', (/** @type {Uint8Array} */ chunk) => {
      chunks.push(chunk)
    })
    readerStream.on('error', reject)
    readerStream.on('end', () => {
      resolve(Buffer.concat(chunks).toString(encoding))
    })
  })
}

/**
 * @param {string} data
 * @param {BufferEncoding} [encoding]
 * @returns {NodeJS.ReadableStream}
 * @private
 */
function stringToStream(data, encoding = 'utf8') {
  let cursor = 0
  const buffer = Buffer.from(data, encoding)
  return new stream.Readable({
    read(size) {
      if (cursor >= buffer.length) {
        this.push(null)
      } else {
        this.push(buffer.slice(cursor, cursor + size))
        cursor += size
      }
    }
  })
}

module.exports = {
  fileToString,
  streamToString,
  stringToStream
}
