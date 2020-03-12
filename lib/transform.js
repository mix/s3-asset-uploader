// Node imports
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
// Lib imports
const fileLib = require('./file')
const hashLib = require('./hash')
const streamLib = require('./stream')

const { CONTENT_TYPE_CSS, CONTENT_TYPE_JS } = fileLib

const DEFAULT_GZIP_OPTIONS = { level: 9 }

const CSS_URL_REGEXP = /url\(\/([^)]+)\)/g
const CSS_SOURCEMAP_REGEXP = /\/\*# sourceMappingURL=([^*]+)\*\/$/
const JS_SOURCEMAP_REGEXP = /\/\/# sourceMappingURL=(.+)$/

/**
 * The mapping of original file paths to hashed file names
 * @typedef {Object.<string,string>} S3SyncDigest
 * @see index.js `S3SyncDigest` type definition
 */

/**
 * @typedef {Object} TransformedFileResult
 * @property {NodeJS.ReadableStream} stream
 * @property {string} [hash]
 */

/**
 * @callback TransformFileCallback
 * @param {string} fileData
 * @return {string} transformed file data
 */

/**
 * @param {Object} options
 * @param {string} options.filePath
 * @param {string} options.relativeFileName
 * @param {S3SyncDigest} options.digest
 * @returns {Promise.<TransformedFileResult>}
 * @public
 */
async function replaceHashedFilenames({ filePath, relativeFileName, digest }) {
  const relativeDirPath = path.dirname(relativeFileName)
  const contentType = fileLib.getContentType(filePath)
  if (contentType === CONTENT_TYPE_JS) {
    return transformFile(replaceHashedFilenamesInJs)
  }
  if (contentType === CONTENT_TYPE_CSS) {
    return transformFile(replaceHashedFilenamesInCss)
  }
  return originalFileResult()

  /**
   * @returns {TransformedFileResult}
   */
  function originalFileResult() {
    return {
      stream: fs.createReadStream(filePath)
    }
  }

  /**
   * @param {string} transformedData
   * @param {string} recalculatedHash
   * @returns {TransformedFileResult}
   */
  function transformedFileResult(transformedData, recalculatedHash) {
    return {
      stream: transformedDataToStream(transformedData),
      hash: recalculatedHash
    }
  }

  /**
   * @param {TransformFileCallback} transformCallback
   * @returns {Promise.<TransformedFileResult>}
   */
  async function transformFile(transformCallback) {
    const originalData = await streamLib.fileToString(filePath)
    const transformedData = transformCallback(originalData)
    if (originalData === transformedData) {
      return originalFileResult()
    }
    const recalculatedHash = await recalculateHash(transformedData)
    return transformedFileResult(transformedData, recalculatedHash)
  }

  /**
   * @param {string} transformedData
   * @returns {NodeJS.ReadableStream}
   */
  function transformedDataToStream(transformedData) {
    const transformedStream = streamLib.stringToStream(transformedData)
    // Re-compress the stream if the original file was gzipped
    return fileLib.isGzipped(filePath)
    ? gzipStream(transformedStream)
    : transformedStream
  }

  /**
   * @param {string} transformedData
   * @returns {Promise.<string>} recalculated hash of transformed file
   */
  async function recalculateHash(transformedData) {
    if (!fileLib.isGzipped(filePath)) {
      // Fast-path to avoid unnecessary conversion to stream
      return hashLib.hashFromString(transformedData)
    }
    const transformedStream = transformedDataToStream(transformedData)
    return hashLib.hashFromStream(transformedStream)
  }

  /**
   * Replaces file names with their hashed versions in a CSS file
   * @param {string} fileData
   * @returns {string}
   */
  function replaceHashedFilenamesInCss(fileData) {
    return fileData
    .replace(CSS_URL_REGEXP, cssUrlReplacer)
    .replace(CSS_SOURCEMAP_REGEXP, cssSourceMapReplacer)
  }

  /**
   * Replaces file names with their hashed versions in a Javascript file
   * @param {string} fileData
   * @returns {string}
   */
  function replaceHashedFilenamesInJs(fileData) {
    return fileData.replace(JS_SOURCEMAP_REGEXP, jsSourceMapReplacer)
  }

  /**
   * Replaces relative URLs with the hashed version from the digest
   * @param {string} match
   * @param {string} absoluteUrl
   * @returns {string}
   */
  function cssUrlReplacer(match, absoluteUrl) {
    return digest[absoluteUrl]
    ? `url(/${digest[absoluteUrl]})`
    : match
  }

  /**
   * Replaces the sourceMappingURL with the hashed version from the digest
   * @param {string} match
   * @param {string} fileBaseName
   * @returns {string}
   */
  function cssSourceMapReplacer(match, fileBaseName) {
    const sourceMappingUrl = hashedSourceMapFileBaseName(fileBaseName)
    return sourceMappingUrl
    ? `/*# sourceMappingURL=${sourceMappingUrl}*/`
    : match
  }

  /**
   * Replaces the sourceMappingURL with the hashed version from the digest
   * @param {string} match
   * @param {string} fileBaseName
   * @returns {string}
   */
  function jsSourceMapReplacer(match, fileBaseName) {
    const sourceMappingUrl = hashedSourceMapFileBaseName(fileBaseName)
    return sourceMappingUrl
    ? `//# sourceMappingURL=${sourceMappingUrl}`
    : match
  }

  /**
   * Looks up the hashed sourceMap file relative to the transformed file
   * @param {string} fileBaseName
   * @returns {(string|void)}
   */
  function hashedSourceMapFileBaseName(fileBaseName) {
    const matchedFileName = path.join(relativeDirPath, fileBaseName)
    if (digest[matchedFileName]) {
      return path.basename(digest[matchedFileName])
    }
  }
}

/**
 * @param {NodeJS.ReadableStream} stream
 * @returns {NodeJS.ReadableStream}
 */
function gzipStream(stream) {
  const gzip = zlib.createGzip(DEFAULT_GZIP_OPTIONS)
  return stream.pipe(gzip)
}

module.exports = {
  gzipStream,
  replaceHashedFilenames
}
