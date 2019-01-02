// Node imports
const fs = require('fs')
const path = require('path')
// NPM imports
const Bluebird = require('bluebird')

/**
 * @param {string} basePath
 * @param {Array.<(RegExp|string)>} filters
 * @returns {Bluebird<Array.<string>>} The full paths of all files in the directory
 */
function getFileNames(basePath, filters = []) {
  return recurseDirectory(basePath)

  /**
   * @param {string} dirPath
   * @returns {Bluebird<Array.<string>>} The full paths of all files in the directory
   */
  function recurseDirectory(dirPath) {
    return Bluebird.fromCallback(callback => {
      fs.readdir(dirPath, { withFileTypes: true }, callback)
    })
    .then(dirents => {
      return Bluebird.map(dirents, dirent => {
        const fullPath = path.resolve(dirPath, dirent.name)
        if (isFiltered(fullPath)) {
          return []
        }
        if (dirent.isDirectory()) {
          return recurseDirectory(fullPath)
        }
        return [fullPath]
      })
    })
    .then(filePaths => Array.prototype.concat(...filePaths))
  }

  /**
   * @param {string} fullPath
   * @returns {boolean}
   */
  function isFiltered(fullPath) {
    const relativePath = path.relative(basePath, fullPath)
    return filters.some(filter => !!relativePath.match(filter))
  }
}

module.exports = {
  getFileNames
}
