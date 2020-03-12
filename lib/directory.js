// Node imports
const fs = require('fs')
const path = require('path')
// NPM imports
const Bluebird = require('bluebird')

/**
 * @param {string} basePath
 * @param {(RegExp|string)[]} filters
 * @returns {Promise.<string[]>} The full paths of all files in the directory
 */
async function getFileNames(basePath, filters = []) {
  return recurseDirectory(basePath)

  /**
   * @param {string} dirPath
   * @returns {Promise.<string[]>} The full paths of all files in the directory
   */
  async function recurseDirectory(dirPath) {
    const dirents = await Bluebird.fromCallback(callback => {
      fs.readdir(dirPath, { withFileTypes: true }, callback)
    })
    const filePaths = await Bluebird.map(dirents, dirent => {
      const fullPath = path.resolve(dirPath, dirent.name)
      if (isFiltered(fullPath)) {
        return []
      }
      if (dirent.isDirectory()) {
        return recurseDirectory(fullPath)
      }
      return [fullPath]
    })
    return Array.prototype.concat(...filePaths)
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
