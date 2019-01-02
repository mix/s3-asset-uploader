// NPM imports
const mime = require('mime')

const EXTENSION_GZ_REGEXP = /\.gz$/
const EXTENSION_JS_REGEXP = /\.js(\.gz)?$/
const EXTENSION_CSS_REGEXP = /\.css(\.gz)?$/
const EXTENSION_SOURCEMAP_REGEXP = /\.(js|css)\.map$/

const CONTENT_TYPE_BINARY = 'application/octet-stream'
const CONTENT_TYPE_CSS = 'text/css'
const CONTENT_TYPE_JS = 'application/javascript'
const CONTENT_TYPE_JSON = 'application/json'

/**
 * @param {string} filePath The absolute path to the file
 * @returns {string} The MIME type of the file
 */
function getContentType(filePath) {
  // Override gzip MIME type for web application artifacts
  if (EXTENSION_JS_REGEXP.test(filePath)) {
    return CONTENT_TYPE_JS
  }
  if (EXTENSION_CSS_REGEXP.test(filePath)) {
    return CONTENT_TYPE_CSS
  }
  if (EXTENSION_SOURCEMAP_REGEXP.test(filePath)) {
    return CONTENT_TYPE_JSON
  }
  return mime.getType(filePath) || CONTENT_TYPE_BINARY
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isGzipped(filePath) {
  return EXTENSION_GZ_REGEXP.test(filePath)
}

module.exports = {
  CONTENT_TYPE_BINARY,
  CONTENT_TYPE_CSS,
  CONTENT_TYPE_JS,
  CONTENT_TYPE_JSON,
  getContentType,
  isGzipped
}
