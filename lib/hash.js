// Node imports
const crypto = require('crypto')
const fs = require('fs')

const HASH_ALGORITHM = 'md5'
const HASH_DIGEST_ENCODING = 'hex'

/** @typedef {string} Hash */

/**
 * Generate a hash of the supplied file
 * @param {string} filePath
 * @returns {Promise.<Hash>}
 */
async function hashFromFile(filePath) {
  return hashFromStream(fs.createReadStream(filePath))
}

/**
 * Generate a hash of the supplied stream
 * @param {NodeJS.ReadableStream} readableStream
 * @returns {Promise.<Hash>}
 */
async function hashFromStream(readableStream) {
  return new Promise((resolve, reject) => {
    const hashStream = crypto.createHash(HASH_ALGORITHM)
    readableStream.pipe(hashStream)
    .on('error', reject)
    .on('finish', () => {
      resolve(hashStream.read().toString(HASH_DIGEST_ENCODING))
    })
  })
}

/**
 * Generate a hash of the supplied string
 * @param {string} data
 * @returns {Hash}
 */
function hashFromString(data) {
  return crypto.createHash(HASH_ALGORITHM)
  .update(data)
  .digest(HASH_DIGEST_ENCODING)
}

module.exports = {
  hashFromFile,
  hashFromStream,
  hashFromString
}
